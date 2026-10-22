# Robot Configurator

Describe the robot you want: a wheeled rover, a desktop arm, or a rover carrying an arm. The configurator returns
designs you can actually build from parts sold in **Denmark, Sweden or Norway**. Each design comes with a landed-cost
budget, building instructions, wiring, and Arduino programs that compile as delivered.

**Live:** https://kathuman.github.io/claude-projects/robot-configurator/

## What it does

1. **Requirements.** For a rover: payload, top speed, steepest slope, runtime, surface, and behaviours (drive from a
   phone, avoid obstacles, follow a line, measured moves). For an arm: reach, payload, axes, and phone control. Then
   the build constraints: controller family, soldering or not, 3D printer or not, vendor preference, and budget cap.
2. **Search.** It enumerates every compatible combination from the catalog: chassis × motor × wheel × driver ×
   battery × regulator × controller, plus frame × servo per joint × power supply for arms. That is up to ~40,000
   combinations. Each one runs through the engineering checks below.
3. **Pricing.** The best candidates are priced exactly for the chosen country. Every subset of vendors is tried, and
   each parcel's shipping, VAT, customs duty and carrier clearance fee are counted.
4. **Proposals.** Up to three designs: **lowest cost**, **most headroom** (largest margin on its tightest check), and
   **quickest delivery** (only vendors that deliver within a week).
5. **Per proposal:** the parts list with every check and its margin, the budget by parcel (CSV export), a step-by-step
   build guide, power and signal wiring (diagrams and a full connection table), and two sketches (a self-test and the
   robot program) as a zip.
6. **When nothing fits,** it says why. It lists the checks that block the closest candidates, and binary-searches each
   requirement to tell you how far it would have to move ("payload up to 4.84 kg works").

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
| Domestic shops | Let Elektronik | Electrokit, Kjell & Company | Kjell & Company |
| EU shop (Electrokit) | VAT at checkout (OSS) | domestic | VOEC: VAT at checkout |
| AliExpress | IOSS ≤ €150, else import + duty + fee | IOSS ≤ €150, else import + duty + fee | VOEC < NOK 3,000 per item |
| Mouser | delivered duty paid | delivered duty paid | delivered duty paid |
| Pololu (US) | import: VAT + fee, duty > €150 | import: VAT + fee, duty > €150 | import: VAT + fee, no duty |

EU duty rates are approximate TARIC rates by part type (0 % for electronics, 2.7 % for motors, servos and batteries,
6 % for frames). Norway charges no duty on industrial goods. Exchange rates can be edited in the app.

**The catalog is dated** (`CATALOG_DATE` in `src/catalog.js`). Prices are indicative listings for planning, not
quotes. Vendor ranges, shipping fees and free-shipping thresholds change. The app says so wherever it shows a price.
Updating the catalog means editing one file; the tests check its schema and consistency.

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

## Tests

```bash
npm test
```

42 checks:
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
- the ZIP writer.

## Layout

```
index.html, styles.css, app.js   the page (wizard, proposals, tabs)
src/catalog.js                   parts, vendors, regions, tax rules
src/physics.js                   motor, drive, battery and arm models
src/pins.js                      controller pin maps and assignment
src/solver.js                    enumeration, checks, ranking, explanations
src/pricing.js                   landed cost and vendor optimisation
src/firmware.js                  sketch generation
src/wiring.js, src/guide.js      wiring table + diagrams, building instructions
src/zip.js, src/worker.js        download archive, background search
tools/                           firmware build matrix
tests/                           node --test suites
```

## Limits

- The models are first-order engineering models with safety factors, not a simulation. Gearbox wear, cheap cells
  below their label, and flexible frames all cost margin; the **most headroom** proposal exists for that reason.
- Servo and motor specifications are typical values for generic parts; clones vary.
- Arm checks are static. Fast moves with a payload add inertial torque, so keep `jointSpeed` moderate with heavy loads.
- Stationary arms use enclosed, CE-marked mains adapters. The app never asks the user to wire mains voltage.
