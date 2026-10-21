// Run: node scripts/check-engine.ts  — billing / inventory invariants, no framework.
import assert from 'node:assert/strict';
import * as E from '../src/lib/engine.ts';

const now = Date.UTC(2026, 0, 1, 12);
let s = E.newState('dev1', now);
const by = (n: string) => s.products.find((p) => p.name.startsWith(n))!;
const maggi = by('Maggi Masala');
const pasta = by('Pasta');
const atta = by('Loose Atta');

// money & quantity
assert.equal(E.fmtMoney(123456789), '₹12,34,567.89');
assert.equal(E.fmtMoney(1400), '₹14');
assert.equal(E.parseQty('0.5'), 500);
assert.equal(E.parseQty('0'), null);
assert.equal(E.parsePaise('12.5'), 1250);
assert.equal(E.lineTotal(5200, 1500), 7800); // 1.5 kg @ ₹52

// units: same-family conversion only, never guessed across families
assert.equal(E.parseQtyIn('500g', 'kg'), 500); // 0.5 kg
assert.equal(E.parseQtyIn('1.5 kg', 'g'), 1_500_000);
assert.equal(E.parseQtyIn('250 ml', 'L'), 250);
assert.equal(E.parseQtyIn('2', 'kg'), 2000);
assert.equal(E.parseQtyIn('2kg', 'pkt'), null);
assert.equal(E.parseQtyIn('1l', 'kg'), null);
assert.equal(E.parseQtyIn('abc', 'kg'), null);

// draft: add / edit / remove / replace, stock untouched
let r = E.startSale(s, now);
s = r.state;
const sid = r.id;
s = E.addItem(s, sid, maggi.id, 2000);
s = E.addItem(s, sid, maggi.id, 1000); // same product merges
s = E.addItem(s, sid, atta.id, 1500);
let sale = s.sales[0];
assert.equal(sale.items.length, 2);
assert.equal(E.saleTotal(sale.items), 3 * 1400 + 7800);
assert.equal(by('Maggi Masala').stock, 40000, 'draft must not deduct stock');
s = E.setItemQty(s, sid, sale.items[0].id, 1000);
s = E.replaceItem(s, sid, sale.items[0].id, pasta.id);
s = E.removeItem(s, sid, s.sales[0].items.find((i) => i.productId === atta.id)!.id);
assert.deepEqual(s.sales[0].items.map((i) => i.productId), [pasta.id]);
assert.notEqual(E.startSale(s, now).id, sid);

// confirm: once, atomically, idempotent
s = E.addItem(s, sid, maggi.id, 2000);
const before = s;
const after = E.confirmSale(s, sid, 'cash', now);
assert.equal(before.sales[0].status, 'draft', 'input state untouched');
assert.equal(after.products.find((p) => p.id === maggi.id)!.stock, 38000);
assert.equal(after.products.find((p) => p.id === pasta.id)!.stock, 11000);
assert.equal(after.sales[0].ref, 'B-0001');
assert.equal(after.sales[0].totalPaise, 8500 + 2800);
assert.equal(E.confirmSale(after, sid, 'cash', now), after, 'second confirm is a no-op');
assert.equal(E.pendingEvents(after), 1);
assert.throws(() => E.addItem(after, sid, maggi.id), { code: 'NOT_DRAFT' });

// stock shortage needs explicit override; failure leaves state alone
let t = E.startSale(after, now);
let s2 = E.addItem(t.state, t.id, pasta.id, 99000);
assert.throws(() => E.confirmSale(s2, t.id, 'none', now), { code: 'STOCK' });
assert.equal(E.confirmSale(s2, t.id, 'none', now, true).products.find((p) => p.id === pasta.id)!.stock, 11000 - 99000);
assert.throws(() => E.confirmSale(t.state, t.id, 'none', now), { code: 'EMPTY' });

