// Landed cost of a parts list in Denmark, Sweden or Norway: which vendors to buy from, and what each parcel costs
// once shipping, VAT, customs duty and the carrier's clearance fee are added.
//
// Vendor choice is exact for the catalog's handful of vendors: every subset of vendors is tried, each item goes to
// the cheapest vendor in the subset, and the subset with the lowest landed total wins (fewer parcels break ties).

import { VENDORS, REGIONS, EU_DUTY, FX, part } from './catalog.js';

export const convert = (amount, from, to, fx = FX) => (amount / fx[from]) * fx[to];

// Which vendors a shopping preference allows.
//   cheapest — everyone who ships to the region
//   fast     — vendors that deliver within a week
//   local    — Nordic shops only (no parcels from outside the Nordics)
export function allowedVendors(regionId, shopping = 'cheapest') {
  return Object.entries(VENDORS)
    .filter(([, v]) => v.ship[regionId])
    .filter(([, v]) => shopping !== 'fast' || v.ship[regionId].days[1] <= 7)
    .filter(([, v]) => shopping !== 'local' || ['DK', 'SE', 'NO'].includes(v.origin))
    .map(([id]) => id);
}

// Net (ex-VAT) unit price of an offer in the destination currency.
function netPrice(offer, regionId, fx) {
  const v = VENDORS[offer.vendor];
  const net = v.inclVat ? offer.price / (1 + v.vat) : offer.price;
  return convert(net, v.currency, REGIONS[regionId].currency, fx);
}

// Cheapest consumer price (net + destination VAT) of a part among the allowed vendors, ignoring shipping: the quick
// estimate the solver ranks candidates with before the exact vendor optimisation.
export function refPrice(partId, regionId, vendors, fx = FX) {
  const r = REGIONS[regionId];
  let best = Infinity;
  for (const o of part(partId).offers) {
    if (!vendors.includes(o.vendor)) continue;
    best = Math.min(best, netPrice(o, regionId, fx) * (1 + r.vat));
  }
  return best;
}

// One parcel from one vendor. items: [{ id, qty }].
export function consignment(vendorId, items, regionId, fx = FX) {
  const v = VENDORS[vendorId];
  const r = REGIONS[regionId];
  const ship = v.ship[regionId];
  const cur = r.currency;
  const lines = items.map(({ id, qty, role }) => {
    const offer = part(id).offers.find((o) => o.vendor === vendorId);
    const unitNet = netPrice(offer, regionId, fx);
    return { id, qty, role, unitNet, lineNet: unitNet * qty, listed: offer.price };
  });
  const goodsNet = lines.reduce((s, l) => s + l.lineNet, 0);
  const listedTotal = lines.reduce((s, l) => s + l.listed * l.qty, 0);
  const freeShip = ship.freeOver != null && listedTotal >= ship.freeOver;
  const feeNet = freeShip ? 0 : (v.inclVat ? ship.fee / (1 + v.vat) : ship.fee);
  const shipping = convert(feeNet, v.currency, cur, fx);
  const goodsEUR = convert(goodsNet, cur, 'EUR', fx);

  let mode = ship.mode;
  if (mode === 'ioss' && goodsEUR > 150) mode = 'import';
  if (mode === 'voec' && lines.some((l) => convert(l.unitNet, cur, 'NOK', fx) >= r.voecItemLimit)) mode = 'import';

  let duty = 0;
  let fees = 0;
  if (mode === 'import') {
    if (r.eu && goodsEUR > 150) {
      const dutyGoods = lines.reduce((s, l) => s + l.lineNet * (EU_DUTY[part(l.id).cat] ?? 0.03), 0);
      duty = dutyGoods + shipping * (dutyGoods / goodsNet);
    }
    fees = r.clearanceFee;
  }
  const vat = r.vat * (goodsNet + shipping + duty);
  return {
    vendor: vendorId, mode, taxedAt: mode === 'import' ? 'arrival' : 'checkout',
    lines, goodsNet, shipping, freeShip, duty, vat, fees,
    total: goodsNet + shipping + duty + vat + fees,
    days: ship.days,
  };
}

// items: [{ id, qty, role }] → the cheapest plan, or { ok: false, missing } when some part has no allowed vendor.
export function priceOrder(items, regionId, { fx = FX, shopping = 'cheapest' } = {}) {
  const r = REGIONS[regionId];
  const vendors = allowedVendors(regionId, shopping).filter((v) => items.some(({ id }) =>
    part(id).offers.some((o) => o.vendor === v)));
  const missing = items.filter(({ id }) => !part(id).offers.some((o) => vendors.includes(o.vendor)));
  if (missing.length) return { ok: false, missing: missing.map((m) => m.id) };

  let best = null;
  const n = vendors.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset = vendors.filter((_, i) => mask & (1 << i));
    const groups = {};
    let feasible = true;
    for (const item of items) {
      let pick = null;
      let pickPrice = Infinity;
      for (const o of part(item.id).offers) {
        if (!subset.includes(o.vendor)) continue;
        const p = netPrice(o, regionId, fx);
        if (p < pickPrice) { pickPrice = p; pick = o.vendor; }
      }
      if (!pick) { feasible = false; break; }
      (groups[pick] ??= []).push(item);
    }
    // a subset whose vendor gets no items is the same plan as a smaller subset
    if (!feasible || Object.keys(groups).length !== subset.length) continue;
    const parcels = Object.entries(groups).map(([v, its]) => consignment(v, its, regionId, fx));
    const total = parcels.reduce((s, c) => s + c.total, 0);
    if (!best || total < best.total - 1e-9 || (Math.abs(total - best.total) < 1e-9 && parcels.length < best.parcels.length)) {
      best = { parcels, total };
    }
  }
  const sum = (k) => best.parcels.reduce((s, c) => s + c[k], 0);
  return {
    ok: true,
    currency: r.currency,
    parcels: best.parcels,
    goods: sum('goodsNet'), shipping: sum('shipping'), duty: sum('duty'), vat: sum('vat'), fees: sum('fees'),
    total: best.total,
    days: Math.max(...best.parcels.map((c) => c.days[1])),
  };
}

export const MODE_LABEL = {
  domestic: 'Domestic shop, VAT included',
  eu: 'EU shop, your VAT charged at checkout',
  ioss: 'IOSS: VAT charged at checkout, no customs fee',
  voec: 'VOEC: Norwegian VAT charged at checkout',
  ddp: 'Delivered duty paid: VAT at checkout',
  import: 'Import: VAT, any duty and the carrier fee paid on arrival',
};
