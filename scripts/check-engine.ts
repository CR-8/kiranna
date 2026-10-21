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

// report
const sum = E.todaySummary(after, now);
assert.equal(sum.totalPaise, 11300);
assert.equal(sum.billCount, 1);
assert.ok(sum.profitPaise !== null && sum.profitPaise > 0);

console.log('engine checks passed');