// products & barcodes
let p = E.addProduct(after, { name: 'Test', barcode: '0001234', unit: 'pcs', pricePaise: 500, openingQty: 3000, lowAt: 1000 }, now);
assert.equal(E.findByBarcode(p.state.products, '0001234')?.id, p.id, 'leading zeroes kept');
assert.throws(() => E.addProduct(p.state, { name: 'Dup', barcode: '0001234', unit: 'pcs', pricePaise: 1, openingQty: 0, lowAt: 0 }, now), { code: 'BARCODE_TAKEN' });
const rs = E.restock(p.state, p.id, 2000, 300, now);
assert.equal(rs.products.find((x) => x.id === p.id)!.stock, 5000);
assert.equal(E.stockStatus(rs.products.find((x) => x.id === p.id)!), 'OK');

// search: aliases, no variant conflation
assert.ok(E.searchProducts(after.products, 'aata').length >= 2);
assert.equal(E.searchProducts(after.products, 'maggi atta')[0].name, 'Maggi Atta Noodles');

// suggestions: last sold first, then catalog A–Z, no duplicates, capped
const rec = E.recentProducts(after, 5);
assert.equal(rec.length, 5);
assert.deepEqual(rec.slice(0, 2).map((x) => x.id), [pasta.id, maggi.id]);
assert.equal(new Set(rec.map((x) => x.id)).size, 5);

// ---------- ledger: stock is always the sum of its movements ----------
assert.deepEqual(E.reconcile(after), []);
assert.equal(after.movements.filter((m) => m.kind === 'sale').length, 2);
assert.ok(after.movements.every((m) => m.deviceId === 'dev1'));
assert.equal(after.events.at(-1)!.deviceId, 'dev1');
assert.ok(after.events.at(-1)!.id);

// ---------- thresholds: normal → low → out → recovery ----------
const made = E.addProduct(after, { name: 'Thr', unit: 'pkt', pricePaise: 1000, openingQty: 10000, lowAt: 5000 }, now);
const tid = made.id;
let ts = made.state;
const level = (x: E.State) => E.stockStatus(x.products.find((q) => q.id === tid)!);
assert.equal(level(ts), 'OK');
ts = E.adjustStock(ts, tid, -5000, 'damage', 'spoiled', now);
assert.equal(level(ts), 'LOW', 'at the minimum counts as low');
ts = E.adjustStock(ts, tid, -5000, 'damage', 'spoiled', now);
assert.equal(level(ts), 'OUT');
ts = E.restock(ts, tid, 20000, undefined, now);
assert.equal(level(ts), 'OK');
assert.throws(() => E.adjustStock(ts, tid, -99999, 'adjust', 'x', now), { code: 'STOCK' });
assert.throws(() => E.adjustStock(ts, tid, -1000, 'adjust', '  ', now), { code: 'REASON' });
assert.throws(() => E.adjustStock(ts, tid, 1000, 'damage', 'x', now), { code: 'BAD_QTY' });
assert.equal(E.adjustStock(ts, tid, 1000, 'return', '', now).products.find((q) => q.id === tid)!.stock, 21000);
assert.deepEqual(E.reconcile(ts), []);
assert.equal(ts.movements.filter((m) => m.kind === 'damage' && m.reason === 'spoiled').length, 2);

// ---------- alerts: snooze / dismiss never touch stock and settle on recovery ----------
ts = E.adjustStock(ts, tid, -16000, 'adjust', 'recount', now); // 20000 → 4000 (low)
const pOf = (x: E.State) => x.products.find((q) => q.id === tid)!;
const stock0 = pOf(ts).stock;
ts = E.setAlert(ts, tid, 'dismiss', now);
assert.equal(E.alertHidden(ts, pOf(ts), now), true);
assert.equal(pOf(ts).stock, stock0, 'dismissing is not an inventory change');
ts = E.adjustStock(ts, tid, -4000, 'damage', 'broken', now); // now OUT: worse than what was dismissed
assert.equal(E.alertHidden(ts, pOf(ts), now), false);
ts = E.restock(ts, tid, 9000, undefined, now); // recovered → settled
assert.equal(ts.alerts[tid], undefined);
ts = E.adjustStock(ts, tid, -6000, 'damage', 'x', now); // 3000: low again, flagged again
assert.equal(E.alertHidden(ts, pOf(ts), now), false);
ts = E.setAlert(ts, tid, 'snooze', now, 1);
assert.equal(E.alertHidden(ts, pOf(ts), now + 1000), true);
assert.equal(E.alertHidden(ts, pOf(ts), now + 2 * E.DAY), false, 'snooze expires');

