// Compiles every generated sketch in a fixtures folder (from tools/gen-fixtures.js) with arduino-cli, exactly as the
// Arduino IDE builds them, and fails on any error or any compiler warning in the generated code. Identical sketches
// (an Uno and a Nano design with the same pins, say) are compiled once.
//
//   node tools/compile-fixtures.js <fixtures-dir> [--arch avr|esp32] [--cover] [--max N] [-- extra arduino-cli args]
//
// --cover compiles a smallest-greedy subset in which every feature value (robot type, driver scheme, encoders,
// each behaviour, Bluetooth, Wi-Fi, arm frame) still appears at least once per architecture: the ESP32 build is slow.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const dir = args[0];
const sep = args.indexOf('--');
const extra = sep >= 0 ? args.slice(sep + 1) : [];
const opt = (name) => { const i = args.indexOf(name); return i >= 0 && (sep < 0 || i < sep) ? args[i + 1] : null; };
const arch = opt('--arch');
const max = Number(opt('--max') ?? Infinity);
const cli = process.env.ARDUINO_CLI ?? 'arduino-cli';

let manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
if (args.includes('--cover')) manifest = cover(manifest);

function cover(list) {
  const features = (v) => {
    const [type, board, scheme, enc, behaviours, bt, wl, frame] = v.sig.split('|');
    return [`type=${type}`, `scheme=${scheme}`, `enc=${enc}`, `bt=${bt}`, `wl=${wl}`, `frame=${frame}`,
      ...behaviours.split('+').filter(Boolean).map((b) => `b=${b}`)].map((f) => `${v.arch}:${f}`);
  };
  const need = new Set(list.flatMap(features));
  const out = [];
  while (need.size) {
    const best = list.reduce((a, b) => (features(b).filter((f) => need.has(f)).length
      > features(a).filter((f) => need.has(f)).length ? b : a));
    out.push(best);
    for (const f of features(best)) need.delete(f);
  }
  return out;
}
const jobs = [];
const seen = new Set();
for (const v of manifest) {
  if (arch && v.arch !== arch) continue;
  for (const sketch of ['robot', 'selftest']) {
    const path = join(dir, v.name, sketch);
    const hash = createHash('sha1').update(v.fqbn).update(readFileSync(join(path, `${sketch}.ino`))).digest('hex');
    if (seen.has(hash)) continue;
    seen.add(hash);
    jobs.push({ name: `${v.name}/${sketch}`, path, fqbn: v.fqbn });
  }
}

let failed = 0;
const todo = jobs.slice(0, max);
for (const [i, job] of todo.entries()) {
  const r = spawnSync(cli, ['compile', '--fqbn', job.fqbn, '--warnings', 'all', ...extra, job.path], { encoding: 'utf8' });
  const output = `${r.stdout}\n${r.stderr}`;
  // warnings and errors that point into the generated sketch (the board cores have warnings of their own)
  const ours = output.split('\n').filter((l) => l.includes(`${job.path}/`) && /(warning|error):/.test(l));
  const size = output.match(/Sketch uses (\d+) bytes .*?\n.*?Global variables use (\d+) bytes/s);
  if (r.status !== 0 || ours.length) {
    failed++;
    console.log(`FAIL ${job.name} (${job.fqbn})`);
    console.log(ours.length ? ours.join('\n') : output.split('\n').slice(-25).join('\n'));
  } else {
    console.log(`ok   [${i + 1}/${todo.length}] ${job.name} ${job.fqbn} flash ${size?.[1]} B, RAM ${size?.[2]} B`);
  }
}
console.log(`${todo.length - failed}/${todo.length} sketches compiled cleanly`);
process.exit(failed ? 1 : 0);
