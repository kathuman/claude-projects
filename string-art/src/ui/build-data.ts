// The build page's content: the parts to buy, the names of the printed parts, and the assembly and calibration steps.
// Prices are rough euro amounts from common online shops in 2026, to give an idea of the total, not quotes.
// The English strings are written out in full in each T() call so the language test can find them.

import { T } from "./i18n";

export interface Bought { group: string; name: string; spec: string; qty: number; eur: number }

export function boughtParts(): Bought[] {
  const wood = T("Wood and board"), mech = T("Mechanics"), motion = T("Motion"), elec = T("Electronics"), thread = T("Thread and consumables");
  return [
    { group: wood, name: T("Birch plywood 18 mm, for the base"), spec: T("760 × 940 mm"), qty: 1, eur: 35 },
    { group: wood, name: T("Birch plywood 12 mm, for the platter"), spec: T("a 700 mm disc"), qty: 1, eur: 18 },
    { group: wood, name: T("Birch plywood 18 mm, for the nail board"), spec: T("a 640 mm disc, one per piece"), qty: 1, eur: 20 },
    { group: wood, name: T("Panel pins (brads)"), spec: T("1.5 × 30 mm, a pack of 500"), qty: 1, eur: 6 },
    { group: wood, name: T("Furniture feet"), spec: T("75 mm tall, screw-on"), qty: 4, eur: 2 },
    { group: mech, name: T("Lazy-susan bearing"), spec: T("305 mm (12 in), aluminium, 100 kg or more"), qty: 1, eur: 15 },
    { group: mech, name: T("Steel dowel"), spec: T("Ø 10 × 40 mm"), qty: 1, eur: 2 },
    { group: mech, name: T("Aluminium extrusion 2040 (V-slot)"), spec: T("260 mm, with T-nuts"), qty: 1, eur: 8 },
    { group: mech, name: T("Screws, nuts and washers"), spec: T("M3, M4 and M5 assortment; 4 × 16 mm wood screws"), qty: 1, eur: 12 },
    { group: motion, name: T("Stepper motor NEMA 17"), spec: T("42 × 48 mm, 0.45 N·m, 1.5 A"), qty: 2, eur: 12 },
    { group: motion, name: T("Stepper motor NEMA 17 with T8 lead screw"), spec: T("200 mm screw, 8 mm lead, anti-backlash nut"), qty: 1, eur: 25 },
    { group: motion, name: T("GT2 pulley, 20 teeth"), spec: T("5 mm bore, for 6 mm belt"), qty: 2, eur: 2 },
    { group: motion, name: T("GT2 idler, 20 teeth"), spec: T("5 mm bore"), qty: 1, eur: 2 },
    { group: motion, name: T("GT2 closed belt"), spec: T("400 mm, 6 mm wide"), qty: 1, eur: 3 },
    { group: motion, name: T("GT2 open belt"), spec: T("6 mm wide, 0.5 m"), qty: 1, eur: 3 },
    { group: motion, name: T("Linear rail MGN12H"), spec: T("200 mm, one carriage"), qty: 1, eur: 18 },
    { group: motion, name: T("Linear rail MGN9H"), spec: T("120 mm, one carriage"), qty: 1, eur: 15 },
    { group: elec, name: T("Arduino Uno (or compatible)"), spec: T("with GRBL 1.1 flashed"), qty: 1, eur: 12 },
    { group: elec, name: T("CNC Shield V3"), spec: T("for the Uno"), qty: 1, eur: 6 },
    { group: elec, name: T("Stepper driver TMC2209"), spec: T("standalone (step/dir) module"), qty: 3, eur: 6 },
    { group: elec, name: T("Power supply 12 V 5 A"), spec: T("with a switch or switched cable"), qty: 1, eur: 15 },
    { group: elec, name: T("Microswitch with lever"), spec: T("Y and Z home, thread break"), qty: 3, eur: 1 },
    { group: elec, name: T("Hall sensor A3144 and a magnet"), spec: T("magnet Ø 6 × 3 mm, for homing the turntable"), qty: 1, eur: 3 },
    { group: elec, name: T("Wire, connectors and a project box"), spec: T("4-wire motor cables, Dupont leads"), qty: 1, eur: 15 },
    { group: thread, name: T("Brass tube"), spec: T("2.5 mm outside, 1.6 mm inside, cut to 40 mm"), qty: 1, eur: 3 },
    { group: thread, name: T("PTFE tube"), spec: T("4 × 2 mm, 0.5 m"), qty: 1, eur: 3 },
    { group: thread, name: T("Thread tension discs"), spec: T("two Ø 16 mm discs, a spring and a wing nut on an M4 bolt, as on a sewing machine"), qty: 1, eur: 4 },
    { group: thread, name: T("Hex bolt M8 × 60"), spec: T("the pin the thread cone stands on"), qty: 1, eur: 1 },
    { group: thread, name: T("Black polyester thread on a cone"), spec: T("0.15 to 0.3 mm (0.25 mm usual), 3,000 m or more per piece"), qty: 1, eur: 10 },
    { group: thread, name: T("Filament PETG"), spec: T("about 0.5 kg for all printed parts"), qty: 1, eur: 12 }
  ];
}