// ---------- restock list → ordered → partial receiving → closed ----------
const pu = E.addToList(ts, tid, 12000, now);
const listId = pu.id;
assert.equal(E.addToList(pu.state, tid, 5000, now).state, pu.state, 'already listed: no change');
assert.equal(pOf(pu.state).stock, pOf(ts).stock, 'a list never changes stock');
assert.equal(E.onOrderQty(pu.state, tid), 0, 'an unplaced list is not "on order"');
let ps = E.markOrdered(pu.state, listId, now);
assert.equal(E.onOrderQty(ps, tid), 12000);
const lineId = ps.purchases[0].lines[0].id;
assert.throws(() => E.setLineQty(ps, listId, lineId, 1000), { code: 'CLOSED' }, 'placed orders are not editable');
const stockBefore = pOf(ps).stock;
ps = E.receivePurchase(ps, listId, 'r1', [{ lineId, qty: 5000, costPaise: 900 }], now + 1);
assert.equal(pOf(ps).stock, stockBefore + 5000);
assert.equal(pOf(ps).costPaise, 900);
assert.equal(pOf(ps).lastRestockedAt, now + 1);
assert.equal(ps.purchases[0].status, 'ordered', 'partial: remainder stays outstanding');
assert.equal(E.onOrderQty(ps, tid), 7000);
assert.equal(E.receivePurchase(ps, listId, 'r1', [{ lineId, qty: 5000 }], now + 2), ps, 'repeated receipt id is a no-op');
assert.equal(pOf(ps).stock, stockBefore + 5000);
ps = E.receivePurchase(ps, listId, 'r2', [{ lineId, qty: 7000 }], now + 3);
assert.equal(ps.purchases[0].status, 'closed');
assert.equal(E.onOrderQty(ps, tid), 0);
assert.equal(ps.movements.filter((m) => m.kind === 'purchase' && m.refId === 'r1')[0].costPaise, 900);
assert.throws(() => E.receivePurchase(ps, listId, 'r3', [{ lineId, qty: 1000 }], now), { code: 'CLOSED' });
assert.throws(() => E.receivePurchase(pu.state, listId, 'r9', [{ lineId, qty: 0 }], now), { code: 'EMPTY' });
assert.deepEqual(E.reconcile(ps), []);
// list editing and cancelling
const l2 = E.addToList(ts, tid, 3000, now);
const ln = l2.state.purchases[0].lines[0].id;
assert.equal(E.setLineQty(l2.state, l2.id, ln, 4000).purchases[0].lines[0].qty, 4000);
assert.equal(E.removeLine(l2.state, l2.id, ln).purchases[0].lines.length, 0);
assert.throws(() => E.markOrdered(E.removeLine(l2.state, l2.id, ln), l2.id, now), { code: 'EMPTY' });
assert.equal(E.cancelPurchase(l2.state, l2.id, now).purchases[0].status, 'cancelled');

// ---------- reversal: stock returns through the ledger, once ----------
const rv = E.voidSale(after, sid, 'billed wrong item', now + 5);
assert.equal(rv.products.find((x) => x.id === maggi.id)!.stock, 40000);
assert.equal(rv.sales[0].status, 'voided');
assert.equal(rv.movements.filter((m) => m.kind === 'reversal').length, 2);
assert.equal(E.voidSale(rv, sid, 'again', now + 6), rv, 'second reversal is a no-op');
assert.throws(() => E.voidSale(after, sid, ' ', now), { code: 'REASON' });
assert.throws(() => E.voidSale(s2, t.id, 'x', now), { code: 'NOT_CONFIRMED' });
assert.deepEqual(E.reconcile(rv), []);
assert.throws(() => E.confirmSale(rv, sid, 'cash', now), { code: 'NOT_DRAFT' }, 'a reversed bill cannot be re-confirmed');

