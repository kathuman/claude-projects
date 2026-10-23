// The parts catalog, the vendors that sell them in Denmark, Sweden and Norway, and the tax rules of those markets.
//
// Prices come in two kinds. A checked price was read on the shop's own product page on a given day (src/prices.js
// holds those checks, with the link and the date). Any other price is an estimate compiled for planning on
// CATALOG_DATE: what the part typically sells for at that vendor, not a quote. Vendor coverage, shipping fees and free-shipping thresholds are modelled from the
// vendors' published terms at that date and change without notice; the app tells the user to confirm before ordering.
// Specifications are typical datasheet or seller values for the generic part; clones vary, which is why the checks keep
// safety margins rather than designing to the number.
//
// Units: SI throughout (kg, m, N·m, A, V). Prices are in the vendor's currency; `inclVat` says whether the listed price
// already includes the vendor's home VAT (Nordic consumer shops) or not (distributors, marketplaces).

import { CHECKS, SEARCH_TERMS } from './prices.js';

export const CATALOG_DATE = '2026-10-22';

// Exchange rates per 1 EUR. Assumed for the catalog date; the app lets the user set their own.
export const FX = { EUR: 1, DKK: 7.46, SEK: 11.0, NOK: 11.7, USD: 1.16 };

export const REGIONS = {
  DK: {
    name: 'Denmark', currency: 'DKK', vat: 0.25, eu: true,
    clearanceFee: 160,   // carrier fee for clearing an import that was not taxed at checkout (DKK)
    note: 'EU: VAT is charged at checkout by EU shops (OSS) and by IOSS marketplaces for parcels up to €150. '
      + 'Parcels from outside the EU that were not taxed at checkout pay import VAT plus a carrier clearance fee; '
      + 'customs duty applies above €150.',
  },
  SE: {
    name: 'Sweden', currency: 'SEK', vat: 0.25, eu: true,
    clearanceFee: 125,
    note: 'EU: VAT is charged at checkout by EU shops (OSS) and by IOSS marketplaces for parcels up to €150. '
      + 'Parcels from outside the EU that were not taxed at checkout pay import VAT plus a carrier handling fee; '
      + 'customs duty applies above €150.',
  },
  NO: {
    name: 'Norway', currency: 'NOK', vat: 0.25, eu: false,
    clearanceFee: 149,
    voecItemLimit: 3000, // NOK per item: below it, VOEC-registered shops collect Norwegian VAT at checkout
    note: 'Not in the EU: every foreign parcel is an import. VOEC-registered shops collect 25 % VAT at checkout for '
      + 'items under NOK 3,000 and the parcel clears without duty; anything else pays VAT and a clearance fee on '
      + 'arrival. Norway charges no customs duty on industrial goods such as electronics, motors and batteries.',
  },
};

// Approximate EU customs duty by part category (TARIC third-country rates for typical HS codes). Only charged on
// non-EU consignments above €150 that were not taxed at checkout. Norway: 0 % for all of these.
export const EU_DUTY = {
  mcu: 0, driver: 0, sensor: 0, servo: 0.027, motor: 0.027, battery: 0.027, charger: 0.033, regulator: 0.033,
  psu: 0.033, chassis: 0.06, frame: 0.06, wheel: 0.035, misc: 0.03, tool: 0.03, cell: 0.027,
};

// Shipping modes per destination:
//   domestic — a shop in the buyer's country; VAT is in the price.
//   eu       — EU shop to an EU consumer; the destination VAT is charged at checkout (OSS).
//   ioss     — non-EU marketplace to the EU; VAT at checkout for parcels ≤ €150, otherwise a normal import.
//   voec     — foreign shop registered in Norway's VOEC scheme; VAT at checkout for items < NOK 3,000.
//   ddp      — delivered duty paid: VAT at checkout, duty and clearance included in the price.
//   import   — taxes and the carrier's clearance fee are paid on arrival.
export const VENDORS = {
  electrokit: {
    name: 'Electrokit', url: 'https://www.electrokit.com', search: 'https://www.electrokit.com/?s={q}&post_type=product', origin: 'SE', currency: 'SEK', inclVat: true, vat: 0.25,
    ship: {
      SE: { mode: 'domestic', fee: 59, freeOver: null, days: [1, 3] },
      DK: { mode: 'eu', fee: 119, freeOver: null, days: [2, 5] },
      NO: { mode: 'voec', fee: 149, freeOver: null, days: [3, 6] },
    },
  },
  'kjell-se': {
    name: 'Kjell & Company (SE)', url: 'https://www.kjell.com/se', search: 'https://www.kjell.com/se/sok?query={q}', origin: 'SE', currency: 'SEK', inclVat: true, vat: 0.25,
    ship: { SE: { mode: 'domestic', fee: 49, freeOver: 499, days: [1, 3] } },
  },
  'kjell-no': {
    name: 'Kjell & Company (NO)', url: 'https://www.kjell.com/no', search: 'https://www.kjell.com/no/sok?query={q}', origin: 'NO', currency: 'NOK', inclVat: true, vat: 0.25,
    ship: { NO: { mode: 'domestic', fee: 69, freeOver: 599, days: [1, 3] } },
  },
  let: {
    name: 'Let Elektronik', url: 'https://let-elektronik.dk', search: 'https://let-elektronik.dk/search?q={q}', origin: 'DK', currency: 'DKK', inclVat: true, vat: 0.25,
    ship: { DK: { mode: 'domestic', fee: 49, freeOver: null, days: [1, 3] } },
  },
  mouser: {
    name: 'Mouser Electronics', url: 'https://www.mouser.com', search: 'https://www.mouser.com/c/?q={q}', origin: 'US', currency: 'EUR', inclVat: false, vat: 0,
    ship: {
      DK: { mode: 'ddp', fee: 20, freeOver: 50, days: [2, 4] },
      SE: { mode: 'ddp', fee: 20, freeOver: 50, days: [2, 4] },
      NO: { mode: 'ddp', fee: 20, freeOver: 50, days: [2, 5] },
    },
  },
  ali: {
    name: 'AliExpress', url: 'https://www.aliexpress.com', search: 'https://www.aliexpress.com/wholesale?SearchText={q}', origin: 'CN', currency: 'EUR', inclVat: false, vat: 0,
    ship: {
      DK: { mode: 'ioss', fee: 2, freeOver: 10, days: [8, 20] },
      SE: { mode: 'ioss', fee: 2, freeOver: 10, days: [8, 20] },
      NO: { mode: 'voec', fee: 2, freeOver: 10, days: [8, 22] },
    },
  },
  // RC-hobby shop for LiPo packs and their chargers. It will not send lithium batteries outside the EU and states no
  // Danish shipping fee, so it is modelled for Sweden only. Shipping is at cost, capped at 89 kr within Sweden.
  mbs: {
    name: 'MBS RC Models', url: 'https://mbs-rcmodels.se', search: 'https://mbs-rcmodels.se/?s={q}&post_type=product',
    origin: 'SE', currency: 'SEK', inclVat: true, vat: 0.25,
    ship: { SE: { mode: 'domestic', fee: 89, freeOver: null, days: [1, 3] } },
  },
  pololu: {
    name: 'Pololu', url: 'https://www.pololu.com', search: 'https://www.pololu.com/search?query={q}', origin: 'US', currency: 'USD', inclVat: false, vat: 0,
    ship: {
      DK: { mode: 'import', fee: 22, freeOver: null, days: [5, 12] },
      SE: { mode: 'import', fee: 22, freeOver: null, days: [5, 12] },
      NO: { mode: 'import', fee: 22, freeOver: null, days: [5, 12] },
    },
  },
};

