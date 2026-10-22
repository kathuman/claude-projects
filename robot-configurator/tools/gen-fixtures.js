// Writes the firmware of one design per distinct firmware variant (controller × motor driver × encoders × sensors ×
// link × arm frame) into a folder, with a manifest of the board each must compile for. tools/compile-fixtures.js then
// builds them with arduino-cli.
//
//   node tools/gen-fixtures.js <out-dir>

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { feasibleDesigns } from '../src/solver.js';
import { generateFirmware } from '../src/firmware.js';
import { BOARDS } from '../src/pins.js';

const out = process.argv[2] ?? 'build/fixtures';
const B = ['remote', 'obstacle', 'line', 'odometry'];
const subsets = [[], ['remote'], ['obstacle'], ['line'], ['remote', 'obstacle'], ['obstacle', 'line'],
  ['remote', 'odometry'], B];

const requests = [];
for (const behaviours of subsets) {
  for (const terrain of ['indoor-smooth', 'outdoor-grass']) {
    requests.push({ region: 'SE', type: 'rover', rover: { behaviours, terrain, payload: terrain === 'indoor-smooth' ? 0.3 : 1.5,
      slope: 5, speed: 0.4, runtime: 30 } });
  }
}
for (const axes of [3, 4, 5]) for (const wireless of [false, true]) {
  requests.push({ region: 'DK', type: 'arm', printer: true, arm: { axes, wireless, reach: axes === 3 ? 0.15 : 0.25, payload: 0.02 } });
}
for (const behaviours of [['remote'], ['obstacle', 'odometry']]) {
  requests.push({ region: 'NO', type: 'mobile', rover: { behaviours, payload: 0.2 }, arm: { axes: 4, reach: 0.25, payload: 0.05, wireless: true } });
}

const seen = new Map();
for (const req of requests) {
  const { req: full, designs } = feasibleDesigns(req);
  for (const d of designs) {
    const p = d.parts;
    const sig = [d.type, d.board, p.driver?.scheme, !!p.motor?.cpr, (full.rover.behaviours ?? []).join('+'),
      d.bt ? 'bt' : '', d.wireless ? 'wl' : '', d.arm?.frame.id ?? ''].join('|');
    if (!seen.has(sig)) seen.set(sig, { d, req: full });
  }
}

const manifest = [];
let i = 0;
for (const [sig, { d, req }] of seen) {
  const name = `v${String(++i).padStart(3, '0')}-${d.type}-${d.board}`;
  const fw = generateFirmware(d, req);
  for (const f of fw.files) {
    const path = join(out, name, f.path);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, f.content);
  }
  manifest.push({ name, sig, fqbn: BOARDS[d.board].fqbn, arch: BOARDS[d.board].arch, board: d.board });
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`${manifest.length} firmware variants written to ${out}`);