// ---------- discount ----------
const dsc = E.startSale(rv, now);
const d1 = E.addItem(dsc.state, dsc.id, maggi.id, 2000); // ₹28
const withDisc = E.confirmSale(d1, dsc.id, 'upi', now, false, 300);
assert.equal(withDisc.sales.at(-1)!.totalPaise, 2500);
assert.throws(() => E.confirmSale(d1, dsc.id, 'upi', now, false, 2900), { code: 'DISCOUNT' });
assert.throws(() => E.confirmSale(d1, dsc.id, 'upi', now, false, -1), { code: 'DISCOUNT' });
assert.match(E.receiptText('Shop', withDisc.sales.at(-1)!, null), /DISCOUNT -₹3/);

// ---------- archive & edit ----------
const ar = E.updateProduct(after, maggi.id, { active: false }, now);
assert.equal(E.searchProducts(ar.products, 'maggi masala').length, 0);
assert.equal(E.searchProducts(ar.products, 'maggi masala', true).length, 1);
const arSale = E.startSale(ar, now);
assert.throws(() => E.addItem(arSale.state, arSale.id, maggi.id), { code: 'NOT_FOUND' });
assert.throws(() => E.updateProduct(after, pasta.id, { barcodes: ['8901058852134'] }, now), { code: 'BARCODE_TAKEN' });
assert.deepEqual(E.updateProduct(after, pasta.id, { barcodes: [' 0123456789012 ', '77'] }, now).products.find((x) => x.id === pasta.id)!.barcodes, ['0123456789012', '77']);
assert.equal(E.updateProduct(after, pasta.id, { costPaise: null }, now).products.find((x) => x.id === pasta.id)!.costPaise, undefined);
assert.throws(() => E.updateProduct(after, pasta.id, { name: ' ' }, now), { code: 'NAME' });

// ---------- sync: movements merge as a set, replays are harmless ----------
const remote: E.Movement[] = [{ id: 'devB-1', productId: maggi.id, qty: 3000, kind: 'purchase', refId: 'x', at: now, deviceId: 'devB' }];
const m1 = E.mergeMovements(after, remote);
assert.equal(m1.applied, 1);
assert.equal(m1.state.products.find((x) => x.id === maggi.id)!.stock, 38000 + 3000);
const m2 = E.mergeMovements(m1.state, [...remote, ...remote]);
assert.equal(m2.applied, 0);
assert.equal(m2.state, m1.state, 'duplicate events change nothing');
assert.equal(E.mergeMovements(after, [{ ...remote[0], id: 'q', productId: 'nope' }]).applied, 0);
assert.deepEqual(E.reconcile(m1.state), []);

// ---------- upgrade from v1 data and survive a restart ----------
const legacy = JSON.parse(JSON.stringify(after));
legacy.v = 1;
delete legacy.purchases;
delete legacy.alerts;
legacy.movements[0].kind = 'restock';
for (const e of legacy.events) delete e.id;
for (const x of legacy.products) {
  delete x.active;
  delete x.createdAt;
  delete x.updatedAt;
}
const up = E.migrate(legacy);
assert.equal(up.v, 2);
assert.deepEqual(up.purchases, []);
assert.ok(up.products.every((x) => x.active === true && typeof x.createdAt === 'number'));
assert.equal(up.movements[0].kind, 'purchase');
assert.ok(up.events.every((e) => e.id));
assert.equal(JSON.stringify(JSON.parse(JSON.stringify(ps))), JSON.stringify(ps)); // what the store writes and reads back
const keep = E.addToList(ts, tid, 3000, now).state;
assert.equal(E.openList(JSON.parse(JSON.stringify(keep)))!.lines[0].qty, 3000, 'the restock list survives a restart');

console.log('engine checks passed');
