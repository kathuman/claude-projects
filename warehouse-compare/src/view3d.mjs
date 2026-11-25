// view3d.mjs — the 3D view of one layout (an ES module: three.js r186 from the
// Warehouse Model's vendor folder, through the page's import map).
// Draws what scene3d.spec() describes: bays or pods as one instanced mesh,
// coloured like the plan, on the floor outline, with the picking points.
// Renders only when something changes (orbit, resize, new layout).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

let renderer = null, scene = null, camera = null, controls = null, host = null, observer = null, framed = null;

function render() { if (renderer) renderer.render(scene, camera); }

function ensure(container) {
  if (renderer && host === container) return;
  host = container;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x0a2f52);
  container.innerHTML = "";
  container.appendChild(renderer.domElement);
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.addEventListener("change", render);
  observer = new ResizeObserver(resize);
  observer.observe(container);
}

function resize() {
  if (!renderer || !host) return;
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + "px"; renderer.domElement.style.height = h + "px";
  camera.aspect = w / h; camera.updateProjectionMatrix();
  render();
}

// res: a layout result; fills: one CSS colour per bay (WC.plan.bayFills); s: WC.scene3d.spec(res, inputs)
function show(container, s, fills, key) {
  ensure(container);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdff3ff, 0x0a2f52, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-40, 80, 30); scene.add(sun);

  // floor
  const shape = new THREE.Shape(s.outline.map((p) => new THREE.Vector2(p[0], -p[1])));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: 0x0d3a63 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(s.outline.map((p) => new THREE.Vector3(p[0], 0.01, p[1]))), new THREE.LineBasicMaterial({ color: 0x8fd0f2 }));
  scene.add(edge);

  // bays / pods
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), s.boxes.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  s.boxes.forEach((b, i) => {
    q.setFromAxisAngle(up, b.rot);
    m.compose(new THREE.Vector3(b.x, b.h / 2, b.z), q, new THREE.Vector3(b.w * 0.96, b.h, b.d * 0.96));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(b.empty ? "#1d4470" : fills[i]));
  });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);

  // picking points
  const dg = new THREE.BoxGeometry(1.2, 0.9, 1.2), dm = new THREE.MeshLambertMaterial({ color: 0x7be0c4 });
  s.depots.forEach((p) => { const d = new THREE.Mesh(dg, dm); d.position.set(p[0], 0.45, p[1]); scene.add(d); });

  // frame the building once per layout; keep the user's view while only colours change
  const cx = (s.size.x0 + s.size.x1) / 2, cz = (s.size.z0 + s.size.z1) / 2, span = Math.max(s.size.x1 - s.size.x0, s.size.z1 - s.size.z0);
  if (framed !== key) {
    controls.target.set(cx, 0, cz);
    camera.position.set(cx - span * 0.55, span * 0.75, cz + span * 0.85);
    camera.near = span / 500; camera.far = span * 20; camera.updateProjectionMatrix();
    controls.update(); framed = key;
  }
  resize(); render();
}

window.WC = window.WC || {};
window.WC.view3d = { show: show };
window.dispatchEvent(new Event("wc-view3d-ready"));
