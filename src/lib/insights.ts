// Pure analytics + restock suggestions. Reads State, never changes it. Runs under `node scripts/check-reports.ts`.
//
// Metric definitions (shown to the shopkeeper on the Reports screen):
//  • A sale is a CONFIRMED bill, counted on the day it was confirmed (device local time). Drafts, discarded and
//    reversed bills are never sales; reversed bills are listed separately.
//  • Sales = bill totals after discount. It is what the bills say, NOT money received: payment is only "recorded".
//  • Profit = sales − purchase cost of what was sold, and is shown only when EVERY item sold has a cost.
import {
  DAY,
  isActive,
  lineTotal,
  onOrderQty,
  searchProducts,
  stockStatus,
  targetOf,
  type PayMethod,
  type Product,
  type Sale,
  type State,
  type Unit,
} from './engine.ts'; // explicit .ts so the node check scripts can load this file too

// ---------- date ranges: [from, to) in epoch ms, local days ----------
export type RangeKey = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
export interface Range {
  from: number;
  to: number;
}

export function dayStart(t: number, plusDays = 0): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + plusDays);
  return d.getTime();
}

/** Week starts Monday. Everything runs up to the end of today. */
export function rangeFor(key: RangeKey, now: number, custom?: Range): Range {
  switch (key) {
    case 'yesterday':
      return { from: dayStart(now, -1), to: dayStart(now) };
    case 'week':
      return { from: dayStart(now, -((new Date(now).getDay() + 6) % 7)), to: dayStart(now, 1) };
    case 'month':
      return { from: new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime(), to: dayStart(now, 1) };
    case 'custom':
      return custom ?? rangeFor('today', now);
    default:
      return { from: dayStart(now), to: dayStart(now, 1) };
  }
}

/** "25/12/2026", "25-12-2026" or "2026-12-25" → local midnight; null if not a real date. */
export function parseDay(str: string): number | null {
  const m = str.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/) ?? str.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const [y, mo, d] = m[3].length === 4 ? [+m[3], +m[2], +m[1]] : [+m[1], +m[2], +m[3]];
  const t = new Date(y, mo - 1, d);
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? t.getTime() : null;
}

