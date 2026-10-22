// Microcontroller pin maps and the assignment of every signal a design needs to a pin that can do it.
//
// Capabilities: out (digital output), in (digital input), pwm (analogWrite), int (attachInterrupt).
// `code` is how the pin is written in Arduino C++.

const pin = (label, code, caps) => ({ label, code, caps: new Set(caps) });

function avrPins(extraAnalog) {
  const pins = [];
  for (let d = 2; d <= 13; d++) {
    const caps = ['in', 'out'];
    if ([3, 5, 6, 9, 10, 11].includes(d)) caps.push('pwm');
    if (d === 2 || d === 3) caps.push('int');
    pins.push(pin(`D${d}`, String(d), caps));
  }
  for (let a = 0; a <= 3; a++) pins.push(pin(`A${a}`, `A${a}`, ['in', 'out']));
  return pins.concat(extraAnalog);
}

// ESP32 DevKit: the GPIOs on both the 30- and 38-pin boards, minus flash (6–11), strapping pins (0, 2, 5, 12, 15),
// UART0 (1, 3) and I2C (21, 22). 34–39 are input-only and have no internal pull-ups.
function esp32Pins() {
  const io = [4, 13, 14, 16, 17, 18, 19, 23, 25, 26, 27, 32, 33].map((g) => pin(`GPIO${g}`, String(g),
    ['in', 'out', 'pwm', 'int']));
  const inOnly = [34, 35, 36, 39].map((g) => pin(`GPIO${g}`, String(g), ['in', 'int']));
  return io.concat(inOnly);
}

export const BOARDS = {
  uno: {
    name: 'Arduino Uno', arch: 'avr', fqbn: 'arduino:avr:uno', logicV: 5, flash: 32256, ram: 2048,
    i2c: { sda: 'A4', scl: 'A5' }, pins: avrPins([]),
  },
  nano: {
    name: 'Arduino Nano', arch: 'avr', fqbn: 'arduino:avr:nano:cpu=atmega328', logicV: 5, flash: 30720, ram: 2048,
    i2c: { sda: 'A4', scl: 'A5' }, pins: avrPins([]),
  },
  esp32: {
    name: 'ESP32 DevKit', arch: 'esp32', fqbn: 'esp32:esp32:esp32', logicV: 3.3, flash: 1310720, ram: 327680,
    i2c: { sda: 'GPIO21', scl: 'GPIO22' }, pins: esp32Pins(),
  },
};

// demands: [{ id, device, signal, need: 'out'|'in'|'pwm'|'int' }]
// Most-constrained first; each takes the free pin with the fewest capabilities it does not need, so versatile pins
// (PWM, interrupt) stay free for the signals that require them. Returns { ok, map: id → pin, missing: [demand] }.
export function assignPins(boardId, demands) {
  const board = BOARDS[boardId];
  const free = new Set(board.pins);
  const fits = (d) => [...free].filter((p) => p.caps.has(d.need));
  const order = [...demands].sort((a, b) => fits(a).length - fits(b).length);
  const map = {};
  const missing = [];
  for (const d of order) {
    const cands = fits(d);
    if (!cands.length) { missing.push(d); continue; }
    cands.sort((a, b) => a.caps.size - b.caps.size || board.pins.indexOf(a) - board.pins.indexOf(b));
    map[d.id] = cands[0];
    free.delete(cands[0]);
  }
  return { ok: missing.length === 0, map, missing, free: free.size };
}
