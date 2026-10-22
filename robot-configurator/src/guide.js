// Building instructions for a design: ordered steps with the parts and tools each needs, the time it takes, what to
// check before moving on, and the safety notes that matter for that step. Generated from the chosen parts, so the
// steps name the actual boards, terminals and settings.

import { part } from './catalog.js';
import { BOARDS } from './pins.js';
import { wiring } from './wiring.js';
import { t, num } from './i18n.js';

export function buildGuide(design, req) {
  const p = design.parts;
  const board = BOARDS[design.board];
  const steps = [];
  const step = (title, minutes, body, extra = {}) => steps.push({ title, minutes, body, ...extra });
  const solderParts = design.items.map((i) => part(i.id)).filter((x) => x.solder && x.cat !== 'tool');
  const isRover = design.type !== 'arm';
  const lipo = p.battery?.chem === 'lipo';
  const { dividers } = wiring(design);

  const tools = [t('Multimeter (voltage and continuity)'), t('Small Phillips and flat screwdrivers'), t('Side cutters and wire stripper')];
  if (solderParts.length) tools.push(t('Soldering iron (temperature-controlled) and solder'));
  if (p.frame?.printer) tools.push(t('3D printer (PLA)'));
  if (lipo) tools.push(t('LiPo balance charger and safety bag'));
  tools.push(t('Computer with Arduino IDE 2 and a USB data cable for the controller'));

  step(t('Check the delivery'), 15, [
    t('Tick off every line of the parts list. Missing a small part is the most common reason a build stalls.'),
    t('Keep the boards in their antistatic bags until you mount them.'),
  ], { check: t('Every part on the list is in front of you.') });

  if (lipo) {
    step(t('Charge the battery safely'), 60, [
      t('Charge the LiPo in its safety bag on the balance charger, on a non-flammable surface, never unattended.'),
      t('Set the charger to LiPo, the right cell count and at most 1C (the capacity in amps).'),
      t('Never charge a puffed or damaged pack. Store it at about 3.8 V per cell when not in use.'),
    ], { warn: t('LiPo cells can catch fire if over-charged, short-circuited or punctured.') });
  } else if (p.battery) {
    step(t('Charge the battery'), 60, [t('Charge the {battery} with its charger while you build.', { battery: p.battery.name.split(',')[0] })]);
  }

  if (solderParts.length) {
    step(t('Solder the header pins'), 10 * solderParts.length, [
      t('Solder header pins to: {parts}.', { parts: [...new Set(solderParts.map((x) => x.name))].join('; ') }),
      t('Push the headers into a breadboard to hold them straight, place the board on top, solder one pin, check it is square, then the rest.'),
      t('Good joints are shiny cones. Re-flow any dull or balled joint.'),
    ], { check: t('With the multimeter on continuity, no two neighbouring pins beep.') });
  }

  if (p.frame?.printer) {
    step(t('Print the arm parts'), 600, [
      t('Print the links in PLA at 30–40 % infill, 3 perimeters, with the long axis of each link flat on the bed for strength.'),
      t('Check that the servos and bearings fit before printing the whole set.'),
    ]);
  }

  // regulators first: an unset buck converter can put its full input on the controller
  const regs = [p.reg && { r: p.reg, v: num(5, 1) }, p.servoReg && { r: p.servoReg, v: num(6, 1) }].filter(Boolean);
  if (regs.length) {
    step(t('Set the regulator output voltages before connecting anything'), 15, regs.map(({ r, v }) =>
      t(p.battery ? '{reg}: connect only the battery to IN+/IN−, measure OUT+/OUT− with the multimeter and turn the trim screw until it reads {v} V.'
        : '{reg}: connect only the power adapter to IN+/IN−, measure OUT+/OUT− with the multimeter and turn the trim screw until it reads {v} V.',
      { reg: r.name.split(',')[0], v })
    ).concat([t('Disconnect the input again before wiring the outputs.')]), {
      warn: t('Many buck converters ship set to their maximum output. Connected unset, they destroy the controller instantly.'),
      check: regs.map(({ r, v }) => t('{reg} reads {v} V ± 0.1 V.', { reg: r.name.split(' ')[0], v })).join(' '),
    });
  }

  if (isRover) {
    const c = p.chassis;
    const mountHow = {
      tt: t('Bolt each TT motor to the chassis with the two long M3 bolts through the motor brackets, shafts pointing outwards.'),
      n20: t('Clamp each N20 motor in its bracket with the two M1.6/M2 screws; leave the encoder board facing inwards.'),
      jga25: t('Screw each 25 mm gearmotor to its bracket with the M3 screws into the gearbox face; do not use screws longer than 6 mm or they hit the gears.'),
      '37mm': t('Screw each 37 mm gearmotor to its bracket with the M3 screws into the gearbox face (max 6 mm into the gearbox).'),
    }[c.mount];
    step(t('Mount the motors and wheels'), 30 + 5 * c.driven, [
      mountHow,
      t('Fit the {wheel} wheels: push-fit on the D-shaft or tighten the grub screw on the flat of the shaft.', { wheel: p.wheel.name.split(' ').slice(0, 2).join(' ').toLowerCase() }),
      c.driven === 2 ? t('Fit the ball caster at the opposite end from the drive wheels.') : t('Check that all four wheels touch the ground on a flat table.'),
      t('Route the motor leads towards the middle of the chassis; leave some slack for the wheels to turn.'),
    ], { check: t('Every wheel spins freely by hand without rubbing on the chassis.') });

    step(t('Mount the electronics and the battery'), 40, [
      t(c.id.includes('alu')
        ? 'Mount the {board}, the {driver} motor driver and the {reg} regulator on nylon standoffs; nothing conductive may touch the chassis (it is aluminium).'
        : 'Mount the {board}, the {driver} motor driver and the {reg} regulator on nylon standoffs; nothing conductive may touch the chassis.',
      { board: board.name, driver: p.driver.name.split(' ')[0], reg: p.reg.name.split(' ')[0] }),
      t('Stick the mini breadboard where the wires from all boards can reach it: its two rails become the battery rail and the 5 V rail; the ground rails join both.'),
      t('Fix the battery low and central with a velcro strap so it cannot slide; keep its leads away from the wheels.'),
      t('Mount the switch where you can reach it, and the fuse holder in the battery + lead right after the battery.'),
    ]);

    step(t('Wire the power'), 40, [
      t('Follow the Power rows of the wiring table, red for +, black for −. Do it with the battery disconnected.'),
      t('The motor driver takes the full battery voltage; the controller takes 5 V from the regulator into its {pin} pin.', { pin: board.name.includes('ESP32') ? '5 V (VIN)' : '5V' }),
      p.driver.id === 'l298n' ? t('On the L298N, remove the 5V-EN jumper and both ENA/ENB jumpers.') : null,
      design.ev?.peakBatt > 2 ? t('Use the 20 AWG silicone wire from the battery to the driver; jumper wires are too thin for motor current.') : null,
    ].filter(Boolean), {
      warn: t('Every ground must be connected together: battery, driver, regulator and controller. Missing grounds are the top cause of "nothing works".'),
      check: t('Battery still disconnected: no continuity between the battery rail and ground, nor between the 5 V rail and ground.'),
    });

    step(t('Wire the motors'), 15, [
      t('Connect each motor (or each pair of same-side motors on 4WD) to its driver output as in the Motors rows.'),
      t('Polarity does not matter yet: the self-test tells you which ones to swap.'),
    ]);

    const sens = design.ev?.sensors ?? [];
    const sensorNotes = [];
    if (sens.includes('hcsr04')) sensorNotes.push(t('Mount the HC-SR04 at the front, level, 5–15 cm above the floor, with nothing in front of its two "eyes".'));
    if (sens.includes('line-5ch')) sensorNotes.push(t('Mount the line sensor at the front underneath, 5–10 mm above the floor, the sensors across the direction of travel; set each potentiometer so its LED switches between floor and line.'));
    if (sens.includes('mpu6050')) sensorNotes.push(t('Mount the MPU-6050 flat near the middle of the robot with a dab of foam tape, away from the motors.'));
    if (design.bt) sensorNotes.push(t('Place the HC-05 away from the motors and the battery.'));
    step(sensorNotes.length ? t('Wire the signals and mount the sensors') : t('Wire the signals'), 30 + 10 * sens.length, [
      ...sensorNotes,
      t('Follow the Signals rows of the wiring table, one wire at a time, ticking each off.'),
      ...(dividers.length ? [t('Build the resistor dividers for: {list} (1 kΩ in series, 2 kΩ to ground), on the breadboard.', { list: dividers.join(', ') })] : []),
    ], { check: t('Every row of the wiring table is ticked off.') });
  }

  if (design.arm) {
    const fr = p.frame;
    step(t('Centre the servos before assembly'), 15, [
      t('Connect the servos to the PCA9685 channels in the order of the wiring table, but do not fit the horns yet.'),
      t('Upload and run the self-test (next steps) up to the servo step: it sends every servo to 90° and holds it there.'),
      t('Mark each servo\'s 90° position on its case with a pen.'),
    ], { warn: t('A servo assembled at a random angle will drive the arm into its end stop and strip its gears.') });
    step(t('Assemble the arm'), fr.printer ? 90 : 60, [
      t('Assemble the base, upper arm, forearm and gripper following the frame kit\'s drawing.'),
      t(fr.joints.includes('wrist')
        ? 'Fit every horn with its servo at 90° and the joint in the home pose: base facing forward, upper arm vertical, forearm horizontal, wrist in line with the forearm.'
        : 'Fit every horn with its servo at 90° and the joint in the home pose: base facing forward, upper arm vertical, forearm horizontal.'),
      t('Tighten the horn screws; use the small screws from the servo bags, not longer ones.'),
      t('Route the servo cables along the links with cable ties, leaving slack at each joint for its full travel.'),
      design.type === 'mobile' ? t('Bolt the arm base to the middle of the rover deck with four M3 bolts, the arm facing forward.')
        : t('Fix the arm base to the table or a heavy board: an arm reaching out with a load tips its base over.'),
    ]);
    step(t('Wire the servo power'), 20, [
      t('Follow the Power rows for the PCA9685: servo power on the screw terminal V+, logic power on the VCC header pin.'),
      t('Servo power and logic share only the ground.'),
    ], { warn: t('Never power the servos from the controller\'s 5 V pin: their stall current resets or damages the board.') });
  }

  const preCheck = [
    t('With the power off, check with the multimeter on continuity that no supply rail is shorted to ground.'),
    t('Re-check every red wire: each goes where the wiring table says.'),
  ];
  if (p.battery) preCheck.push(t('Insert the {a} A fuse.', { a: design.specs?.fuse ?? '' }));
  step(t('Check before first power-up'), 10, preCheck, { check: t('No shorts, fuse fitted, switch off.') });

  step(t('Upload the self-test'), 20, [
    t('Install Arduino IDE 2.') + ' ' + (board.arch === 'esp32'
      ? t('In Boards Manager install "esp32 by Espressif Systems" (3.x) and select ESP32 Dev Module.')
      : t(p.mcu.id.includes('clone') ? 'Select {board} under Arduino AVR Boards; clone boards may need the CH340 USB driver.'
        : 'Select {board} under Arduino AVR Boards.', { board: board.name })),
    t('Open selftest/selftest.ino from the downloaded programs, upload it over USB and open the serial monitor at 115200 baud, line ending "Newline".'),
    isRover ? t('Switch on the battery with the robot on a stand, wheels off the ground, and follow the steps it prints.')
      : t('Plug in the servo power and follow the steps it prints.'),
  ], { check: t('The self-test runs to the end. Write down every setting it asks you to change.') });

  if (isRover) {
    step(t('Calibrate the drive'), 20, [
      p.motor.cpr ? t('In robot/robot.ino set INVERT_LEFT / INVERT_RIGHT, INVERT_ENC_LEFT / INVERT_ENC_RIGHT as the self-test told you.')
        : t('In robot/robot.ino set INVERT_LEFT / INVERT_RIGHT as the self-test told you.'),
      t('Measure the wheel diameter and the distance between the wheel centres; update WHEEL_DIAMETER and TRACK_WIDTH.'),
      p.motor.cpr ? t('Set MAX_WHEEL_SPEED to about 90 % of the slower wheel\'s measured speed.')
        : t('Drive straight for 2 m: if it curves, lower PWM on the faster side by scaling its power in motorWrite.'),
    ]);
  }
  if (design.arm) {
    step(t('Calibrate the arm'), 30, [
      t('Upload robot/robot.ino and send H (home): the arm must stand in the home pose.'),
      t('Send J commands to each joint in small steps. If a joint moves the wrong way, set its dir to -1 and its zero to 180 − zero in the joints table.'),
      t('Find each joint\'s safe range (where it stops short of hitting the frame or the table) and set lo and hi.'),
      t('Close the gripper on an object with J and note the angle for GRIP_CLOSED; the same for GRIP_OPEN.'),
      t('Test P with a point straight ahead at half reach, then at the edges of your workspace.'),
    ], { warn: t('Keep fingers out of the arm while it moves; standard servos pinch hard.') });
  }

  const tries = [];
  if (isRover) {
    const b = req.rover.behaviours;
    if (b.includes('remote')) tries.push(design.wireless && board.arch === 'esp32'
      ? t('Join the robot\'s Wi-Fi from a phone and open http://192.168.4.1: drag the joystick to drive.')
      : t('Pair the phone with HC-05 (PIN 1234), connect a serial terminal app and send "D 0.2 0" to drive.'));
    if (b.includes('obstacle')) tries.push(t('Send "M 2" to start obstacle avoidance; "S" stops.'));
    if (b.includes('line')) tries.push(t('Put the robot on a black tape line on a light floor and send "M {n}".', { n: b.includes('obstacle') ? 3 : 2 }));
    if (b.includes('odometry')) tries.push(t('Send "F 1" to drive one metre and "T 90" to turn a quarter turn left; correct WHEEL_DIAMETER and TRACK_WIDTH until they are accurate.'));
  }
  if (design.arm) tries.push(t('Move the arm to a few poses, save each with W, then send R to replay the sequence.'));
  step(t('Upload the robot program and try it'), 30, [
    t('Upload robot/robot.ino. Type ? in the serial monitor for the commands.'),
    ...tries,
  ]);

  const total = steps.reduce((s, x) => s + x.minutes, 0);
  return { steps, tools, total };
}