export function formatDay(t: number): string {
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Inclusive start and end dates → a range. Null when either is invalid or the end is before the start. */
export function customRange(fromStr: string, toStr: string): Range | null {
  const from = parseDay(fromStr);
  const last = parseDay(toStr);
  return from === null || last === null || last < from ? null : { from, to: dayStart(last, 1) };
}

// ---------- sales ----------
export const inRange = (t: number | undefined, r: Range) => t !== undefined && t >= r.from && t < r.to;

export const billsIn = (s: State, r: Range, pay?: PayMethod): Sale[] =>
  s.sales
    .filter((b) => b.status === 'confirmed' && inRange(b.confirmedAt, r) && (!pay || (b.pay ?? 'none') === pay))
    .sort((a, b) => (b.confirmedAt ?? 0) - (a.confirmedAt ?? 0));

export interface ProductSales {
  productId: string;
  name: string;
  unit: Unit;
  qty: number;
  revenuePaise: number; // line totals before any bill-level discount
}

export interface SalesReport {
  billCount: number;
  grossPaise: number; // sum of bill totals (after discount)
  avgPaise: number;
  discountPaise: number;
  pay: Record<PayMethod, number>; // recorded method; cash + upi + none === grossPaise
  reversed: { count: number; paise: number };
  profit: { paise: number | null; costlessLines: number; lines: number };
  byDay: { day: number; bills: number; paise: number }[];
  best: ProductSales[]; // by quantity
  bestByRevenue: ProductSales[];
  lowSellers: ProductSales[]; // sold something, but the least
  noSales: Product[]; // in stock, active, nothing sold
}

export function salesReport(s: State, r: Range, top = 10): SalesReport {
  const bills = billsIn(s, r);
  const pay: Record<PayMethod, number> = { cash: 0, upi: 0, none: 0 };
  const sold = new Map<string, ProductSales>();
  const days = new Map<number, { bills: number; paise: number }>();
  let gross = 0;
  let discount = 0;
  let cost = 0;
  let lines = 0;
  let costless = 0;
  for (const b of bills) {
    const total = b.totalPaise ?? 0;
    gross += total;
    discount += b.discountPaise ?? 0;
    pay[b.pay ?? 'none'] += total;
    const d = days.get(dayStart(b.confirmedAt!)) ?? { bills: 0, paise: 0 };
    days.set(dayStart(b.confirmedAt!), { bills: d.bills + 1, paise: d.paise + total });
    for (const i of b.items) {
      lines++;
      if (i.costPaise === undefined) costless++;
      else cost += lineTotal(i.costPaise, i.qty);
      const e = sold.get(i.productId) ?? { productId: i.productId, name: i.name, unit: i.unit, qty: 0, revenuePaise: 0 };
      e.qty += i.qty;
      e.revenuePaise += lineTotal(i.unitPaise, i.qty);
      sold.set(i.productId, e);
    }
  }
  const all = [...sold.values()];
  const rev = s.sales.filter((b) => b.status === 'voided' && inRange(b.confirmedAt, r));
  return {
    billCount: bills.length,
    grossPaise: gross,
    avgPaise: bills.length ? Math.round(gross / bills.length) : 0,
    discountPaise: discount,
    pay,
    reversed: { count: rev.length, paise: rev.reduce((a, b) => a + (b.totalPaise ?? 0), 0) },
    // Honest profit: all-or-nothing. Part-costed sales would overstate profit, so say "insufficient data" instead.
    profit: { paise: lines && !costless ? gross - cost : null, costlessLines: costless, lines },
    byDay: [...days].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day - b.day),
    best: [...all].sort((a, b) => b.qty - a.qty).slice(0, top),
    bestByRevenue: [...all].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, top),
    lowSellers: [...all].sort((a, b) => a.qty - b.qty).slice(0, 5),
    noSales: s.products
      .filter((p) => isActive(p) && p.stock > 0 && !sold.has(p.id))
      .sort((a, b) => lineTotal(b.pricePaise, b.stock) - lineTotal(a.pricePaise, a.stock))
      .slice(0, top),
  };
}

// ---------- inventory & purchasing ----------
export function stockValue(s: State) {
  let cost = 0;
  let sell = 0;
  let unknownCost = 0;
  let products = 0;
  for (const p of s.products) {
    if (!isActive(p) || p.stock <= 0) continue;
    products++;
    sell += lineTotal(p.pricePaise, p.stock);
    if (p.costPaise === undefined) unknownCost++;
    else cost += lineTotal(p.costPaise, p.stock);
  }
  return { costPaise: cost, sellPaise: sell, unknownCost, products };
}

/** Money spent on goods received in the range. Receipts without a recorded cost are counted, never guessed. */
export function purchaseSpend(s: State, r: Range) {
  let paise = 0;
  let costed = 0;
  let uncosted = 0;
  for (const m of s.movements) {
    if (m.kind !== 'purchase' || !inRange(m.at, r)) continue;
    if (m.costPaise === undefined) uncosted++;
    else {
      paise += lineTotal(m.costPaise, m.qty);
      costed++;
    }
  }
  return { paise, costed, uncosted };
}

// ---------- restock ----------
export interface Suggestion {
  qty: number; // 0 = nothing to order
  target: number;
  targetIsDefault: boolean;
  have: number;
  onOrder: number;
}

/** order = max(0, target − available − already on order), rounded UP to the supplier's pack size when one is set. */
export function suggestOrder(s: State, p: Product): Suggestion {
  const have = Math.max(0, p.stock); // a negative record means oversold; the shelf holds nothing
  const onOrder = onOrderQty(s, p.id);
  const t = targetOf(p);
  const raw = Math.max(0, t.qty - have - onOrder);
  const qty = raw > 0 && p.packQty && p.packQty > 0 ? Math.ceil(raw / p.packQty) * p.packQty : raw;
  return { qty, target: t.qty, targetIsDefault: t.isDefault, have, onOrder };
}

