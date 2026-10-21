// Pure billing / inventory / restocking logic. No React, no storage — so it runs under `node scripts/check-engine.ts`.
// Money = integer paise. Quantity = integer thousandths ("milli") of the product's own unit, so 0.5 kg is exact.
// For kg and L products 1 milli is exactly 1 g / 1 ml. Units only convert inside a family (g↔kg, ml↔L); see parseQtyIn.
// Stock is a balance kept in step with an append-only movement ledger; `reconcile` proves the two agree.

export type Unit = 'pcs' | 'pkt' | 'box' | 'g' | 'kg' | 'ml' | 'L';
export type Lang = 'en' | 'hi';
export type PayMethod = 'cash' | 'upi' | 'none';

export const DAY = 86_400_000;

export interface Product {
  id: string;
  name: string;
  aliases: string[];
  barcodes: string[]; // primary first, then aliases; always strings: leading zeroes matter
  unit: Unit;
  pack?: string;
  pricePaise: number;
  costPaise?: number; // last known purchase cost per unit
  stock: number; // milli
  lowAt: number; // milli — minimum before the product is flagged
  targetAt?: number; // milli — refill up to this; default is 3× the minimum (see targetOf)
  packQty?: number; // milli — suppliers sell in multiples of this (e.g. a case of 12)
  leadDays?: number; // days a supplier takes to deliver
  supplier?: string;
  notes?: string;
  category?: string;
  active: boolean; // false = archived: hidden from billing, kept for history
  createdAt: number;
  updatedAt: number;
  lastRestockedAt?: number;
}

export interface SaleItem {
  id: string;
  productId: string;
  name: string; // snapshots: a confirmed bill never changes when the catalog does
  unit: Unit;
  qty: number;
  unitPaise: number;
  costPaise?: number;
}

export interface Sale {
  id: string;
  label: number; // "SALE 1" — anonymous, no customer data
  status: 'draft' | 'confirmed' | 'cancelled' | 'voided';
  items: SaleItem[];
  createdAt: number;
  confirmedAt?: number;
  ref?: string;
  totalPaise?: number; // what the customer owes: items minus discount
  discountPaise?: number;
  pay?: PayMethod; // recorded as selected; UPI is never verified
  voidedAt?: number;
  voidReason?: string;
}

export interface Movement {
  id: string;
  productId: string;
  qty: number; // signed milli
  kind: 'opening' | 'sale' | 'purchase' | 'return' | 'damage' | 'adjust' | 'reversal';
  refId: string; // sale id, receipt id, product id (direct restock)…
  at: number;
  reason?: string;
  costPaise?: number; // unit cost, purchases only
  deviceId?: string;
}

// Restock list → (ordered) → received. Adding to a list never changes stock; only a receipt does.
export interface PurchaseLine {
  id: string;
  productId: string;
  name: string;
  unit: Unit;
  qty: number; // milli ordered
  received: number; // milli received so far
  costPaise?: number; // expected unit cost
}
export interface Receipt {
  id: string; // idempotency key: replaying the same receipt is a no-op
  at: number;
  lines: { lineId: string; qty: number; costPaise?: number }[];
}
export interface Purchase {
  id: string;
  status: 'list' | 'ordered' | 'closed' | 'cancelled';
  lines: PurchaseLine[];
  receipts: Receipt[];
  createdAt: number;
  orderedAt?: number;
  closedAt?: number;
}

// Hides a stock alert without touching stock. Valid only while the product stays at `level`.
export interface Alert {
  level: 'LOW' | 'OUT';
  until?: number; // snooze end; absent = dismissed until it recovers or gets worse
}

// Outbox entry. Payload/transport come with the sync phase; the id makes replays harmless.
export interface SyncEvent {
  id: string;
  seq: number;
  type:
    | 'product.created'
    | 'product.updated'
    | 'stock.restocked'
    | 'stock.adjusted'
    | 'purchase.received'
    | 'sale.confirmed'
    | 'sale.voided';
  entityId: string;
  at: number;
  deviceId: string;
}

export interface State {
  v: 2;
  deviceId: string;
  shopName: string;
  lang: Lang;
  products: Product[];
  sales: Sale[];
  movements: Movement[];
  purchases: Purchase[];
  alerts: Record<string, Alert>;
  events: SyncEvent[];
  billSeq: number;
  ackedSeq: number;
  lastSyncAt: number | null;
}

export type ErrCode =
  | 'NOT_DRAFT'
  | 'NOT_CONFIRMED'
  | 'NOT_FOUND'
  | 'EMPTY'
  | 'BAD_QTY'
  | 'BAD_PRICE'
  | 'BAD_COST'
  | 'STOCK'
  | 'BARCODE_TAKEN'
  | 'NAME'
  | 'REASON'
  | 'DISCOUNT'
  | 'CLOSED';