// [vendor, price] pairs, in the vendor's currency
const offers = (o) => Object.entries(o).map(([vendor, price]) => ({ vendor, price }));
// the same for parts sold only as a set: the price is for the set of `pack` catalog units
const sets = (pack, o) => offers(o).map((x) => ({ ...x, pack }));

// Microcontroller pin maps live in pins.js; `board` points there.
const MCUS = [
  { id: 'uno-r3', cat: 'mcu', name: 'Arduino Uno Rev3 (original)', board: 'uno', arch: 'avr', logicV: 5,
    current: 0.05, mass: 0.025, solder: false, wifi: false,
    offers: offers({ electrokit: 319, let: 249, mouser: 24.0 }) },
  { id: 'uno-clone', cat: 'mcu', name: 'Uno R3-compatible board (CH340 USB)', board: 'uno', arch: 'avr', logicV: 5,
    current: 0.05, mass: 0.025, solder: false, wifi: false,
    offers: offers({ ali: 4.2, electrokit: 169, 'kjell-se': 199, 'kjell-no': 249 }) },
  { id: 'nano-clone', cat: 'mcu', name: 'Nano-compatible board (CH340, loose headers)', board: 'nano', arch: 'avr', logicV: 5,
    current: 0.025, mass: 0.007, solder: true, wifi: false,
    offers: offers({ ali: 2.9, electrokit: 109 }) },
  { id: 'esp32-devkit', cat: 'mcu', name: 'ESP32 DevKitC (ESP32-WROOM-32, Wi-Fi + Bluetooth)', board: 'esp32', arch: 'esp32',
    logicV: 3.3, current: 0.12, mass: 0.010, solder: false, wifi: true,
    offers: offers({ mouser: 10.9, electrokit: 139, let: 109, 'kjell-se': 199, 'kjell-no': 249, ali: 4.0 }) },
];

// scheme: how the board is driven (see firmware.js). Voltage drop is drop0 + rdrop·I at current I per channel.
// logicHigh: the input-high threshold of the board's logic, so 3.3 V controllers can be checked against it.
const DRIVERS = [
  { id: 'l298n', cat: 'driver', name: 'L298N dual H-bridge module', scheme: 'en-in', channels: 2, units: 1,
    vMin: 5, vMax: 35, iCont: 2.0, iPeak: 3.0, drop0: 1.4, rdrop: 0.6, logicHigh: 2.3, current: 0.04, mass: 0.030,
    solder: false, offers: offers({ ali: 2.2, electrokit: 89, 'kjell-se': 129, 'kjell-no': 169, let: 69 }) },
  { id: 'tb6612', cat: 'driver', name: 'TB6612FNG dual motor driver breakout', scheme: 'en-in', channels: 2, units: 1,
    vMin: 4.5, vMax: 13.5, iCont: 1.2, iPeak: 3.2, drop0: 0, rdrop: 0.5, logicHigh: 0.7 * 2.7, current: 0.002,
    mass: 0.003, solder: true, standby: true,
    offers: offers({ ali: 1.8, pololu: 5.95, electrokit: 79, let: 89, mouser: 9.9 }) },
  { id: 'drv8833', cat: 'driver', name: 'DRV8833 dual motor driver breakout', scheme: 'in-in', channels: 2, units: 1,
    vMin: 2.7, vMax: 10.8, iCont: 1.2, iPeak: 2.0, drop0: 0, rdrop: 0.36, logicHigh: 2.0, current: 0.002,
    mass: 0.002, solder: true, standby: true,
    offers: offers({ ali: 1.5, pololu: 5.95, mouser: 5.2, electrokit: 69 }) },
  { id: 'mdd10a', cat: 'driver', name: 'Cytron MDD10A dual 10 A motor driver', scheme: 'pwm-dir', channels: 2, units: 1,
    vMin: 5, vMax: 30, iCont: 10, iPeak: 30, drop0: 0, rdrop: 0.03, logicHigh: 2.0, current: 0.03, mass: 0.060,
    solder: false, offers: offers({ mouser: 27, let: 249, ali: 24 }) },
  { id: 'bts7960', cat: 'driver', name: 'BTS7960 43 A H-bridge module (one motor channel per board)', scheme: 'two-pwm',
    channels: 1, units: 2, vMin: 5.5, vMax: 27, iCont: 15, iPeak: 43, drop0: 0, rdrop: 0.02, logicHigh: 3.5,
    current: 0.02, mass: 0.066, solder: false, offers: offers({ ali: 6.5, electrokit: 149 }) },
];