/** Printed parts: names and print notes, by the ids FreeCAD writes to parts.json. */
export function printedNames(): Record<string, { name: string; note: string }> {
  return {
    turntable_pulley: { name: T("Turntable pulley, 160 teeth"), note: T("PETG, 0.1 mm layers for the teeth, 4 walls, 40 % infill. Hub down.") },
    motor_plate: { name: T("Turntable motor plate"), note: T("Under the base; the slots tension the belt.") },
    turn_button: { name: T("Turn button"), note: T("Three hold the nail board on the platter.") },
    hall_holder: { name: T("Hall sensor holder"), note: T("On the base, under the magnet's path.") },
    tower_foot_left: { name: T("Tower foot, left"), note: T("Holds the extrusion upright.") },
    tower_foot_right: { name: T("Tower foot, right"), note: T("Holds the extrusion upright.") },
    z_motor_mount: { name: T("Height motor mount"), note: T("On top of the extrusion.") },
    z_carriage: { name: T("Height carriage with shelf"), note: T("PETG, 5 walls, 40 % infill. Shelf down; the gussets need no support.") },
    guide_arm: { name: T("Guide arm"), note: T("Press the brass tube in from below; the PTFE tube pushes into the socket on top.") },
    cone_stand: { name: T("Cone stand"), note: T("The thread cone stands on it, on an M8 bolt; the thread comes off over the top.") },
    tensioner_bracket: { name: T("Eyelet and tension bracket"), note: T("Above the cone: the eyelet for the thread and the M4 post for the tension discs (tap it M4).") },
    dancer_bracket: { name: T("Dancer bracket"), note: T("Carries the dancer's pivot and the thread-break switch.") },
    dancer_arm: { name: T("Dancer arm"), note: T("Rides on the thread; if the thread breaks it drops onto the switch.") }
  };
}

/** Names for the bought parts in the 3D model, by object name (without the letter prefix). */
export function modelNames(): Record<string, string> {
  return {
    base: T("Base, 18 mm plywood"), platter: T("Platter, 12 mm plywood"), nail_board: T("Nail board"), nails: T("Nails"),
    lazy_susan_bearing: T("Lazy-susan bearing"), centre_dowel: T("Centre dowel"), magnet: T("Homing magnet"),
    extrusion_2040: T("Tower, 2040 extrusion"), mgn12_rail: T("Height rail, MGN12"), mgn12h_carriage: T("Height rail carriage"),
    mgn9_rail: T("Guide rail, MGN9"), mgn9h_carriage: T("Guide rail carriage"), z_motor_leadscrew: T("Height motor with lead screw"),
    y_motor: T("Guide motor"), x_motor: T("Turntable motor"), y_pulley: T("Guide belt pulley"), y_idler: T("Guide belt idler"),
    y_belt: T("Guide belt"), x_pulley_20t: T("Motor pulley, 20 teeth"), x_belt: T("Turntable belt"),
    brass_guide_tube: T("Brass guide tube"), ptfe_tube: T("PTFE tube for the thread"), thread_cone: T("Thread cone"), tension_discs: T("Tension discs"), cone_pin: T("Cone pin, M8 bolt"),
    break_switch: T("Thread-break switch"), controller_box: T("Controller: Arduino Uno with CNC Shield"), power_supply: T("Power supply"),
    foot: T("Foot")
  };
}