export class EngineError extends Error {
  code: ErrCode;
  detail?: string;
  constructor(code: ErrCode, detail?: string) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

// ---------- money & quantity ----------
export const lineTotal = (unitPaise: number, qty: number) => Math.round((unitPaise * qty) / 1000);
export const saleTotal = (items: SaleItem[]) => items.reduce((a, i) => a + lineTotal(i.unitPaise, i.qty), 0);
export const itemCount = (items: SaleItem[]) => items.length;

export function fmtMoney(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const s = String(rupees);
  const grouped = s.length > 3 ? s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3) : s;
  return `${neg ? '-' : ''}₹${grouped}${p ? '.' + String(p).padStart(2, '0') : ''}`;
}

export const fmtQty = (milli: number) => String(Math.round(milli) / 1000);

/** "2", "0.5" → milli; null when empty, non-numeric, ≤ 0 or absurd. */
export function parseQty(s: string): number | null {
  const n = Number(s.trim().replace(',', '.'));
  if (!s.trim() || !Number.isFinite(n) || n <= 0 || n > 100000) return null;
  return Math.round(n * 1000);
}

/** "12.50" → 1250 paise; null when invalid. Allows 0 only if allowZero. */
export function parsePaise(s: string, allowZero = false): number | null {
  const n = Number(s.trim().replace(',', '.'));
  if (!s.trim() || !Number.isFinite(n) || n < 0 || (n === 0 && !allowZero) || n > 10_000_000) return null;
  return Math.round(n * 100);
}

export const stepFor = (u: Unit) => (u === 'kg' || u === 'L' ? 500 : u === 'g' || u === 'ml' ? 100_000 : 1000);

// Only same-family units convert (weight ↔ weight, volume ↔ volume). Anything else is never guessed.
const FAMILY: Partial<Record<Unit, [family: 'mass' | 'volume', perBase: number]>> = {
  g: ['mass', 1],
  kg: ['mass', 1000],
  ml: ['volume', 1],
  L: ['volume', 1000],
};
const UNIT_WORD: Record<string, Unit> = { g: 'g', gm: 'g', gram: 'g', kg: 'kg', ml: 'ml', l: 'L', ltr: 'L', litre: 'L' };

/** Quantity typed for a product sold in `unit`: "2" → 2 units; "500g" on a kg item → 0.5 kg; "2kg" on a packet item → null. */
export function parseQtyIn(s: string, unit: Unit): number | null {
  const m = s.trim().toLowerCase().match(/^([\d.,]+)\s*([a-z]*)$/);
  if (!m) return null;
  const n = parseQty(m[1]);
  if (n === null || !m[2]) return n;
  const from = FAMILY[UNIT_WORD[m[2]]];
  const to = FAMILY[unit];
  return from && to && from[0] === to[0] ? Math.round((n * from[1]) / to[1]) : null;
}

/** Like parseQtyIn but "0" is allowed (thresholds, counts). Empty or invalid → null. */
export const parseQtyOrZero = (s: string, unit: Unit): number | null =>
  s.trim() && Number(s.trim().replace(',', '.')) === 0 ? 0 : parseQtyIn(s, unit);

// ---------- helpers ----------
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const norm = (s: string) => s.toLowerCase().trim();

export function searchProducts(products: Product[], query: string, includeArchived = false): Product[] {
  const q = norm(query);
  const pool = includeArchived ? products : products.filter(isActive);
  if (!q) return [...pool].sort((a, b) => a.name.localeCompare(b.name));
  const scored: [number, Product][] = [];
  for (const p of pool) {
    const names = [p.name, ...p.aliases].map(norm);
    let score = 0;
    if (p.barcodes.includes(query.trim())) score = 100;
    else if (names.some((n) => n === q)) score = 90;
    else if (names.some((n) => n.startsWith(q))) score = 70;
    else if (names.some((n) => n.split(/\s+/).some((w) => w.startsWith(q)))) score = 60;
    else if (names.some((n) => n.includes(q))) score = 40;
    if (score) scored.push([score, p]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).map((x) => x[1]);
}

/** Counter suggestions: what was sold most recently first, then the catalog A–Z, capped. */
export function recentProducts(s: State, limit = 12): Product[] {
  const out: Product[] = [];
  const seen = new Set<string>();
  const take = (p?: Product) => {
    if (p && !seen.has(p.id) && out.length < limit) {
      seen.add(p.id);
      out.push(p);
    }
  };
  for (const b of confirmedBills(s)) for (const i of b.items) take(s.products.find((p) => p.id === i.productId && isActive(p)));
  [...s.products].filter(isActive).sort((a, b) => a.name.localeCompare(b.name)).forEach(take);
  return out;
}

export const findByBarcode = (products: Product[], code: string) =>
  products.find((p) => p.barcodes.includes(code.trim()));

export const stockStatus = (p: Product): 'OUT' | 'LOW' | 'OK' => (p.stock <= 0 ? 'OUT' : p.stock <= p.lowAt ? 'LOW' : 'OK');

export const openDrafts = (s: State) => s.sales.filter((x) => x.status === 'draft').sort((a, b) => a.label - b.label);
export const confirmedBills = (s: State) =>
  s.sales.filter((x) => x.status === 'confirmed').sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0));