// Brushed DC gearmotors, modelled with the linear torque–speed line at the rated voltage vNom.
// cpr: encoder channel-A rising edges per output-shaft revolution (null = no encoder).
const MOTORS = [
  { id: 'tt-dc', cat: 'motor', name: 'TT yellow gearmotor 1:48 (3–6 V, with leads)', vNom: 6, noLoadRpm: 200, stallTorque: 0.078,
    stallCurrent: 1.2, noLoadCurrent: 0.17, cpr: null, mount: 'tt', shaft: 'tt', mass: 0.030, solder: false,
    offers: offers({ ali: 1.0, electrokit: 35, 'kjell-se': 59, 'kjell-no': 79, let: 29 }) },
  { id: 'n20-100-enc', cat: 'motor', name: 'N20 micro gearmotor 6 V 1:100 with Hall encoder', vNom: 6, noLoadRpm: 300,
    stallTorque: 0.12, stallCurrent: 0.8, noLoadCurrent: 0.06, cpr: 700, mount: 'n20', shaft: 'd3', mass: 0.015,
    solder: false, offers: offers({ ali: 4.5, electrokit: 119 }) },
  { id: 'pololu-micro-100-enc', cat: 'motor', name: 'Pololu 100:1 Micro Metal Gearmotor HP 6 V + magnetic encoder',
    vNom: 6, noLoadRpm: 320, stallTorque: 0.216, stallCurrent: 1.6, noLoadCurrent: 0.1, cpr: 300, mount: 'n20',
    shaft: 'd3', mass: 0.012, solder: true, offers: offers({ pololu: 26.5 }) },
  { id: 'jga25-34-enc', cat: 'motor', name: 'JGA25-370 gearmotor 12 V 1:34 with Hall encoder', vNom: 12, noLoadRpm: 170,
    stallTorque: 0.65, stallCurrent: 2.0, noLoadCurrent: 0.1, cpr: 374, mount: 'jga25', shaft: 'd4', mass: 0.100,
    solder: false, offers: offers({ ali: 9.5 }) },
  { id: 'jga25-21-enc', cat: 'motor', name: 'JGA25-370 gearmotor 12 V 1:21 with Hall encoder', vNom: 12, noLoadRpm: 280,
    stallTorque: 0.40, stallCurrent: 2.0, noLoadCurrent: 0.1, cpr: 231, mount: 'jga25', shaft: 'd4', mass: 0.095,
    solder: false, offers: offers({ ali: 9.5 }) },
  { id: 'jgb37-30-enc', cat: 'motor', name: 'JGB37-520 gearmotor 12 V 1:30 with Hall encoder', vNom: 12, noLoadRpm: 333,
    stallTorque: 0.9, stallCurrent: 3.0, noLoadCurrent: 0.15, cpr: 330, mount: '37mm', shaft: 'd6', mass: 0.160,
    solder: false, offers: offers({ ali: 11 }) },
  { id: 'pololu-37d-50-enc', cat: 'motor', name: 'Pololu 50:1 37D metal gearmotor 12 V with 64 CPR encoder', vNom: 12,
    noLoadRpm: 200, stallTorque: 2.06, stallCurrent: 5.5, noLoadCurrent: 0.2, cpr: 800, mount: '37mm', shaft: 'd6',
    mass: 0.195, solder: false, offers: offers({ pololu: 49.95 }) },
];

