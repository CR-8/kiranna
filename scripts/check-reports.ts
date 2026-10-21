// Run: node scripts/check-reports.ts  — analytics and restock suggestions, no framework.
import assert from 'node:assert/strict';
import * as E from '../src/lib/engine.ts';
import * as I from '../src/lib/insights.ts';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const now = at(2026, 10, 21, 15); // Wednesday
const DAY = E.DAY;

// ---------- date ranges ----------
assert.deepEqual(I.rangeFor('today', now), { from: at(2026, 10, 21, 0), to: at(2026, 10, 22, 0) });
assert.deepEqual(I.rangeFor('yesterday', now), { from: at(2026, 10, 20, 0), to: at(2026, 10, 21, 0) });
assert.equal(I.rangeFor('week', now).from, at(2026, 10, 19, 0), 'week starts Monday');
assert.equal(I.rangeFor('week', at(2026, 10, 19, 1)).from, at(2026, 10, 19, 0));
assert.equal(I.rangeFor('week', at(2026, 10, 25, 23)).from, at(2026, 10, 19, 0), 'Sunday still belongs to the week that began Monday');
assert.equal(I.rangeFor('month', now).from, at(2026, 10, 1, 0));
assert.equal(I.parseDay('25/12/2026'), at(2026, 12, 25, 0));
assert.equal(I.parseDay('2026-12-25'), at(2026, 12, 25, 0));
assert.equal(I.parseDay('30/02/2026'), null);
assert.equal(I.parseDay('hello'), null);
assert.deepEqual(I.customRange('20/10/2026', '21/10/2026'), { from: at(2026, 10, 20, 0), to: at(2026, 10, 22, 0) }, 'end date is inclusive');
assert.equal(I.customRange('22/10/2026', '21/10/2026'), null);

// ---------- build a small shop history ----------
let st = E.newState('dev1', at(2026, 9, 1));
const prod = (n: string) => st.products.find((p) => p.name.startsWith(n))!;
const maggi = prod('Maggi Masala'); // ₹14, cost 11.5
const milk = prod('Amul Milk'); // ₹29, cost 27
const sugar = prod('Sugar'); // ₹46/kg, cost 41
function sell(items: [E.Product, number][], when: number, pay: E.PayMethod = 'cash', discount = 0) {
  const r = E.startSale(st, when);
  let x = r.state;
  for (const [p, q] of items) x = E.addItem(x, r.id, p.id, q);
  st = E.confirmSale(x, r.id, pay, when, true, discount);
  return r.id;
}
sell([[maggi, 2000]], at(2026, 10, 21, 10), 'cash'); // ₹28
sell([[milk, 1000], [maggi, 1000]], at(2026, 10, 21, 11), 'upi'); // ₹43
const big = sell([[sugar, 2000]], at(2026, 10, 21, 12), 'none', 200); // ₹92 − ₹2 = ₹90
const cancelled = sell([[milk, 4000]], at(2026, 10, 21, 13), 'cash'); // ₹116, then reversed
st = E.voidSale(st, cancelled, 'customer left', at(2026, 10, 21, 14));
sell([[maggi, 3000]], at(2026, 10, 20, 18), 'cash'); // yesterday ₹42
sell([[milk, 1000]], at(2026, 10, 13, 9), 'cash'); // last week, ₹29
const open = E.startSale(st, now); // a draft: never a sale
st = E.addItem(open.state, open.id, milk.id, 9000);

