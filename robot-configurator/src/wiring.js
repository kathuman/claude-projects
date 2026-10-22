// Wiring of a design: every connection as a table row (the authoritative list), and two diagrams drawn from the same
// rows, one for power and one for signals. Terminal names are the ones printed on the boards.

import { part } from './catalog.js';
import { BOARDS } from './pins.js';

const DRIVER_TERMINALS = {
  l298n: { vm: '+12V', gnd: 'GND', outL: ['OUT1', 'OUT2'], outR: ['OUT3', 'OUT4'], logic: '+5V',
    note: 'Remove the 5V-EN jumper and the ENA/ENB jumpers; the enable pins take PWM from the controller.' },
  tb6612: { vm: 'VM', gnd: 'GND', outL: ['AO1', 'AO2'], outR: ['BO1', 'BO2'], logic: 'VCC', standby: 'STBY' },
  drv8833: { vm: 'VM (VIN)', gnd: 'GND', outL: ['AOUT1', 'AOUT2'], outR: ['BOUT1', 'BOUT2'], standby: 'SLP / EEP' },
  mdd10a: { vm: 'POWER +', gnd: 'POWER −', outL: ['M1A', 'M1B'], outR: ['M2A', 'M2B'], sigGnd: 'GND' },
  bts7960: { vm: 'B+', gnd: 'B−', outL: ['M+', 'M−'], outR: ['M+', 'M−'], logic: 'VCC', enables: 'R_EN, L_EN' },
};

const MCU_POWER = {
  uno: { in5: '5V', gnd: 'GND', v33: '3.3V' },
  nano: { in5: '5V', gnd: 'GND', v33: '3V3' },
  esp32: { in5: '5V (VIN)', gnd: 'GND', v33: '3V3' },
};

