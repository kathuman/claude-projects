/* Linkage — guided tutorial.
 *
 * Three levels (Basic, Intermediate, Advanced). Each step highlights part of the app, explains
 * it, and usually asks the user to try something; the step notices when they have (a `check`
 * against the app's state) and ticks itself off. Some steps offer "Do it for me". Progress is
 * remembered per level, and every level can be read as a written guide.
 *
 * The page hands over a small `app` object (read-only views of the state + a few actions and
 * event counters), so this file never reaches into the simulator's internals.
 * Browser global: window.LinkageTutorial.init(app).
 */
(function (root) {
  "use strict";

  var DEG = Math.PI / 180;

  // ------------------------------------------------------------------ content
  // Step fields: id, title, body (HTML), target (CSS selector to highlight), task (what to do),
  // check(app, base) -> true when done, enter(app) (set-up when the step opens),
  // doit {label, run(app)} (optional "Do it for me"), base(app) -> snapshot taken on entering.
  function dist3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  var since = function (app, base, k) { return app.flag(k) - (base.flags[k] || 0); };

  var LEVELS = [
    {
      id: "basic", name: "Basic", tagline: "Drive the arm", minutes: 10,
      learn: ["Move the camera around the robot", "Drive each of the six joints and read the tool position",
              "Open and close the gripper", "See the collision guard stop a crash",
              "Drag the tool around and let the arm work out the joints", "Run the built-in pick & place and play with physics blocks"],
      setup: function (app) { app.reset("UR5e"); },
      steps: [
        { id: "welcome", title: "Welcome to Linkage",
          body: "<p>Linkage is a simulator of a real <b>6-axis collaborative robot arm</b> — by default a Universal Robots <b>UR5e</b>, built from the manufacturer's published dimensions, masses and joint limits. Everything you do here happens only in your browser; no real robot is connected.</p>" +
                "<p>The screen has three parts: the <b>control rail</b> on the left, the <b>3D view</b> in the middle, and the <b>telemetry panel</b> (top-left of the view) that reads out where the tool is.</p>" +
                "<p>This level takes about 10 minutes. Each step highlights what it's about and gives you something to try; when you've done it, the step ticks itself off. You can always press <b>Next</b> to skip ahead, or close the tutorial and come back — your place is remembered.</p>" },
        { id: "orbit", title: "Look around the robot", target: "#stage",
          body: "<p>The 3D view works like most 3D apps:</p><ul><li><b>Drag</b> with the left mouse button (or one finger) to orbit around the arm.</li><li><b>Scroll</b> (or pinch) to zoom in and out.</li><li><b>Shift + drag</b>, <b>right-drag</b> or two fingers to <b>pan</b> — slide the view sideways.</li></ul>" +
                "<p>The blue grid is the table the robot is bolted to; each square is 10 cm. The faint circle marks the arm's nominal <b>reach</b> (850 mm for a UR5e).</p>",
          task: "Orbit or zoom the view.",
          base: function (app) { return { cam: app.camera() }; },
          check: function (app, b) { var c = app.camera(); return Math.abs(c.theta - b.cam.theta) > 0.3 || Math.abs(c.phi - b.cam.phi) > 0.2 || Math.abs(c.radius - b.cam.radius) > 0.25; } },
        { id: "views", title: "Camera presets", target: ".caption .views",
          body: "<p>If you lose your way, the buttons at the bottom right jump to standard views: <b>Iso</b> (three-quarter view, the default), <b>Front</b>, <b>Side</b> and <b>Top</b> (looking straight down — handy for judging positions on the table).</p>" +
                "<p>The camera glides to the new view rather than jumping, so you keep your bearings.</p>",
          task: "Click Top, then Iso.",
          check: function (app, b) { return since(app, b, "view-top") > 0 && since(app, b, "view-iso") > 0; },
          doit: { label: "Show me", run: function (app) { app.view("top"); setTimeout(function () { app.view("iso"); }, 1200); } } },
        { id: "joints", title: "The six joints", target: "#jointSection",
          body: "<p>An industrial arm is a chain of motors. Each slider turns one joint, from the base up:</p>" +
                "<ul><li><b>Base (J1)</b> swings the whole arm around the vertical axis.</li><li><b>Shoulder (J2)</b> and <b>Elbow (J3)</b> lift and reach — together they decide <em>where</em> the wrist is.</li><li><b>Wrist 1–3 (J4–J6)</b> decide <em>which way</em> the tool points.</li></ul>" +
                "<p>Angles are in degrees; the value next to each name is the current angle. You can also click a slider and use the arrow keys for fine steps.</p>",
          task: "Turn the Base by at least 30°.",
          base: function (app) { return { q: app.q() }; },
          check: function (app, b) { return Math.abs(app.q()[0] - b.q[0]) > 30 * DEG; } },
        { id: "reach", title: "Shoulder and elbow", target: "#jointSection",
          body: "<p>Now move the <b>Shoulder</b> or <b>Elbow</b> and watch the arm lift and extend. These two big joints carry most of the arm's weight — in the Advanced level you'll see the torque they need.</p>" +
                "<p>Notice that one joint moving changes the position of <em>everything after it</em> in the chain. That's <b>forward kinematics</b>: from joint angles to where the tool ends up.</p>",
          task: "Move the Shoulder or Elbow by 20° or more.",
          base: function (app) { return { q: app.q() }; },
          check: function (app, b) { var q = app.q(); return Math.abs(q[1] - b.q[1]) > 20 * DEG || Math.abs(q[2] - b.q[2]) > 20 * DEG; } },
        { id: "hud", title: "Reading the telemetry", target: ".hud",
          body: "<p>The panel shows the <b>tool centre point</b> (TCP) — the spot between the gripper fingertips:</p>" +
                "<ul><li><b>X, Y, Z</b>: position in metres in the robot's <b>base frame</b> (origin at the centre of the base, Z pointing up from the table).</li><li><b>Roll, Pitch, Yaw</b>: which way the tool faces. A tool pointing straight down reads Roll 180°, Pitch 0°.</li><li><b>Reach</b>: distance from the shoulder to the tool.</li><li><b>Dexterity</b>: how freely the tool can move in every direction right now (more on this in the Intermediate level).</li></ul>" +
                "<p>Move a wrist slider and watch Roll/Pitch/Yaw change while X/Y/Z barely move.</p>",
          task: "Move one of the three wrist sliders.",
          base: function (app) { return { q: app.q() }; },
          check: function (app, b) { var q = app.q(); return [3, 4, 5].some(function (i) { return Math.abs(q[i] - b.q[i]) > 10 * DEG; }); } },
        { id: "gripper", title: "The gripper", target: "#gripper",
          body: "<p>The two-finger gripper on the end of the arm opens and closes with this slider (0% = closed, 100% = fully open, about 8 cm). In programs and in Pick &amp; Place the gripper closes onto parts automatically; here you're driving it by hand.</p>",
          task: "Close the gripper below 20%.",
          check: function (app) { return app.gripper() < 20; } },
        { id: "guard", title: "The collision guard", target: "#guard-switch",
          body: "<p>Real cobots stop before they hit things. Linkage's <b>collision guard</b> checks every pose before the arm moves: if the table or the arm's own links would touch, the move is refused, a message says what would have hit what, and the offending links flash red.</p>" +
                "<p>Try it: drag the <b>Shoulder</b> slider towards <b>+40°</b> — that would push the arm into the table.</p>",
          task: "Make the guard block a move.",
          check: function (app, b) { return since(app, b, "blocked") > 0; } },
        { id: "home", title: "Back to Home", target: "#btn-home",
          body: "<p><b>Home</b> brings the arm back to its ready pose — arm raised, tool pointing down — with a smooth joint move. It's the safe starting point for most tasks.</p><p><b>Stop</b> (below the sequence buttons) halts any running motion immediately.</p>",
          task: "Press Home.",
          check: function (app, b) { return since(app, b, "done-HOME") > 0; },
          doit: { label: "Press it for me", run: function (app) { app.click("btn-home"); } } },
        { id: "drag", title: "Drag the tool — the arm follows", target: "#stage",
          body: "<p>The coloured arrows at the gripper tip are the <b>target handle</b>. Drag an arrow to move the tool along that axis (red = X, green = Y, blue = Z), or drag the ball to move it freely.</p>" +
                "<p>The arm follows by itself: for every new tool position Linkage solves <b>inverse kinematics</b> — working backwards from where the tool should be to the six joint angles that put it there — and moves the joints at their real speeds. If the handle turns red, that spot is out of reach or would collide.</p>",
          task: "Drag the target handle at least 10 cm.",
          enter: function (app) { app.ensureFollow(true); },
          base: function (app) { return { t: app.targetPos() }; },
          check: function (app, b) { return dist3(app.targetPos(), b.t) > 0.1; } },
        { id: "pick", title: "Pick & place", target: "#btn-pickplace",
          body: "<p><b>Pick &amp; Place</b> picks up the yellow block and puts it on the other ring. It's done for real: the block is a physics object, its position and angle are read from the simulation, the gripper lines up with how it's lying, and it's carried and let go — press it again and it carries the block back.</p>" +
                "<p>Watch the sequence: approach from above, straight down, grip, lift, travel, set down, release, retreat.</p>",
          task: "Run Pick & Place and let it finish.",
          check: function (app, b) { return since(app, b, "done-PICK & PLACE") > 0; },
          doit: { label: "Press it for me", run: function (app) { app.click("btn-pickplace"); } } },
        { id: "blocks", title: "Physics blocks", target: "#btn-drop",
          body: "<p><b>Drop Block</b> drops a 5 cm cube onto the table; they tumble, stack and settle under real rigid-body physics. The arm is solid too, so you can push blocks around with it — drag the target handle through a block and watch it shove it aside. <b>Clear Blocks</b> tidies up.</p>",
          task: "Drop three blocks.",
          base: function (app) { return { n: app.flag("drop") }; },
          check: function (app, b) { return app.flag("drop") - b.n >= 3; } },
        { id: "done", title: "Basic level complete",
          body: "<p>You can now move the camera, drive every joint, read the tool position, use the gripper, rely on the collision guard, drag the tool with inverse kinematics and run a physical pick &amp; place.</p>" +
                "<p><b>Next:</b> the <b>Intermediate</b> level covers planned motions (joint vs straight-line moves), speed and motion plots, singularities, robot models and writing your own programs.</p>" }
      ]
    },

    {
      id: "intermediate", name: "Intermediate", tagline: "Plan motions & write programs", minutes: 20,
      learn: ["Set exact targets and compare joint moves with straight-line moves", "Understand speed limits, timing and motion plots",
              "Draw a circle, find the arm's alternative configurations and its singularities", "Switch robot models",
              "Build, run, save and share a program — and export it for a real UR robot"],
      setup: function (app) { app.reset("UR5e"); },
      steps: [
        { id: "intro", title: "Planning motions",
          body: "<p>In the Basic level the arm followed you live. Real robots are usually <b>programmed</b>: you decide target poses, then the controller plans a motion to each one. This level shows the kinds of motion, how they're timed, and how to put them together into a program.</p><p>About 20 minutes.</p>" },
        { id: "follow-off", title: "Plan first, then move", target: "#follow-switch",
          body: "<p><b>Follow live</b> makes the arm chase the target handle. Switch it off and the handle becomes a <b>ghost target</b>: you can place it anywhere, and the arm stays put until you tell it how to get there.</p>" +
                "<p>The six boxes below it set the target exactly: <b>X, Y, Z</b> in metres and <b>Roll, Pitch, Yaw</b> in degrees. <b>Point tool down</b> keeps the position but aims the tool straight down; <b>Target = tool</b> snaps the target back onto the tool.</p>",
          task: "Switch Follow live off.",
          check: function (app) { return !app.follow(); },
          doit: { label: "Switch it off", run: function (app) { app.ensureFollow(false); } } },
        { id: "set-target", title: "Place a target", target: "#tx",
          body: "<p>Move the target 20 cm to the side: add <b>0.2</b> to <b>Y</b> (type it and press Enter), or drag the handle. The arm doesn't move yet — the handle alone shows where it will go.</p>",
          task: "Move the target at least 10 cm away from the tool.",
          check: function (app) { return dist3(app.targetPos(), app.tcp()) > 0.1; },
          doit: { label: "Place it for me", run: function (app) { app.offsetTarget([0, 0.2, 0]); } } },
        { id: "movej", title: "Move J — a joint move", target: "#btn-movej",
          body: "<p><b>Move J</b> interpolates the <em>joint angles</em>: every joint turns from its start angle to its goal angle, all starting and finishing together. It's the fastest, most natural motion for the motors — but the tool's path through space is <b>curved</b>.</p>" +
                "<p>The <b>tip trace</b> is on, so you'll see the path the tool takes.</p>",
          task: "Press Move J.",
          enter: function (app) { app.ensureToggle("trace-switch", true); },
          check: function (app, b) { return since(app, b, "move-joint") > 0 && dist3(app.targetPos(), app.tcp()) < 0.002; },
          doit: { label: "Press it for me", run: function (app) { app.click("btn-movej"); } } },
        { id: "movel", title: "Move L — a straight line", target: "#btn-movel",
          body: "<p>Now set another target (add 0.2 to <b>X</b>, or use the button below) and press <b>Move L</b>. A linear move keeps the tool on a <b>perfectly straight line</b> — Linkage solves the inverse kinematics hundreds of times along the way.</p>" +
                "<p>Use Move L near parts and fixtures, where the tool must approach in a predictable line; use Move J for free travel. Move L is refused if the line leaves the reachable space, would collide, or passes through a singularity — you'll see why in a few steps.</p>",
          task: "Run a Move L to a new target.",
          check: function (app, b) { return since(app, b, "move-linear") > 0; },
          doit: { label: "Set target + Move L", run: function (app) { app.offsetTarget([0.15, 0, 0]); setTimeout(function () { app.click("btn-movel"); }, 300); } } },
        { id: "speed", title: "Speed and timing", target: "#speed",
          body: "<p>Every joint of a UR5e can turn at most 180°/s and has an acceleration limit. Linkage times each motion so <b>no joint breaks its limits</b>: it speeds up, cruises and slows down (a <em>trapezoidal</em> speed profile), and in a Move J the slowest joint sets the pace while the others slow down to finish at the same moment.</p>" +
                "<p>The Speed slider scales everything. Try 100%.</p>",
          task: "Set Speed to 100%.",
          check: function (app) { return app.speed() >= 0.99; } },
        { id: "plots", title: "See the motion", target: "#plot-switch",
          body: "<p>Switch on <b>Joint plots</b> and choose the <b>Speed</b> tab, then run <b>Wave</b>. Each coloured line is one joint; you'll see the flat-topped trapezoids and the dashed lines at the 180°/s limit. <b>Position</b> shows angles, <b>Accel</b> the acceleration spikes at the start and end of each move.</p>",
          task: "Open the plots on the Speed tab and run Wave.",
          enter: function (app) { app.ensureToggle("plot-switch", true); app.plotTab("vel"); },
          check: function (app, b) { return app.plotOn() && since(app, b, "done-WAVE") > 0; },
          doit: { label: "Run Wave", run: function (app) { app.click("btn-wave"); } } },
        { id: "circle", title: "Move C — arcs and circles", target: "#btn-circle",
          body: "<p>The third motion type, <b>Move C</b>, sends the tool along a circular arc through a via point. <b>Draw circle</b> uses two arcs to trace a 10 cm circle around the current tool position — look at the tip trace afterwards: it closes exactly on its starting point.</p>",
          task: "Press Draw circle.",
          enter: function (app) { app.ensureToggle("plot-switch", false); },
          check: function (app, b) { return since(app, b, "done-MOVE C") > 0; },
          doit: { label: "Press it for me", run: function (app) { app.click("btn-circle"); } } },
        { id: "configs", title: "Same tool pose, different arm", target: "#btn-config",
          body: "<p>A 6-axis arm can usually reach the same tool position and orientation in up to <b>8 different ways</b>: shoulder left or right, elbow up or down, wrist flipped or not. Linkage's solver finds all eight exactly and normally picks the one closest to where the arm already is.</p>" +
                "<p><b>Next IK config</b> moves to another of them — watch the tool stay perfectly still while the rest of the arm rearranges.</p>",
          task: "Press Next IK config.",
          check: function (app, b) { return since(app, b, "done-RECONFIGURE") > 0; },
          doit: { label: "Press it for me", run: function (app) { app.click("btn-config"); } } },
        { id: "singular", title: "Singularities", target: ".hud",
          body: "<p>Watch the <b>Dexterity</b> meter. When the arm is fully stretched (or two wrist axes line up) it hits a <b>singularity</b>: the tool can no longer move in some direction, and small tool motions would need huge joint speeds. The meter drops towards 0% and a warning appears.</p>" +
                "<p>Stretch the arm straight up: Shoulder −90°, Elbow 0°. That's also why a Move L through such a pose is refused.</p>",
          task: "Get the dexterity below 10%.",
          check: function (app) { return app.dexterity() < 0.1; },
          doit: { label: "Stretch it for me", run: function (app) { app.moveJointsDeg([0, -90, 0, -90, 0, 0]); } } },
        { id: "models", title: "Other robots", target: "#model-sel",
          body: "<p>The <b>Robot</b> menu switches between the UR e-Series: <b>UR3e</b> (500 mm reach), <b>UR5e</b> (850 mm), <b>UR16e</b> (900 mm, heavy payload) and <b>UR10e</b> (1300 mm). Each uses its published dimensions, masses and joint torques; the table, work sites and camera scale to fit.</p>" +
                "<p>(The URDF entries let you load other arms — that's in the Advanced level.)</p>",
          task: "Switch to another model, then back to UR5e.",
          check: function (app, b) { return since(app, b, "model") >= 2 && app.modelKey() === "UR5e"; },
          doit: { label: "Show me the UR10e", run: function (app) { app.setModel("UR10e"); setTimeout(function () { app.setModel("UR5e"); }, 2500); } } },
        { id: "demo", title: "Programs", target: "#prog-list",
          body: "<p>The <b>Program</b> panel is a small teach pendant. A program is a list of <b>waypoints</b>; each row has:</p>" +
                "<ul><li>the <b>move type</b> used to get there (Move J or Move L),</li><li>a <b>gripper action</b> on arrival (open, grip, or none),</li><li>a <b>speed</b> in %,</li><li>buttons to go there now (▶), reorder (↑ ↓) or delete (✕).</li></ul>" +
                "<p><b>Load demo</b> fills in a 7-waypoint pick &amp; place written as a program.</p>",
          task: "Press Load demo.",
          check: function (app) { return app.progLength() >= 7; },
          doit: { label: "Load it", run: function (app) { app.click("prog-demo"); } } },
        { id: "run", title: "Run the program", target: "#prog-run",
          body: "<p>Press <b>Run</b>. The current waypoint is highlighted in green as the arm works through the list; if a waypoint would collide, the program stops and names it. Switch on <b>Loop</b> to repeat it forever (press Stop to end).</p>",
          task: "Run the program to the end.",
          check: function (app, b) { return since(app, b, "done-PROGRAM") > 0; },
          doit: { label: "Run it", run: function (app) { app.click("prog-run"); } } },
        { id: "add", title: "Teach your own waypoint", target: "#prog-add",
          body: "<p>Teaching a robot usually means: pose the arm, then record that pose. Move the arm anywhere (sliders or the handle) and press <b>+ Waypoint</b>. It's added at the end — set its move type and speed in its row.</p>",
          task: "Add a waypoint.",
          base: function (app) { return { n: app.progLength() }; },
          check: function (app, b) { return app.progLength() > b.n; },
          doit: { label: "Add one", run: function (app) { app.click("prog-add"); } } },
        { id: "share", title: "Save, export and share", target: "#prog-share",
          body: "<p>Your program is saved in this browser automatically. To take it elsewhere:</p>" +
                "<ul><li><b>Export JSON</b> downloads it; <b>Import JSON</b> loads it back.</li><li><b>URScript</b> downloads it as a program for a <b>real UR controller</b> (joint moves become <code>movej</code>, linear moves <code>movel</code>; the gripper actions are left as comments for your gripper's commands). Always test on a real robot at low speed first.</li><li><b>Share link</b> copies a link that reopens this robot, pose, program and obstacles for anyone.</li></ul>",
          task: "Press Share link.",
          check: function (app, b) { return since(app, b, "share") > 0; } },
        { id: "done", title: "Intermediate level complete",
          body: "<p>You've used all three motion types, seen how they're timed within the joints' limits, found the arm's alternative configurations and singularities, switched robots, and built, run and shared a program.</p><p><b>Next:</b> the <b>Advanced</b> level — collision models, obstacles and path planning, physics, torques, the learning overlays, importing other robots (URDF) and connecting to ROS.</p>" }
      ]
    },

    {
      id: "advanced", name: "Advanced", tagline: "Safety, physics, dynamics & integration", minutes: 25,
      learn: ["See the collision model and test the guard", "Add obstacles and watch the path planner route around them",
              "Push objects with the solid arm; read motor torques and payload effects", "Use the learning overlays: joint frames, DH table, workspace, dexterity ellipsoid",
              "Import another robot from a URDF file", "Connect Linkage to ROS"],
      setup: function (app) { app.reset("UR5e"); },
      steps: [
        { id: "intro", title: "Under the hood",
          body: "<p>This level opens up how the simulator works: the geometry it checks for collisions, the planner that finds its way around obstacles, the physics and the forces in the motors, and how to bring in other robots or connect to ROS. About 25 minutes.</p>" },
        { id: "capsules", title: "The collision model", target: "#caps-switch",
          body: "<p>Switch on <b>Collision capsules</b>. Each link is modelled as a <b>capsule</b> (a cylinder with rounded ends); two parts collide if their capsules are closer than the sum of their radii. That's fast enough to check thousands of poses per second — which the planner relies on.</p>" +
                "<p>The same capsules are the arm's solid body in the physics engine, so what you see is exactly what's checked.</p>",
          task: "Switch the capsules on.",
          check: function (app) { return app.toggleOn("caps-switch"); },
          doit: { label: "Switch on", run: function (app) { app.ensureToggle("caps-switch", true); } } },
        { id: "guard-off", title: "Guard off: see a collision", target: "#guard-switch",
          body: "<p>Switch the <b>collision guard off</b> and drive the Shoulder towards +40°: the arm now goes into the table and the colliding capsules turn red, with the reason in the telemetry panel.</p><p>With the guard back on, the arm may always move <em>out</em> of a collision (so you can recover), but never into one.</p>",
          task: "Turn the guard off, then back on.",
          check: function (app, b) { return since(app, b, "guard-off") > 0 && app.guard(); } },
        { id: "obstacle", title: "Obstacles", target: "#btn-obstacle",
          body: "<p><b>Add obstacle</b> puts a box on the table — the first one stands right between the two pick &amp; place sites. Obstacles are seen by the collision guard, by the planner and by the physics (blocks land on them).</p>",
          task: "Add an obstacle.",
          enter: function (app) { app.ensureToggle("caps-switch", false); if (!app.guard()) app.click("guard-switch"); app.home(); },
          check: function (app) { return app.obstacleCount() > 0; },
          doit: { label: "Add one", run: function (app) { app.click("btn-obstacle"); } } },
        { id: "plan", title: "Planning around obstacles", target: "#btn-pickplace",
          body: "<p>Run <b>Pick &amp; Place</b>. The direct joint move from site to site would go through the box, so the <b>path planner</b> steps in: it uses <b>RRT-Connect</b>, which grows two trees of random collision-free arm poses — one from the start, one from the goal — until they meet, then shortens the result. It usually takes a few milliseconds.</p>" +
                "<p>The dashed orange line shows the planned route of the tool; the message says how many segments it found.</p>",
          task: "Run Pick & Place with the obstacle in place.",
          check: function (app, b) { return since(app, b, "planned") > 0 && since(app, b, "done-PICK & PLACE") > 0; },
          doit: { label: "Run it", run: function (app) { app.click("btn-pickplace"); } } },
        { id: "plan-off", title: "What planning is doing for you", target: "#plan-switch",
          body: "<p>Switch <b>Plan around obstacles</b> off and try Pick &amp; Place again: without a plan the arm heads straight for the box and the collision guard stops it mid-move. Switch planning back on before you continue.</p>",
          task: "Turn planning off, then back on.",
          check: function (app, b) { return since(app, b, "plan-off") > 0 && app.plan(); } },
        { id: "push", title: "A solid arm", target: "#btn-drop",
          body: "<p>Physics runs on <b>Rapier</b>, a real rigid-body engine. The arm's links and fingers are in the simulation as moving solid bodies, so they push things. Press <b>Do it for me</b>: a block appears on the table and the arm sweeps through it — watch it get shoved aside.</p>",
          task: "Push a block with the arm.",
          enter: function (app) { app.click("btn-clear-obstacles"); },
          check: function (app, b) { return since(app, b, "pushed") > 0; },
          doit: { label: "Do it for me", run: function (app) { app.pushDemo(); } } },
        { id: "load", title: "Motor load", target: "#hud-loads",
          body: "<p>The <b>Motor load</b> bars show the torque each joint must produce just to <b>hold the arm still against gravity</b>, computed from the robot's published link masses and centres of mass (plus the gripper and anything it holds), compared with each joint's rated torque (150 N·m for a UR5e's big joints, 28 N·m for the wrists).</p>" +
                "<p>Stretch the arm out horizontally and the shoulder load climbs; point it straight up and it almost vanishes.</p>",
          task: "Get the shoulder (J2) load above 30% of its rating.",
          check: function (app) { return Math.abs(app.loadFraction(1)) > 0.3; },
          doit: { label: "Stretch it out", run: function (app) { app.moveJointsDeg([0, -10, 10, -90, 0, 0]); } } },
        { id: "torque", title: "Torque over time, with a payload", target: "#plot",
          body: "<p>The <b>Torque</b> tab of the joint plots draws each joint's holding torque as a percentage of its rating over time (dashed lines at 100%). Run Pick &amp; Place and look for the small step when the gripper picks up the 0.12 kg part — the panel title also says when it's holding something.</p>",
          task: "Open the Torque tab.",
          enter: function (app) { app.home(); app.ensureToggle("plot-switch", true); },
          check: function (app) { return app.plotOn() && app.plotTabName() === "tau"; },
          doit: { label: "Open it", run: function (app) { app.plotTab("tau"); } } },
        { id: "learn", title: "Learning overlays", target: "#frames-switch",
          body: "<p>The <b>Learn</b> section is for understanding the maths:</p>" +
                "<ul><li><b>Joint frames</b>: the coordinate frame of every joint (red X, green Y, blue Z) as defined by the Denavit–Hartenberg convention.</li><li>The <b>DH table</b> below: the four numbers per joint that define the whole geometry — the θ column updates live.</li><li><b>Reachable workspace</b>: 6,000 random collision-free poses, coloured from blue (awkward) to yellow-green (dexterous).</li><li><b>Dexterity ellipsoid</b>: at the tool, its longest axis is the direction the tool moves most easily; it flattens near singularities.</li></ul>",
          task: "Switch on at least two overlays.",
          enter: function (app) { app.ensureToggle("plot-switch", false); },
          check: function (app) { return ["frames-switch", "ws-switch", "ell-switch"].filter(function (id) { return app.toggleOn(id); }).length >= 2; } },
        { id: "render", title: "Rendering quality", target: "#ao-switch",
          body: "<p>Linkage renders with image-based lighting, soft shadows and <b>ambient occlusion</b> (soft contact shadows where parts meet). On a slow device it switches ambient occlusion off by itself to keep motion smooth; this switch lets you choose. The page also only redraws when something moves, to save battery.</p>" },
        { id: "urdf", title: "Import another robot (URDF)", target: "#model-sel",
          body: "<p><b>URDF</b> is the standard robot description format in ROS. From the Robot menu, pick <b>Spherical-wrist 6R (sample URDF)</b> — an industrial-style arm whose last three axes meet at a point, unlike the UR's offset wrist.</p>" +
                "<p>For imported arms Linkage reads the joints, limits, tool frame and masses from the file and solves inverse kinematics <b>numerically</b> (damped least squares). Everything else — dragging, Move L, programs, planning, physics, torques — works the same.</p>",
          task: "Load the spherical-wrist sample.",
          enter: function (app) { ["frames-switch", "ws-switch", "ell-switch"].forEach(function (id) { app.ensureToggle(id, false); }); },
          check: function (app) { return app.modelKey() === "urdf:spherical_wrist_6r.urdf"; },
          doit: { label: "Load it", run: function (app) { app.setModel("urdf:spherical_wrist_6r.urdf"); } } },
        { id: "urdf-own", title: "Your own URDF files",
          body: "<p>Choose <b>Load a URDF file…</b> to open your own. What works:</p>" +
                "<ul><li>Arms with <b>6 revolute joints</b> in a chain (fixed joints in between are fine; extra branches such as gripper fingers are ignored).</li><li>A link called <code>tool0</code>, <code>flange</code> or <code>ee_link</code> is used as the tool flange (tool Z pointing out).</li><li><code>&lt;inertial&gt;</code> masses feed the torque readout; <code>&lt;limit&gt;</code> sets joint ranges.</li></ul>" +
                "<p>Not supported: mesh files (links are drawn as capsules), 7-joint arms and sliding (prismatic) joints in the arm. A file that doesn't fit is refused with the reason.</p>",
          enter: function (app) { } },
        { id: "ros", title: "Connect to ROS", target: "#ros-url",
          body: "<p>Linkage can mirror or be driven by <b>ROS</b> through <code>rosbridge</code>. On your ROS 2 machine:</p>" +
                "<pre>ros2 launch rosbridge_server rosbridge_websocket_launch.xml</pre>" +
                "<p>then press <b>Connect</b> (default <code>ws://localhost:9090</code>). Linkage publishes <code>/joint_states</code> and <code>/linkage/tcp_pose</code> 20 times a second:</p><pre>ros2 topic echo /joint_states</pre>" +
                "<p>With <b>Follow joint commands</b> on, it moves to joint angles you publish (radians, UR joint names), through the collision guard:</p>" +
                "<pre>ros2 topic pub --once /linkage/joint_command sensor_msgs/msg/JointState \"{name: [shoulder_pan_joint, shoulder_lift_joint, elbow_joint, wrist_1_joint, wrist_2_joint, wrist_3_joint], position: [0.5, -1.2, 1.4, -1.8, -1.57, 0]}\"</pre>" +
                "<p>From this https page a remote bridge needs <code>wss://</code>; <code>ws://localhost</code> works as is. There's a ROS 1 option in the menu too.</p>",
          enter: function (app) { app.setModel("UR5e"); } },
        { id: "done", title: "Advanced level complete",
          body: "<p>That's everything: collision model, obstacles and planning, physics, torques, the learning overlays, URDF import and ROS.</p>" +
                "<p>If you want to go deeper, the code is split into small, tested pieces — <code>kinematics.js</code>, <code>motion.js</code>, <code>planner.js</code>, <code>urdf.js</code> — each with unit tests in <code>tests/</code>, and the README explains how they fit together. The <b>GitHub</b> link is in the project list.</p>" }
      ]
    }
  ];

  // ------------------------------------------------------------------ engine
  var app, ui = {}, run = null, tick = 0, prog = {};
  function save() { try { localStorage.setItem("linkage-tutorial", JSON.stringify(prog)); } catch (e) {} }
  function load() { try { prog = JSON.parse(localStorage.getItem("linkage-tutorial") || "{}") || {}; } catch (e) { prog = {}; } }
  function lv(id) { return LEVELS.filter(function (l) { return l.id === id; })[0]; }
  function doneSet(id) { prog[id] = prog[id] || { done: [], at: 0 }; return prog[id]; }
  function stepDone(level, step) { return doneSet(level.id).done.indexOf(step.id) >= 0; }
  function countDone(level) { var d = doneSet(level.id).done; return level.steps.filter(function (s) { return d.indexOf(s.id) >= 0; }).length; }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function build() {
    // chooser
    ui.chooser = el("div", "tut-modal"); ui.chooser.hidden = true;
    ui.chooser.setAttribute("role", "dialog"); ui.chooser.setAttribute("aria-modal", "true"); ui.chooser.setAttribute("aria-label", "Choose a tutorial level");
    document.body.appendChild(ui.chooser);
    ui.chooser.addEventListener("click", function (e) { if (e.target === ui.chooser) closeChooser(); });
    // step panel
    ui.panel = el("section", "tut-panel"); ui.panel.hidden = true;
    ui.panel.setAttribute("role", "dialog"); ui.panel.setAttribute("aria-label", "Tutorial step");
    ui.panel.innerHTML =
      '<div class="tut-top"><span class="tut-level"></span><span class="tut-count"></span><button class="tut-x" type="button" aria-label="Close the tutorial">×</button></div>' +
      '<div class="tut-bar"><i></i></div>' +
      '<h3 class="tut-title"></h3><div class="tut-body"></div>' +
      '<div class="tut-task" aria-live="polite"><span class="tut-tick"></span><span class="tut-task-text"></span></div>' +
      '<div class="tut-nav"><button class="tut-btn tut-do" type="button"></button><span class="tut-grow"></span>' +
      '<button class="tut-btn tut-back" type="button">← Back</button><button class="tut-btn primary tut-next" type="button">Next →</button></div>';
    document.body.appendChild(ui.panel);
    ui.spot = el("div", "tut-spot"); ui.spot.hidden = true; document.body.appendChild(ui.spot);
    ui.panel.querySelector(".tut-x").addEventListener("click", close);
    ui.panel.querySelector(".tut-back").addEventListener("click", function () { go(run.i - 1); });
    ui.panel.querySelector(".tut-next").addEventListener("click", function () {
      if (run.i >= run.level.steps.length - 1) { finish(); } else go(run.i + 1);
    });
    ui.panel.querySelector(".tut-do").addEventListener("click", function () { var s = run.level.steps[run.i]; if (s.doit) s.doit.run(app); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { if (!ui.chooser.hidden) closeChooser(); else if (!ui.panel.hidden) close(); }
    });
    window.addEventListener("resize", placeSpot);
    // follow any scrolling (the control rail scrolls smoothly to bring a control into view)
    document.addEventListener("scroll", placeSpot, true);
    setInterval(poll, 300);
  }

  function openChooser(mode) {
    load();
    var h = '<div class="tut-card"><div class="tut-top"><h2>Linkage tutorial</h2><button class="tut-x" type="button" aria-label="Close">×</button></div>';
    if (mode && mode.guide) {
      var L = lv(mode.guide);
      h += '<p class="tut-lead"><b>' + L.name + '</b> — ' + L.tagline + ' · written guide (' + L.steps.length + ' steps)</p><div class="tut-guide">';
      L.steps.forEach(function (s, i) {
        h += '<article><h3>' + (i + 1) + '. ' + s.title + '</h3>' + s.body + (s.task ? '<p class="tut-g-task"><b>Try it:</b> ' + s.task + '</p>' : '') + '</article>';
      });
      h += '</div><div class="tut-nav"><button class="tut-btn tut-back-levels" type="button">← All levels</button><span class="tut-grow"></span><button class="tut-btn primary tut-start" data-level="' + L.id + '" type="button">Start interactive →</button></div>';
    } else {
      h += '<p class="tut-lead">Pick a level. Each step shows you where to look, explains what\'s going on and gives you something to try — it ticks itself off when you\'ve done it. Your progress is saved in this browser.</p><div class="tut-levels">';
      LEVELS.forEach(function (L) {
        var n = countDone(L), started = n > 0 || doneSet(L.id).at > 0;
        h += '<div class="tut-lvl tut-lvl-' + L.id + '"><div class="tut-lvl-head"><b>' + L.name + '</b><span>~' + L.minutes + ' min · ' + L.steps.length + ' steps</span></div>' +
          '<p class="tut-tag">' + L.tagline + '</p><ul>' + L.learn.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
          '<div class="tut-lvl-bar" title="' + n + ' of ' + L.steps.length + ' steps done"><i style="width:' + (n / L.steps.length * 100).toFixed(0) + '%"></i></div>' +
          '<div class="tut-lvl-actions"><button class="tut-btn primary tut-start" data-level="' + L.id + '" type="button">' + (started ? (n === L.steps.length ? 'Do it again' : 'Resume') : 'Start') + '</button>' +
          '<button class="tut-btn tut-read" data-level="' + L.id + '" type="button">Read as guide</button></div></div>';
      });
      h += '</div><p class="tut-note">Starting a level switches to the UR5e in its home pose and clears obstacles, so the steps match what you see. Your program is kept.</p>';
    }
    h += '</div>';
    ui.chooser.innerHTML = h;
    ui.chooser.hidden = false;
    ui.chooser.querySelector(".tut-x").addEventListener("click", closeChooser);
    Array.prototype.forEach.call(ui.chooser.querySelectorAll(".tut-start"), function (b) { b.addEventListener("click", function () { start(this.dataset.level); }); });
    Array.prototype.forEach.call(ui.chooser.querySelectorAll(".tut-read"), function (b) { b.addEventListener("click", function () { openChooser({ guide: this.dataset.level }); }); });
    var back = ui.chooser.querySelector(".tut-back-levels");
    if (back) back.addEventListener("click", function () { openChooser(); });
    var first = ui.chooser.querySelector(".tut-start"); if (first) first.focus();
  }
  function closeChooser() { ui.chooser.hidden = true; }

  function start(levelId) {
    var L = lv(levelId);
    closeChooser();
    L.setup(app);
    var d = doneSet(L.id), at = d.done.length >= L.steps.length ? 0 : Math.min(d.at || 0, L.steps.length - 1);
    run = { level: L, i: -1 };
    ui.panel.hidden = false;
    go(at);
  }
  function go(i) {
    var L = run.level;
    i = Math.max(0, Math.min(L.steps.length - 1, i));
    run.i = i;
    var s = L.steps[i];
    doneSet(L.id).at = i; save();
    if (s.enter) s.enter(app);
    run.base = s.base ? s.base(app) : {};
    run.base.flags = app.flagSnapshot();
    run.justDone = false;
    var P = ui.panel;
    P.querySelector(".tut-level").textContent = L.name;
    P.querySelector(".tut-level").className = "tut-level tut-lvl-" + L.id;
    P.querySelector(".tut-count").textContent = "Step " + (i + 1) + " of " + L.steps.length;
    P.querySelector(".tut-bar i").style.width = ((i + 1) / L.steps.length * 100).toFixed(1) + "%";
    P.querySelector(".tut-title").textContent = s.title;
    P.querySelector(".tut-body").innerHTML = s.body;
    P.querySelector(".tut-body").scrollTop = 0;
    var task = P.querySelector(".tut-task");
    task.hidden = !s.task;
    P.querySelector(".tut-task-text").textContent = s.task || "";
    var doB = P.querySelector(".tut-do");
    doB.hidden = !s.doit; doB.textContent = s.doit ? s.doit.label : "";
    P.querySelector(".tut-back").disabled = i === 0;
    P.querySelector(".tut-next").textContent = i === L.steps.length - 1 ? "Finish ✓" : "Next →";
    // steps without a task count as done when shown
    if (!s.task) markDone(s);
    renderTask();
    // bring the highlighted control into view (it may be further down the control rail)
    var t = s.target && document.querySelector(s.target);
    if (t && t.closest && t.closest(".rail")) t.scrollIntoView({ block: "center", behavior: "smooth" });
    placeSpot();
    setTimeout(placeSpot, 450);
  }
  function markDone(s) {
    var d = doneSet(run.level.id);
    if (d.done.indexOf(s.id) < 0) { d.done.push(s.id); save(); }
  }
  function renderTask() {
    var s = run.level.steps[run.i], ok = stepDone(run.level, s), P = ui.panel;
    var task = P.querySelector(".tut-task");
    task.classList.toggle("ok", ok);
    P.querySelector(".tut-tick").textContent = ok ? "✓" : "○";
    P.querySelector(".tut-next").classList.toggle("pulse", ok && !!s.task && run.justDone);
  }
  function poll() {
    if (!run || ui.panel.hidden) return;
    tick++;
    var s = run.level.steps[run.i];
    if (s.task && s.check && !stepDone(run.level, s)) {
      var ok = false;
      try { ok = !!s.check(app, run.base); } catch (e) { ok = false; }
      if (ok) { markDone(s); run.justDone = true; renderTask(); }
    }
    placeSpot();
  }
  function placeSpot() {
    if (!run || ui.panel.hidden) { ui.spot.hidden = true; return; }
    var s = run.level.steps[run.i], t = s.target && document.querySelector(s.target);
    if (!t || t.offsetParent === null) { ui.spot.hidden = true; return; }
    var r = t.getBoundingClientRect(), pad = 6;
    if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) { ui.spot.hidden = true; return; }
    ui.spot.hidden = false;
    ui.spot.style.left = (r.left - pad) + "px"; ui.spot.style.top = (r.top - pad) + "px";
    ui.spot.style.width = (r.width + pad * 2) + "px"; ui.spot.style.height = (r.height + pad * 2) + "px";
  }
  function finish() {
    var L = run.level;
    L.steps.forEach(function (s) { if (!s.task) markDone(s); });
    close();
    openChooser();
  }
  function close() { ui.panel.hidden = true; ui.spot.hidden = true; run = null; }

  function init(appApi) {
    app = appApi;
    load();
    build();
    return {
      open: openChooser, start: start, close: close, levels: LEVELS,
      state: function () { return run ? { level: run.level.id, step: run.i, id: run.level.steps[run.i].id, done: stepDone(run.level, run.level.steps[run.i]) } : null; },
      go: function (i) { if (run) go(i); }
    };
  }
  root.LinkageTutorial = { init: init, LEVELS: LEVELS };
})(window);