export function assemblySteps(): string[] {
  return [
    T("<b>Print</b> the parts below. PETG is best for the pulley and the carriage, which carry load; PLA will do for the rest."),
    T("<b>Base.</b> Cut the board to size and cut the opening for the pulleys and the belt. Drill the holes from the drilling plan and screw on the feet."),
    T("<b>Bearing.</b> Centre the bearing on the opening and screw its lower plate to the base. Drill the 20 mm access hole where one of the upper plate's holes falls."),
    T("<b>Platter.</b> Cut the 700 mm disc and drill the 10 mm centre hole and the magnet hole underneath. Screw the turntable pulley to its underside, with the dowel through both, then glue the magnet in."),
    T("<b>Turntable.</b> Set the platter on the bearing and screw it on through the access hole, turning it to reach each screw."),
    T("<b>Turntable drive.</b> Fix the motor to its plate, put the 20-tooth pulley on so its teeth line up with the big pulley, fit the belt and slide the plate outward until the belt is firm but not tight; then screw the plate down."),
    T("<b>Homing sensor.</b> Screw the hall sensor holder under the magnet's path, the sensor's flat face up, 1 to 2 mm below the magnet."),
    T("<b>Tower.</b> Bolt the extrusion upright with the two feet, fit the MGN12 rail on its front face and the height motor on top."),
    T("<b>Carriage.</b> Bolt the height carriage to the rail carriage and the lead-screw nut to its tab. Fit the MGN9 rail under the shelf, the guide motor and its pulley on the shelf, and the idler at the front."),
    T("<b>Guide.</b> Deburr and round both ends of the brass tube, press it into the guide arm, and bolt the arm under the MGN9 carriage. Loop the belt round the pulley and the idler and clamp both ends in the arm."),
    T("<b>Thread path.</b> Fit the cone stand with its M8 bolt and the eyelet bracket above it, with the tension discs on their post. Fit the dancer bracket with the arm and the switch so the switch closes when the arm drops, and run the PTFE tube from the dancer to the guide arm. The thread goes up from the cone through the eyelet, between the discs, through the dancer eye and the tube."),
    T("<b>Switches and wiring.</b> Fit the home switches where the guide and the carriage reach them at the back and the top, then wire everything as in the diagram.")
  ];
}

export function calibrationSteps(): string[] {
  return [
    T("<b>Flash GRBL 1.1</b> on the Uno and send the settings below, one line at a time, from any G-code sender."),
    T("<b>Directions.</b> Jog each axis a little. X+ must turn the board anticlockwise seen from the front, Y+ move the guide towards the tower, Z+ raise it. Reverse an axis with $3 if it goes the wrong way."),
    T("<b>Steps.</b> Mark the platter's edge and send G91 G1 X360 F600: the board must turn exactly once. Check Y and Z against a ruler."),
    T("<b>Homing.</b> Send $H. The guide rises, moves back to its switch, and the board turns until the magnet passes the sensor."),
    T("<b>Work zero.</b> Clamp a board on, jog the guide's tip exactly above nail 0, just clear of its top, and send G10 L20 P1 X0 Y0 Z18 (18 = the nail height). GRBL remembers it."),
    T("<b>Dry run.</b> Without thread, run the demo pattern's G-code at half speed (feed override 50 %). Watch the tube pass through the gaps and round the nails."),
    T("<b>Tension.</b> Tie the thread on and turn the tension discs' wing nut until the thread leaving the guide just lifts a 25 g weight (0.25 N; see Thread tension above). Then wind your first piece.")
  ];
}

/** The comment for each GRBL setting, in the page's language (the settings themselves come from hardware/drive.ts). */
export function grblComment(setting: string): string {
  switch (setting.split("=")[0]) {
    case "$0": return T("step pulse, µs");
    case "$1": return T("keep the motors powered when idle, so the board cannot drift");
    case "$5": return T("limit switches: normally open");
    case "$10": return T("status shows the work position and buffer use");
    case "$20": return T("no soft limits: the board turns many times");
    case "$21": return T("no hard limits");
    case "$22": return T("homing on");
    case "$23": return T("home X towards −, Y towards +, Z towards +");
    case "$24": return T("homing feed, °/min or mm/min");
    case "$25": return T("homing seek, °/min or mm/min");
    case "$27": return T("pull-off after homing, mm");
    case "$100": return T("X steps per degree of board turn");
    case "$101": return T("Y steps per mm");
    case "$102": return T("Z steps per mm");
    case "$110": return T("X top speed, °/min");
    case "$111": return T("Y top speed, mm/min");
    case "$112": return T("Z top speed, mm/min");
    case "$120": return T("X acceleration, °/s²");
    case "$121": return T("Y acceleration, mm/s²");
    case "$122": return T("Z acceleration, mm/s²");
    default: return "";
  }
}
