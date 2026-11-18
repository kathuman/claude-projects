// A Pybricks program for the robot: MicroPython for a LEGO MINDSTORMS Robot Inventor hub running Pybricks firmware
// (pybricks.com). The plan is written into the program as short codes (robot.js toCodes); the settings at the top
// are the ones that depend on the build, to be checked before the first run.

import { toCodes } from './robot.js';

export const DEFAULT_SETTINGS = {
  tablePort: 'A', leftPort: 'B', rightPort: 'C',
  tableRatio: 3,      // motor degrees per degree of the turntable (gears between them)
  tableReversed: false,
  overshoot: 6,       // degrees the turntable goes past a layer turn and comes back, so the layer settles square
  armOpen: 0,         // arm motor angles, from where the arms are when the program starts (open)
  armGrip: 90,
  armTip: 150,
  leftReversed: false, rightReversed: true, // the right arm is a mirror image: same angles, other direction
  speed: 600,         // degrees per second, for every motor
};

const py = (v) => (typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v));
const dir = (rev) => (rev ? 'Direction.COUNTERCLOCKWISE' : 'Direction.CLOCKWISE');

export function pybricksProgram(plan, settings = {}, meta = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const codes = toCodes(plan.steps);
  const lines = [];
  for (let i = 0; i < codes.length; i += 16) lines.push(`    ${codes.slice(i, i + 16).map((c) => `"${c}"`).join(', ')},`);
  return `# Cube Studio robot program, for a LEGO MINDSTORMS Robot Inventor hub with Pybricks firmware.
# ${meta.title || 'Robot plan'}: ${plan.steps.length} steps, about ${Math.round(plan.time)} s.
#
# Put the cube in with the ${plan.place.top} centre on top and the ${plan.place.front} centre facing you (the hub
# is at the back). Start with both arms open. Then press the hub's RIGHT button to begin.
# The centre button stops the program at any time.
#
# Run it with:  python -m pybricksdev run ble -n <hub name> cube_robot.py
# or paste it into Pybricks Code (code.pybricks.com).
${meta.solution ? `#\n# Solution: ${meta.solution}\n` : ''}
from pybricks.hubs import InventorHub
from pybricks.pupdevices import Motor
from pybricks.parameters import Port, Direction, Button, Color
from pybricks.tools import wait

# ---- settings for your build: check these before the first run
TABLE_RATIO = ${py(s.tableRatio)}    # motor degrees per degree of the turntable
OVERSHOOT = ${py(s.overshoot)}       # turntable degrees past a layer turn, then back
ARM_OPEN = ${py(s.armOpen)}
ARM_GRIP = ${py(s.armGrip)}
ARM_TIP = ${py(s.armTip)}
SPEED = ${py(s.speed)}

hub = InventorHub()
table = Motor(Port.${s.tablePort}, ${dir(s.tableReversed)})
left = Motor(Port.${s.leftPort}, ${dir(s.leftReversed)})
right = Motor(Port.${s.rightPort}, ${dir(s.rightReversed)})
for m in (table, left, right):
    m.reset_angle(0)

# S1 S-1 S2: spin the whole cube (quarter turns, anticlockwise from above)
# T1 T-1 T2: turn the bottom layer while the arms hold the rest
# L R: tip the cube over with the left or the right arm
PLAN = [
${lines.join('\n')}
]


def arms(angle):
    left.run_target(SPEED, angle, wait=False)
    right.run_target(SPEED, angle)
    while not left.done():
        wait(10)


def table_turn(quarters, extra=0):
    deg = quarters * 90
    if extra:
        sign = 1 if deg > 0 else -1
        table.run_angle(SPEED, (deg + sign * extra) * TABLE_RATIO)
        table.run_angle(SPEED, -sign * extra * TABLE_RATIO)
    else:
        table.run_angle(SPEED, deg * TABLE_RATIO)


def tip(arm):
    arm.run_target(SPEED, ARM_TIP)
    arm.run_target(SPEED, ARM_OPEN)


def step(code):
    if code == "L":
        tip(left)
    elif code == "R":
        tip(right)
    elif code[0] == "S":
        table_turn(int(code[1:]))
    else:
        arms(ARM_GRIP)
        table_turn(int(code[1:]), OVERSHOOT)
        arms(ARM_OPEN)


hub.light.on(Color.YELLOW)
hub.display.text("GO")
while Button.RIGHT not in hub.buttons.pressed():
    wait(20)
while Button.RIGHT in hub.buttons.pressed():
    wait(20)

hub.light.on(Color.BLUE)
for i, code in enumerate(PLAN):
    hub.display.number(min(99, len(PLAN) - i))
    step(code)

hub.light.on(Color.GREEN)
hub.display.text("OK")
wait(3000)
`;
}

// The plan as data, for other tools.
export function planJSON(plan, meta = {}) {
  return JSON.stringify({
    app: 'Cube Studio', kind: 'robot-plan', version: meta.version, solution: meta.solution,
    place: plan.place, start: plan.start, seconds: Math.round(plan.time * 10) / 10, counts: plan.counts,
    codes: toCodes(plan.steps), steps: plan.steps.map(({ op, move, q, side }) => ({ op, move, q, side })),
  }, null, 2);
}