const WHEELS = [
  { id: 'wheel-tt-65', cat: 'wheel', name: 'Rubber wheel 65 mm for TT motors', diameter: 0.065, shaft: ['tt'],
    terrain: 'indoor', mass: 0.025, solder: false, offers: offers({ ali: 0.8, electrokit: 29, let: 25 }) },
  { id: 'wheel-d3-42', cat: 'wheel', name: 'Wheel 42 mm for 3 mm D-shaft', diameter: 0.042, shaft: ['d3'],
    terrain: 'indoor', mass: 0.006, solder: false, offers: offers({ pololu: 4.0, ali: 1.0 }) },
  { id: 'wheel-d4-65', cat: 'wheel', name: 'Rubber wheel 65 mm with 4 mm hub', diameter: 0.065, shaft: ['d4'],
    terrain: 'indoor', mass: 0.035, solder: false, offers: offers({ ali: 2.5 }) },
  { id: 'wheel-d6-85', cat: 'wheel', name: 'Off-road wheel 85 mm with 6 mm hub coupling', diameter: 0.085, shaft: ['d6'],
    terrain: 'outdoor', mass: 0.070, solder: false, offers: offers({ ali: 4.5 }) },
  { id: 'wheel-d6-125', cat: 'wheel', name: 'Off-road wheel 125 mm with 6 mm hub coupling', diameter: 0.125,
    shaft: ['d6'], terrain: 'outdoor', mass: 0.140, solder: false, offers: offers({ ali: 7.5 }) },
  // Mecanum wheels: rollers at 45 degrees let a four-wheel base drive sideways. Sold as sets of two left and two right
  // wheels; the price is for the set of four.
  { id: 'mecanum-60-tt', cat: 'wheel', kind: 'mecanum', name: 'Mecanum wheel 60 mm for TT motors (set of 4: 2 left, 2 right)',
    diameter: 0.060, shaft: ['tt'], terrain: 'indoor', mass: 0.040, solder: false, offers: sets(4, { ali: 7.5 }) },
  { id: 'mecanum-80', cat: 'wheel', kind: 'mecanum', name: 'Mecanum wheel 80 mm with 4 and 6 mm hub couplings (set of 4)',
    diameter: 0.080, shaft: ['d4', 'd6'], terrain: 'indoor', mass: 0.075, solder: false, offers: sets(4, { ali: 21 }) },
  { id: 'mecanum-97', cat: 'wheel', kind: 'mecanum', name: 'Mecanum wheel 97 mm with 6 mm hub couplings (set of 4)',
    diameter: 0.097, shaft: ['d6'], terrain: 'indoor', mass: 0.140, solder: false, offers: sets(4, { ali: 34 }) },
  // Track drives: the sprockets and tracks that come with a tracked chassis, never bought on their own. diameter is
  // the drive sprocket's pitch diameter with the track on it (what one turn moves the robot, divided by pi).
  { id: 'tracks-zumo', cat: 'wheel', kind: 'track', partOf: 'chassis-zumo', name: 'Zumo silicone tracks on 35 mm drive sprockets',
    diameter: 0.039, shaft: ['d3'], terrain: 'indoor', mass: 0.010, solder: false, offers: [] },
  { id: 'tracks-alu-tank', cat: 'wheel', kind: 'track', partOf: 'tank-alu-25', name: 'Rubber tracks on the tank chassis drive sprockets',
    diameter: 0.050, shaft: ['d4'], terrain: 'outdoor', mass: 0.15, solder: false, offers: [] },
  { id: 'tracks-alu-tank37', cat: 'wheel', kind: 'track', partOf: 'tank-alu-37', name: 'Rubber tracks on the 37 mm tank chassis drive sprockets',
    diameter: 0.055, shaft: ['d6'], terrain: 'outdoor', mass: 0.18, solder: false, offers: [] },
];

// Chassis: mounts accept that motor mount; driven = driven wheels (2 = differential drive + caster, 4 = skid steer).
// length/track: support polygon used for the tipping check.
// Kits that come with their motors and wheels: `includes` names the parts they bring, which are then not bought
// separately (their mass and specs still count).
// drive: 'wheels' (the default), 'tracks' (a tank: contact = length of track on the ground, track = between the track
// centres) or 'balance' (two wheels on one axle and no caster: height of the frame, comH = the robot's centre of mass
// above the axle without payload, decks = how many plates the frame stacks).
const CHASSIS = [
  { id: 'kit-2wd-olimex', cat: 'chassis', name: '2WD acrylic robot kit with 2 TT gearmotors and 65 mm wheels (Olimex)', mount: 'tt',
    driven: 2, maxLoad: 1.0, mass: 0.18, length: 0.20, track: 0.15, terrain: 'indoor', solder: false,
    includes: { motor: 'tt-dc', wheel: 'wheel-tt-65' }, offers: offers({ electrokit: 199 }) },
  { id: 'kit-4wd-joyit', cat: 'chassis', name: '4WD acrylic robot kit with 4 gearmotors and 65 mm wheels (Joy-It Robot03)', mount: 'tt',
    driven: 4, maxLoad: 1.5, mass: 0.30, length: 0.28, track: 0.156, terrain: 'indoor', solder: false,
    includes: { motor: 'tt-dc', wheel: 'wheel-tt-65' }, offers: offers({ electrokit: 249 }) },
  { id: 'chassis-2wd-acrylic', cat: 'chassis', name: '2WD acrylic robot chassis (TT mounts, ball caster)', mount: 'tt',
    driven: 2, maxLoad: 1.0, mass: 0.18, length: 0.20, track: 0.15, terrain: 'indoor', solder: false,
    offers: offers({ ali: 4.5, electrokit: 129, let: 99 }) },
  { id: 'chassis-4wd-acrylic', cat: 'chassis', name: '4WD acrylic robot chassis (TT mounts)', mount: 'tt', driven: 4,
    maxLoad: 1.5, mass: 0.30, length: 0.25, track: 0.15, terrain: 'indoor', solder: false,
    offers: offers({ ali: 7.5, electrokit: 199 }) },
  { id: 'chassis-n20-mini', cat: 'chassis', name: 'Mini 2WD plate chassis for N20 gearmotors (ball caster)',
    mount: 'n20', driven: 2, maxLoad: 0.5, mass: 0.06, length: 0.10, track: 0.10, terrain: 'indoor', solder: false,
    offers: offers({ ali: 6.0 }) },
  { id: 'chassis-alu-2wd-25', cat: 'chassis', name: 'Aluminium 2WD chassis for 25 mm gearmotors (caster)',
    mount: 'jga25', driven: 2, maxLoad: 3.0, mass: 0.45, length: 0.25, track: 0.18, terrain: 'indoor', solder: false,
    offers: offers({ ali: 18 }) },
  { id: 'chassis-alu-4wd-37', cat: 'chassis', name: 'Aluminium 4WD off-road chassis for 37 mm gearmotors',
    mount: '37mm', driven: 4, maxLoad: 6.0, mass: 1.10, length: 0.30, track: 0.24, terrain: 'outdoor', solder: false,
    offers: offers({ ali: 42 }) },
  // tracked: the Zumo takes two micro metal gearmotors (not included); the aluminium tank comes with its motors
  { id: 'chassis-zumo', cat: 'chassis', drive: 'tracks', name: 'Pololu Zumo tracked chassis kit (tracks and sprockets, motors not included)',
    mount: 'n20', driven: 2, maxLoad: 0.45, mass: 0.09, length: 0.086, track: 0.086, contact: 0.068, terrain: 'indoor',
    solder: false, includes: { wheel: 'tracks-zumo' }, offers: offers({ electrokit: 299, pololu: 23.49 }) },
  { id: 'tank-alu-25', cat: 'chassis', drive: 'tracks', name: 'Aluminium tank chassis with two 25 mm encoder gearmotors and rubber tracks',
    mount: 'jga25', driven: 2, maxLoad: 3.0, mass: 0.90, length: 0.275, track: 0.16, contact: 0.21, terrain: 'outdoor',
    solder: false, includes: { motor: 'jga25-34-enc', wheel: 'tracks-alu-tank' }, offers: offers({ ali: 48 }) },
  { id: 'tank-alu-37', cat: 'chassis', drive: 'tracks', name: 'Aluminium tank chassis with two 37 mm encoder gearmotors and rubber tracks',
    mount: '37mm', driven: 2, maxLoad: 5.0, mass: 1.30, length: 0.30, track: 0.19, contact: 0.23, terrain: 'outdoor',
    solder: false, includes: { motor: 'jgb37-30-enc', wheel: 'tracks-alu-tank37' }, offers: offers({ ali: 65 }) },
  // balancing frames: stacked acrylic plates on standoffs, motor brackets at the bottom (motors and wheels not included)
  { id: 'bal-frame-n20', cat: 'chassis', drive: 'balance', name: 'Balancing-robot frame for N20 micro gearmotors (3 acrylic decks)',
    mount: 'n20', driven: 2, maxLoad: 0.40, mass: 0.05, length: 0.06, track: 0.11, height: 0.12, comH: 0.06, decks: 3,
    terrain: 'indoor', solder: false, offers: offers({ ali: 7 }) },
  { id: 'bal-frame-25', cat: 'chassis', drive: 'balance', name: 'Balancing-robot frame for 25 mm gearmotors (3 acrylic decks)',
    mount: 'jga25', driven: 2, maxLoad: 1.2, mass: 0.16, length: 0.09, track: 0.19, height: 0.20, comH: 0.10, decks: 3,
    terrain: 'indoor', solder: false, offers: offers({ ali: 12 }) },
];

