// Price checks: what a shop listed for a part, on which page, on which day. catalog.js holds the parts and their
// typical prices; an entry here replaces a typical price with the one seen on the shop's own product page, so every
// offer is either "checked" (a link and a date) or an "estimate" (a search link at that shop instead).
//
//   CHECKS[partId][vendorId] = { price, url, checked: 'YYYY-MM-DD', listed: 'the shop's product name' }
//   CHECKS[partId][vendorId] = { gone: true, checked, note }   the shop does not sell it (the offer is dropped)
//   CHECKS[partId][vendorId] = { price, url, checked, listed, adds: true }   a shop not in catalog.js sells it too
//
// Prices are as listed, in the shop's currency, with VAT where the shop shows it (the Nordic shops do). A check goes
// stale after STALE_DAYS: the page still shows it, marked as possibly changed, and the weekly catalog job lists it.
// tools/check-catalog.mjs follows every link and reports what broke.

export const STALE_DAYS = 90;

// The search term each shop is asked for when an offer has no product page yet.
export const SEARCH_TERMS = {
  'uno-r3': 'Arduino Uno R3', 'uno-clone': 'Uno R3 CH340', 'nano-clone': 'Nano CH340', 'esp32-devkit': 'ESP32 DevKitC',
  l298n: 'L298N', tb6612: 'TB6612FNG', drv8833: 'DRV8833', mdd10a: 'MDD10A', bts7960: 'BTS7960',
  'tt-dc': 'TT gearmotor', 'n20-100-enc': 'N20 encoder motor', 'pololu-micro-100-enc': 'micro metal gearmotor 100:1 encoder',
  'jga25-34-enc': 'JGA25-370 encoder', 'jgb37-30-enc': 'JGB37-520 encoder', 'pololu-37d-50-enc': '37D 50:1 encoder',
  'wheel-tt-65': 'TT wheel 65mm', 'wheel-d3-42': 'wheel 42mm 3mm D', 'wheel-d4-65': 'wheel 65mm 4mm hub',
  'wheel-d6-85': 'off-road wheel 85mm 6mm', 'wheel-d6-125': 'off-road wheel 125mm 6mm',
  'kit-2wd-olimex': 'robot car kit 2WD', 'kit-4wd-joyit': 'robot car kit 4WD', 'chassis-2wd-acrylic': '2WD robot chassis', 'chassis-4wd-acrylic': '4WD robot chassis', 'chassis-n20-mini': 'N20 robot chassis',
  'chassis-alu-2wd-25': 'aluminium robot chassis 25mm motor', 'chassis-alu-4wd-37': 'aluminium 4WD chassis 37mm',
  'chassis-zumo': 'Zumo chassis', 'tank-alu-25': 'aluminium tank chassis encoder motor', 'tank-alu-37': 'aluminium tank chassis 37mm encoder motor', 'jga25-21-enc': 'JGA25-370 encoder 280rpm', 'bal-frame-n20': 'balancing robot chassis N20',
  'bal-frame-25': 'self-balancing robot chassis 25mm motor', 'mecanum-60-tt': 'mecanum wheel 60mm TT', 'mecanum-80': 'mecanum wheel 80mm',
  'mecanum-97': 'mecanum wheel 97mm',
  'batt-6aa-nimh': 'NiMH AA 2000mAh', 'batt-2s-18650': '2S 18650 battery pack', 'batt-3s-18650': '3S 18650 battery pack',
  'batt-2s-lipo-2200': '2S LiPo 2200mAh', 'batt-3s-lipo-2200': '3S LiPo 2200mAh', 'batt-3s-lipo-5000': '3S LiPo 5000mAh',
  'chg-nimh': 'NiMH charger AA', 'chg-2s': '2S li-ion charger 8.4V', 'chg-3s': '3S li-ion charger 12.6V',
  'chg-lipo': 'LiPo balance charger', 'lipo-bag': 'LiPo safety bag',
  'reg-s13v30f5': 'Pololu 5V step-up step-down', 'buck-lm2596': 'LM2596', 'buck-mp1584': 'MP1584', 'buck-xl4015': 'XL4015', 'buck-xl4016': 'XL4016', 'ubec-5a': 'UBEC 5A',
  'psu-6v-5a': '6V 5A power supply', 'psu-12v-5a': '12V 5A power supply', 'dc-jack-terminal': 'DC jack screw terminal',
  hcsr04: 'HC-SR04', 'line-5ch': 'TCRT5000 5 channel', mpu6050: 'MPU-6050', hc05: 'HC-05', pca9685: 'PCA9685',
  sg90: 'SG90', mg90s: 'MG90S', mg996r: 'MG996R', ds3218: 'DS3218', ds3225: 'DS3225',
  'arm-micro-acrylic': 'MeArm robot arm', 'arm-alu-4axis': 'robot arm aluminium 4DOF', 'arm-alu-5axis': 'robot arm 6DOF aluminium',
  'arm-printed-5axis': 'robot arm 3D printed', jumpers: 'jumper wires', 'breadboard-mini': 'mini breadboard 170',
  'm3-kit': 'M3 standoff kit', 'switch-fuse': 'blade fuse holder', 'divider-res': 'resistor 1k 2k',
  'wire-20awg': 'silicone wire 20AWG', 'xt60-pigtail': 'XT60 cable', 'servo-ext': 'servo extension cable',
  'cell-18650-prot': '18650 protected', 'holder-2x18650': '18650 holder 2', 'holder-3x18650': '18650 holder 3',
  'chg-18650-cells': '18650 charger', 'tool-multimeter': 'multimeter', 'tool-solder': 'soldering station', 'tool-screwdrivers': 'precision screwdriver set',
};

