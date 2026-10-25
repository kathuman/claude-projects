// Loads the vendored solver (cubejs, plain scripts written for the browser) into Node for the tests, the way the
// worker loads it: both files run in one context, the second finding Cube on `this`.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const dir = new URL('../vendor/', import.meta.url);
const ctx = vm.createContext({ console, Math, Date });
for (const f of ['cube.js', 'solve.js']) vm.runInContext(readFileSync(new URL(f, dir), 'utf8'), ctx, { filename: f });
export const Cube = ctx.Cube;