export const pendingEvents = (s: State) => s.events.filter((e) => e.seq > s.ackedSeq).length;

// ---------- state transitions (immutable; throw EngineError on invalid input) ----------
function event(s: State, type: SyncEvent['type'], entityId: string, at: number): SyncEvent[] {
  const seq = (s.events.length ? s.events[s.events.length - 1].seq : 0) + 1;
  return [...s.events, { id: uid(), seq, type, entityId, at, deviceId: s.deviceId }];
}

function draft(s: State, saleId: string): Sale {
  const sale = s.sales.find((x) => x.id === saleId);
  if (!sale) throw new EngineError('NOT_FOUND');
  if (sale.status !== 'draft') throw new EngineError('NOT_DRAFT');
  return sale;
}

const patchSale = (s: State, sale: Sale): State => ({ ...s, sales: s.sales.map((x) => (x.id === sale.id ? sale : x)) });

/** Reuses an empty draft instead of piling up blank sales. */
export function startSale(s: State, now: number): { state: State; id: string } {
  const empty = openDrafts(s).find((d) => d.items.length === 0);
  if (empty) return { state: s, id: empty.id };
  const used = new Set(openDrafts(s).map((d) => d.label));
  let label = 1;
  while (used.has(label)) label++;
  const sale: Sale = { id: uid(), label, status: 'draft', items: [], createdAt: now };
  return { state: { ...s, sales: [...s.sales, sale] }, id: sale.id };
}

const snapshot = (p: Product, qty: number): SaleItem => ({
  id: uid(),
  productId: p.id,
  name: p.name,
  unit: p.unit,
  qty,
  unitPaise: p.pricePaise,
  costPaise: p.costPaise,
});

export function addItem(s: State, saleId: string, productId: string, qty = 1000): State {
  const sale = draft(s, saleId);
  const p = s.products.find((x) => x.id === productId);
  if (!p || !isActive(p)) throw new EngineError('NOT_FOUND');
  if (qty <= 0) throw new EngineError('BAD_QTY');
  const line = sale.items.find((i) => i.productId === productId);
  const items = line
    ? sale.items.map((i) => (i === line ? { ...i, qty: i.qty + qty } : i))
    : [...sale.items, snapshot(p, qty)];
  return patchSale(s, { ...sale, items });
}

export function setItemQty(s: State, saleId: string, itemId: string, qty: number): State {
  const sale = draft(s, saleId);
  if (!(qty > 0)) throw new EngineError('BAD_QTY');
  return patchSale(s, { ...sale, items: sale.items.map((i) => (i.id === itemId ? { ...i, qty } : i)) });
}

export function removeItem(s: State, saleId: string, itemId: string): State {
  const sale = draft(s, saleId);
  return patchSale(s, { ...sale, items: sale.items.filter((i) => i.id !== itemId) });
}

/** Swap the product on one line, keeping its quantity. Merges if the new product is already on the bill. */
export function replaceItem(s: State, saleId: string, itemId: string, productId: string): State {
  const sale = draft(s, saleId);
  const old = sale.items.find((i) => i.id === itemId);
  const p = s.products.find((x) => x.id === productId);
  if (!old || !p) throw new EngineError('NOT_FOUND');
  const without = patchSale(s, { ...sale, items: sale.items.filter((i) => i.id !== itemId) });
  return addItem(without, saleId, productId, old.qty);
}

export function discardSale(s: State, saleId: string): State {
  const sale = draft(s, saleId);
  return patchSale(s, { ...sale, status: 'cancelled' });
}

export interface Shortage {
  productId: string;
  name: string;
  need: number;
  have: number;
}

export function stockShortages(s: State, sale: Sale): Shortage[] {
  const need = new Map<string, number>();
  for (const i of sale.items) need.set(i.productId, (need.get(i.productId) ?? 0) + i.qty);
  const out: Shortage[] = [];
  for (const [productId, n] of need) {
    const p = s.products.find((x) => x.id === productId);
    if (p && p.stock < n) out.push({ productId, name: p.name, need: n, have: p.stock });
  }
  return out;
}

