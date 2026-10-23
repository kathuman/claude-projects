# Robot Configurator

Describe the robot you want: a wheeled rover, a desktop arm, or a rover carrying an arm. The configurator returns
designs you can actually build from parts sold in **Denmark, Sweden or Norway**. Each design comes with a landed-cost
budget, building instructions, wiring, and Arduino programs that compile as delivered.

**Live:** https://kathuman.github.io/claude-projects/robot-configurator/ · version 2.1.0 · English, Dansk, Svenska, Norsk, Español

## What it does

1. **Requirements.** For a rover: payload, top speed, steepest slope, runtime, surface, and behaviours (drive from a
   phone, avoid obstacles, follow a line, measured moves). For an arm: reach, payload, axes, and phone control. Then
   the build constraints: controller family, soldering or not, 3D printer or not, vendor preference, and budget cap.
2. **Search.** It enumerates every compatible combination from the catalog: chassis × motor × wheel × driver ×
   battery × regulator × controller, plus frame × servo per joint × power supply for arms. That is up to ~40,000
   combinations. Each one runs through the engineering checks below.
3. **Pricing.** The best candidates are priced exactly for the chosen country. Every subset of vendors is tried, and
   each parcel's shipping, VAT, customs duty and carrier clearance fee are counted.
4. **Proposals.** Up to three designs: **lowest cost**, **most headroom**, and **quickest delivery** (only vendors that
   deliver within a week; when its parts are the lowest-cost ones, the card says so).
   - *Headroom* is the margin on a design's tightest check. Most headroom is the design on the **cost–headroom
     frontier** with the largest margin for at most twice the lowest cost (or within the budget). It must beat the
     lowest-cost design by more than 2 points; otherwise the page says the cheapest is also the sturdiest buy.
   - **Compare side by side:** price, delivery, headroom and its check, performance, building time, and every part, with
     the parts that differ highlighted.
   - **Cost against headroom:** a chart of every design that passes (a sample above 700, and the whole frontier), the
     frontier as a staircase, the proposals ringed. Click any point, or a row of the frontier table, and it is priced
     exactly and becomes **your pick**.
   - **Try another part:** for each part of the design, the alternatives with everything else unchanged: the price
     difference and headroom of those that work, and the check that stops each that does not.
5. **Per proposal:** the parts list with every check and its margin, the budget by parcel (CSV export), a step-by-step
   build guide, power and signal wiring (diagrams and a full connection table), and two sketches (a self-test and the
   robot program) as a zip.
6. **When nothing fits,** it says why. It lists the checks that block the closest candidates, and binary-searches each
   requirement to tell you how far it would have to move ("payload up to 4.84 kg works").

## See it before you buy (2.1)

- **Drawing** tab: the rover from above, drawn from its parts (`src/layout.js`). The battery goes in the middle, then
  every board takes the first free spot on the chassis plate; what does not fit goes on a second deck, and the page
  says which boards and what standoffs. The power wiring is drawn along that layout (battery → switch and fuse →
  breadboard rails → driver and regulator → controller) with the motor leads to the wheels. An arm is drawn from the
  side in the home pose the build guide sets up, stretched out, and with the reach you asked for against its full
  stretch. Board sizes are typical module footprints (`FOOTPRINT`), so the drawing is a guide to fitting and wiring,
  not a mechanical drawing.
- **Build pack:** one printable document with the drawing, parts and budget, wiring and building guide (and the
  program file names), to print or save as PDF from the browser.

## Engineering checks

| Area | Check |
|---|---|
| Drive | Brushed DC motor on its linear torque–speed line, scaled with voltage; motor voltage = battery − driver drop (iterated with current), capped by firmware PWM at the motor rating. Continuous slope torque ≤ 30 % of stall at the battery's cut-off voltage; climbing + accelerating ≤ 60 %. Top speed on the flat at nominal voltage. |
| Grip | Climbing + accelerating force ≤ μ × weight on the driven wheels (75 % with a caster, 100 % on 4WD). |
| Load and terrain | Carried mass ≤ chassis rating; outdoor surfaces need an outdoor chassis, outdoor tread and a minimum wheel size. |
| Electrical | Driver voltage range and continuous current per channel (motors in parallel on 4WD); stall current vs. driver peak (warning, because the firmware ramps); regulator input range and dropout (keeps the logic rail ≥ 4.6 V on an empty battery) and current; battery discharge rating; 3.3 V logic vs. each driver's input-high threshold; enough pins of each kind (PWM, interrupt, input-only on the ESP32). |
| Runtime | 80 % of battery energy; moving 60 % of the time at 70 % of top speed; drive power × 1.5 (× 2.5 for skid steer) for starts and turns. |
| Arm | Holding torque at shoulder, elbow and wrist ≤ 50 % of the servo's stall torque at 6 V, with the payload held horizontally at the required reach; gripper friction hold (μ 0.5, × 2); servo supply ≥ all servos holding + one stalled; required reach ≤ 90 % of full stretch. |
| Rover + arm | The arm and its payload ride on the rover; the servo regulator must run from an empty battery; with the arm stretched sideways, the centre of mass stays within ⅔ of the half-track. |