export interface AlertRow {
  p: Product;
  level: 'LOW' | 'OUT';
  sug: Suggestion;
  hidden: boolean;
}

/** Everything at or below its minimum, most urgent first (out of stock, then lowest relative to the minimum). */
export function stockAlerts(s: State, now: number): AlertRow[] {
  const rows: AlertRow[] = [];
  for (const p of s.products) {
    const level = stockStatus(p);
    if (!isActive(p) || level === 'OK') continue;
    const a = s.alerts[p.id];
    rows.push({ p, level, sug: suggestOrder(s, p), hidden: !!a && a.level === level && (a.until === undefined || now < a.until) });
  }
  const ratio = (r: AlertRow) => (r.p.lowAt > 0 ? r.p.stock / r.p.lowAt : 0);
  return rows.sort((a, b) => (a.level === b.level ? ratio(a) - ratio(b) || a.p.name.localeCompare(b.p.name) : a.level === 'OUT' ? -1 : 1));
}

// Prediction needs real history, so it says "not enough data" rather than guessing.
export const MIN_HISTORY_DAYS = 7; // the shop must have been billing at least this long
export const WINDOW_DAYS = 14; // sales rate = last 14 days
export const MIN_SALE_LINES = 3; // a product needs this many sales in the window
export const DEFAULT_LEAD_DAYS = 2;
export const SAFETY_DAYS = 3;

export interface SoonRow {
  p: Product;
  daysLeft: number;
  perDay: number; // milli per day, from recent sales
  sug: Suggestion;
}

export function restockSoon(s: State, now: number): { enoughHistory: boolean; historyDays: number; rows: SoonRow[] } {
  let first = Infinity;
  for (const b of s.sales) if ((b.status === 'confirmed' || b.status === 'voided') && b.confirmedAt !== undefined) first = Math.min(first, b.confirmedAt);
  const historyDays = Number.isFinite(first) ? (now - first) / DAY : 0;
  if (historyDays < MIN_HISTORY_DAYS) return { enoughHistory: false, historyDays, rows: [] };

  const winDays = Math.min(WINDOW_DAYS, historyDays);
  const since = now - winDays * DAY;
  const rate = new Map<string, { qty: number; lines: number }>();
  for (const b of s.sales) {
    if (b.status !== 'confirmed' || (b.confirmedAt ?? 0) < since) continue;
    for (const i of b.items) {
      const e = rate.get(i.productId) ?? { qty: 0, lines: 0 };
      rate.set(i.productId, { qty: e.qty + i.qty, lines: e.lines + 1 });
    }
  }
  const rows: SoonRow[] = [];
  for (const p of s.products) {
    const e = rate.get(p.id);
    if (!isActive(p) || stockStatus(p) !== 'OK' || !e || e.lines < MIN_SALE_LINES || e.qty <= 0) continue;
    const perDay = e.qty / winDays;
    const daysLeft = p.stock / perDay;
    if (daysLeft <= (p.leadDays ?? DEFAULT_LEAD_DAYS) + SAFETY_DAYS) rows.push({ p, daysLeft, perDay, sug: suggestOrder(s, p) });
  }
  return { enoughHistory: true, historyDays, rows: rows.sort((a, b) => a.daysLeft - b.daysLeft) };
}

// ---------- product list filters ----------
export type StockFilter = 'all' | 'in' | 'low' | 'out';

/** In stock = above its minimum. Low = at/below the minimum but not empty. Out = nothing left. They never overlap. */
export function filterProducts(s: State, q: string, filter: StockFilter, includeArchived = false): Product[] {
  const want = { all: null, in: 'OK', low: 'LOW', out: 'OUT' }[filter];
  return searchProducts(s.products, q, includeArchived).filter((p) => !want || stockStatus(p) === want);
}

export function stockCounts(s: State) {
  const c = { all: 0, in: 0, low: 0, out: 0 };
  for (const p of s.products) {
    if (!isActive(p)) continue;
    c.all++;
    const st = stockStatus(p);
    c[st === 'OK' ? 'in' : st === 'LOW' ? 'low' : 'out']++;
  }
  return c;
}
