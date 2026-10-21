// Pure billing/inventory logic. No React, no storage — so it runs under `node scripts/check-engine.ts`.
// Money = integer paise. Quantity = integer thousandths ("milli") so 0.5 kg is exact.

export type Unit = 'pcs' | 'pkt' | 'box' | 'g' | 'kg' | 'ml' | 'L';
export type Lang = 'en' | 'hi';
export type PayMethod = 'cash' | 'upi' | 'none';

export interface Product {
  id: string;
  name: string;
  aliases: string[];
  barcodes: string[]; // always strings: leading zeroes matter
  unit: Unit;
  pack?: string;
  pricePaise: number;
  costPaise?: number;
  stock: number; // milli
  lowAt: number; // milli
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
  status: 'draft' | 'confirmed' | 'cancelled';
  items: SaleItem[];
  createdAt: number;
  confirmedAt?: number;
  ref?: string;
  totalPaise?: number;
  pay?: PayMethod;
}

export interface Movement {
  id: string;
  productId: string;
  qty: number; // signed milli
  kind: 'opening' | 'sale' | 'restock';
  refId: string;
  at: number;
}

// Outbox entry. Payload/hash/transport come with the sync phase.
export interface SyncEvent {
  seq: number;
  type: 'product.created' | 'stock.restocked' | 'sale.confirmed';
  entityId: string;
  at: number;
}

export interface State {
  v: 1;
  deviceId: string;
  shopName: string;
  lang: Lang;
  products: Product[];
  sales: Sale[];
  movements: Movement[];
  events: SyncEvent[];
  billSeq: number;
  ackedSeq: number;
  lastSyncAt: number | null;
}

export type ErrCode = 'NOT_DRAFT' | 'NOT_FOUND' | 'EMPTY' | 'BAD_QTY' | 'BAD_PRICE' | 'STOCK' | 'BARCODE_TAKEN' | 'NAME';
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

// ---------- helpers ----------
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const norm = (s: string) => s.toLowerCase().trim();

export function searchProducts(products: Product[], query: string): Product[] {
  const q = norm(query);
  if (!q) return [...products].sort((a, b) => a.name.localeCompare(b.name));
  const scored: [number, Product][] = [];
  for (const p of products) {
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
  for (const b of confirmedBills(s)) for (const i of b.items) take(s.products.find((p) => p.id === i.productId));
  [...s.products].sort((a, b) => a.name.localeCompare(b.name)).forEach(take);
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
  return [...s.events, { seq, type, entityId, at }];
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
  if (!p) throw new EngineError('NOT_FOUND');
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
export function confirmSale(s: State, saleId: string, pay: PayMethod, now: number, override = false): State {
  const sale = s.sales.find((x) => x.id === saleId);
  if (!sale) throw new EngineError('NOT_FOUND');
  if (sale.status === 'confirmed') return s; // double-tap / retry: no second deduction
  if (sale.status !== 'draft') throw new EngineError('NOT_DRAFT');
  if (!sale.items.length) throw new EngineError('EMPTY');
  for (const i of sale.items) {
    if (!(i.qty > 0)) throw new EngineError('BAD_QTY');
    if (!s.products.some((p) => p.id === i.productId)) throw new EngineError('NOT_FOUND', i.name);
  }
  const short = stockShortages(s, sale);
  if (short.length && !override) throw new EngineError('STOCK', short.map((x) => x.name).join(', '));

  const billSeq = s.billSeq + 1;
  const moves: Movement[] = sale.items.map((i) => ({
    id: uid(),
    productId: i.productId,
    qty: -i.qty,
    kind: 'sale',
    refId: sale.id,
    at: now,
  }));
  const delta = new Map<string, number>();
  for (const m of moves) delta.set(m.productId, (delta.get(m.productId) ?? 0) + m.qty);
  const confirmed: Sale = {
    ...sale,
    status: 'confirmed',
    confirmedAt: now,
    ref: `B-${String(billSeq).padStart(4, '0')}`,
    totalPaise: saleTotal(sale.items),
    pay,
  };
  return {
    ...patchSale(s, confirmed),
    billSeq,
    products: s.products.map((p) => (delta.has(p.id) ? { ...p, stock: p.stock + delta.get(p.id)! } : p)),
    movements: [...s.movements, ...moves],
    events: event(s, 'sale.confirmed', sale.id, now),
  };
}

export interface NewProduct {
  name: string;
  barcode?: string;
  unit: Unit;
  pricePaise: number;
  costPaise?: number;
  openingQty: number;
  lowAt: number;
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
  };
  const moves: Movement[] = input.openingQty
    ? [{ id: uid(), productId: p.id, qty: input.openingQty, kind: 'opening', refId: p.id, at: now }]
    : [];
  return {
    id: p.id,
    state: {
      ...s,
      products: [...s.products, p],
      movements: [...s.movements, ...moves],
      events: event(s, 'product.created', p.id, now),
    },
  };
}

export function restock(s: State, productId: string, qty: number, costPaise: number | undefined, now: number): State {
  if (!(qty > 0)) throw new EngineError('BAD_QTY');
  if (!s.products.some((p) => p.id === productId)) throw new EngineError('NOT_FOUND');
  return {
    ...s,
    products: s.products.map((p) =>
      p.id === productId ? { ...p, stock: p.stock + qty, costPaise: costPaise ?? p.costPaise } : p,
    ),
    movements: [...s.movements, { id: uid(), productId, qty, kind: 'restock', refId: productId, at: now }],
    events: event(s, 'stock.restocked', productId, now),
  };
}

// ---------- reports ----------
const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);