// rows: { group, from, to, wire, note }
export function wiring(design) {
  const rows = [];
  const add = (group, from, to, wire, note = '') => rows.push({ group, from, to, wire, note });
  const p = design.parts;
  const board = BOARDS[design.board];
  const mcu = p.mcu;
  const mp = MCU_POWER[design.board];
  const logicRail = board.logicV < 5 ? `controller ${mp.v33}` : '5 V rail';
  const isRover = design.type !== 'arm';
  const battery = p.battery;
  const pinOf = (id) => design.pins.map[id]?.label;

  if (battery) {
    const fuse = design.specs?.fuse ?? 5;
    add('Power', `Battery + (${battery.name.split(',')[0]})`, `Fuse holder (${fuse} A blade fuse)`, 'red',
      battery.chem === 'lipo' ? 'through the XT60 pigtail' : '');
    add('Power', 'Fuse holder', 'Switch', 'red');
    add('Power', 'Switch', 'Battery rail + (breadboard)', 'red');
    add('Power', 'Battery −', 'Ground rail (breadboard)', 'black', 'every ground in the robot meets here');
    add('Power', 'Battery rail +', `${part(p.reg.id).name.split(' ')[0]} IN+`, 'red');
    add('Power', 'Ground rail', `${part(p.reg.id).name.split(' ')[0]} IN−`, 'black');
    add('Power', `${part(p.reg.id).name.split(' ')[0]} OUT+ (set to 5.0 V first)`, '5 V rail (breadboard)', 'red');
    add('Power', `${part(p.reg.id).name.split(' ')[0]} OUT−`, 'Ground rail', 'black');
    add('Power', '5 V rail', `${board.name} ${mp.in5}`, 'red', 'not the barrel jack, and never together with a 5 V supply on another pin');
    add('Power', 'Ground rail', `${board.name} ${mp.gnd}`, 'black');
  } else {
    add('Power', 'USB cable (computer or USB charger)', `${board.name} USB`, '', 'the controller runs from USB');
  }

  if (isRover) {
    const d = p.driver;
    const t = DRIVER_TERMINALS[d.id];
    const units = d.channels === 1 ? 2 : 1;
    const n = p.chassis.driven;
    const dname = (s) => (units === 2 ? `BTS7960 ${s === 'L' ? 'left' : 'right'}` : d.name.split(' ')[0]);
    for (const s of units === 2 ? ['L', 'R'] : ['']) {
      add('Power', 'Battery rail +', `${dname(s || 'L')} ${t.vm}`, 'red', design.ev?.peakBatt > 2 ? '20 AWG silicone wire' : '');
      add('Power', 'Ground rail', `${dname(s || 'L')} ${t.gnd}`, 'black');
    }
    if (t.logic) {
      for (const s of units === 2 ? ['L', 'R'] : ['']) {
        add('Power', d.id === 'tb6612' ? logicRail : '5 V rail', `${dname(s || 'L')} ${t.logic}`, 'red',
          d.id === 'l298n' ? t.note : '');
      }
    }
    if (t.standby) add('Power', logicRail, `${dname('L')} ${t.standby}`, 'red', 'holds the driver awake');
    if (t.enables) for (const s of ['L', 'R']) add('Power', '5 V rail', `${dname(s)} ${t.enables}`, 'red', 'both enables high');
    if (t.sigGnd) add('Power', 'Ground rail', `${dname('L')} ${t.sigGnd} (signal header)`, 'black');
    for (const [s, side] of [['L', 'left'], ['R', 'right']]) {
      const outs = s === 'L' ? t.outL : t.outR;
      const motors = n === 4 ? `both ${side} motors (in parallel)` : `${side[0].toUpperCase() + side.slice(1)} motor`;
      add('Motors', `${motors} red lead`, `${dname(s)} ${outs[0]}`, 'red', 'swap the two leads if it turns backwards');
      add('Motors', `${motors} black lead`, `${dname(s)} ${outs[1]}`, 'black');
    }
    if (p.motor.cpr) {
      for (const side of ['Left', 'Right']) {
        add('Power', logicRail, `${side} encoder VCC`, 'red', board.logicV < 5 ? 'encoders at 3.3 V keep their outputs safe for the ESP32' : '');
        add('Power', 'Ground rail', `${side} encoder GND`, 'black');
      }
    }
  }

  const sensors = design.ev?.sensors ?? [];
  if (sensors.includes('hcsr04')) {
    add('Power', '5 V rail', 'HC-SR04 VCC', 'red');
    add('Power', 'Ground rail', 'HC-SR04 GND', 'black');
  }
  if (sensors.includes('line-5ch')) {
    add('Power', logicRail, 'Line sensor VCC', 'red');
    add('Power', 'Ground rail', 'Line sensor GND', 'black');
  }
  if (sensors.includes('mpu6050')) {
    add('Power', '5 V rail', 'MPU-6050 VCC', 'red', 'the GY-521 board has its own 3.3 V regulator');
    add('Power', 'Ground rail', 'MPU-6050 GND', 'black');
  }
  if (design.bt) {
    add('Power', '5 V rail', 'HC-05 VCC', 'red');
    add('Power', 'Ground rail', 'HC-05 GND', 'black');
  }

  if (design.arm) {
    const sr = p.servoReg;
    if (p.psu) {
      add('Power', `${p.psu.name.split('(')[0].trim()}`, 'DC jack adapter', '', 'plug in only after the regulator is set');
      if (sr) {
        add('Power', 'DC jack adapter +', `${sr.name.split(' ')[0]} IN+`, 'red');
        add('Power', 'DC jack adapter −', `${sr.name.split(' ')[0]} IN−`, 'black');
      }
    } else if (sr) {
      add('Power', 'Battery rail +', `${sr.name.split(' ')[0]} IN+ (servo regulator)`, 'red', '20 AWG silicone wire');
      add('Power', 'Ground rail', `${sr.name.split(' ')[0]} IN−`, 'black');
    }
    const servoSrc = sr ? `${sr.name.split(' ')[0]} OUT+ (set to 6.0 V first)` : 'DC jack adapter + (6 V)';
    add('Power', servoSrc, 'PCA9685 V+ (screw terminal)', 'red', 'servo power only, thick wire');
    add('Power', sr ? `${sr.name.split(' ')[0]} OUT−` : 'DC jack adapter −', 'PCA9685 GND (screw terminal)', 'black');
    add('Power', board.logicV < 5 ? `${board.name} ${mp.v33}` : `${board.name} 5V`, 'PCA9685 VCC', 'red', 'logic power, not servo power');
    add('Power', `${board.name} GND`, 'PCA9685 GND (header)', 'black', 'common ground between controller and servo supply');
    for (const j of design.arm.frame.joints.concat('gripper').map((name, ch) => ({ name, ch }))) {
      add('Servos', `${j.name[0].toUpperCase() + j.name.slice(1)} servo plug`, `PCA9685 channel ${j.ch}`, 'brown/black = GND, red = V+, orange/yellow = signal', '');
    }
  }

  const i2c = [];
  if (design.arm) i2c.push('PCA9685');
  if (sensors.includes('mpu6050')) i2c.push('MPU-6050');
  for (const dev of i2c) {
    add('Signals', `${board.name} ${board.i2c.sda} (SDA)`, `${dev} SDA`, 'blue', 'I²C');
    add('Signals', `${board.name} ${board.i2c.scl} (SCL)`, `${dev} SCL`, 'yellow', 'I²C');
  }

  const dividers = [];
  for (const [id, pin] of Object.entries(design.pins?.map ?? {})) {
    const dem = design.pinDemands?.find((x) => x.id === id);
    let note = '';
    if (id === 'SONAR_ECHO' && board.logicV < 5) {
      note = 'through a divider: ECHO → 1 kΩ → pin, pin → 2 kΩ → GND (5 V echo to 3.3 V)';
      dividers.push('HC-SR04 ECHO');
    }
    if (id === 'BT_TX' && board.logicV >= 5) {
      note = 'through a divider: pin → 1 kΩ → RXD, RXD → 2 kΩ → GND (5 V to the 3.3 V input)';
      dividers.push('HC-05 RXD');
    }
    const [from, to] = id === 'BT_RX' || id.includes('ENC') || id === 'SONAR_ECHO' || id.startsWith('LINE')
      ? [`${dem?.device ?? id} ${dem?.signal ?? ''}`, `${board.name} ${pin.label}`]
      : [`${board.name} ${pin.label}`, `${dem?.device ?? id} ${dem?.signal ?? ''}`];
    add('Signals', from, to, 'jumper', note);
  }
  return { rows, dividers, board };
}

