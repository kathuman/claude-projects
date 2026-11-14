// The angle of every moving part at a set of frames (30 fps, frame 1 = t 0), from src/clock.js, for
// blender/check_motion.py: node escapement/tools/expected_poses.js > expected.json
const C = require("../src/clock.js");
const d = C.derive(), FPS = 30;
const frames = [1, 2, 5, 8, 12, 16, 23, 31, 46, 61, 90, 151, 222, 300];
const out = frames.map((frame) => {
  const t = (frame - 1) / FPS, p = C.pose(t, d), p0 = C.pose(0, d);
  return { frame, pose: Object.assign({}, p, { centreRun: p.centre - p0.centre }) };
});
process.stdout.write(JSON.stringify({ fps: FPS, frames: out }, null, 1) + "\n");
