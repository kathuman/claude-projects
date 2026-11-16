// The machine in 3D: the assembly FreeCAD exported (web/public/hardware/machine.glb), coloured by what each part is made
// of (the first letter of its name), with orbit controls and a name for whatever is clicked. FreeCAD's glTF writer
// already turns millimetres into metres and Z-up into Y-up, so the model is used as it comes.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export const MATERIALS: Record<string, { color: number; metal?: number; rough?: number }> = {
  W: { color: 0xc9a46c, rough: 0.85 },        // wood
  B: { color: 0xf3ead8, rough: 0.9 },         // the nail board
  P: { color: 0x2f9fd8, rough: 0.55 },        // printed
  M: { color: 0x2b2f36, metal: 0.3, rough: 0.5 },
  A: { color: 0xb9c2cc, metal: 0.8, rough: 0.35 },
  E: { color: 0x2e8a57, rough: 0.6 },
  N: { color: 0x8b9199, metal: 0.9, rough: 0.3 },
  T: { color: 0xe5484d, rough: 0.5 }
};

export class MachineView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
  private controls: OrbitControls;
  private model: THREE.Object3D | null = null;
  private picked: THREE.Mesh | null = null;
  private pickedColor = new THREE.Color();
  autoTurn = true;

  constructor(private host: HTMLElement, private onPick: (name: string | null) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x082444);
    host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x1b2a3a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1.2, 2, 1.5);
    this.scene.add(sun);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("start", () => { this.autoTurn = false; });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    let down = { x: 0, y: 0 };
    this.renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) this.pick(e);
    });
    // draw only while the view is on screen: no work (or battery) spent on a model scrolled out of sight
    let visible = true;
    new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }).observe(host);
    const loop = () => {
      if (visible && !document.hidden) {
        if (this.autoTurn && this.model) this.model.rotation.y += 0.0025;
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  async load(url: string, onProgress: (f: number) => void): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => { if (e.total) onProgress(e.loaded / e.total); });
    const root = gltf.scene;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = this.partName(m);
      const spec = MATERIALS[name[0]] ?? MATERIALS.A;
      m.material = new THREE.MeshStandardMaterial({ color: spec.color, metalness: spec.metal ?? 0, roughness: spec.rough ?? 0.6, side: THREE.DoubleSide });
      m.userData.part = name;
    });
    // centre it on the turntable's axis, sitting on the floor
    const pivot = new THREE.Group();
    const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3());
    root.position.set(0, -box.min.y, 0);
    pivot.add(root);
    this.scene.add(pivot);
    this.model = pivot;
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.set(0, (box.max.y - box.min.y) * 0.25, c.z * 0.5);
    this.camera.position.set(size * 0.55, size * 0.45, size * 0.68);      // from the front right, the tower behind
    this.camera.near = size / 100; this.camera.far = size * 10; this.camera.updateProjectionMatrix();
  }

  /** the name FreeCAD gave the part: the mesh's own name or its nearest named parent */
  private partName(o: THREE.Object3D): string {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (/^[A-Z]_/.test(p.name)) return p.name;
    return o.name || "";
  }

  private pick(e: PointerEvent): void {
    if (!this.model) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = ray.intersectObject(this.model, true)[0];
    if (this.picked) (this.picked.material as THREE.MeshStandardMaterial).color.copy(this.pickedColor);
    this.picked = null;
    if (!hit) { this.onPick(null); return; }
    const m = hit.object as THREE.Mesh, mat = m.material as THREE.MeshStandardMaterial;
    this.picked = m; this.pickedColor.copy(mat.color);
    mat.color.set(0xffcf4a);
    this.onPick(String(m.userData.part || ""));
  }

  private resize(): void {
    const w = this.host.clientWidth || 600, h = this.host.clientHeight || Math.round(w * 0.66);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%"; this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
}
