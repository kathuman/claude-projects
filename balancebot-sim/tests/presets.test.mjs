// Every preset is shown with a scripted push one second after it loads. This checks each one does
// what its description says: the "watch it fail" ones fall, the rest stay up, settle and drive.
import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, buildPreset } from '../web/js/presets.mjs';
import { createController } from '../web/js/controller.mjs';
import { createSimLoop } from '../web/js/simloop.mjs';

function scenario(key, { nudge, drive = 0, secs = 7 } = {}) {
  const b = buildPreset(key);
  const loop = createSimLoop(b.params, createController(b.gains, b.realism));
  const hz = b.realism.controlLoopHz, kick = nudge != null ? nudge : b.nudge;
  let fell = false, tail = 0;
  for (let i = 0; i < hz * secs; i++) {
    const t = i / hz;
    if (i === hz) { const s = loop.getState(); loop.setState({ ...s, thetaDot: s.thetaDot + kick }); }
    loop.setCommand(t > 1.5 ? drive : 0, 0);
    loop.advance();
    const th = Math.abs(loop.getState().theta);
    if (th > 1.2) { fell = true; break; }
    if (t > secs - 2) tail = Math.max(tail, th);
  }
  return { fell, tailDeg: (tail * 180) / Math.PI, v: loop.getState().xDot };
}

for (const key of Object.keys(PRESETS)) {
  const expect = PRESETS[key].expect;
  test(`preset "${PRESETS[key].label}" ${expect === 'falls' ? 'falls over' : 'survives'} its scripted push`, () => {
    const r = scenario(key);
    if (expect === 'falls') {
      assert.ok(r.fell, 'expected it to fall');
      return;
    }
    assert.ok(!r.fell, 'fell over');
    const settle = expect === 'recovers' || expect === 'slips' ? 1.5 : 4; // chatter/jitter presets wobble by design
    assert.ok(r.tailDeg < settle, `still wobbling ${r.tailDeg.toFixed(2)} degrees after 5 s`);
    const d = scenario(key, { nudge: 0, drive: 0.35 });
    assert.ok(!d.fell, 'fell over while driving at 0.35 m/s');
    assert.ok(Math.abs(d.v - 0.35) < 0.15, `drive speed ${d.v.toFixed(2)} m/s, wanted 0.35`);
  });
}