// ---------------------------------------------------------------- diagrams (inline SVG, themed with CSS classes)

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Signals: the controller in the middle with its used pins, the devices around it, one line per connection.
export function signalDiagram(design) {
  const board = BOARDS[design.board];
  const entries = Object.entries(design.pins?.map ?? {}).map(([id, pin]) => {
    const dem = design.pinDemands.find((x) => x.id === id);
    return { id, pin: pin.label, device: dem.device, signal: dem.signal, need: dem.need };
  });
  const i2c = [];
  if (design.arm) i2c.push('PCA9685');
  if (design.ev?.sensors?.includes('mpu6050')) i2c.push('MPU-6050');
  for (const dev of i2c) {
    entries.push({ id: `${dev}-sda`, pin: board.i2c.sda, device: dev, signal: 'SDA', need: 'i2c' });
    entries.push({ id: `${dev}-scl`, pin: board.i2c.scl, device: dev, signal: 'SCL', need: 'i2c' });
  }
  const devices = [...new Set(entries.map((e) => e.device))];
  const rowH = 20;
  const W = 760;
  const mcuX = 40;
  const mcuW = 190;
  const devX = 470;
  const devW = 250;
  const pinRows = [...new Set(entries.map((e) => e.pin))];
  const top = 50;
  const mcuH = pinRows.length * rowH + 40;
  // device boxes stacked on the right
  let y = top;
  const devBox = {};
  for (const dev of devices) {
    const sigs = entries.filter((e) => e.device === dev);
    devBox[dev] = { y, h: sigs.length * rowH + 34, sigs };
    y += devBox[dev].h + 14;
  }
  const H = Math.max(top + mcuH, y) + 20;
  const parts = [];
  parts.push(`<rect class="box" x="${mcuX}" y="${top}" width="${mcuW}" height="${mcuH}" rx="8"/>`);
  parts.push(`<text class="title" x="${mcuX + 12}" y="${top + 22}">${esc(board.name)}</text>`);
  const pinY = {};
  pinRows.forEach((p, i) => {
    const py = top + 40 + i * rowH;
    pinY[p] = py;
    parts.push(`<text class="pin" x="${mcuX + mcuW - 10}" y="${py + 4}" text-anchor="end">${esc(p)}</text>`);
    parts.push(`<circle class="dot" cx="${mcuX + mcuW}" cy="${py}" r="3"/>`);
  });
  let lane = 0;
  for (const dev of devices) {
    const b = devBox[dev];
    parts.push(`<rect class="box" x="${devX}" y="${b.y}" width="${devW}" height="${b.h}" rx="8"/>`);
    parts.push(`<text class="title" x="${devX + 12}" y="${b.y + 20}">${esc(dev)}</text>`);
    b.sigs.forEach((e, i) => {
      const sy = b.y + 36 + i * rowH;
      const py = pinY[e.pin];
      const x1 = mcuX + mcuW;
      const x2 = devX;
      const mid = x1 + 30 + (lane++ % 20) * 9;
      const cls = e.need === 'i2c' ? 'w-i2c' : e.need === 'pwm' ? 'w-pwm' : e.need === 'int' || e.need === 'in' ? 'w-in' : 'w-out';
      parts.push(`<path class="wire ${cls}" d="M${x1} ${py} H${mid} V${sy} H${x2}"/>`);
      parts.push(`<circle class="dot" cx="${x2}" cy="${sy}" r="3"/>`);
      parts.push(`<text class="pin" x="${devX + 10}" y="${sy + 4}">${esc(e.signal)}</text>`);
    });
  }
  const legend = [['w-pwm', 'PWM', 40], ['w-out', 'digital out', 150], ['w-in', 'digital in / interrupt', 300], ['w-i2c', 'I²C', 520]]
    .map(([c, l, x]) => `<path class="wire ${c}" d="M${x} 24 h24"/><text class="pin" x="${x + 30}" y="28">${l}</text>`).join('');
  return `<svg class="diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="Signal wiring">${legend}${parts.join('')}</svg>`;
}