// vMin: cut-off under load; iMax: continuous discharge the pack (or its BMS) allows.
const BATTERIES = [
  { id: 'batt-6aa-nimh', cat: 'battery', name: '6 × AA NiMH 2000 mAh in a holder (7.2 V)', chem: 'nimh', vNom: 7.2,
    vMax: 8.4, vMin: 6.0, capacity: 2.0, iMax: 4, mass: 0.17, charger: 'chg-nimh', solder: false,
    offers: offers({ 'kjell-se': 279, 'kjell-no': 349, electrokit: 259, let: 199 }) },
  { id: 'batt-2s-18650', cat: 'battery', name: '2S 18650 Li-ion pack, 3000 mAh, with BMS (7.4 V)', chem: 'liion',
    vNom: 7.4, vMax: 8.4, vMin: 6.0, capacity: 3.0, iMax: 8, mass: 0.11, charger: 'chg-2s', solder: false,
    offers: offers({ electrokit: 239, let: 199, 'kjell-se': 299, 'kjell-no': 379, ali: 12 }) },
  { id: 'batt-3s-18650', cat: 'battery', name: '3S 18650 Li-ion pack, 3000 mAh, with BMS (11.1 V)', chem: 'liion',
    vNom: 11.1, vMax: 12.6, vMin: 9.0, capacity: 3.0, iMax: 8, mass: 0.16, charger: 'chg-3s', solder: false,
    offers: offers({ electrokit: 339, let: 279, 'kjell-se': 429, 'kjell-no': 529, ali: 16 }) },
  { id: 'batt-2s-lipo-2200', cat: 'battery', name: '2S LiPo 2200 mAh 25C, XT60 (7.4 V)', chem: 'lipo', vNom: 7.4,
    vMax: 8.4, vMin: 6.6, capacity: 2.2, iMax: 40, mass: 0.12, charger: 'chg-lipo', solder: false,
    offers: offers({ electrokit: 229, let: 189, ali: 15 }) },
  { id: 'batt-3s-lipo-2200', cat: 'battery', name: '3S LiPo 2200 mAh 25C, XT60 (11.1 V)', chem: 'lipo', vNom: 11.1,
    vMax: 12.6, vMin: 9.9, capacity: 2.2, iMax: 40, mass: 0.18, charger: 'chg-lipo', solder: false,
    offers: offers({ electrokit: 299, let: 239, ali: 19 }) },
  { id: 'batt-3s-lipo-5000', cat: 'battery', name: '3S LiPo 5000 mAh 30C, XT60 (11.1 V)', chem: 'lipo', vNom: 11.1,
    vMax: 12.6, vMin: 9.9, capacity: 5.0, iMax: 80, mass: 0.38, charger: 'chg-lipo', solder: false,
    offers: offers({ electrokit: 549, let: 449, ali: 36 }) },
];

