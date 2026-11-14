"""Checks that the clock in the .blend moves exactly as src/clock.js says it should.

usage: blender -b <skeleton_clock.blend> --python escapement/blender/check_motion.py -- <expected.json>
expected.json (from tools/expected_poses.js) holds, for a set of frames, the clockwise angle of every moving part.
Each part's driver is evaluated at those frames and compared; the script exits non-zero on any mismatch.

The gears are compared by how far they have turned since frame 1 (where the model starts them is a matter of looks; the
hands carry the start time and are compared as they are). Blender leaves a driven value unchanged when the change is
tiny (the barrel turns 0.0075° a second), so the tolerance is 2e-4 rad, 0.01°: far below anything visible.
"""
import json
import sys

import bpy

exp = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
scene = bpy.context.scene
PARTS = {"Pendulum": "pendulum", "Anchor (pallets)": "anchor", "Escape wheel": "escape", "Third wheel": "third", "Centre wheel": "centre",
         "Barrel and great wheel": "barrel", "Mainspring": "mainspring", "Cannon pinion": "cannon", "Minute wheel": "minuteWheel",
         "Hour wheel": "hourWheel", "Hour hand": "hourHand", "Minute hand": "minuteHand"}
RELATIVE = {"centre", "cannon", "minuteWheel"}
TOL = 2e-4
first = exp["frames"][0]["pose"]
worst, bad = 0.0, []
for row in exp["frames"]:
    scene.frame_set(row["frame"])
    for ob_name, key in PARTS.items():
        got = -bpy.data.objects[ob_name].rotation_euler[2]   # the drivers store minus the clockwise angle
        want = row["pose"][key] - (first[key] if key in RELATIVE else 0.0)
        err = abs(got - want)
        worst = max(worst, err)
        if err > TOL:
            bad.append(f"frame {row['frame']} {ob_name}: {got:.6f} vs {want:.6f}")
print(f"checked {len(exp['frames'])} frames x {len(PARTS)} parts; worst difference {worst:.2e} rad (tolerance {TOL})")
for b in bad[:10]:
    print("MISMATCH", b)
sys.exit(1 if bad else 0)
