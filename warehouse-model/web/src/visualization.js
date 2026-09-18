/*
 * visualization.js — the 3D visualization model.
 *
 * This is explicitly NOT the FreeCAD geometry. A GLB is a baked, static
 * mesh: it cannot resize itself when a slider moves. So the live 3D view
 * you drag/zoom while dragging sliders is procedural geometry built
 * straight from the same parameters.json values and the same layout
 * numbers calculations.js just computed — same source of truth, different
 * (necessarily live) representation.
 *
 * The real FreeCAD-derived geometry is still here and still real: switch
 * to "Reference Model" to load web/models/warehouse_baseline.glb, the
 * actual tessellated export of freecad/warehouse_model.FCStd at its
 * baseline (default) parameter values. It doesn't move when you drag a
 * slider — that's the honest limit of a baked mesh — but it's proof the
 * two layers describe the same building.
 */
(function (global) {
  "use strict";

  const M = 1; // scene units are metres, 1:1 with the engineering model

  // Palette (single-hue categorical slots from the project's standard
  // dataviz palette, reused here as material colors, not chart colors).
  const COLOR = {
    structure: 0x2a4258,
    structureWire: 0x3a5570,
    rack: 0xd95926,
    rackSelected: 0xffb27a,
    dock: 0x199e70,
    zone: 0xc98500,
    highlight: 0x7dd3fc
  };

  function Visualization(stageEl) {
    this.stageEl = stageEl;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (this.renderer.outputEncoding !== undefined) this.renderer.outputEncoding = THREE.sRGBEncoding;
    stageEl.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a2f52);
    this.scene.fog = new THREE.Fog(0x0a2f52, 120, 420);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);

    const hemi = new THREE.HemisphereLight(0x9fc7ff, 0x0a2f52, 0.7);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff2e0, 1.0);
    key.position.set(80, 140, 60);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7dd3fc, 0.25);
    rim.position.set(-60, 40, -80);
    this.scene.add(rim);

    this.liveGroup = new THREE.Group();
    this.scene.add(this.liveGroup);

    this.referenceGroup = new THREE.Group();
    this.referenceGroup.visible = false;
    this.scene.add(this.referenceGroup);
    this.referenceLoaded = false;
    this.referenceLoadFailed = false;

    this.selectable = []; // meshes with userData.info, for raycasting
    this.selectedMesh = null;

    this._setupCamera();
    this._setupInput();
    this.mode = "live";

    this._onSelect = null; // callback(info|null) set by app.js
  }

  Visualization.prototype._setupCamera = function () {
    this.target = new THREE.Vector3(50, 0, 30);
    this.spherical = { theta: 0.55, phi: 1.0, radius: 170 };
    this.defaultSpherical = { theta: 0.55, phi: 1.0, radius: 170 };
    this._updateCamera();
  };

  Visualization.prototype._updateCamera = function () {
    const s = this.spherical, t = this.target;
    this.camera.position.set(
      t.x + s.radius * Math.sin(s.phi) * Math.sin(s.theta),
      t.y + s.radius * Math.cos(s.phi),
      t.z + s.radius * Math.sin(s.phi) * Math.cos(s.theta)
    );
    this.camera.lookAt(t);
  };

  Visualization.prototype.resetView = function () {
    this.spherical.theta = this.defaultSpherical.theta;
    this.spherical.phi = this.defaultSpherical.phi;
    this.spherical.radius = this.defaultSpherical.radius;
    this._updateCamera();
  };

  Visualization.prototype._setupInput = function () {
    const dom = this.renderer.domElement;
    dom.style.touchAction = "none";
    let dragging = false, lastX = 0, lastY = 0, moved = false;
    const self = this;

    dom.addEventListener("pointerdown", function (e) {
      dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener("pointerup", function (e) {
      dragging = false;
      if (!moved) self._handleClick(e);
    });
    dom.addEventListener("pointercancel", function () { dragging = false; });
    dom.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      lastX = e.clientX; lastY = e.clientY;
      self.spherical.theta -= dx * 0.005;
      self.spherical.phi -= dy * 0.005;
      self.spherical.phi = Math.max(0.15, Math.min(1.5, self.spherical.phi));
      self._updateCamera();
    });
    dom.addEventListener("wheel", function (e) {
      e.preventDefault();
      self.spherical.radius *= (1 + e.deltaY * 0.0012);
      self.spherical.radius = Math.max(20, Math.min(500, self.spherical.radius));
      self._updateCamera();
    }, { passive: false });
  };

  Visualization.prototype._handleClick = function (e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const targets = this.mode === "live" ? this.selectable : [];
    const hits = raycaster.intersectObjects(targets, false);

    if (this.selectedMesh) {
      this.selectedMesh.material.emissive.setHex(0x000000);
      this.selectedMesh = null;
    }
    if (hits.length) {
      const mesh = hits[0].object;
      mesh.material.emissive.setHex(0x0e4a66);
      this.selectedMesh = mesh;
      if (this._onSelect) this._onSelect(mesh.userData.info);
    } else if (this._onSelect) {
      this._onSelect(null);
    }
  };

  Visualization.prototype.onSelect = function (cb) { this._onSelect = cb; };

  Visualization.prototype.resize = function () {
    const w = this.stageEl.clientWidth, h = this.stageEl.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  Visualization.prototype.render = function () {
    this.renderer.render(this.scene, this.camera);
  };

  // -------------------------------------------------------------------
  // Live procedural geometry — rebuilt whenever parameters change
  // -------------------------------------------------------------------
  function disposeGroup(group) {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const obj = group.children[i];
      group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  }

  function box(w, d, h, x, y, z, color, opacity) {
    const geo = new THREE.BoxGeometry(w, h, d); // three.js Y-up: h maps to Y
    const mat = new THREE.MeshStandardMaterial({
      color: color, transparent: opacity < 1, opacity: opacity,
      roughness: 0.6, metalness: 0.1, depthWrite: opacity >= 0.9
    });
    const mesh = new THREE.Mesh(geo, mat);
    // engineering coords: x=length, y=width, z=height(up) -> scene: X, Z, Y(up)
    mesh.position.set(x + w / 2, z + h / 2, y + d / 2);
    return mesh;
  }

  Visualization.prototype.rebuildLive = function (p, results) {
    disposeGroup(this.liveGroup);
    this.selectable.length = 0;
    this.selectedMesh = null;

    const layout = results.layout;
    const WL = p.warehouse_length, WW = p.warehouse_width, WT = p.wall_thickness / 1000;
    const CH = p.clear_height;

    // Floor
    const floor = box(WL + 2 * WT, WW + 2 * WT, 0.2, -WT, -WT, -0.2, 0x11161d, 1);
    this.liveGroup.add(floor);

    // Walls (semi-transparent so interior stays visible)
    const wallOpacity = 0.16;
    this.liveGroup.add(box(WT, WW, CH, -WT, 0, 0, COLOR.structure, wallOpacity));
    this.liveGroup.add(box(WT, WW, CH, WL, 0, 0, COLOR.structure, wallOpacity));
    this.liveGroup.add(box(WL + 2 * WT, WT, CH, -WT, -WT, 0, COLOR.structure, wallOpacity));
    this.liveGroup.add(box(WL + 2 * WT, WT, CH, -WT, WW, 0, COLOR.structure, wallOpacity));
    this.liveGroup.add(box(WL + 2 * WT, WW + 2 * WT, 0.3, -WT, -WT, CH, COLOR.structure, 0.08));

    // Rack rows
    const yOffset = (WW - layout.rackingWidthUsed) / 2;
    const x0 = p.cross_aisle_width;
    let rowIndex = 1;
    for (let i = 0; i < layout.numAisleUnits; i++) {
      const unitY0 = yOffset + i * layout.widthPerAisleUnit;
      [unitY0, unitY0 + p.rack_depth + p.aisle_width].forEach((rowY) => {
        const mesh = box(layout.rackRowLength, p.rack_depth, p.rack_height, x0, rowY, 0, COLOR.rack, 0.92);
        mesh.userData.info = {
          type: "Rack row",
          name: "Rack Row " + rowIndex,
          dimensions: layout.rackRowLength.toFixed(1) + " × " + p.rack_depth.toFixed(2) + " × " + p.rack_height.toFixed(1) + " m",
          levels: p.levels_per_rack,
          bays: layout.baysPerRow,
          positions: layout.baysPerRow * results.capacity.positionsPerBay,
          material: "Steel"
        };
        this.liveGroup.add(mesh);
        this.selectable.push(mesh);
        rowIndex++;
      });
    }

    // Staging zones (flat floor decals)
    this.liveGroup.add(box(p.cross_aisle_width, WW, 0.05, 0, 0, 0.01, COLOR.zone, 0.22));
    this.liveGroup.add(box(p.cross_aisle_width, WW, 0.05, WL - p.cross_aisle_width, 0, 0.01, COLOR.zone, 0.22));

    // Dock markers
    const recvTotal = p.num_receiving_docks * p.dock_bay_width;
    const recvY0 = (WW - recvTotal) / 2;
    for (let i = 0; i < p.num_receiving_docks; i++) {
      const mesh = box(0.3, p.dock_bay_width, 3, -0.3, recvY0 + i * p.dock_bay_width, 0, COLOR.dock, 1);
      mesh.userData.info = { type: "Dock door", name: "Receiving Dock " + (i + 1), dimensions: p.dock_bay_width.toFixed(1) + " m wide", role: "Inbound" };
      this.liveGroup.add(mesh);
      this.selectable.push(mesh);
    }
    const shipTotal = p.num_shipping_docks * p.dock_bay_width;
    const shipY0 = (WW - shipTotal) / 2;
    for (let i = 0; i < p.num_shipping_docks; i++) {
      const mesh = box(0.3, p.dock_bay_width, 3, WL, shipY0 + i * p.dock_bay_width, 0, COLOR.dock, 1);
      mesh.userData.info = { type: "Dock door", name: "Shipping Dock " + (i + 1), dimensions: p.dock_bay_width.toFixed(1) + " m wide", role: "Outbound" };
      this.liveGroup.add(mesh);
      this.selectable.push(mesh);
    }

    // Recenter camera target on the building. Only auto-fit the zoom
    // distance when the footprint has changed substantially (e.g. the
    // building got much longer) -- otherwise every minor slider nudge
    // (cost, inventory...) would yank a manually-set zoom back to "fit".
    this.target.set(WL / 2, 0, WW / 2);
    const diag = Math.sqrt(WL * WL + WW * WW);
    if (this._lastFitDiag === undefined || Math.abs(diag - this._lastFitDiag) / this._lastFitDiag > 0.15) {
      this.spherical.radius = Math.max(20, diag * 1.05);
      this.defaultSpherical.radius = this.spherical.radius;
      this._lastFitDiag = diag;
    }
    this._updateCamera();
  };

  // -------------------------------------------------------------------
  // Reference model — the real FreeCAD GLB export, loaded once
  // -------------------------------------------------------------------
  Visualization.prototype.loadReferenceModel = function (url, onDone) {
    if (this.referenceLoaded || this.referenceLoadFailed) { onDone(this.referenceLoaded); return; }
    const loader = new THREE.GLTFLoader();
    const self = this;
    loader.load(
      url,
      function (gltf) {
        // FreeCAD's exporter (Import.export -> RWGltf_CafWriter) already
        // converts internal mm to metres AND FreeCAD's Z-up to glTF's
        // Y-up, per the glTF spec's conventions -- verified empirically
        // (an explicit extra scale/rotation here double-applied both and
        // left the building 1000x too small with width where height
        // should be). No unit/axis transform needed.
        //
        // What IS still needed: the axis swap leaves the width axis
        // running negative (bbox Z came out [-60, 0] for a 60 m wide
        // baseline) where the live view's convention is [0, +width].
        // Shift the loaded scene so its bbox starts at Z=0 too, so both
        // views frame the same way under one shared camera target.
        const box = new THREE.Box3().setFromObject(gltf.scene);
        gltf.scene.position.z -= box.min.z;

        // FreeCAD's exporter also gives every face of every box its own
        // opaque mesh/material (an "envelope block" export, not a
        // rendering-optimized one) -- fine for a handful of objects, but
        // it means the roof and walls are solid and hide everything
        // inside. Recolor by the same names FreeCAD gave the objects
        // (preserved through the export) so the reference view reads the
        // same way the live view does: structure translucent, racks
        // opaque and orange, docks distinct.
        gltf.scene.traverse(function (node) {
          if (!node.isMesh || !node.material) return;
          const n = node.name;
          node.material = node.material.clone();
          if (n.indexOf("Roof") === 0 || n.indexOf("Wall") >= 0) {
            node.material.transparent = true;
            node.material.opacity = n.indexOf("Roof") === 0 ? 0.08 : 0.16;
            node.material.depthWrite = false;
            node.material.color.setHex(COLOR.structure);
          } else if (n.indexOf("Rack_Row") === 0) {
            node.material.color.setHex(COLOR.rack);
          } else if (n.indexOf("Dock") >= 0) {
            node.material.color.setHex(COLOR.dock);
          } else if (n.indexOf("Zone") >= 0) {
            node.material.transparent = true;
            node.material.opacity = 0.25;
            node.material.color.setHex(COLOR.zone);
          } else if (n.indexOf("Floor") === 0) {
            node.material.color.setHex(0x11161d);
          }
        });

        self.referenceGroup.add(gltf.scene);
        self.referenceLoaded = true;

        // The reference model is always the FreeCAD baseline export, which
        // may not match whatever the live sliders currently say -- frame
        // the camera on the model's own actual bounding box, not on
        // whatever the live view last centered on.
        const size = new THREE.Vector3();
        box.getSize(size);
        self.target.set(size.x / 2, size.y / 2, size.z / 2);
        self.spherical.radius = Math.max(20, Math.sqrt(size.x * size.x + size.z * size.z) * 1.1);
        self._updateCamera();

        onDone(true);
      },
      undefined,
      function (err) {
        console.error("Reference GLB failed to load:", err);
        self.referenceLoadFailed = true;
        onDone(false);
      }
    );
  };

  Visualization.prototype.setMode = function (mode) {
    this.mode = mode;
    this.liveGroup.visible = mode === "live";
    this.referenceGroup.visible = mode === "reference";
  };

  global.WH = global.WH || {};
  global.WH.Visualization = Visualization;
})(window);
