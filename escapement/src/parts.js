// Escapement — the parts of the clock (window.ESParts / module.exports): what each one is called, which nodes of
// models/clock.glb it is made of (by their names in Blender), which group it belongs to, and what it does. The page
// lights up a part when it is picked and moves the ones listed in MOVES from ESClock.pose(t).
// Translations (Spanish, Danish) are in i18n-es.js and i18n-da.js under P: [name, role, text] by part key.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESParts = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var GROUPS = [
    { id: "power", name: "Power" },
    { id: "train", name: "Going train" },
    { id: "escapement", name: "Escapement and pendulum" },
    { id: "motion", name: "Motion work and hands" },
    { id: "frame", name: "Frame" }
  ];

  var PARTS = {
    mainspring: { nodes: ["Mainspring"], group: "power", name: "Mainspring",
      role: "Stores the energy that runs the clock.",
      text: "A long strip of spring steel coiled inside the barrel. Winding the clock coils it tightly around the barrel arbor; as it unwinds it pushes the barrel round. Six turns of the spring run the clock for two days." },
    barrel: { nodes: ["Barrel and great wheel"], group: "power", name: "Barrel and great wheel",
      role: "Turns the spring's pull into a turning force on the train.",
      text: "The drum that holds the mainspring, with the great wheel's 96 teeth around its rim. The spring's outer end is hooked to the barrel wall, so the barrel turns slowly — once every eight hours — and drives the centre pinion. It is the first and slowest wheel of the going train." },
    ratchet: { nodes: ["Barrel arbor and ratchet"], group: "power", name: "Barrel arbor and ratchet",
      role: "Where the key winds the spring.",
      text: "The square end of this arbor takes the winding key. The ratchet wheel on it can turn only one way, so winding tightens the spring and the arbor then stays put while the barrel around it does the work." },
    click: { nodes: ["Click"], group: "power", name: "Click",
      role: "Stops the spring from unwinding backwards.",
      text: "A small pawl held against the ratchet wheel by a spring. It lets the arbor turn when you wind and catches a tooth when you stop — the clicking you hear while winding a clock." },
    centre: { nodes: ["Centre wheel"], group: "train", name: "Centre wheel",
      role: "Turns once an hour; its arbor carries the minute hand.",
      text: "Its pinion of 12 leaves is driven by the great wheel, and its 80 teeth drive the third pinion. Because the escapement lets the train run at a fixed rate, this arbor turns exactly once an hour, so its front end, passing through the dial, carries the minute hand." },
    third: { nodes: ["Third wheel"], group: "train", name: "Third wheel",
      role: "Speeds the motion up between the centre and escape wheels.",
      text: "A pinion of 8 leaves and a wheel of 72 teeth. Each mesh of a big wheel with a small pinion multiplies the speed, so the third wheel turns once every six minutes, in the opposite direction to the centre wheel." },
    escape: { nodes: ["Escape wheel"], group: "train", name: "Escape wheel",
      role: "The last wheel of the train, released half a tooth per beat.",
      text: "30 pointed teeth on a 6-leaf pinion. The spring's force reaches it through the train, but the anchor's pallets hold it still most of the time; each time the pendulum passes the middle it is let go for half a tooth. With one full swing per second it turns once every 30 seconds." },
    anchor: { nodes: ["Anchor (pallets)"], group: "escapement", name: "Anchor and pallets",
      role: "Locks and releases the escape wheel, and pushes the pendulum.",
      text: "The anchor rocks with the pendulum. Its two pallets span seven and a half teeth and take turns blocking the escape wheel. In Graham's deadbeat design the locking faces are arcs centred on the anchor's pivot, so a resting tooth does not push the wheel back (no recoil): the wheel stands dead still. As the pendulum passes the middle, a tooth slides along a pallet's slanted impulse face and gives the anchor a small push." },
    crutch: { nodes: ["Crutch"], group: "escapement", name: "Crutch",
      role: "Links the anchor to the pendulum.",
      text: "An arm fixed to the anchor's arbor that reaches down and holds the pendulum rod. The pendulum swings the anchor through it, and the small push from each impulse travels back through it to keep the pendulum swinging." },
    pendulum: { nodes: ["Pendulum"], group: "escapement", name: "Pendulum",
      role: "The timekeeper: it sets the rate of the whole clock.",
      text: "A rod and a heavy brass bob, hung from a thin spring. A swing takes the same time whatever its size (for small swings), and that time depends only on its length: T = 2π√(L/g). This one is 248 mm long and makes one full swing a second — two beats, a tick and a tock." },
    suspension: { nodes: ["Suspension cock"], group: "escapement", name: "Suspension cock",
      role: "Holds the pendulum up.",
      text: "A bracket on the back plate from which the pendulum hangs by a short, thin suspension spring. The spring bends instead of rubbing, so the pendulum swings with almost no friction." },
    cannon: { nodes: ["Cannon pinion"], group: "motion", name: "Cannon pinion",
      role: "Carries the minute hand and drives the motion work.",
      text: "A tube with 12 leaves that sits on the front of the centre arbor. It is held by friction, not fixed, so you can turn the hands to set the time without forcing the train. It drives the minute wheel." },
    minuteWheel: { nodes: ["Minute wheel"], group: "motion", name: "Minute wheel and pinion",
      role: "Slows the motion down for the hour hand.",
      text: "A 36-tooth wheel, turned by the cannon pinion, with an 8-leaf pinion on the same arbor that drives the hour wheel. Between them the two meshes divide by 3 and by 4: 36/12 × 32/8 = 12." },
    hourWheel: { nodes: ["Hour wheel"], group: "motion", name: "Hour wheel",
      role: "Turns once in twelve hours and carries the hour hand.",
      text: "32 teeth on a tube that rides over the cannon pinion. It turns twelve times slower than the minute hand, in the same direction, so both hands go clockwise." },
    minuteHand: { nodes: ["Minute hand"], group: "motion", name: "Minute hand",
      role: "One turn an hour.",
      text: "Blued steel, fixed to the cannon pinion. Its turn is the centre arbor's turn: one revolution an hour." },
    hourHand: { nodes: ["Hour hand"], group: "motion", name: "Hour hand",
      role: "One turn in twelve hours.",
      text: "The shorter hand, on the hour wheel's tube. Blueing — heating polished steel until it turns blue — protects it from rust and makes it easy to read against the silvered ring." },
    dial: { nodes: ["Dial (chapter ring)", "Dial numerals"], group: "motion", name: "Chapter ring",
      role: "The dial: hours and minutes, open in the middle.",
      text: "A skeleton clock has only a ring for a dial, so you can see the wheels behind it. It carries the hour numerals and a track of 60 minute marks, and stands on three short feet on the front plate." },
    plates: { nodes: ["Frame: back plate", "Frame: front plate"], group: "frame", name: "Plates",
      role: "Hold the arbors' pivots in line.",
      text: "Two brass plates, cut away to a lancet shape so the wheels show. Every arbor runs from one plate to the other on small pivots, so the distance between arbors — and with it how well the teeth mesh — is set by holes drilled in the plates." },
    pillars: { nodes: ["Frame: pillars"], group: "frame", name: "Pillars",
      role: "Keep the plates the right distance apart.",
      text: "Turned brass posts between the plates. They set the space for the wheels and make the frame stiff." },
    stand: { nodes: ["Frame: columns", "Base"], group: "frame", name: "Columns and base",
      role: "Hold the movement up, with room below for the pendulum.",
      text: "Two columns raise the movement above a walnut base, so the pendulum has room to swing underneath it." }
  };

  // the order in which the spring's energy reaches the pendulum, and the branch that turns the hands
  var POWER_PATH = ["mainspring", "barrel", "centre", "third", "escape", "anchor", "crutch", "pendulum"];
  var HANDS_PATH = ["centre", "cannon", "minuteWheel", "hourWheel", "minuteHand", "hourHand"];
  // the parts that move, and the angle from ESClock.pose that turns each; "run" angles are taken relative to t = 0
  // (how the model starts those wheels is a matter of looks), the others as they are
  var MOVES = {
    "Pendulum": { key: "pendulum" }, "Anchor (pallets)": { key: "anchor" }, "Escape wheel": { key: "escape" },
    "Third wheel": { key: "third" }, "Centre wheel": { key: "centre", run: true }, "Barrel and great wheel": { key: "barrel" },
    "Mainspring": { key: "mainspring" }, "Cannon pinion": { key: "cannon", run: true }, "Minute wheel": { key: "minuteWheel", run: true },
    "Hour wheel": { key: "hourWheel" }, "Hour hand": { key: "hourHand" }, "Minute hand": { key: "minuteHand" }
  };
  // three.js renames glTF nodes: whitespace becomes "_" and the characters [ ] . : / are dropped
  function nodeName(blenderName) { return blenderName.replace(/\s/g, "_").replace(/[\[\]\.:\/]/g, ""); }
  // the part key of each node name as three.js sees it
  function byNode() {
    var m = {};
    Object.keys(PARTS).forEach(function (k) { PARTS[k].nodes.forEach(function (n) { m[nodeName(n)] = k; }); });
    return m;
  }
  return { GROUPS: GROUPS, PARTS: PARTS, POWER_PATH: POWER_PATH, HANDS_PATH: HANDS_PATH, MOVES: MOVES, nodeName: nodeName, byNode: byNode };
});