// Power: where the energy goes, from the battery (or adapter) through fuse, switch and regulators to each load.
export function powerDiagram(design) {
  const p = design.parts;
  const nodes = [];
  const edges = [];
  const node = (id, label, sub, col, row) => nodes.push({ id, label, sub, col, row });
  const edge = (a, b, label = '') => edges.push({ a, b, label });
  if (p.battery) {
    node('batt', 'Battery', `${p.battery.vNom} V ${p.battery.chem === 'lipo' ? 'LiPo' : p.battery.chem === 'liion' ? 'Li-ion' : 'NiMH'}`, 0, 0);
    node('fuse', `Fuse ${design.specs?.fuse ?? ''} A`, '+ switch', 1, 0);
    edge('batt', 'fuse');
    let row = 0;
    if (design.type !== 'arm') {
      node('drv', p.driver.name.split(' ')[0], 'motor driver', 2, row);
      edge('fuse', 'drv', `${p.battery.vMin}–${p.battery.vMax} V`);
      node('mot', `${p.chassis.driven} motors`, p.motor.name.split(' ')[0], 3, row);
      edge('drv', 'mot');
      row++;
    }
    node('reg', p.reg.name.split(' ')[0], 'buck → 5.0 V', 2, row);
    edge('fuse', 'reg');
    node('mcu', BOARDS[design.board].name, 'and sensors', 3, row);
    edge('reg', 'mcu', '5 V');
    row++;
    if (p.servoReg) {
      node('sreg', p.servoReg.name.split(' ')[0], 'buck → 6.0 V', 2, row);
      edge('fuse', 'sreg');
      node('pca', 'PCA9685 V+', `${design.arm.frame.joints.length + 1} servos`, 3, row);
      edge('sreg', 'pca', '6 V');
    }
  } else {
    node('psu', p.psu.name.split('(')[0].replace('desktop power adapter', 'adapter').trim(), 'mains, enclosed', 0, 0);
    if (p.servoReg) {
      node('sreg', p.servoReg.name.split(' ')[0], 'buck → 6.0 V', 1, 0);
      edge('psu', 'sreg', `${p.psu.vOut} V`);
      node('pca', 'PCA9685 V+', `${design.arm.frame.joints.length + 1} servos`, 2, 0);
      edge('sreg', 'pca', '6 V');
    } else {
      node('pca', 'PCA9685 V+', `${design.arm.frame.joints.length + 1} servos`, 1, 0);
      edge('psu', 'pca', '6 V');
    }
    node('usb', 'USB', 'computer or charger', 0, 1);
    node('mcu', BOARDS[design.board].name, 'logic only', 1, 1);
    edge('usb', 'mcu', '5 V');
  }
  const bw = 150;
  const bh = 52;
  const gx = 80;
  const gy = 26;
  const pos = (n) => ({ x: 20 + n.col * (bw + gx), y: 20 + n.row * (bh + gy) });
  const W = 20 + (Math.max(...nodes.map((n) => n.col)) + 1) * (bw + gx);
  const H = 20 + (Math.max(...nodes.map((n) => n.row)) + 1) * (bh + gy);
  const out = [];
  for (const e of edges) {
    const a = pos(nodes.find((n) => n.id === e.a));
    const b = pos(nodes.find((n) => n.id === e.b));
    const x1 = a.x + bw;
    const y1 = a.y + bh / 2;
    const x2 = b.x;
    const y2 = b.y + bh / 2;
    const mx = (x1 + x2) / 2;
    out.push(`<path class="wire w-power" d="M${x1} ${y1} H${mx} V${y2} H${x2}"/>`);
    if (e.label) out.push(`<text class="pin" x="${x2 - 6}" y="${y2 - 6}" text-anchor="end">${esc(e.label)}</text>`);
  }
  for (const n of nodes) {
    const { x, y } = pos(n);
    out.push(`<rect class="box" x="${x}" y="${y}" width="${bw}" height="${bh}" rx="8"/>`);
    out.push(`<text class="title" x="${x + 10}" y="${y + 21}">${esc(n.label)}</text>`);
    out.push(`<text class="pin" x="${x + 10}" y="${y + 40}">${esc(n.sub)}</text>`);
  }
  return `<svg class="diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="Power distribution">${out.join('')}</svg>`;
}
