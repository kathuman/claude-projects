// Turbine Lab — the three machines (window.TLmach in the browser, module.exports in Node). Pure data and lookups.
//   MACHINES[id].water / .wind   the operating figures used by the power panel (wind: the thought-experiment twin)
//   PARTS[key]                   name and role of each part; the role is what the hover card teaches
//   partOf(meshName)             the part key for a node name from the exported model (null: not a labelled part)
(function (root) {
  "use strict";
  var MACHINES = {
    pelton: {
      file: "models/pelton.glb", kind: "pelton",
      water: { drive: "head", H: 600, Hmin: 50, Hmax: 1200, Qrated: 2.5, D: 1.9, ux: 0.47 }
    },
    francis: {
      file: "models/francis.glb", kind: "francis",
      water: { drive: "head", H: 25, Hmin: 10, Hmax: 300, Qrated: 12, D: 2.0, ku: 0.75 },
      // the wind twin is the same machine at 2.5× scale fed by air through a 6 m intake
      wind:  { drive: "current", D: 6, vRated: 12, cpMax: 0.3, tsr: 2, scale: 2.5 }
    },
    kaplan: {
      file: "models/kaplan.glb", kind: "kaplan",
      // an in-stream (hydrokinetic) unit: no dam, it takes power from the river's current
      water: { drive: "current", D: 2.2, vRated: 2.5, cpMax: 0.45, tsr: 4 },
      wind:  { drive: "current", D: 11, vRated: 12, cpMax: 0.45, tsr: 4, scale: 5 }
    }
  };

  // part key → [English name, what it does]. Order inside each machine's list sets the order of the parts list.
  var PARTS = {
    // Pelton
    runner_p: ["Pelton runner", "A wheel of buckets. The jet strikes one bucket at a time; each bucket splits it in two and turns it back almost 180°, so the water leaves with almost no speed left."],
    bucket: ["Bucket", "A double cup with a sharp splitter ridge in the middle. Turning the jet back is what takes its momentum: the best bucket speed is about half the jet speed."],
    hub: ["Hub and bolts", "Clamps the runner to the shaft and carries the whole torque."],
    nozzle: ["Nozzle", "Turns the pressure of the full head into speed: at 600 m of head the jet leaves at about 100 m/s."],
    needle: ["Spear needle", "Slides inside the nozzle to make the jet thinner or thicker. This is how a Pelton follows the load while the jet speed stays the same."],
    jet: ["Water jet", "A free jet in air, at atmospheric pressure: all the head is now speed. Pelton runners are impulse turbines."],
    penstock: ["Penstock", "The steel pipe that brings water down from the reservoir. Its height difference is the head; its friction is lost head."],
    bearing: ["Bearings", "Hold the shaft on both sides of the runner and take the jet's side force."],
    shaft: ["Shaft", "Carries the torque from the runner to the generator."],
    generator: ["Generator", "Turns shaft power into electricity. It must spin at a synchronous speed: 3000 rpm divided by the number of pole pairs on a 50 Hz grid."],
    dam: ["Dam", "Holds the reservoir: the water level behind it sets the top of the head."],
    reservoir: ["Reservoir", "Stored water — stored energy. Every cubic metre released through 600 m of head is worth about 1.5 kWh."],
    intake: ["Intake", "A smooth bell mouth where water enters the pipe, shaped to avoid losses and swirl."],
    trashrack: ["Trash rack", "Bars that stop branches and debris before they reach the turbine."],
    tailrace: ["Tailrace", "Takes the spent water back to the river. A Pelton runner sits above it, in air."],
    rock: ["Mountain (cut away)", "High-head schemes are built into mountains: the powerhouse often sits in a cavern."],
    powerhouse: ["Powerhouse", "The building or cavern that houses turbine and generator."],
    crane: ["Overhead crane", "Lifts the runner and generator out for maintenance."],
    transformer: ["Transformer", "Steps the generator voltage up for transmission, cutting losses in the lines."],
    switchyard: ["Switchyard", "Breakers and busbars that connect the plant to the grid."],
    lines: ["Transmission line", "Carries the power to the grid at high voltage."],
    person: ["Person (for scale)", "About 1.8 m tall: use them to judge the size of the machine."],
    river: ["River", "The water before and after the plant."],
    // Francis
    spiral: ["Spiral casing", "A scroll that gets narrower all the way round, so water reaches every point of the runner at the same speed, already swirling."],
    stayvanes: ["Stay vanes", "Fixed vanes that hold the casing together against the water pressure and straighten the flow."],
    gates: ["Wicket gates", "Adjustable vanes around the runner. Turning them sets both how much water enters and the angle it hits the blades — the Francis turbine's control."],
    runner_f: ["Francis runner", "Curved blades between a crown and a band. Water enters at the rim and leaves downward at the centre; pressure and swirl both turn into torque. A reaction turbine: it runs full of water."],
    drafttube: ["Draft tube", "A widening pipe under the runner. Slowing the outflow recovers pressure, so the runner also uses the head below it."],
    weir: ["Weir", "Raises the river level to create the head."],
    headwater: ["Headwater", "The raised water level upstream of the weir."],
    tailwater: ["Tailwater", "The river below the plant. Head = headwater level − tailwater level."],
    flowpath: ["Water path", "The water inside the machine, shown so you can follow it: casing → gates → runner → draft tube."],
    airpath: ["Air path", "The air inside the wind twin, following the same path as the water would."],
    frame: ["Support frame", "Holds the wind twin up in the wind."],
    yaw: ["Yaw ring", "Turns the machine to face the wind."],
    ground: ["Ground", "The site."],
    // Kaplan
    blades: ["Kaplan blades", "Five blades on bearings in the hub. Their pitch is adjustable while running, so the runner stays efficient across a wide range of flows."],
    trunnion: ["Blade trunnion", "The bearing each blade turns on when its pitch changes."],
    hubk: ["Runner hub", "Holds the blades and the mechanism that pitches them."],
    bulb: ["Bulb", "A watertight nacelle in the flow that holds the generator, so the water passes straight through."],
    duct: ["Duct", "A shroud that guides the current through the runner and keeps it from spilling around the blade tips."],
    guidevanes: ["Guide vanes", "Fixed vanes that hold the bulb in the duct and shape the inflow."],
    base: ["Gravity base", "Heavy concrete that keeps the unit on the riverbed without piles."],
    pylon: ["Support pylon", "Carries the unit above the base and its loads to the ground."],
    mast: ["Service mast", "Access for maintenance; shows where the unit is."],
    marker: ["Navigation marker", "Warns boats of the unit below the surface."],
    cable: ["Export cable", "Brings the power ashore."],
    kiosk: ["Shore connection", "Where the cable meets the local grid."],
    riverbed: ["Riverbed", "The bottom of the river."],
    tower: ["Tower", "Holds the wind twin high up, where the wind is stronger and steadier."],
    foundation: ["Foundation", "Takes the tower's loads into the ground."]
  };

  // node name → part key, by name pattern (the first match wins)
  var RULES = [
    [/^Bucket_Arm_|^Runner_Disc/, "runner_p"], [/^Bucket_\d/, "bucket"], [/^Runner_Hub|^Hub_Bolt/, "hub"],
    [/Emitter/, null], [/^Nozzle_/, "nozzle"], [/^Spear_Needle/, "needle"], [/^Water_Jet$/, "jet"],
    [/^Penstock|^Pipe_Flange|^Reducer_Support|^Cut_Penstock/, "penstock"],
    [/^Bearing_|^Pedestal_Foot/, "bearing"], [/^Shaft/, "shaft"],
    [/Generator/, "generator"], [/^Dam$/, "dam"], [/^Reservoir_Water/, "reservoir"],
    [/^Intake_Bellmouth/, "intake"], [/^Trash_Rack/, "trashrack"], [/^Tailrace/, "tailrace"], [/^Tailwater/, "tailwater"],
    [/^Mountain/, "rock"], [/^Floor_|^Hall_|^Powerhouse_/, "powerhouse"], [/^Gantry|^Crane/, "crane"],
    [/^Transformer/, "transformer"], [/^Switchyard|^Busbar|^HV_|^Jumper|^Cable_Clamp/, "switchyard"],
    [/^Tower_\d|^Line_/, "lines"], [/^Person_/, "person"], [/^River_Water/, "river"],
    [/Spiral_Casing/, "spiral"], [/Stay_(Vane|Ring)/, "stayvanes"], [/Wicket_Gate/, "gates"],
    [/Francis_Runner_|Francis_Shaft/, "runner_f"], [/Draft_Tube/, "drafttube"],
    [/Casing_Water|Draft_Water/, "flowpath"], [/Airflow/, "airpath"],
    [/^Weir/, "weir"], [/^Headwater/, "headwater"], [/^Frame_/, "frame"], [/Yaw_/, "yaw"],
    [/Wind_Site_Ground/, "ground"],
    [/Kaplan_Blade_\d/, "blades"], [/Kaplan_Trunnion/, "trunnion"], [/Kaplan_Runner_Hub/, "hubk"],
    [/Bulb_Nacelle/, "bulb"], [/Kaplan_Duct/, "duct"], [/Guide_Vane/, "guidevanes"],
    [/^Gravity_Base/, "base"], [/^Support_Pylon/, "pylon"], [/^Service_Mast/, "mast"],
    [/^Navigation_Marker/, "marker"], [/^Export_Cable/, "cable"], [/^Shore_Connection/, "kiosk"],
    [/^Riverbed/, "riverbed"], [/^Wind_Tower|^Tower_Door/, "tower"], [/^Wind_Foundation/, "foundation"]
  ];
  function partOf(name) {
    var n = String(name || "");
    for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(n)) return RULES[i][1];
    return null;
  }
  // the parts list shown for each machine and medium, in this order
  var LISTS = {
    pelton: ["reservoir", "dam", "intake", "trashrack", "penstock", "nozzle", "needle", "jet", "runner_p", "bucket", "hub", "shaft", "bearing", "generator", "transformer", "switchyard", "lines", "tailrace", "river", "rock", "powerhouse", "crane", "person"],
    francis: ["headwater", "weir", "intake", "spiral", "stayvanes", "gates", "runner_f", "drafttube", "flowpath", "generator", "tailwater", "riverbed", "powerhouse", "crane", "person"],
    kaplan: ["duct", "guidevanes", "bulb", "blades", "trunnion", "hubk", "pylon", "base", "mast", "marker", "cable", "kiosk", "river", "riverbed", "person"],
    francis_wind: ["spiral", "stayvanes", "gates", "runner_f", "drafttube", "airpath", "generator", "frame", "yaw", "ground"],
    kaplan_wind: ["duct", "guidevanes", "bulb", "blades", "trunnion", "hubk", "yaw", "tower", "foundation", "ground"]
  };

  root.TLmach = { MACHINES: MACHINES, PARTS: PARTS, LISTS: LISTS, partOf: partOf };
  if (typeof module !== "undefined" && module.exports) module.exports = root.TLmach;
})(typeof self !== "undefined" ? self : this);
