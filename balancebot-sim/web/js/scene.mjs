// Three.js scene for the balancing robot. Y-up, X-forward, Z-lateral.
//
// Hierarchy (mirrors the physical structure, not just a visual convenience):
//   chassisGroup            -- world position (posX, wheelRadius, posZ), heading (psi)
//     wheelLeftGroup/Right  -- fixed at (0, 0, +-trackWidth/2); wheels never tilt
//       wheelMesh           -- spins about its own axle (Z) as it rolls
//     tiltGroup             -- rotates about Z by theta (pitch); this is what "falls"
//       bodyMesh
//
// Rendering mirrors the Z axis relative to the physics convention (psi and
// posZ are both negated here) purely to match three.js's Y-rotation
// handedness to the sign convention dynamics.mjs was derived and tested
// against -- see the comment at the call site in main.mjs. It has no effect
// on correctness, only on which way "turn right" looks from above.

export function buildScene(THREE, scene, params) {
  const g = params.geometry;

  const chassisGroup = new THREE.Group();
  scene.add(chassisGroup);

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2a3138, metalness: 0.3, roughness: 0.6 });
  const treadMat = new THREE.MeshStandardMaterial({ color: 0x14181d, metalness: 0.1, roughness: 0.9 });
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xeaf2f1,
    metalness: 0.1,
    roughness: 0.35,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x18e0c8,
    emissive: 0x18e0c8,
    emissiveIntensity: 0.5,
    metalness: 0.3,
    roughness: 0.4,
  });

  function makeWheel(ySign) {
    const group = new THREE.Group();
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(g.wheelRadius, g.wheelRadius, g.wheelWidth, 28), wheelMat);
    wheel.rotation.x = Math.PI / 2; // local Y (cylinder axis) -> Z (lateral)
    wheel.castShadow = true;
    wheel.receiveShadow = true;
    group.add(wheel);
    const tread = new THREE.Mesh(
      new THREE.TorusGeometry(g.wheelRadius * 0.96, g.wheelWidth * 0.18, 8, 28),
      treadMat
    );
    tread.rotation.y = Math.PI / 2;
    group.add(tread);
    group.position.set(0, 0, ySign * g.trackWidth / 2);
    chassisGroup.add(group);
    return { group, wheel };
  }

  const wheelLeft = makeWheel(-1);
  const wheelRight = makeWheel(1);

  const tiltGroup = new THREE.Group();
  chassisGroup.add(tiltGroup);

  const body = new THREE.Mesh(new THREE.BoxGeometry(g.bodyDepth, g.bodyHeight, g.bodyWidth), bodyMat);
  body.position.y = g.bodyHeight / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  tiltGroup.add(body);

  const indicator = new THREE.Mesh(new THREE.SphereGeometry(Math.min(g.bodyDepth, g.bodyWidth) * 0.18, 16, 12), accentMat);
  indicator.position.set(g.bodyDepth / 2 + 0.002, g.bodyHeight * 0.8, 0);
  tiltGroup.add(indicator);

  const comMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff5c5c })
  );
  tiltGroup.add(comMarker);

  function rebuild(newParams) {
    const ng = newParams.geometry;
    [wheelLeft, wheelRight].forEach(({ group, wheel }, i) => {
      wheel.geometry.dispose();
      wheel.geometry = new THREE.CylinderGeometry(ng.wheelRadius, ng.wheelRadius, ng.wheelWidth, 28);
      group.position.set(0, 0, (i === 0 ? -1 : 1) * ng.trackWidth / 2);
    });
    body.geometry.dispose();
    body.geometry = new THREE.BoxGeometry(ng.bodyDepth, ng.bodyHeight, ng.bodyWidth);
    body.position.y = ng.bodyHeight / 2;
    indicator.position.set(ng.bodyDepth / 2 + 0.002, ng.bodyHeight * 0.8, 0);
    comMarker.position.set(0, ng.comHeight, 0);
  }
  rebuild(params);

  return {
    chassisGroup,
    tiltGroup,
    wheelLeft,
    wheelRight,
    rebuild,
    /** Push the live three.js transforms to match a physics state + params. */
    sync(state, currentParams) {
      chassisGroup.position.set(state.posX, currentParams.geometry.wheelRadius, -state.posZ);
      chassisGroup.rotation.y = -state.psi;
      tiltGroup.rotation.z = state.theta;
      const phi = state.x / currentParams.geometry.wheelRadius;
      wheelLeft.wheel.rotation.z = phi;
      wheelRight.wheel.rotation.z = phi;
    },
  };
}

export function buildGround(THREE, scene) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x0d1116, roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(40, 80, 0x223038, 0x161c22);
  grid.position.y = 0.002;
  scene.add(grid);
  return { floor, grid };
}