const today = I.salesReport(st, I.rangeFor('today', now));
assert.equal(today.billCount, 3);
assert.equal(today.grossPaise, 2800 + 4300 + 9000);
assert.equal(today.avgPaise, Math.round(16100 / 3));
assert.equal(today.discountPaise, 200);
assert.deepEqual(today.pay, { cash: 2800, upi: 4300, none: 9000 });
assert.equal(today.pay.cash + today.pay.upi + today.pay.none, today.grossPaise, 'payment buckets add up to sales');
assert.deepEqual(today.reversed, { count: 1, paise: 11600 }, 'reversed bill is listed, not sold');
assert.equal(today.best[0].name, 'Maggi Masala Noodles');
assert.equal(today.best[0].qty, 3000);
assert.equal(today.bestByRevenue[0].name, 'Sugar');
assert.equal(today.byDay.length, 1);
assert.ok(today.noSales.every((p) => !['Maggi Masala Noodles', 'Amul Milk', 'Sugar'].includes(p.name)), 'no-sales list excludes sold products');
assert.equal(I.salesReport(st, I.rangeFor('yesterday', now)).grossPaise, 4200);
const week = I.salesReport(st, I.rangeFor('week', now));
assert.equal(week.grossPaise, 16100 + 4200);
assert.equal(week.byDay.length, 2);
assert.equal(I.salesReport(st, I.rangeFor('month', now)).grossPaise, 16100 + 4200 + 2900);
assert.equal(I.salesReport(st, I.customRange('13/10/2026', '13/10/2026')!).grossPaise, 2900);
assert.equal(I.salesReport(st, I.rangeFor('today', at(2026, 11, 5))).billCount, 0, 'empty range is zeros, not an error');
assert.equal(I.billsIn(st, I.rangeFor('today', now), 'upi').length, 1);
assert.equal(I.billsIn(st, I.rangeFor('today', now), 'none')[0].id, big);

// profit: every line has a cost → a number, net of the discount
const cost = (28 / 14) * 1150 + (2900 - 2900 + 1 * 2700 + 1 * 1150) + 2 * 4100; // maggi 2 + (milk 1 + maggi 1) + sugar 2 kg, in paise
assert.equal(today.profit.paise, 16100 - cost);
assert.equal(today.profit.costlessLines, 0);
// …but one line without a cost makes profit unknowable, not wrong
st = E.updateProduct(st, sugar.id, { costPaise: null }, now);
sell([[sugar, 1000]], at(2026, 10, 21, 16), 'cash'); // costless line (snapshot taken after the cost was cleared)
const mixed = I.salesReport(st, I.rangeFor('today', now));
assert.equal(mixed.profit.paise, null);
assert.equal(mixed.profit.costlessLines, 1);

// ---------- stock value & purchase spend ----------
const val = I.stockValue(st);
assert.equal(val.unknownCost, 1, 'sugar has no cost recorded');
assert.ok(val.sellPaise > val.costPaise);
st = E.restock(st, milk.id, 10000, 2600, at(2026, 10, 21, 9)); // ₹260 with cost
st = E.restock(st, maggi.id, 5000, undefined, at(2026, 10, 21, 9)); // no cost recorded
const spend = I.purchaseSpend(st, I.rangeFor('today', now));
assert.deepEqual(spend, { paise: 26000, costed: 1, uncosted: 1 });

// ---------- suggested order = max(0, target − available − on order) ----------
const mk = (over: Partial<E.Product>): E.Product => ({ ...milk, stock: 3000, lowAt: 5000, targetAt: 20000, packQty: undefined, ...over });
assert.equal(I.suggestOrder(st, mk({})).qty, 17000);
assert.equal(I.suggestOrder(st, mk({ stock: 25000 })).qty, 0, 'never negative');
assert.equal(I.suggestOrder(st, mk({ stock: -4000 })).qty, 20000, 'oversold counts as empty, not as extra demand');
assert.equal(I.suggestOrder(st, mk({ packQty: 12000 })).qty, 24000, 'rounds up to whole packs');
assert.equal(I.suggestOrder(st, mk({ packQty: 17000 })).qty, 17000);
const dflt = I.suggestOrder(st, mk({ targetAt: undefined }));
assert.deepEqual([dflt.target, dflt.targetIsDefault, dflt.qty], [15000, true, 12000]);
assert.equal(I.suggestOrder(st, mk({ lowAt: 0, targetAt: undefined, stock: 0 })).qty, 0, 'no thresholds: nothing to suggest');
// on-order quantity reduces the suggestion, but an unplaced list does not
let o = E.addToList(st, milk.id, 6000, now);
const milkNow = () => o.state.products.find((p) => p.id === milk.id)!;
const base = I.suggestOrder(o.state, { ...milkNow(), stock: 3000, lowAt: 5000, targetAt: 20000 }).qty;
assert.equal(base, 17000);
const placed = E.markOrdered(o.state, o.id, now);
assert.equal(I.suggestOrder(placed, { ...milkNow(), stock: 3000, lowAt: 5000, targetAt: 20000 }).qty, 11000);