// Packs you assemble from what the Nordic shops sell: a holder with the cells in series and protected 18650 cells,
// charged as loose cells. `kit` lists what is bought; the pack itself has no offer. iMax is the holder's spring
// contacts (about 5 A), below the cells' 10 A.
const PACKS = [
  { id: 'pack-2s-18650', cat: 'battery', name: '2S 18650 pack you assemble, holder + 2 protected cells (7.2 V)', chem: 'liion',
    vNom: 7.2, vMax: 8.4, vMin: 6.0, capacity: 3.3, iMax: 5, mass: 0.12, charger: 'chg-18650-cells', solder: false,
    kit: [{ id: 'holder-2x18650', qty: 1 }, { id: 'cell-18650-prot', qty: 2 }], offers: [] },
  { id: 'pack-3s-18650', cat: 'battery', name: '3S 18650 pack you assemble, holder + 3 protected cells (10.8 V)', chem: 'liion',
    vNom: 10.8, vMax: 12.6, vMin: 9.0, capacity: 3.3, iMax: 5, mass: 0.18, charger: 'chg-18650-cells', solder: false,
    kit: [{ id: 'holder-3x18650', qty: 1 }, { id: 'cell-18650-prot', qty: 3 }], offers: [] },
];
const CELLS = [
  { id: 'cell-18650-prot', cat: 'cell', name: 'Protected 18650 Li-ion cell, 3300 mAh, 10 A', mass: 0.047, solder: false,
    offers: offers({ electrokit: 129, ali: 3.5 }) },
  { id: 'holder-2x18650', cat: 'misc', name: '2×18650 holder, cells in series (7.4 V)', mass: 0.025, solder: false,
    offers: offers({ electrokit: 25, let: 23, ali: 1.2 }) },
  { id: 'holder-3x18650', cat: 'misc', name: '3×18650 holder, cells in series (11.1 V)', mass: 0.035, solder: false,
    offers: offers({ let: 30, ali: 1.6 }) },
];

const CHARGERS = [
  { id: 'chg-18650-cells', cat: 'charger', name: 'Charger for loose 18650 cells, 2 slots (USB)', mass: 0, solder: false,
    offers: offers({ electrokit: 79, ali: 4 }) },
  { id: 'chg-nimh', cat: 'charger', name: 'Smart NiMH charger for AA cells', mass: 0, solder: false,
    offers: offers({ 'kjell-se': 249, 'kjell-no': 299, electrokit: 229, let: 179 }) },
  { id: 'chg-2s', cat: 'charger', name: '2S Li-ion charger 8.4 V 1 A (mains adapter)', mass: 0, solder: false,
    offers: offers({ electrokit: 129, let: 99 }) },
  { id: 'chg-3s', cat: 'charger', name: '3S Li-ion charger 12.6 V 1 A (mains adapter)', mass: 0, solder: false,
    offers: offers({ electrokit: 149, let: 119, ali: 7 }) },
  { id: 'chg-lipo', cat: 'charger', name: 'LiPo balance charger 2–6S with power supply', mass: 0, solder: false,
    offers: offers({ electrokit: 449, let: 349, ali: 32 }) },
  { id: 'lipo-bag', cat: 'misc', name: 'LiPo safety bag (charge and store in it)', mass: 0, solder: false,
    offers: offers({ electrokit: 99, let: 79, ali: 3.5 }) },
];

// DC-DC converters. dropout: minimum input above the output; out: [min, max] adjustable output.
const REGULATORS = [
  { id: 'buck-lm2596', cat: 'regulator', name: 'LM2596 adjustable buck converter, 3 A (2 A continuous)', vInMin: 4.5,
    vInMax: 40, dropout: 2.0, iCont: 2.0, out: [1.25, 30], eff: 0.8, mass: 0.012, solder: false,
    offers: offers({ ali: 1.2, electrokit: 59, 'kjell-se': 99, 'kjell-no': 129, let: 49 }) },
  { id: 'buck-mp1584', cat: 'regulator', name: 'MP1584 mini buck converter, 3 A peak (1.5 A continuous)', vInMin: 4.5,
    vInMax: 28, dropout: 1.0, iCont: 1.5, out: [0.8, 20], eff: 0.88, mass: 0.003, solder: true,
    offers: offers({ ali: 0.8, electrokit: 49 }) },
  { id: 'buck-xl4015', cat: 'regulator', name: 'XL4015 buck converter, 5 A, screw terminals', vInMin: 8, vInMax: 36,
    dropout: 1.5, iCont: 5.0, out: [1.25, 32], eff: 0.9, mass: 0.020, solder: false,
    offers: offers({ ali: 2.5, electrokit: 99 }) },
  { id: 'buck-xl4016', cat: 'regulator', name: 'XL4016 buck converter, 8 A, screw terminals', vInMin: 8, vInMax: 40,
    dropout: 1.5, iCont: 8.0, out: [1.25, 36], eff: 0.9, mass: 0.045, solder: false,
    offers: offers({ ali: 6.5, electrokit: 179 }) },
  // buck-boost: makes 5 V from anything between 2.8 and 22 V, so an empty 2S pack is no problem; fixed output
  { id: 'reg-s13v30f5', cat: 'regulator', name: 'Pololu S13V30F5 5 V buck-boost regulator, 2.8–22 V in (2 A)', vInMin: 2.8,
    vInMax: 22, dropout: 0, iCont: 2.0, out: [5, 5], eff: 0.85, mass: 0.004, solder: true, fixed: true,
    offers: offers({ electrokit: 189 }) },
  { id: 'ubec-5a', cat: 'regulator', name: 'UBEC switching regulator 5/6 V, 5 A', vInMin: 7, vInMax: 26, dropout: 1.0,
    iCont: 5.0, out: [5, 6], eff: 0.88, mass: 0.015, solder: false,
    offers: offers({ ali: 4.0, let: 99 }) },
];

// Enclosed desktop power adapters (CE-marked, EU plug) for stationary arms. No mains wiring by the user.
const PSUS = [
  { id: 'psu-6v-5a', cat: 'psu', name: '6 V 5 A desktop power adapter (EU plug, 5.5 × 2.1 mm)', vOut: 6, iCont: 5,
    mass: 0, solder: false, offers: offers({ electrokit: 249, let: 199, 'kjell-se': 299, 'kjell-no': 349, ali: 11 }) },
  { id: 'psu-12v-5a', cat: 'psu', name: '12 V 5 A desktop power adapter (EU plug, 5.5 × 2.1 mm)', vOut: 12, iCont: 5,
    mass: 0, solder: false, offers: offers({ electrokit: 229, let: 179, 'kjell-se': 249, 'kjell-no': 299 }) },
  { id: 'dc-jack-terminal', cat: 'misc', name: 'DC barrel jack to screw terminal adapter', mass: 0, solder: false,
    offers: offers({ ali: 0.6, electrokit: 29, let: 19 }) },
];