/** Atomic by construction: returns one new State or throws, nothing is half-applied. Idempotent. */
export function confirmSale(s: State, saleId: string, pay: PayMethod, now: number, override = false, discountPaise = 0): State {
  const sale = s.sales.find((x) => x.id === saleId);
  if (!sale) throw new EngineError('NOT_FOUND');
  if (sale.status === 'confirmed') return s; // double-tap / retry: no second deduction
  if (sale.status !== 'draft') throw new EngineError('NOT_DRAFT');
  if (!sale.items.length) throw new EngineError('EMPTY');
  for (const i of sale.items) {
    if (!(i.qty > 0)) throw new EngineError('BAD_QTY');
    if (!s.products.some((p) => p.id === i.productId)) throw new EngineError('NOT_FOUND', i.name);
  }
  const gross = saleTotal(sale.items);
  if (!Number.isInteger(discountPaise) || discountPaise < 0 || discountPaise > gross) throw new EngineError('DISCOUNT');
  const short = stockShortages(s, sale);
  if (short.length && !override) throw new EngineError('STOCK', short.map((x) => x.name).join(', '));

  const billSeq = s.billSeq + 1;
  const moves = sale.items.map((i) => move(s, i.productId, 'sale', -i.qty, sale.id, now));
  const confirmed: Sale = {
    ...sale,
    status: 'confirmed',
    confirmedAt: now,
    ref: `B-${String(billSeq).padStart(4, '0')}`,
    totalPaise: gross - discountPaise,
    discountPaise: discountPaise || undefined,
    pay,
  };
  return settleAlerts({
    ...patchSale(s, confirmed),
    billSeq,
    products: applyMoves(s.products, moves),
    movements: [...s.movements, ...moves],
    events: event(s, 'sale.confirmed', sale.id, now),
  });
}

export interface NewProduct {
  name: string;
  barcode?: string;
  unit: Unit;
  pricePaise: number;
  costPaise?: number;
  openingQty: number;
  lowAt: number;
  targetAt?: number;
}