// ---------- alerts list ----------
let al = E.newState('d', now);
const gp = (n: string) => al.products.find((p) => p.name.startsWith(n))!;
al = E.adjustStock(al, gp('Maggi Masala').id, -35000, 'adjust', 'count', now); // 5 left, min 10 → low
al = E.adjustStock(al, gp('Amul Milk').id, -24000, 'adjust', 'count', now); // 0 → out
al = E.adjustStock(al, gp('Sugar').id, -33000, 'adjust', 'count', now); // 7 left, min 10 → low (ratio 0.7 > maggi 0.5)
const rows = I.stockAlerts(al, now);
assert.deepEqual(rows.map((r) => [r.p.name, r.level]), [['Amul Milk', 'OUT'], ['Maggi Masala Noodles', 'LOW'], ['Sugar', 'LOW']]);
assert.equal(rows[0].sug.qty, 24000, 'default target is 3× minimum (8 → 24)');
al = E.setAlert(al, gp('Sugar').id, 'dismiss', now);
assert.deepEqual(I.stockAlerts(al, now).map((r) => r.hidden), [false, false, true]);
const cnt = I.stockCounts(al);
assert.deepEqual([cnt.low, cnt.out, cnt.in + cnt.low + cnt.out === cnt.all], [2, 1, true]);
assert.deepEqual(I.filterProducts(al, '', 'out').map((p) => p.name), ['Amul Milk']);
assert.equal(I.filterProducts(al, 'sugar', 'low').length, 1);
assert.equal(I.filterProducts(al, 'sugar', 'in').length, 0);
assert.equal(I.filterProducts(al, '8901262010016', 'all')[0].name, 'Amul Milk', 'search by barcode');

// ---------- restock soon: only with enough history, and says so otherwise ----------
let pr = E.newState('d', at(2026, 10, 1));
const pp = (n: string) => pr.products.find((p) => p.name.startsWith(n))!;
assert.equal(I.restockSoon(pr, now).enoughHistory, false, 'no bills → no prediction');
const sellDaily = (p: E.Product, qty: number, from: number, days: number) => {
  for (let i = 0; i < days; i++) {
    const w = from + i * DAY;
    const r = E.startSale(pr, w);
    pr = E.confirmSale(E.addItem(r.state, r.id, p.id, qty), r.id, 'cash', w, true);
  }
};
sellDaily(pp('Maggi Masala'), 5000, now - 5 * DAY, 6); // 30 packets in 6 days; stock 40 → 10 (= its minimum)
assert.equal(I.restockSoon(pr, now).enoughHistory, false, '5 days of history is not enough');
sellDaily(pp('Sugar'), 1000, now - 10 * DAY, 5); // the shop is now 10 days old
sellDaily(pp('Tata Salt'), 1000, now - 9 * DAY, 2); // only 2 sale lines: too few to trust
const early = I.restockSoon(pr, now);
assert.equal(early.enoughHistory, true);
assert.equal(early.rows.some((r) => r.p.name === 'Maggi Masala Noodles'), false, 'already low: that is an alert, not "soon"');
pr = E.restock(pr, pp('Maggi Masala').id, 1000, undefined, now); // 11 > minimum 10: healthy again
const soon = I.restockSoon(pr, now);
const mrow = soon.rows.find((r) => r.p.name === 'Maggi Masala Noodles')!;
assert.ok(mrow, 'a healthy product selling fast is predicted');
assert.ok(Math.abs(mrow.daysLeft - 11000 / 3000) < 0.01, `3 packets/day → ~3.7 days, got ${mrow.daysLeft}`);
assert.equal(soon.rows.some((r) => r.p.name === 'Tata Salt'), false, 'too few sales: no prediction');
assert.equal(soon.rows.some((r) => r.p.name === 'Sugar'), false, 'plenty of stock: not soon');

console.log('report checks passed');