const SENSORS = [
  { id: 'hcsr04', cat: 'sensor', name: 'HC-SR04 ultrasonic distance sensor', logicV: 5, current: 0.015, mass: 0.010,
    solder: false, offers: offers({ ali: 0.9, electrokit: 49, 'kjell-se': 89, 'kjell-no': 119, let: 35 }) },
  { id: 'line-5ch', cat: 'sensor', name: '5-channel TCRT5000 line tracking module', logicV: 'any', current: 0.08,
    mass: 0.012, solder: false, offers: offers({ ali: 2.8, electrokit: 99 }) },
  { id: 'mpu6050', cat: 'sensor', name: 'MPU-6050 gyro/accelerometer breakout (GY-521)', logicV: 'any', current: 0.005,
    mass: 0.003, solder: true, offers: offers({ ali: 1.6, electrokit: 79, let: 59 }) },
  { id: 'hc05', cat: 'sensor', name: 'HC-05 Bluetooth serial module (on breakout)', logicV: 3.3, current: 0.04,
    mass: 0.004, solder: false, offers: offers({ ali: 3.5, electrokit: 119, let: 89 }) },
  { id: 'pca9685', cat: 'driver', name: 'PCA9685 16-channel PWM servo driver board', logicV: 'any', current: 0.01,
    mass: 0.009, solder: true, offers: offers({ ali: 2.9, mouser: 13.9, electrokit: 129, let: 119 }) },
];

// Hobby servos. Torques are stall torques at 4.8 V and 6 V, linearly interpolated; vMax is the highest rated supply.
const SERVOS = [
  { id: 'sg90', cat: 'servo', name: 'SG90 micro servo (plastic gears)', size: 'micro', t48: 0.177, t60: 0.21,
    stallCurrent: 0.7, idleCurrent: 0.01, vMax: 6.0, mass: 0.009, solder: false,
    offers: offers({ ali: 1.2, electrokit: 39, 'kjell-se': 79, 'kjell-no': 99, let: 35 }) },
  { id: 'mg90s', cat: 'servo', name: 'MG90S micro servo (metal gears)', size: 'micro', t48: 0.177, t60: 0.216,
    stallCurrent: 0.9, idleCurrent: 0.01, vMax: 6.0, mass: 0.0134, solder: false,
    offers: offers({ ali: 2.2, electrokit: 69, let: 59 }) },
  { id: 'mg996r', cat: 'servo', name: 'MG996R standard servo (metal gears)', size: 'standard', t48: 0.92, t60: 1.08,
    stallCurrent: 2.5, idleCurrent: 0.01, vMax: 7.2, mass: 0.055, solder: false,
    offers: offers({ ali: 3.5, electrokit: 99, let: 89 }) },
  { id: 'ds3218', cat: 'servo', name: 'DS3218 20 kg·cm digital servo', size: 'standard', t48: 1.80, t60: 1.97,
    stallCurrent: 3.0, idleCurrent: 0.01, vMax: 6.8, mass: 0.060, solder: false,
    offers: offers({ ali: 9.0, electrokit: 249 }) },
  { id: 'ds3225', cat: 'servo', name: 'DS3225 25 kg·cm digital servo', size: 'standard', t48: 2.06, t60: 2.30,
    stallCurrent: 3.0, idleCurrent: 0.01, vMax: 6.8, mass: 0.060, solder: false,
    offers: offers({ ali: 14.0 }) },
];

// Arm frames (servos not included). Geometry: shoulder height above the base plate, upper arm L1, forearm L2, and
// `tool` from the wrist axis (or the forearm tip) to the grip point. parallel: a MeArm-style linkage drives the forearm
// from the base and keeps the gripper level, so the elbow servo sits at the base and sets the forearm's absolute angle.
const FRAMES = [
  { id: 'arm-micro-acrylic', cat: 'frame', name: 'Acrylic desktop arm kit, 3 axes + gripper, micro servos (MeArm-style)',
    joints: ['base', 'shoulder', 'elbow'], parallel: true, size: 'micro', baseH: 0.06, L1: 0.080, L2: 0.080,
    tool: 0.050, linkMass: [0.015, 0.015], gripperMass: 0.020, finger: 0.02, maxPayload: 0.08, mass: 0.10,
    printer: false, solder: false, offers: offers({ ali: 9, electrokit: 199 }) },
  { id: 'arm-alu-4axis', cat: 'frame', name: 'Aluminium arm bracket kit, 4 axes + gripper, standard servos',
    joints: ['base', 'shoulder', 'elbow', 'wrist'], parallel: false, size: 'standard', baseH: 0.10, L1: 0.105,
    L2: 0.098, tool: 0.150, linkMass: [0.05, 0.05], gripperMass: 0.080, finger: 0.03, maxPayload: 0.35, mass: 0.35,
    printer: false, solder: false, offers: offers({ ali: 22 }) },
  { id: 'arm-alu-5axis', cat: 'frame', name: 'Aluminium arm bracket kit, 5 axes + gripper ("6DOF"), standard servos',
    joints: ['base', 'shoulder', 'elbow', 'wrist', 'roll'], parallel: false, size: 'standard', baseH: 0.10, L1: 0.105,
    L2: 0.098, tool: 0.165, linkMass: [0.05, 0.05], gripperMass: 0.100, finger: 0.03, maxPayload: 0.30, mass: 0.40,
    printer: false, solder: false, offers: offers({ ali: 28 }) },
  { id: 'arm-printed-5axis', cat: 'frame', name: '3D-printed 5-axis arm: PLA + bearings + screws (you print the parts)',
    joints: ['base', 'shoulder', 'elbow', 'wrist', 'roll'], parallel: false, size: 'standard', baseH: 0.11, L1: 0.150,
    L2: 0.150, tool: 0.140, linkMass: [0.07, 0.06], gripperMass: 0.070, finger: 0.03, maxPayload: 0.50, mass: 0.45,
    printer: true, solder: false, offers: offers({ ali: 16, electrokit: 259, let: 199 }) },
];