export const CHECKS = {
  'uno-r3': {
    let: {"gone": true, "checked": "2026-10-23", "note": "sells DFRduino and clone Uno boards, no original Arduino Uno R3"},
    electrokit: {"price": 329, "url": "https://www.electrokit.com/en/arduino-uno-mega328rev-3", "checked": "2026-10-22", "listed": "Arduino UNO REV3", "note": "out of stock when checked"},
  },
  'uno-clone': {
    let: {"price": 75, "url": "https://let-elektronik.dk/arduino-uno-r3-klon.-mega328p-with-ch340", "checked": "2026-10-23", "listed": "Arduino UNO R3 (klon), Mega328P with CH340", "adds": true},
    'kjell-no': {"price": 279.9, "url": "https://www.kjell.com/no/produkter/elektro-og-verktoy/elektronikk/arduino/utviklingskort/uno-rev.-3-arduino-kompatibelt-utviklingskort-p88860", "checked": "2026-10-23", "listed": "Uno Rev. 3 Arduino-kompatibelt utviklingskort"},
    'kjell-se': {"price": 279.9, "url": "https://www.kjell.com/se/produkter/el-verktyg/elektronik/arduino/utvecklingskort/uno-rev.-3-arduino-kompatibelt-utvecklingskort-p88860", "checked": "2026-10-23", "listed": "Uno Rev. 3 Arduino-kompatibelt utvecklingskort"},
    electrokit: {"price": 99, "url": "https://www.electrokit.com/en/utvecklingskort-atmega328p-uno-kompatibelt", "checked": "2026-10-22", "listed": "UNO REV3 Arduino-compatible"},
  },
  'nano-clone': {
    electrokit: {"price": 179, "url": "https://www.electrokit.com/en/utvecklingskort-atmega328p-nano-kompatibelt", "checked": "2026-10-22", "listed": "Microcontroller ATMEGA328P Nano compatible", "note": "headers already soldered"},
  },
  'esp32-devkit': {
    let: {"price": 80, "url": "https://let-elektronik.dk/esp-wroom-32-nodemcu", "checked": "2026-10-23", "listed": "ESP-WROOM-32 NodeMCU", "note": "30-pin board; the programs use only GPIOs it has"},
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: sells the Arduino Nano ESP32, a different board and pin map, not an ESP32-DevKitC"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "sells the Arduino Nano ESP32, a different board and pin map, not an ESP32-DevKitC"},
    electrokit: {"price": 179, "url": "https://www.electrokit.com/en/esp32-devkit-lipo", "checked": "2026-10-22", "listed": "ESP32-WROOM-32 DevKit LiPo", "note": "pin-compatible with ESP32-DevKitC, adds a LiPo charger; out of stock when checked"},
  },
  'l298n': {
    let: {"price": 150, "url": "https://let-elektronik.dk/mdv-2x2a-dc-motor-controller-l298n", "checked": "2026-10-23", "listed": "DC Motor Controller L298N, 4.8-46V 2A Dual H-Bridge"},
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: its L298N listing (Velleman 87201) is no longer available"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "its L298N listing (Velleman 87201) is no longer available"},
    electrokit: {"price": 79, "url": "https://www.electrokit.com/en/motordrivare-l298-dubbel-h-brygga-5-35v-2a", "checked": "2026-10-22", "listed": "Motor driver dual H-bridge 5-35V 2A - L298N"},
  },
  'tb6612': {
    pololu: {"price": 4.95, "url": "https://www.pololu.com/product/713", "checked": "2026-10-23", "listed": "TB6612FNG Dual Motor Driver Carrier (#713)", "note": "headers included loose"},
    let: {"price": 55, "url": "https://let-elektronik.dk/fermion-tb6612fng-2x1.2a-dc-motor-driver-breakout", "checked": "2026-10-23", "listed": "DC Motor Driver TB6612FNG, 2x1.2A, 2.7V-12V, Dual Channel (DFRobot DRI0044)", "note": "ordered in: ships the Tuesday after"},
    electrokit: {"price": 119, "url": "https://www.electrokit.com/en/tbb6612-motordrivare-2-kanal-4.5-13.5v-monterad-pa-kort", "checked": "2026-10-22", "listed": "TB6612 motor driver 2-ch 4.5V-13.5V"},
  },
  'drv8833': {
    pololu: {"price": 10.95, "url": "https://www.pololu.com/product/2130", "checked": "2026-10-23", "listed": "DRV8833 Dual Motor Driver Carrier (#2130)"},
    electrokit: {"price": 99, "url": "https://www.electrokit.com/en/motor-driver-dual-h-bridge-1.5a-drv8833", "checked": "2026-10-22", "listed": "Motor driver dual H-bridge 1.5A DRV8833"},
  },
  'bts7960': {
    electrokit: {"price": 119, "url": "https://www.electrokit.com/en/motordrivare-dubbel-h-brygga-6-27v-43a-bts7960", "checked": "2026-10-22", "listed": "Motor driver dual H-bridge 5.5-27V 43A - BTS7960"},
  },
  'tt-dc': {
    let: {"gone": true, "checked": "2026-10-23", "note": "no TT gearmotor found"},
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: no TT gearmotor found"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "no TT gearmotor found"},
    electrokit: {"price": 58, "url": "https://www.electrokit.com/en/dc-motor-med-kuggvaxel-1-48-230rpm-6v", "checked": "2026-10-22", "listed": "DC motor with gearbox 1:48 230rpm 6V", "note": "out of stock when checked"},
  },
  'n20-100-enc': {
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells a 12 V 1:150 N20 motor with encoder, a different motor from the 6 V 1:100 one"},
  },
  'wheel-tt-65': {
    let: {"gone": true, "checked": "2026-10-23", "note": "its 65 mm wheels need a hub adapter and are not made for TT shafts"},
    electrokit: {"price": 79, "url": "https://www.electrokit.com/en/robothjul-65mm-gummidack-2-pack", "checked": "2026-10-22", "listed": "Robot wheels 65mm rubber tires 2-pack", "pack": 2},
  },
  'chassis-2wd-acrylic': {
    let: {"gone": true, "checked": "2026-10-23", "note": "no TT-motor 2WD chassis found"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells complete 2WD kits with motors and wheels, not a bare chassis"},
  },
  'chassis-4wd-acrylic': {
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells a complete 4WD kit (Joy-It Robot03) with motors and wheels, not a bare chassis"},
  },
  'batt-6aa-nimh': {
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: sells AA cells and a 6×AA holder separately, not a pack"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "sells AA cells and a 6×AA holder separately, not a pack"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells AA cells and holders separately, not a 6-cell pack"},
  },
  'batt-2s-18650': {
    let: {"gone": true, "checked": "2026-10-23", "note": "sells single 18650 cells, holders and BMS boards, no ready 2S pack"},
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: sells single 3.6 V 18650 cells only"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "sells single 3.6 V 18650 cells only"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells single 18650 cells and holders, no ready 2S pack with BMS"},
  },
  'batt-3s-18650': {
    let: {"gone": true, "checked": "2026-10-23", "note": "sells single 18650 cells, holders and BMS boards, no ready 3S pack"},
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: sells single 3.6 V 18650 cells only"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "sells single 3.6 V 18650 cells only"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells single 18650 cells and holders, no ready 3S pack with BMS"},
  },
  'batt-2s-lipo-2200': {
    mbs: {"price": 159, "url": "https://mbs-rcmodels.se/butik/lipo-2s-1000mah-och-over/gens-ace-2s-2200mah-30c-soaring/", "checked": "2026-10-23", "listed": "2S 2200mAh 30C Gens ace G-Tech Soaring (XT60)", "adds": true, "note": "JST-XH balance lead"},
    let: {"gone": true, "checked": "2026-10-23", "note": "sells single-cell LiPos only"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells single-cell LiPos only, no 2S pack"},
  },
  'batt-3s-lipo-2200': {
    mbs: {"price": 214, "url": "https://mbs-rcmodels.se/butik/lipo-3s-1000mah-och-over/gens-ace-3s-2200mah-30c-soaring/", "checked": "2026-10-23", "listed": "3S 2200mAh 30C Gens ace G-Tech Soaring (XT60)", "adds": true, "note": "JST-XH balance lead"},
    let: {"gone": true, "checked": "2026-10-23", "note": "sells single-cell LiPos only"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells single-cell LiPos only, no 3S pack"},
  },
  'batt-3s-lipo-5000': {
    mbs: {"gone": true, "checked": "2026-10-23", "note": "its 3S 5000 mAh pack has an XT90 plug, not XT60"},
    let: {"gone": true, "checked": "2026-10-23", "note": "sells single-cell LiPos only"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells single-cell LiPos only, no 3S pack"},
  },
  'chg-nimh': {
    'kjell-no': {"price": 399.9, "url": "https://www.kjell.com/no/produkter/elektro-og-verktoy/batteriladere/nimh-nicd-li-jon/luxorparts-multi-charger-8-batterilader-p32076", "checked": "2026-10-23", "listed": "Luxorparts Multi Charger 8 Batterilader", "note": "USB-powered; adapter sold separately"},
    'kjell-se': {"price": 349.9, "url": "https://www.kjell.com/se/produkter/el-verktyg/batteriladdare/nimh-nicd-li-jon/luxorparts-multi-charger-8-batteriladdare-p32076", "checked": "2026-10-23", "listed": "Luxorparts Multi Charger 8 Batteriladdare", "note": "USB-powered; adapter sold separately"},
    electrokit: {"price": 229, "url": "https://www.electrokit.com/en/batteriladdare-pro-4x-aaa/aa-nimh-1.5v-li-ion", "checked": "2026-10-22", "listed": "Batteriladdare Pro 4x AAA/AA NiMH + 1.5V Li-Ion", "note": "USB-C cable included, USB adapter not"},
  },
  'chg-2s': {
    let: {"price": 61, "url": "https://let-elektronik.dk/usb-charger-for-7.4v-lipo-battery", "checked": "2026-10-23", "listed": "USB Charger, 7.4V LiPo, High Efficiency, 1A, LED Indicator (DFRobot DFR0564)", "note": "USB-powered; its 8.4 V cut-off suits a 2S Li-ion pack"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells chargers for loose 18650 cells, not for a 2S pack"},
  },
  'chg-3s': {
    let: {"gone": true, "checked": "2026-10-23", "note": "no 3S charger found"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells chargers for loose 18650 cells, not for a 3S pack"},
  },
  'chg-lipo': {
    mbs: {"price": 229, "url": "https://mbs-rcmodels.se/butik/nyheter/skyrc-e3s-2-3s-lipo-life-och-lihv-laddare/", "checked": "2026-10-23", "listed": "SkyRC e3S, 2-3S LiPo-, LiFe- och LiHV-laddare", "adds": true, "note": "mains input, 2–3S through the balance lead, 2.2 A"},
    let: {"gone": true, "checked": "2026-10-23", "note": "no balance charger found"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "its balance charger (Velleman VLE8) is discontinued"},
  },
  'lipo-bag': {
    mbs: {"price": 59, "url": "https://mbs-rcmodels.se/butik/lipo-forvaring/laddpase-18x23cm/", "checked": "2026-10-23", "listed": "Laddpåse 18x23cm", "adds": true},
    let: {"gone": true, "checked": "2026-10-23", "note": "no LiPo safety bag found"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "no LiPo safety bag found"},
  },
  'buck-lm2596': {
    let: {"price": 45, "url": "https://let-elektronik.dk/dc-dc-step-down-3a.-in-3.2v-40v.-out-1.25-35v", "checked": "2026-10-23", "listed": "Step-Down, IN 3.2V-40V, OUT 1.25V-35V 3A (LM2596S)"},
    'kjell-no': {"price": 99.9, "url": "https://www.kjell.com/no/produkter/elektro-og-verktoy/elektronikk/arduino/stromforsyning/luxorparts-variabel-spenningsregulator-switchet-p87049", "checked": "2026-10-23", "listed": "Luxorparts Variabel spenningsregulator - switchet"},
    'kjell-se': {"price": 99.9, "url": "https://www.kjell.com/se/produkter/el-verktyg/elektronik/arduino/stromforsorjning/luxorparts-variabel-spanningsregulator-switchad-p87049", "checked": "2026-10-23", "listed": "Luxorparts Variabel spänningsregulator Switchad (LM2596S, 2.5 A)"},
    electrokit: {"price": 69, "url": "https://www.electrokit.com/en/dc-dc-omvandlare-step-down-1.23-30v-1.5a", "checked": "2026-10-22", "listed": "DC-DC converter step-down 1.23-30V 1.5A"},
  },
  'buck-mp1584': {
    let: {"price": 35, "url": "https://let-elektronik.dk/dc-dc-step-down-converter-buck", "checked": "2026-10-23", "listed": "MP1584EN justerbar buck-modul 3A", "adds": true, "note": "listed on the step-down category page"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "no MP1584 board found"},
  },
  'buck-xl4015': {
    electrokit: {"price": 99, "url": "https://www.electrokit.com/en/dc-dc-omvandlare-step-down-1.25-36v-0-5a", "checked": "2026-10-22", "listed": "DC-DC converter step-down 1.25-36V 0-5A"},
  },
  'buck-xl4016': {
    electrokit: {"price": 149, "url": "https://www.electrokit.com/en/dc-dc-omvandlare-1.2-35v-8a", "checked": "2026-10-22", "listed": "DC-DC converter 1.2 - 35V 8A"},
  },
  'psu-6v-5a': {
    let: {"gone": true, "checked": "2026-10-23", "note": "no 6 V 5 A adapter found"},
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: no 6 V 5 A adapter; its adjustable adapters give 2 A at most at 6 V"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "no 6 V 5 A adapter; its adjustable adapters give 2 A at most at 6 V"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "no 6 V 5 A supply found"},
  },
  'psu-12v-5a': {
    let: {"price": 345, "url": "https://let-elektronik.dk/strmforsyning-desktop-12v-5a", "checked": "2026-10-23", "listed": "12V, 5A/60W Strømforsyning Desktop", "note": "not in local stock when checked: 2–3 weeks"},
    'kjell-se': {"price": 429.9, "url": "https://www.kjell.com/se/produkter/el-verktyg/natadaptrar-nataggregat/acdc-natadaptrar/fast-utspanning/luxorparts-switchad-natadapter-12-v-dc-60-w-p45189", "checked": "2026-10-23", "listed": "Luxorparts Switchad nätadapter 12 V (DC) 60 W", "note": "comes with O-dapt plug tips; check one is 5.5 × 2.1 mm"},
    electrokit: {"price": 279, "url": "https://www.electrokit.com/en/nataggregat-desktop-12v-5a-60w", "checked": "2026-10-22", "listed": "Power supply desktop 12VDC 5A 60W", "note": "mains cord (C13) sold separately"},
  },
  'dc-jack-terminal': {
    let: {"price": 17.75, "url": "https://let-elektronik.dk/dc-barrel-jack-adapter-female", "checked": "2026-10-23", "listed": "DC Barrel Jack Adapter - Female", "note": "check it has the screw terminal"},
    electrokit: {"price": 20, "url": "https://www.electrokit.com/en/adapter-dc-jack/skruvplint", "checked": "2026-10-22", "listed": "DC jack 2.1x5.5x9.5 to terminal block"},
  },
  'hcsr04': {
    let: {"price": 23, "url": "https://let-elektronik.dk/ultrasonic-distance-meter-hc-sr04", "checked": "2026-10-23", "listed": "Ultralyds afstandsmåler HC-SR04 TIPA"},
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: its ultrasonic distance sensor listing is gone; only a time-of-flight sensor is left"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "its ultrasonic distance sensor listing is gone; only a time-of-flight sensor is left"},
    electrokit: {"price": 49, "url": "https://www.electrokit.com/en/product/distance-sensor-ultrasound-hc-sr04-2-400cm/", "checked": "2026-10-22", "listed": "Distance sensor ultrasound HC-SR04 2 - 400cm"},
  },
  'line-5ch': {
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "its 5-channel sensor is Pololu's, made for the Balboa robot, not a TCRT5000 module"},
  },
  'mpu6050': {
    let: {"price": 165, "url": "https://let-elektronik.dk/fermion-mpu-6050-6-dof-sensor-breakout", "checked": "2026-10-23", "listed": "6 DOF Sensor MPU-6050 (Breakout) (DFRobot)"},
    electrokit: {"price": 72, "url": "https://www.electrokit.com/en/mpu-6050-accelerometer-3-axel-gyro-monterad-pa-kort", "checked": "2026-10-22", "listed": "6-axlis IMU accelerometer and gyro MPU6050 - I2C"},
  },
  'hc05': {
    let: {"price": 215, "url": "https://let-elektronik.dk/bluetooth-2.0-module-v3-for-arduino", "checked": "2026-10-23", "listed": "Bluetooth Module V3, 2.0, For Arduino (DFRobot TEL0026)", "note": "classic Bluetooth serial like the HC-05; ordered in"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells a BLE module only; the programs use classic Bluetooth serial (HC-05)"},
  },
  'pca9685': {
    let: {"gone": true, "checked": "2026-10-23", "note": "no PCA9685 board for sale"},
    electrokit: {"price": 199, "url": "https://www.electrokit.com/en/pwm-servo-driver-16-kanal-12-bit-i2c", "checked": "2026-10-22", "listed": "Servo Driver 16 Channels 12-bit PWM - I2C", "note": "Adafruit board, headers to solder; out of stock when checked"},
  },
  'sg90': {
    'kjell-no': {"price": 229.9, "url": "https://www.kjell.com/no/produkter/elektro-og-verktoy/elektronikk/arduino/arduino-tilbehor/luxorparts-sg90-mikroservo-4-pk.-p90720", "checked": "2026-10-23", "listed": "Luxorparts SG90 Mikroservo 4-pk.", "pack": 4},
    'kjell-se': {"price": 199.9, "url": "https://www.kjell.com/se/produkter/el-verktyg/elektronik/arduino/arduino-tillbehor/luxorparts-sg90-micro-servo-4-pack-p90720", "checked": "2026-10-23", "listed": "Luxorparts SG90 Micro-servo 4-pack", "pack": 4},
    electrokit: {"price": 49, "url": "https://www.electrokit.com/en/servo-ms-1.3-9", "checked": "2026-10-22", "listed": "Analog micro servo SG90 1.8kg 0.12s", "note": "44.10 kr each from 4"},
  },
  'mg90s': {
    let: {"gone": true, "checked": "2026-10-23", "note": "its MG90S is listed with plastic gears and 1.2–1.4 kg·cm, weaker than the metal-gear servo the checks assume"},
    electrokit: {"price": 79, "url": "https://www.electrokit.com/en/mg90s-micro-servo", "checked": "2026-10-22", "listed": "Analog micro servo 2.8kg 0.09s metal", "note": "67.15 kr each from 4"},
  },
  'mg996r': {
    let: {"price": 60, "url": "https://let-elektronik.dk/servo-mg996r-180-grader-rotation-metal-gear-high-torque", "checked": "2026-10-23", "listed": "Servo MG996R 180 grader rotation Metal Gear High Torque"},
    electrokit: {"price": 99, "url": "https://www.electrokit.com/en/analog-servo-11kg-0.18s-metal-high-torque", "checked": "2026-10-22", "listed": "Analog servo 11kg 0.18s metal, high torque (MG996R)"},
  },
  'ds3218': {
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "its 20 kg servo is a Waveshare WP5320, rated at 7.4 V, not a DS3218"},
  },
  'arm-micro-acrylic': {
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "no acrylic micro-servo arm kit found"},
  },
  'arm-printed-5axis': {
    let: {"gone": true, "checked": "2026-10-23", "note": "no hardware kit for a printed arm found"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "no hardware kit for a printed arm found"},
  },
  'jumpers': {
    let: {"price": 54, "url": "https://let-elektronik.dk/40-pin-dupont-wire-female-to-male-20cm", "checked": "2026-10-23", "listed": "40 pin Dupont Wire 20cm: male-male, female-male and female-female", "note": "three cables at 18 kr each"},
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: sells male-male jumper packs only"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "sells male-male jumper packs only"},
    electrokit: {"price": 165, "url": "https://www.electrokit.com/en/dupont-jumper-wire/", "checked": "2026-10-22", "listed": "Jumper wire cable 40-pin 30cm, male/male + male/female + female/female", "note": "three cables at 55 kr each"},
  },
  'breadboard-mini': {
    let: {"price": 30, "url": "https://let-elektronik.dk/mini-bread-board-self-adhesive", "checked": "2026-10-23", "listed": "Mini Bread Board, Self Adhesive, 170 Tie Points"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "no small breadboard sold on its own"},
    electrokit: {"price": 35, "url": "https://www.electrokit.com/en/kopplingsdack-170-anslutningar", "checked": "2026-10-22", "listed": "Breadboard 170 hole"},
  },
  'm3-kit': {
    let: {"price": 245, "url": "https://let-elektronik.dk/mounting-kit-standoffs", "checked": "2026-10-23", "listed": "Mounting Kit (Standoffs) - 24 Compartment Box, Nylon & Copper, M3 Screws"},
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: its screw assortment has no standoffs"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "its screw assortment has no standoffs"},
    electrokit: {"price": 169, "url": "https://www.electrokit.com/en/skruv-mutter-och-distansset", "checked": "2026-10-22", "listed": "Bolt nut and spacer set 205 pcs"},
  },
  'switch-fuse': {
    'kjell-no': {"gone": true, "checked": "2026-10-23", "note": "the same range as Kjell Sweden, checked there: sells fuse holders, but no switch and holder set"},
    'kjell-se': {"gone": true, "checked": "2026-10-23", "note": "sells fuse holders, but no switch and holder set"},
    electrokit: {"price": 120.5, "url": "https://www.electrokit.com/en/sakringshallare-bladsakring-kabelmonterad", "checked": "2026-10-23", "listed": "MIDI blade fuse holder 10A with cable + toggle switch on-off 12/24VDC + MIDI blade fuse assortment 100 pcs", "note": "three items: 25 + 16.50 + 79 kr"},
  },
  'divider-res': {
    electrokit: {"price": 59, "url": "https://www.electrokit.com/en/motstandssats-10r-1m-x20-600-st", "checked": "2026-10-22", "listed": "Resistor kit 10R - 1M x20 = 600 pcs", "note": "includes 1 kΩ and 2 kΩ"},
  },
  'wire-20awg': {
    let: {"price": 37, "url": "https://let-elektronik.dk/high-temperature-resistant-silicone-wire-18awg-0.75mm2-1m-red-and-black", "checked": "2026-10-23", "listed": "Silicone Wire 18AWG 0.75mm2, 1m, Red & Black", "pack": 0.5, "note": "18 AWG, thicker than needed; two make the 2 m"},
    electrokit: {"price": 72, "url": "https://www.electrokit.com/en/kabel-2x0.5mmcu-rod/svart-10m", "checked": "2026-10-22", "listed": "Cable 2x0.5mm² Cu red/black 10m", "note": "PVC rather than silicone"},
  },
  'xt60-pigtail': {
    mbs: {"price": 20, "url": "https://mbs-rcmodels.se/butik/kontakter-kontakter-med-kabel/xt60-hona-med-10cm-kabel/", "checked": "2026-10-23", "listed": "XT60 hona med 10cm kabel", "adds": true, "note": "14 AWG; out of stock when checked"},
    let: {"gone": true, "checked": "2026-10-23", "note": "sells XT60 connector pairs to solder, not a pigtail"},
    electrokit: {"gone": true, "checked": "2026-10-22", "note": "sells bare XT60 connectors to solder, not a pigtail"},
  },
  'servo-ext': {
    let: {"gone": true, "checked": "2026-10-23", "note": "no servo extension cables found"},
    electrokit: {"price": 69, "url": "https://www.electrokit.com/en/servokabel-tvinnad-hitec-awg22-12", "checked": "2026-10-22", "listed": "Servo extension cable twisted AWG22 30cm", "pack": 0.2, "note": "sold singly: five cables make the set"},
  },
  'tool-multimeter': {
    'kjell-se': {"price": 299.9, "url": "https://www.kjell.com/se/produkter/el-verktyg/matinstrument/multimetrar/uni-t-ut123c-multimeter-p40727", "checked": "2026-10-23", "listed": "Uni-T UT123C Multimeter"},
    electrokit: {"price": 175, "url": "https://www.electrokit.com/en/digital-multimeter-dvm005", "checked": "2026-10-22", "listed": "Multimeter 3 1/2 digits, autorange, TrueRMS DVM005", "note": "out of stock when checked"},
  },
  'tool-solder': {
    'kjell-se': {"price": 699, "url": "https://www.kjell.com/se/produkter/el-verktyg/verktyg/lodning/lodkolvar/luxorparts-lodstation-startpaket-48-w-p40712", "checked": "2026-10-23", "listed": "Luxorparts Lödstation startpaket 48 W"},
    electrokit: {"price": 269, "url": "https://www.electrokit.com/en/lodstation-48w-vtss4/ap-2", "checked": "2026-10-22", "listed": "Soldering station 48W VTSS4 / AP2", "note": "solder not included"},
  },
  'tool-screwdrivers': {
    'kjell-se': {"price": 399, "url": "https://www.kjell.com/se/produkter/el-verktyg/verktyg/mejslar-mejselset/ifixit-mako-precisionsmejsel-med-bits-p40667", "checked": "2026-10-23", "listed": "Ifixit Mako Precisionsmejsel med bits", "note": "a bit driver with 64 bits; no spanners"},
    electrokit: {"price": 29, "url": "https://www.electrokit.com/en/mejselset-precision-11st", "checked": "2026-10-22", "listed": "Screwdriver precision set 11pcs", "note": "on sale (49 kr regular); no spanners"},
  },
  'mdd10a': {
    let: {"gone": true, "checked": "2026-10-23", "note": "no Cytron MDD10A found"},
  },
  'ubec-5a': {
    let: {"gone": true, "checked": "2026-10-23", "note": "no UBEC found"},
  },
  'pololu-micro-100-enc': {
    pololu: {"price": 29.95, "url": "https://www.pololu.com/product/5164", "checked": "2026-10-23", "listed": "100:1 Micro Metal Gearmotor HP 6V with 12 CPR Encoder, Back Connector (#5164)", "note": "encoder cable sold separately"},
  },
  'wheel-d3-42': {
    pololu: {"price": 9.95, "url": "https://www.pololu.com/product/1090", "checked": "2026-10-23", "listed": "Pololu Wheel 42×19mm Pair (#1090)", "pack": 2, "note": "marked not recommended for new designs"},
  },
  'pololu-37d-50-enc': {
    pololu: {"price": 60.95, "url": "https://www.pololu.com/product/4753", "checked": "2026-10-23", "listed": "50:1 Metal Gearmotor 37Dx70L mm 12V with 64 CPR Encoder (#4753)"},
  },
  'cell-18650-prot': {
    electrokit: {"price": 129, "url": "https://www.electrokit.com/en/batteri-li-ion-18650-3.7v-3300mah-med-skyddskrets-xtar", "checked": "2026-10-23", "listed": "Battery Li-Ion 18650 3.6V 3300mAh with protection Xtar", "note": "protected cells are 68.8 mm long; check they fit the holder"},
  },
  'holder-2x18650': {
    electrokit: {"price": 25, "url": "https://www.electrokit.com/en/batterihallare-2x18650-sladdanslutning", "checked": "2026-10-23", "listed": "Battery holder 2x 18650 cable", "note": "wire leads; series is the usual wiring, so measure 7–8.4 V before use"},
    let: {"price": 23, "url": "https://let-elektronik.dk/2-x-18650-battery-holder-with-dc2.1-power-jack", "checked": "2026-10-23", "listed": "Battery Holder 18650, 2 x, DC2.1 Jack, 7.4V Output (DFRobot FIT0538)", "note": "ordered in: ships the Tuesday after"},
  },
  'holder-3x18650': {
    let: {"price": 30, "url": "https://let-elektronik.dk/3-x-18650-battery-holder-with-dc2.1-power-jack", "checked": "2026-10-23", "listed": "Battery Holder 3 x 18650, 11.1V (DFRobot FIT0539)", "note": "ordered in: ships the Tuesday after"},
  },
  'chg-18650-cells': {
    electrokit: {"price": 79, "url": "https://www.electrokit.com/en/batteriladdare-li-ion-1a-for-2x-18650", "checked": "2026-10-23", "listed": "Battery charger Li-Ion 1A for 2x 18650", "note": "2 × 0.5 A, USB; adapter not included"},
  },
  'kit-2wd-olimex': {
    electrokit: {"price": 199, "url": "https://www.electrokit.com/en/olimex-robotplattform-3-hjul", "checked": "2026-10-23", "listed": "Robot Car Kit 2WD, 4 wheels and 2 motors", "note": "2 × 1:48 gearmotors 3–6 V, 230 rpm, 0.078 N·m; 65 mm wheels; casters and a 2×AA holder included"},
  },
  'kit-4wd-joyit': {
    electrokit: {"price": 249, "url": "https://www.electrokit.com/en/robot-car-kit-base-with-4-wheels-and-motors", "checked": "2026-10-23", "listed": "Robot car kit 4WD, base with 4 wheels and motors (Joy-It)", "note": "its motors are rated 4.5–9 V and modelled as TT gearmotors"},
  },
  'chassis-zumo': {
    electrokit: {"price": 299, "url": "https://www.electrokit.com/en/product/zumo-robot-chassi/", "checked": "2026-10-23", "listed": "Zumo Robot Chassis (Pololu 1418)", "note": "tracks, 2 drive and 2 idler sprockets, acrylic plate, 4×AA compartment; motors not included"},
    pololu: {"price": 23.49, "url": "https://www.pololu.com/product/1418", "checked": "2026-10-23", "listed": "Zumo Chassis Kit (No Motors)", "note": "98 × 86 × 39 mm; about 210 g with motors and batteries"},
  },
  'reg-s13v30f5': {
    electrokit: {"price": 189, "url": "https://www.electrokit.com/en/switchregulator-2.8-22v-/-5v", "checked": "2026-10-23", "listed": "Switch regulator 2.8-22V / 5V 3A (Pololu 4082)", "note": "2–4 A depending on input; wires or headers to solder"},
  },
};
