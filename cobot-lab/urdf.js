/* Cobot Lab — URDF import (6-joint serial arms).
 *
 * A small, dependency-free URDF reader (works in the browser and under Node): parses the
 * XML, walks the kinematic tree from the root link along the branch with the most moving
 * joints, and returns a Cobot Lab robot model with a generic joint chain:
 *   chain.joints[i] = { name, origin (4x4 fixed transform before the joint), axis, lo, hi }
 *   chain.flange    = fixed transform from the 6th joint's child link to the tool flange
 *                     (the frame of a link named tool0 / flange / ee_link if the file has one)
 * plus masses and centres of mass from <inertial>, limits from <limit>. Meshes are not loaded:
 * Cobot Lab draws the links as capsules between the joints.
 * Browser global window.CobotLabURDF, or CommonJS.
 */
(function (root) {
  "use strict";
  var K = (typeof module !== "undefined" && module.exports) ? require("./kinematics.js") : root.CobotLabKin;

  // ---- a tiny XML reader: elements with attributes and children (text is ignored)
  function parseXML(text) {
    text = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<!DOCTYPE[^>]*>/gi, "");
    var re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g, m;
    var rootEl = { tag: "#root", attrs: {}, children: [] }, stack = [rootEl];
    while ((m = re.exec(text))) {
      if (m[1]) {                                         // closing tag
        var top = stack.pop();
        if (!top || top.tag !== m[2]) throw new Error("malformed XML near </" + m[2] + ">");
        continue;
      }
      var el = { tag: m[2], attrs: {}, children: [] }, am, are = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      while ((am = are.exec(m[3]))) el.attrs[am[1]] = am[3] !== undefined ? am[3] : am[4];
      stack[stack.length - 1].children.push(el);
      if (!m[4]) stack.push(el);
    }
    if (stack.length !== 1) throw new Error("malformed XML: <" + stack[stack.length - 1].tag + "> is never closed");
    return rootEl;
  }
  function kids(el, tag) { return el.children.filter(function (c) { return c.tag === tag; }); }
  function kid(el, tag) { return kids(el, tag)[0] || null; }
  function nums(s, n, def) {
    if (s == null) return def.slice();
    var v = s.trim().split(/[\s,]+/).map(Number);
    if (v.length !== n || v.some(function (x) { return !isFinite(x); })) throw new Error('bad numbers "' + s + '"');
    return v;
  }
  function originOf(el) {
    var o = el && kid(el, "origin");
    var xyz = nums(o && o.attrs.xyz, 3, [0, 0, 0]), rpy = nums(o && o.attrs.rpy, 3, [0, 0, 0]);
    return K.poseFromRPY(xyz[0], xyz[1], xyz[2], rpy[0], rpy[1], rpy[2]);
  }

  function parseURDF(text, opts) {
    opts = opts || {};
    var doc = parseXML(text), robotEl = kid(doc, "robot");
    if (!robotEl) throw new Error("no <robot> element — is this a URDF file?");
    var links = {}, joints = [];
    kids(robotEl, "link").forEach(function (l) { links[l.attrs.name] = l; });
    kids(robotEl, "joint").forEach(function (j) {
      var p = kid(j, "parent"), c = kid(j, "child");
      if (!p || !c) throw new Error('joint "' + j.attrs.name + '" has no parent/child');
      joints.push({ el: j, name: j.attrs.name, type: j.attrs.type, parent: p.attrs.link, child: c.attrs.link });
    });
    if (!joints.length) throw new Error("the URDF has no joints");
    var childOf = {}; joints.forEach(function (j) { childOf[j.child] = j; });
    var rootLink = Object.keys(links).filter(function (n) { return !childOf[n]; })[0] || joints[0].parent;
    var MOVING = { revolute: 1, continuous: 1 };
    // the path from a link with the most revolute joints (so a gripper-finger branch doesn't
    // win over the arm)
    function best(link) {
      var out = { moving: 0, path: [] };
      joints.filter(function (j) { return j.parent === link; }).forEach(function (j) {
        var sub = best(j.child), mv = sub.moving + (MOVING[j.type] ? 1 : 0);
        if (mv > out.moving || (mv === out.moving && !out.path.length)) out = { moving: mv, path: [j].concat(sub.path) };
      });
      return out;
    }
    var path = best(rootLink).path;
    var moving = path.filter(function (j) { return MOVING[j.type]; });
    if (moving.length !== 6) throw new Error("Cobot Lab imports 6-joint arms; this chain has " + moving.length + " revolute joints");
    // prismatic joints inside the arm aren't supported (after joint 6 they're gripper fingers: ignored)
    var i6p = path.indexOf(moving[5]);
    if (path.slice(0, i6p).some(function (j) { return j.type === "prismatic" || j.type === "floating" || j.type === "planar"; })) {
      throw new Error("the arm has a prismatic/floating joint — Cobot Lab handles arms made of revolute joints");
    }
    path = path.slice(0, i6p + 1);

    // fold fixed joints into the next moving joint's origin; the rest (after joint 6) into the flange
    var chainJoints = [], acc = K.I4(), masses = [], coms = [], jointNames = [];
    var i6 = path.indexOf(moving[5]);
    path.forEach(function (j, idx) {
      var o = originOf(j.el);
      if (MOVING[j.type]) {
        var ax = nums(kid(j.el, "axis") && kid(j.el, "axis").attrs.xyz, 3, [1, 0, 0]), n = Math.hypot(ax[0], ax[1], ax[2]);
        if (n < 1e-12) throw new Error('joint "' + j.name + '" has a zero axis');
        var lim = kid(j.el, "limit"), lo = -Math.PI, hi = Math.PI, vel = Math.PI, eff = 150;
        if (lim) {
          if (j.type === "revolute") { lo = Math.max(-Math.PI, +lim.attrs.lower || 0); hi = Math.min(Math.PI, +lim.attrs.upper || 0); }
          if (+lim.attrs.velocity > 0) vel = +lim.attrs.velocity;
          if (+lim.attrs.effort > 0) eff = +lim.attrs.effort;
        }
        if (hi - lo < 1e-6) { lo = -Math.PI; hi = Math.PI; }
        chainJoints.push({ name: j.name, origin: K.mul(acc, o), axis: [ax[0] / n, ax[1] / n, ax[2] / n], lo: lo, hi: hi, vmax: vel, tauMax: eff });
        jointNames.push(j.name);
        acc = K.I4();
        // the moving link's own inertia (in its frame, which is the joint frame after rotation)
        var inr = kid(links[j.child] || { children: [] }, "inertial");
        var m = inr && kid(inr, "mass") ? +kid(inr, "mass").attrs.value : 0;
        var io = inr && kid(inr, "origin"), com = io ? nums(io.attrs.xyz, 3, [0, 0, 0]) : [0, 0, 0];
        masses.push(isFinite(m) && m > 0 ? m : 0); coms.push(com);
      } else if (idx < i6) {
        acc = K.mul(acc, o);
      }
    });
    // flange: fixed joints after joint 6, preferring the path that ends in a tool-frame link
    var flange = K.I4(), last = moving[5].child, TOOL = /^(tool0|flange|ee_link|tool_link|end_effector|link_ee|tcp)$/i;
    function toolPath(link) {
      if (TOOL.test(link)) return [];
      var js = joints.filter(function (j) { return j.parent === link && j.type === "fixed"; });
      for (var k = 0; k < js.length; k++) { var p = toolPath(js[k].child); if (p) return [js[k]].concat(p); }
      return null;
    }
    var tp = toolPath(last);
    if (tp) tp.forEach(function (j) { flange = K.mul(flange, originOf(j.el)); });

    var any = masses.some(function (m) { return m > 0; });
    var model = {
      name: robotEl.attrs.name || "URDF robot", chain: { joints: chainJoints, flange: flange }, jointNames: jointNames,
      lo: chainJoints.map(function (j) { return j.lo; }), hi: chainJoints.map(function (j) { return j.hi; }),
      vmax: chainJoints.map(function (j) { return Math.min(j.vmax, 2 * Math.PI); }), amax: [4, 4, 4, 6, 6, 6],
      tool: opts.tool || K.UR5E.tool, tauMax: chainJoints.map(function (j) { return j.tauMax; }),
      mass: any ? masses : [3, 6, 3, 1.5, 1.5, 0.5], com: coms, gripperMass: K.UR5E.gripperMass,
      inertiaFromFile: any, toolFrameFound: !!tp, source: "urdf"
    };
    // size: reach = farthest horizontal flange distance over sampled poses (deterministic);
    // the capsule radius used for drawing and collisions scales with it
    var seed = 12345, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }, R = 0;
    for (var k = 0; k < 1500; k++) {
      var q = model.lo.map(function (lo, i) { return lo + rnd() * (model.hi[i] - lo); }), fl = K.fk(q, model).flange;
      R = Math.max(R, Math.hypot(fl[3], fl[7]));
    }
    model.reach = Math.max(0.2, R);
    model.capR = Math.max(0.025, Math.min(0.07, model.reach * 0.04));
    return model;
  }

  var api = { parseURDF: parseURDF, parseXML: parseXML };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CobotLabURDF = api;
})(typeof window !== "undefined" ? window : this);