// Small parts every build needs, and the extras some designs need.
const MISC = [
  { id: 'jumpers', cat: 'misc', name: 'Jumper wire set (M-M, M-F, F-F, 40 each)', mass: 0.02, solder: false,
    offers: offers({ ali: 2.5, electrokit: 79, 'kjell-se': 99, 'kjell-no': 129, let: 59 }) },
  { id: 'breadboard-mini', cat: 'misc', name: 'Mini breadboard, 170 points (power distribution)', mass: 0.01, solder: false,
    offers: offers({ ali: 0.6, electrokit: 29, let: 19, 'kjell-se': 49 }) },
  { id: 'm3-kit', cat: 'misc', name: 'M3 screw, nut and nylon standoff assortment', mass: 0.03, solder: false,
    offers: offers({ ali: 5, electrokit: 149, let: 99, 'kjell-se': 199, 'kjell-no': 249 }) },
  { id: 'switch-fuse', cat: 'misc', name: 'Rocker switch + inline blade-fuse holder with fuse set', mass: 0.02,
    solder: false, offers: offers({ ali: 3, electrokit: 69, 'kjell-se': 89, 'kjell-no': 119, let: 49 }) },
  { id: 'divider-res', cat: 'misc', name: 'Resistors 1 kΩ + 2 kΩ, 10 each (logic-level dividers)', mass: 0, solder: false,
    offers: offers({ electrokit: 19, let: 15, ali: 1.0 }) },
  { id: 'wire-20awg', cat: 'misc', name: 'Silicone wire 20 AWG red + black, 2 m each (power wiring)', mass: 0.03,
    solder: false, offers: offers({ ali: 2, electrokit: 59, let: 45 }) },
  { id: 'xt60-pigtail', cat: 'misc', name: 'XT60 female pigtail, 14 AWG, 10 cm (LiPo lead)', mass: 0.01, solder: false,
    offers: offers({ ali: 1.5, electrokit: 39, let: 29 }) },
  { id: 'servo-ext', cat: 'misc', name: 'Servo extension cables 30 cm, 5 pcs', mass: 0.02, solder: false,
    offers: offers({ ali: 2.0, electrokit: 89, let: 69 }) },
];

// Tools: only added to the budget when the user says they need them.
const TOOLS = [
  { id: 'tool-multimeter', cat: 'tool', name: 'Digital multimeter', mass: 0, solder: false,
    offers: offers({ 'kjell-se': 199, 'kjell-no': 249, electrokit: 199, let: 149, ali: 12 }) },
  { id: 'tool-solder', cat: 'tool', name: 'Temperature-controlled soldering station + lead-free solder', mass: 0,
    solder: false, offers: offers({ 'kjell-se': 599, 'kjell-no': 749, electrokit: 549, let: 449 }) },
  { id: 'tool-screwdrivers', cat: 'tool', name: 'Precision screwdriver set + small spanner set', mass: 0, solder: false,
    offers: offers({ 'kjell-se': 149, 'kjell-no': 199, electrokit: 129, let: 99, ali: 8 }) },
];

export const PARTS = [
  ...MCUS, ...DRIVERS, ...MOTORS, ...WHEELS, ...CHASSIS, ...BATTERIES, ...PACKS, ...CELLS, ...CHARGERS, ...REGULATORS, ...PSUS,
  ...SENSORS, ...SERVOS, ...FRAMES, ...MISC, ...TOOLS,
];

// Apply the price checks: a checked price replaces the estimate, a shop that does not sell the part loses the offer,
// and a shop found selling it is added. Every offer ends up `checked` (url + date) or an `estimate`.
for (const p of PARTS) {
  const c = CHECKS[p.id] ?? {};
  p.query = SEARCH_TERMS[p.id] ?? p.name;
  p.dropped = p.offers.filter((o) => c[o.vendor]?.gone).map((o) => ({ vendor: o.vendor, ...c[o.vendor] }));
  p.offers = p.offers.filter((o) => !c[o.vendor]?.gone)
    .map((o) => (c[o.vendor] ? { vendor: o.vendor, ...c[o.vendor], status: 'checked' } : { ...o, status: 'estimate' }));
  for (const [vendor, x] of Object.entries(c)) {
    if (x.adds && !p.offers.some((o) => o.vendor === vendor)) p.offers.push({ vendor, ...x, status: 'checked' });
  }
  for (const o of p.offers) delete o.adds;
}

// Where an offer can be seen: its product page when it was checked, otherwise a search for the part at that shop.
export const offerUrl = (p, o) => o.url ?? VENDORS[o.vendor].search.replace('{q}', encodeURIComponent(p.query));

const BY_ID = new Map(PARTS.map((p) => [p.id, p]));
export function part(id) {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`unknown part ${id}`);
  return p;
}

export const byCat = (cat) => PARTS.filter((p) => p.cat === cat);
export const catalog = {
  mcus: MCUS, drivers: DRIVERS, motors: MOTORS, wheels: WHEELS, chassis: CHASSIS, batteries: [...BATTERIES, ...PACKS],
  chargers: CHARGERS, regulators: REGULATORS, psus: PSUS, sensors: SENSORS, servos: SERVOS, frames: FRAMES,
  misc: MISC, tools: TOOLS,
};