export function addProduct(s: State, input: NewProduct, now: number): { state: State; id: string } {
  const name = input.name.trim();
  if (!name) throw new EngineError('NAME');
  if (!(input.pricePaise > 0)) throw new EngineError('BAD_PRICE');
  if (input.openingQty < 0 || input.lowAt < 0) throw new EngineError('BAD_QTY');
  const code = input.barcode?.trim();
  if (code) {
    const taken = findByBarcode(s.products, code);
    if (taken) throw new EngineError('BARCODE_TAKEN', taken.name);
  }
  const p: Product = {
    id: uid(),
    name,
    aliases: [],
    barcodes: code ? [code] : [],
    unit: input.unit,
    pricePaise: input.pricePaise,
    costPaise: input.costPaise,
    stock: input.openingQty,
    lowAt: input.lowAt,
    targetAt: input.targetAt,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const moves = input.openingQty ? [move(s, p.id, 'opening', input.openingQty, p.id, now)] : [];
  return {
    id: p.id,
    state: settleAlerts({
      ...s,
      products: [...s.products, p],
      movements: [...s.movements, ...moves],
      events: event(s, 'product.created', p.id, now),
    }),
  };
}

/** Quick restock of one product: the goods are in your hands now. Same ledger kind as a received purchase. */
export function restock(s: State, productId: string, qty: number, costPaise: number | undefined, now: number): State {
  if (!(qty > 0)) throw new EngineError('BAD_QTY');
  if (!s.products.some((p) => p.id === productId)) throw new EngineError('NOT_FOUND');
  const m = move(s, productId, 'purchase', qty, productId, now, { costPaise });
  return settleAlerts({
    ...s,
    products: applyMoves(s.products, [m], now),
    movements: [...s.movements, m],
    events: event(s, 'stock.restocked', productId, now),
  });
}

export function receiptText(shopName: string, sale: Sale, payLine: string | null): string {
  const lines = sale.items.map(
    (i) => `${i.name}  ${fmtQty(i.qty)} ${i.unit} x ${fmtMoney(i.unitPaise)} = ${fmtMoney(lineTotal(i.unitPaise, i.qty))}`,
  );
  const when = new Date(sale.confirmedAt ?? sale.createdAt).toLocaleString();
  return [shopName, `${sale.ref ?? ''}  ${when}`, '', ...lines, '']
    .concat(sale.discountPaise ? [`DISCOUNT -${fmtMoney(sale.discountPaise)}`] : [])
    .concat([`TOTAL ${fmtMoney(sale.totalPaise ?? saleTotal(sale.items))}`])
    .concat(payLine ? [payLine] : [])
    .join('\n');
}

// ---------- first-run catalog ----------
type Seed = [name: string, aliases: string[], unit: Unit, pack: string | undefined, price: number, cost: number, stock: number, low: number, barcode?: string];

const SEED: Seed[] = [
  ['Maggi Masala Noodles', ['maggi', 'noodles', 'instant noodles', 'मैगी', 'नूडल्स'], 'pkt', '70 g', 14, 11.5, 40, 10, '8901058852134'],
  ['Maggi Atta Noodles', ['maggi atta', 'atta noodles'], 'pkt', '75 g', 16, 13, 25, 10],
  ['Pasta Penne', ['pasta'], 'pkt', '500 g', 85, 70, 12, 5, '0123456789012'],
  ['Aashirvaad Atta', ['aata', 'atta', 'flour', 'gehu ka atta', 'आटा'], 'pkt', '5 kg', 285, 255, 15, 5],
  ['Loose Atta', ['aata', 'atta loose', 'आटा', 'खुला आटा'], 'kg', undefined, 52, 46, 30, 10],
  ['Amul Milk', ['doodh', 'milk', 'dudh', 'दूध'], 'pkt', '500 ml', 29, 27, 24, 8, '8901262010016'],
  ['Parle-G Biscuit', ['biscuit', 'biscuits', 'parle', 'बिस्कुट', 'पारले'], 'pkt', '800 g', 80, 70, 18, 6, '8901719101014'],
  ['Good Day Biscuit', ['biscuit', 'biscuits', 'britannia', 'बिस्कुट'], 'pkt', '200 g', 40, 34, 20, 6],
  ['Tata Salt', ['namak', 'salt', 'नमक'], 'pkt', '1 kg', 28, 24, 30, 8],
  ['Sugar', ['cheeni', 'shakkar', 'sugar', 'चीनी', 'शक्कर'], 'kg', undefined, 46, 41, 40, 10],
  ['Toor Dal', ['dal', 'arhar', 'tuvar', 'दाल', 'अरहर'], 'kg', undefined, 160, 142, 20, 5],
  ['Fortune Sunflower Oil', ['tel', 'oil', 'refined oil', 'तेल'], 'L', '1 L', 145, 130, 14, 5],
  ['Tata Tea Gold', ['chai', 'chai patti', 'tea', 'चाय', 'चायपत्ती'], 'pkt', '250 g', 150, 132, 10, 4],
  ['Surf Excel', ['detergent', 'washing powder', 'सर्फ', 'डिटर्जेंट'], 'pkt', '1 kg', 135, 118, 9, 4],
  ['Lifebuoy Soap', ['sabun', 'soap', 'साबुन'], 'pcs', '100 g', 32, 27, 36, 12],
];

export function newState(deviceId: string, now: number): State {
  const products: Product[] = SEED.map(([name, aliases, unit, pack, price, cost, stock, low, barcode]) => ({
    id: uid(),
    name,
    aliases,
    barcodes: barcode ? [barcode] : [],
    unit,
    pack,
    pricePaise: Math.round(price * 100),
    costPaise: Math.round(cost * 100),
    stock: stock * 1000,
    lowAt: low * 1000,
    active: true,
    createdAt: now,
    updatedAt: now,
  }));
  return {
    v: 2,
    deviceId,
    shopName: 'My Kirana Store',
    lang: 'en',
    products,
    sales: [],
    movements: products.map((p) => ({ id: uid(), productId: p.id, qty: p.stock, kind: 'opening', refId: p.id, at: now, deviceId })),
    purchases: [],
    alerts: {},
    events: [],
    billSeq: 0,
    ackedSeq: 0,
    lastSyncAt: null,
  };
}

// ---------- ledger helpers ----------
export const isActive = (p: Product) => p.active !== false;
export const voidedBills = (s: State) =>
  s.sales.filter((x) => x.status === 'voided').sort((a, b) => (b.voidedAt ?? 0) - (a.voidedAt ?? 0));

function move(s: State, productId: string, kind: Movement['kind'], qty: number, refId: string, at: number, extra: Partial<Movement> = {}): Movement {
  return { id: uid(), productId, qty, kind, refId, at, deviceId: s.deviceId, ...extra };
}

/** Adds each movement's signed quantity to its product's balance. */
function applyMoves(products: Product[], moves: Movement[], restockedAt?: number): Product[] {
  const delta = new Map<string, number>();
  for (const m of moves) delta.set(m.productId, (delta.get(m.productId) ?? 0) + m.qty);
  return products.map((p) => {
    const d = delta.get(p.id);
    if (d === undefined) return p;
    const bought = moves.some((m) => m.productId === p.id && m.kind === 'purchase');
    return { ...p, stock: p.stock + d, ...(bought && restockedAt ? { lastRestockedAt: restockedAt, updatedAt: restockedAt } : {}) };
  });
}

export const movementsFor = (s: State, productId: string) =>
  s.movements.filter((m) => m.productId === productId).sort((a, b) => b.at - a.at);

/** Products whose balance disagrees with the sum of their ledger. Empty = books are consistent. */
export function reconcile(s: State): { productId: string; name: string; ledger: number; stock: number }[] {
  const sum = new Map<string, number>();
  for (const m of s.movements) sum.set(m.productId, (sum.get(m.productId) ?? 0) + m.qty);
  return s.products
    .filter((p) => (sum.get(p.id) ?? 0) !== p.stock)
    .map((p) => ({ productId: p.id, name: p.name, ledger: sum.get(p.id) ?? 0, stock: p.stock }));
}

/** Merge movements from another device. A set union by id: replays and duplicates change nothing. */
export function mergeMovements(s: State, incoming: Movement[]): { state: State; applied: number; duplicates: number } {
  const have = new Set(s.movements.map((m) => m.id));
  const fresh = incoming.filter((m) => {
    if (have.has(m.id) || !s.products.some((p) => p.id === m.productId)) return false;
    have.add(m.id); // also drops duplicates inside `incoming`
    return true;
  });
  if (!fresh.length) return { state: s, applied: 0, duplicates: incoming.length };
  const at = Math.max(...fresh.map((m) => m.at));
  return {
    state: settleAlerts({ ...s, products: applyMoves(s.products, fresh, at), movements: [...s.movements, ...fresh] }),
    applied: fresh.length,
    duplicates: incoming.length - fresh.length,
  };
}

// ---------- product upkeep ----------
export interface ProductPatch {
  name?: string;
  pricePaise?: number;
  costPaise?: number | null; // null clears
  lowAt?: number;
  targetAt?: number | null;
  packQty?: number | null;
  leadDays?: number | null;
  supplier?: string | null;
  notes?: string | null;
  category?: string | null;
  barcodes?: string[];
  active?: boolean;
}

export function updateProduct(s: State, productId: string, patch: ProductPatch, now: number): State {
  const p = s.products.find((x) => x.id === productId);
  if (!p) throw new EngineError('NOT_FOUND');
  if (patch.name !== undefined && !patch.name.trim()) throw new EngineError('NAME');
  if (patch.pricePaise !== undefined && !(patch.pricePaise > 0)) throw new EngineError('BAD_PRICE');
  if (patch.costPaise != null && !(patch.costPaise >= 0)) throw new EngineError('BAD_COST');
  for (const v of [patch.lowAt, patch.targetAt, patch.packQty, patch.leadDays]) if (v != null && !(v >= 0)) throw new EngineError('BAD_QTY');
  const clean = { ...patch, name: patch.name?.trim() };
  if (patch.barcodes) {
    const codes = [...new Set(patch.barcodes.map((b) => b.trim()).filter(Boolean))];
    const clash = s.products.find((x) => x.id !== productId && codes.some((c) => x.barcodes.includes(c)));
    if (clash) throw new EngineError('BARCODE_TAKEN', clash.name);
    clean.barcodes = codes;
  }
  const next: Record<string, unknown> = { ...p, updatedAt: now };
  for (const [k, v] of Object.entries(clean)) {
    if (v === null) delete next[k];
    else if (v !== undefined) next[k] = v;
  }
  return settleAlerts({
    ...s,
    products: s.products.map((x) => (x.id === productId ? (next as unknown as Product) : x)),
    events: event(s, 'product.updated', productId, now),
  });
}

/** Damaged/expired (−), a recount (±) or a customer return (+). Every one needs a ledger line; damage and recount need a reason. */
export function adjustStock(s: State, productId: string, delta: number, kind: 'damage' | 'adjust' | 'return', reason: string, now: number): State {
  const p = s.products.find((x) => x.id === productId);
  if (!p) throw new EngineError('NOT_FOUND');
  if (!Number.isFinite(delta) || delta === 0 || (kind === 'damage' && delta > 0) || (kind === 'return' && delta < 0)) throw new EngineError('BAD_QTY');
  if (kind !== 'return' && !reason.trim()) throw new EngineError('REASON');
  if (p.stock + delta < 0) throw new EngineError('STOCK', p.name);
  const m = move(s, productId, kind, delta, productId, now, { reason: reason.trim() || undefined });
  return settleAlerts({
    ...s,
    products: applyMoves(s.products, [m]).map((x) => (x.id === productId ? { ...x, updatedAt: now } : x)),
    movements: [...s.movements, m],
    events: event(s, 'stock.adjusted', productId, now),
  });
}

/** Cancel a completed bill: stock goes back through reversal movements, the bill stops counting as a sale. Idempotent. */
export function voidSale(s: State, saleId: string, reason: string, now: number): State {
  const sale = s.sales.find((x) => x.id === saleId);
  if (!sale) throw new EngineError('NOT_FOUND');
  if (sale.status === 'voided') return s;
  if (sale.status !== 'confirmed') throw new EngineError('NOT_CONFIRMED');
  if (!reason.trim()) throw new EngineError('REASON');
  const moves = sale.items.filter((i) => s.products.some((p) => p.id === i.productId)).map((i) => move(s, i.productId, 'reversal', i.qty, sale.id, now, { reason: reason.trim() }));
  return settleAlerts({
    ...patchSale(s, { ...sale, status: 'voided', voidedAt: now, voidReason: reason.trim() }),
    products: applyMoves(s.products, moves),
    movements: [...s.movements, ...moves],
    events: event(s, 'sale.voided', sale.id, now),
  });
}

// ---------- restock list & receiving ----------
export const openList = (s: State) => s.purchases.find((p) => p.status === 'list');
export const outstanding = (l: PurchaseLine) => Math.max(0, l.qty - l.received);
/** Quantity ordered but not yet received. A plain list does not count — only placed orders do. */
export const onOrderQty = (s: State, productId: string) =>
  s.purchases
    .filter((p) => p.status === 'ordered')
    .reduce((a, p) => a + p.lines.filter((l) => l.productId === productId).reduce((b, l) => b + outstanding(l), 0), 0);

function purchase(s: State, id: string): Purchase {
  const p = s.purchases.find((x) => x.id === id);
  if (!p) throw new EngineError('NOT_FOUND');
  return p;
}
const patchPurchase = (s: State, p: Purchase): State => ({ ...s, purchases: s.purchases.map((x) => (x.id === p.id ? p : x)) });
function editable(s: State, id: string): Purchase {
  const p = purchase(s, id);
  if (p.status !== 'list') throw new EngineError('CLOSED');
  return p;
}

/** Puts a product on the open restock list (creating it). Already listed: no change. */
export function addToList(s: State, productId: string, qty: number, now: number): { state: State; id: string } {
  const p = s.products.find((x) => x.id === productId);
  if (!p || !isActive(p)) throw new EngineError('NOT_FOUND');
  if (!(qty > 0)) throw new EngineError('BAD_QTY');
  const list = openList(s) ?? { id: uid(), status: 'list' as const, lines: [], receipts: [], createdAt: now };
  if (list.lines.some((l) => l.productId === productId)) return { state: s, id: list.id };
  const line: PurchaseLine = { id: uid(), productId, name: p.name, unit: p.unit, qty, received: 0, costPaise: p.costPaise };
  const next = { ...list, lines: [...list.lines, line] };
  return { id: list.id, state: s.purchases.some((x) => x.id === list.id) ? patchPurchase(s, next) : { ...s, purchases: [...s.purchases, next] } };
}

export function setLineQty(s: State, purchaseId: string, lineId: string, qty: number): State {
  const p = editable(s, purchaseId);
  if (!(qty > 0)) throw new EngineError('BAD_QTY');
  return patchPurchase(s, { ...p, lines: p.lines.map((l) => (l.id === lineId ? { ...l, qty } : l)) });
}

export function removeLine(s: State, purchaseId: string, lineId: string): State {
  const p = editable(s, purchaseId);
  return patchPurchase(s, { ...p, lines: p.lines.filter((l) => l.id !== lineId) });
}

/** "I have placed this order": its outstanding quantities now count as on order. Stock is untouched. */
export function markOrdered(s: State, purchaseId: string, now: number): State {
  const p = editable(s, purchaseId);
  if (!p.lines.length) throw new EngineError('EMPTY');
  return patchPurchase(s, { ...p, status: 'ordered', orderedAt: now });
}

export function cancelPurchase(s: State, purchaseId: string, now: number): State {
  const p = purchase(s, purchaseId);
  if (p.status === 'cancelled') return s;
  if (p.status === 'closed') throw new EngineError('CLOSED');
  return patchPurchase(s, { ...p, status: 'cancelled', closedAt: now });
}

/**
 * Goods arrived (all or part). Stock moves only here. `receiptId` makes a repeated request a no-op;
 * unreceived quantity stays outstanding and the purchase stays open as an order.
 */
export function receivePurchase(
  s: State,
  purchaseId: string,
  receiptId: string,
  lines: { lineId: string; qty: number; costPaise?: number }[],
  now: number,
): State {
  const p = purchase(s, purchaseId);
  if (s.purchases.some((x) => x.receipts.some((r) => r.id === receiptId))) return s;
  if (p.status !== 'list' && p.status !== 'ordered') throw new EngineError('CLOSED');
  const take = lines.filter((l) => l.qty > 0);
  if (!take.length) throw new EngineError('EMPTY');
  for (const l of take) {
    if (!p.lines.some((x) => x.id === l.lineId)) throw new EngineError('NOT_FOUND');
    if (!Number.isFinite(l.qty)) throw new EngineError('BAD_QTY');
    if (l.costPaise !== undefined && !(l.costPaise >= 0)) throw new EngineError('BAD_COST');
  }
  const byId = new Map(p.lines.map((l) => [l.id, l]));
  const moves = take.map((l) => move(s, byId.get(l.lineId)!.productId, 'purchase', l.qty, receiptId, now, { costPaise: l.costPaise }));
  const got = new Map(take.map((l) => [l.lineId, l]));
  const updated = p.lines.map((l) => (got.has(l.id) ? { ...l, received: l.received + got.get(l.id)!.qty } : l));
  const done = updated.every((l) => l.received >= l.qty);
  const costs = new Map(take.filter((l) => l.costPaise !== undefined).map((l) => [byId.get(l.lineId)!.productId, l.costPaise!]));
  const next: Purchase = {
    ...p,
    lines: updated,
    receipts: [...p.receipts, { id: receiptId, at: now, lines: take }],
    status: done ? 'closed' : 'ordered',
    orderedAt: p.orderedAt ?? now,
    closedAt: done ? now : undefined,
  };
  return settleAlerts({
    ...patchPurchase(s, next),
    products: applyMoves(s.products, moves, now).map((x) => (costs.has(x.id) ? { ...x, costPaise: costs.get(x.id) } : x)),
    movements: [...s.movements, ...moves],
    events: event(s, 'purchase.received', receiptId, now),
  });
}

// ---------- alerts ----------
export const targetOf = (p: Product): { qty: number; isDefault: boolean } =>
  p.targetAt !== undefined ? { qty: p.targetAt, isDefault: false } : { qty: p.lowAt * 3, isDefault: true };

export function alertHidden(s: State, p: Product, now: number): boolean {
  const a = s.alerts[p.id];
  const level = stockStatus(p);
  return !!a && level !== 'OK' && a.level === level && (a.until === undefined || now < a.until);
}

/** dismiss: hidden until the product recovers or gets worse. snooze: hidden for `days`. clear: show again. Stock is never touched. */
export function setAlert(s: State, productId: string, mode: 'dismiss' | 'snooze' | 'clear', now: number, days = 1): State {
  const p = s.products.find((x) => x.id === productId);
  if (!p) throw new EngineError('NOT_FOUND');
  const rest = { ...s.alerts };
  delete rest[productId];
  const level = stockStatus(p);
  if (mode === 'clear' || level === 'OK') return { ...s, alerts: rest };
  return { ...s, alerts: { ...rest, [productId]: mode === 'snooze' ? { level, until: now + days * DAY } : { level } } };
}

/** Forget alert settings for products that have recovered, so a later dip is flagged again. Run after any stock change. */
export function settleAlerts(s: State): State {
  const ids = Object.keys(s.alerts);
  if (!ids.length) return s;
  const keep = ids.filter((id) => {
    const p = s.products.find((x) => x.id === id);
    return p && isActive(p) && stockStatus(p) !== 'OK';
  });
  if (keep.length === ids.length) return s;
  return { ...s, alerts: Object.fromEntries(keep.map((id) => [id, s.alerts[id]])) };
}

// ---------- upgrade older saved data ----------
export function migrate(raw: any): State {
  const opened = new Map<string, number>();
  for (const m of raw.movements ?? []) if (m.kind === 'opening') opened.set(m.productId, m.at);
  const at = Date.now();
  return {
    ...raw,
    v: 2,
    products: (raw.products ?? []).map((p: any) => ({
      ...p,
      active: p.active ?? true,
      createdAt: p.createdAt ?? opened.get(p.id) ?? at,
      updatedAt: p.updatedAt ?? p.createdAt ?? opened.get(p.id) ?? at,
    })),
    movements: (raw.movements ?? []).map((m: any) => ({ ...m, kind: m.kind === 'restock' ? 'purchase' : m.kind, deviceId: m.deviceId ?? raw.deviceId })),
    events: (raw.events ?? []).map((e: any) => ({ ...e, id: e.id ?? `${raw.deviceId}-${e.seq}`, deviceId: e.deviceId ?? raw.deviceId })),
    purchases: raw.purchases ?? [],
    alerts: raw.alerts ?? {},
  } as State;
}
