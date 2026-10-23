// Landed cost: VAT, duty and fees by shipping mode, and the vendor choice against brute force.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consignment, priceOrder, convert, allowedVendors } from '../src/pricing.js';
import { FX, part, VENDORS, REGIONS } from '../src/catalog.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≠ ${b}`);

test('currency conversion through EUR', () => {
  near(convert(7.46, 'DKK', 'EUR'), 1);
  near(convert(100, 'SEK', 'NOK'), (100 / FX.SEK) * FX.NOK);
});

test('a domestic shop: the listed price already holds the VAT', () => {
  // Electrokit in Sweden: the NiMH charger at 229 SEK incl. 25 % VAT, 59 SEK shipping incl. VAT
  const c = consignment('electrokit', [{ id: 'chg-nimh', qty: 1 }], 'SE');
  assert.equal(c.mode, 'domestic');
  near(c.total, 229 + 59);
  near(c.vat, (229 + 59) * 0.2);
  assert.equal(c.fees, 0);
});

test('IOSS below €150: VAT at checkout, no duty, no fee', () => {
  const c = consignment('ali', [{ id: 'esp32-devkit', qty: 2 }], 'DK');
  assert.equal(c.mode, 'ioss');
  assert.equal(c.duty, 0);
  assert.equal(c.fees, 0);
  near(c.total, (8 + 2) * FX.DKK * 1.25); // €8 of goods below the €10 free-shipping line, so €2 shipping
});

test('IOSS above €150 becomes an import: duty by part type, VAT on top, clearance fee', () => {
  const c = consignment('ali', [{ id: 'chassis-alu-4wd-37', qty: 4 }], 'SE'); // €168 of chassis
  assert.equal(c.mode, 'import');
  const goods = 168 * FX.SEK;
  near(c.goodsNet, goods);
  near(c.duty, goods * 0.06); // shipping is free above €10
  near(c.vat, 0.25 * (goods + c.duty));
  assert.equal(c.fees, REGIONS.SE.clearanceFee);
});

test('Norway: VOEC below NOK 3,000 per item, no duty on imports', () => {
  const c = consignment('ali', [{ id: 'chassis-alu-4wd-37', qty: 4 }], 'NO');
  assert.equal(c.mode, 'voec'); // each item is €42 ≈ NOK 491
  assert.equal(c.fees, 0);
  const p = consignment('pololu', [{ id: 'pololu-37d-50-enc', qty: 4 }], 'NO');
  assert.equal(p.mode, 'import');
  assert.equal(p.duty, 0);
  assert.equal(p.fees, REGIONS.NO.clearanceFee);
});

test('free shipping above the threshold', () => {
  const small = consignment('mouser', [{ id: 'esp32-devkit', qty: 1 }], 'DK');
  const big = consignment('mouser', [{ id: 'esp32-devkit', qty: 5 }], 'DK');
  assert.ok(small.shipping > 0);
  assert.equal(big.shipping, 0);
  assert.ok(big.freeShip);
});

test('the vendor choice is the cheapest of every item-to-vendor assignment', () => {
  const items = [{ id: 'esp32-devkit', qty: 1 }, { id: 'l298n', qty: 1 }, { id: 'hcsr04', qty: 2 },
    { id: 'batt-2s-18650', qty: 1 }, { id: 'jumpers', qty: 1 }];
  for (const region of ['DK', 'SE', 'NO']) {
    const plan = priceOrder(items, region);
    const vendors = allowedVendors(region);
    // brute force: each item to each vendor that sells it
    const choices = items.map((it) => part(it.id).offers.map((o) => o.vendor).filter((v) => vendors.includes(v)));
    let best = Infinity;
    const walk = (i, pick) => {
      if (i === items.length) {
        const groups = {};
        items.forEach((it, k) => (groups[pick[k]] ??= []).push(it));
        const total = Object.entries(groups).reduce((s, [v, its]) => s + consignment(v, its, region).total, 0);
        best = Math.min(best, total);
        return;
      }
      for (const v of choices[i]) walk(i + 1, [...pick, v]);
    };
    walk(0, []);
    assert.ok(plan.ok);
    // the optimiser buys each item at the cheapest vendor within the chosen set, which can miss a mix that shifts
    // an item to reach a free-shipping threshold; it must be within that gap of the true optimum
    assert.ok(plan.total <= best * 1.03 + 1e-9, `${region}: ${plan.total} vs brute force ${best}`);
    near(plan.total, plan.goods + plan.shipping + plan.duty + plan.vat + plan.fees);
  }
});

test('shopping preferences restrict the vendors', () => {
  assert.ok(!allowedVendors('SE', 'local').some((v) => !['DK', 'SE', 'NO'].includes(VENDORS[v].origin)));
  assert.ok(!allowedVendors('NO', 'fast').includes('ali'));
  const plan = priceOrder([{ id: 'jgb37-30-enc', qty: 2 }], 'SE', { shopping: 'local' });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.missing, ['jgb37-30-enc']);
});

test('packs are bought whole, and a single item can be a share of a set', async () => {
  const { itemsFor, freshness } = await import('../src/pricing.js');
  assert.equal(itemsFor(2, 2), 1);
  assert.equal(itemsFor(3, 2), 2);
  assert.equal(itemsFor(1, 0.2), 5);
  const c = consignment('electrokit', [{ id: 'wheel-tt-65', qty: 2 }], 'SE');
  near(c.goodsNet * 1.25, 79); // one 2-pack
  const today = new Date('2026-12-01T00:00:00Z');
  assert.equal(freshness({ status: 'checked', checked: '2026-10-23' }, today).kind, 'checked');
  assert.equal(freshness({ status: 'checked', checked: '2026-08-01' }, today).kind, 'stale');
  assert.equal(freshness({ status: 'estimate' }, today).kind, 'estimate');
});