## Markets, vendors and taxes

| | Denmark | Sweden | Norway |
|---|---|---|---|
| VAT | 25 % | 25 % | 25 % |
| Domestic shops | Let Elektronik | Electrokit, Kjell & Company, MBS RC Models | Kjell & Company |
| EU shop (Electrokit) | VAT at checkout (OSS) | domestic | VOEC: VAT at checkout |
| AliExpress | IOSS ≤ €150, else import + duty + fee | IOSS ≤ €150, else import + duty + fee | VOEC < NOK 3,000 per item |
| Mouser | delivered duty paid | delivered duty paid | delivered duty paid |
| Pololu (US) | import: VAT + fee, duty > €150 | import: VAT + fee, duty > €150 | import: VAT + fee, no duty |

EU duty rates are approximate TARIC rates by part type (0 % for electronics, 2.7 % for motors, servos and batteries,
6 % for frames). Norway charges no duty on industrial goods. Exchange rates can be edited in the app.

MBS RC Models (a Swedish RC-hobby shop, for LiPo packs and their chargers) is modelled for Sweden only: it does not
send lithium batteries outside the EU and states no Danish shipping fee.

## Prices you can check (2.0)

Every offer is one of two kinds, and the page shows which:

- **Checked:** read on the shop's own product page on a given day. `src/prices.js` holds the price as listed, the
  link, the date and the shop's own product name (and a note when it matters: out of stock, ordered in, a different
  but equivalent board). The budget links each line to that page and says how long ago it was checked; after 90 days
  it is marked as possibly changed.
- **Estimate:** a typical price from `src/catalog.js` that has not been checked. The budget links to a search for the
  part at that shop.

A shop that turned out not to sell a part loses the offer, with the reason recorded (`gone: true, note`), so it does
not come back by accident. The first full check (2026-10-22/23) went through every Nordic offer, Pololu and the new
RC shop:

| | Offers |
|---|---|
| Checked, with link and date | 79 |
| Dropped: the shop does not sell it (reason recorded) | 64 |
| Estimates: AliExpress 65, Mouser 6, Nordic prices that could not be confirmed 12 | 83 |

Mouser and AliExpress turn automated readers away, so their prices stay estimates. **Buy from: only prices checked at
the shop** restricts a search to checked offers; each proposal card says how many of its prices were checked.

What the check changed:

- **Packs you assemble.** No shop in the catalog sells a ready-made 2S or 3S lithium pack, so the configurator builds
  one: a holder with the cells in series (Electrokit, Let) and protected 18650 cells (Electrokit, 10 A), charged as
  loose cells in a 2-slot charger. A pack's `kit` is what is bought; the build guide charges the cells, assembles the
  pack and measures it before anything is wired.
- **Chassis kits.** The Nordic shops sell 2WD and 4WD kits with their motors and wheels, not bare chassis. A kit's
  `includes` names the motor and wheel it brings; they count for mass and the checks but are not bought again.
- **Parts sold in packs.** An offer's `pack` is how many catalog units one shop item holds (2 for a pair of wheels,
  0.2 when a set of five is sold singly); only whole items are bought.
- **A 5 V buck-boost regulator** (Pololu S13V30F5 at Electrokit), which runs from an empty 2S pack, where the LM2596
  cannot.
- **AliExpress estimates** for the ready-made packs, LiPo chargers and the 6 V adapter, so those designs remain
  possible, clearly marked.

**The weekly catalog job** (`.github/workflows/robot-configurator-catalog.yml`, Mondays and on every catalog change)
runs `tools/check-catalog.mjs --links`: it rejects a malformed record, lists coverage and stale checks per vendor, and
follows every product link and vendor search, reporting what did not answer in the job summary.

```bash
node tools/check-catalog.mjs            # records and coverage
node tools/check-catalog.mjs --links    # also follow every link
```

## Firmware

`src/firmware.js` writes two Arduino sketches per design. They have no third-party libraries: the PCA9685 and the
MPU-6050 are driven over `Wire` directly.

- **`selftest.ino`:** an I²C scan; each motor forward with its encoder count (tells you which `INVERT_*` flags to
  set); a full-speed test that measures `MAX_WHEEL_SPEED`; the distance and line sensors; the gyro; every servo to
  90° so the horns can be fitted in the home pose; the Bluetooth link.