export function todaySummary(s: State, now: number) {
  const from = startOfDay(now);
  const bills = confirmedBills(s).filter((b) => (b.confirmedAt ?? 0) >= from);
  const sold = new Map<string, { name: string; unit: Unit; qty: number }>();
  let totalPaise = 0;
  let costKnown = true;
  let costPaise = 0;
  for (const b of bills) {
    totalPaise += b.totalPaise ?? 0;
    for (const i of b.items) {
      const e = sold.get(i.productId) ?? { name: i.name, unit: i.unit, qty: 0 };
      e.qty += i.qty;
      sold.set(i.productId, e);
      if (i.costPaise === undefined) costKnown = false;
      else costPaise += lineTotal(i.costPaise, i.qty);
    }
  }
  const moves = s.movements.filter((m) => m.at >= from);
  return {
    totalPaise,
    billCount: bills.length,
    best: [...sold.values()].sort((a, b) => b.qty - a.qty).slice(0, 5),
    low: s.products.filter((p) => stockStatus(p) !== 'OK').sort((a, b) => a.stock - b.stock),
    movements: {
      sold: moves.filter((m) => m.kind === 'sale').length,
      restocked: moves.filter((m) => m.kind === 'restock').length,
      opened: moves.filter((m) => m.kind === 'opening').length,
    },
    // Profit only when every line sold today carries a purchase cost.
    profitPaise: bills.length && costKnown ? totalPaise - costPaise : null,
  };
}

export function receiptText(shopName: string, sale: Sale, payLine: string | null): string {
  const lines = sale.items.map(
    (i) => `${i.name}  ${fmtQty(i.qty)} ${i.unit} x ${fmtMoney(i.unitPaise)} = ${fmtMoney(lineTotal(i.unitPaise, i.qty))}`,
  );
  const when = new Date(sale.confirmedAt ?? sale.createdAt).toLocaleString();
  return [shopName, `${sale.ref ?? ''}  ${when}`, '', ...lines, '', `TOTAL ${fmtMoney(sale.totalPaise ?? saleTotal(sale.items))}`]
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
  }));
  return {
    v: 1,
    deviceId,
    shopName: 'My Kirana Store',
    lang: 'en',
    products,
    sales: [],
    movements: products.map((p) => ({ id: uid(), productId: p.id, qty: p.stock, kind: 'opening', refId: p.id, at: now })),
    events: [],
    billSeq: 0,
    ackedSeq: 0,
    lastSyncAt: null,
  };
}