- **`robot.ino`:** body-speed commands → acceleration-limited wheel speeds → PI speed loop per wheel (open-loop
  feed-forward without encoders); odometry (gyro heading when fitted); obstacle avoidance; PD line following;
  measured moves (`F 1`, `T 90`); and the arm, with analytic inverse kinematics (elbow-up, wrist pitch,
  parallel-linkage variant), rate-limited joint motion, and teach / replay. Commands come over USB serial, HC-05
  Bluetooth (AVR), or a Wi-Fi access point with a phone page: a joystick and arm sliders on the ESP32. Remote driving
  stops when commands stop arriving.

Every firmware variant the solver can produce is generated by `tools/gen-fixtures.js`: about 200 combinations of
controller × driver scheme × encoders × behaviours × link × arm frame. CI builds them with `arduino-cli`, exactly as
the Arduino IDE does, including its prototype generation. A build fails on any compiler warning in the generated code.

```bash
node tools/gen-fixtures.js build/fixtures
node tools/compile-fixtures.js build/fixtures --arch avr          # all AVR variants
node tools/compile-fixtures.js build/fixtures --arch esp32 --cover # a covering subset (the ESP32 build is slow)
```

## Languages

English, Danish, Swedish, Norwegian (Bokmål) and Latin American Spanish: the page, the checks and their details, the
budget, the building guide, the wiring and the About page. The Arduino programs stay in English, like the IDE they are
read in; part names are the shops' own.

- `src/i18n.js`: `t('English text', { placeholders })`, with the English text as the key, and number formats per
  language. The worker gets the language with each search, so the checks come back translated.
- `src/lang/{da,sv,nb,es}.js`: one dictionary each.
- The language comes from the picker, `?lang=da|sv|nb|es|en`, or the browser. Danish, Swedish and Norwegian also
  preselect their market.
- `tools/i18n-keys.js` finds every text by reading the sources (`--missing -v` lists what a dictionary lacks).

## Tests

```bash
npm test
```

60 checks:
- the motor, slope, PWM-cap, runtime, servo and joint-torque models, against hand calculations;
- catalog schema and consistency;
- every shipping/tax mode, against hand-computed parcels;
- the vendor optimiser, against brute force over every item-to-vendor assignment;
- pin assignment on the Uno and ESP32;
- every proposal passes its checks and honours the solder, vendor and budget constraints;
- infeasible requests are explained, and the relaxed values they suggest really are feasible;
- generated firmware defines every pin and constant the design uses;
- the inverse kinematics inverts the forward kinematics;
- the wiring covers every pin and level divider;
- the build guide sets the regulators before anything is wired;
- the ZIP writer;
- the most-headroom proposal differs from the lowest cost, adds margin and lies on the frontier, which only gains
  headroom as the cost rises;
- a design picked on the chart is priced and passes; a swap changes only its part and prices the difference;
- every text in every language with the same placeholders, and the engine run in each language asks for nothing a
  dictionary lacks;
- every price record well formed (dates, links, reasons for dropped offers), every offer checked or an estimate;
- packs are bought whole; a check goes stale after 90 days;
- a pack you assemble is bought as holder and cells with the loose-cell charger; a chassis kit's motors and wheels
  are not bought again; with checked prices only, every line is checked, and an arm says no arm frame has one;
- the drawing places every board inside the plate or on a second deck without overlaps, and the arm's drawn geometry
  matches its link lengths.

A browser check drives the page (59 checks: the drawing and the build pack, every robot type, the chart pick, swaps, the comparison, every tab, both
downloads, every language with no English left, the About page, phone width, the theme):

```bash
python -m http.server 8766          # from the repository root
PW=<path to playwright or playwright-core> CHROME=<chrome.exe> node robot-configurator/tools/browser-check.cjs
```

## Layout

```
index.html, styles.css, app.js   the page (wizard, proposals, chart, comparison, swaps, tabs, build pack)
src/layout.js                    the drawing: footprints, placement on the plate, top and side views
about.html                       what it does, limits, versions, citation
src/catalog.js                   parts, vendors, regions, tax rules
src/physics.js                   motor, drive, battery and arm models
src/pins.js                      controller pin maps and assignment
src/solver.js                    enumeration, checks, ranking, explanations
src/pricing.js                   landed cost and vendor optimisation
src/firmware.js                  sketch generation
src/wiring.js, src/guide.js      wiring table + diagrams, building instructions
src/zip.js, src/worker.js        download archive, background search (keeps the last search for picks and swaps)
src/i18n.js, src/lang/           translation and the four dictionaries
tools/                           firmware build matrix, translation keys, browser check
tests/                           node --test suites
```

## Limits

- The models are first-order engineering models with safety factors, not a simulation. Gearbox wear, cheap cells
  below their label, and flexible frames all cost margin; the **most headroom** proposal exists for that reason.
- Servo and motor specifications are typical values for generic parts; clones vary.
- Arm checks are static. Fast moves with a payload add inertial torque, so keep `jointSpeed` moderate with heavy loads.
- Stationary arms use enclosed, CE-marked mains adapters. The app never asks the user to wire mains voltage.
