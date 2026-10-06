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

  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x9fb4c8, metalness: 0.35, roughness: 0.5 });
  const treadMat = new THREE.MeshStandardMaterial({ color: 0x14212e, metalness: 0.05, roughness: 0.95 });
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, emissive: 0x7dd3fc, emissiveIntensity: 0.35, roughness: 0.5 });
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xeaf2f1,
    metalness: 0.1,
    roughness: 0.35,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    emissive: 0x7dd3fc,
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
    // the tyre: a torus around the axle (its own axis is already Z, the axle direction)
    const tread = new THREE.Mesh(
      new THREE.TorusGeometry(g.wheelRadius * 0.93, g.wheelWidth * 0.32, 10, 36),
      treadMat
    );
    tread.castShadow = true;
    // a bright spoke, so the wheel's spin (and any slip) is visible
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(g.wheelRadius * 1.6, g.wheelRadius * 0.16, g.wheelWidth * 1.08), spokeMat);
    const spin = new THREE.Group();
    spin.add(wheel, tread, spoke);
    group.add(spin);
    group.position.set(0, 0, ySign * g.trackWidth / 2);
    chassisGroup.add(group);
    return { group, wheel, tread, spoke, spin };
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
    [wheelLeft, wheelRight].forEach(({ group, wheel, tread, spoke }, i) => {
      wheel.geometry.dispose();
      wheel.geometry = new THREE.CylinderGeometry(ng.wheelRadius * 0.9, ng.wheelRadius * 0.9, ng.wheelWidth, 28);
      tread.geometry.dispose();
      tread.geometry = new THREE.TorusGeometry(ng.wheelRadius * 0.93, ng.wheelWidth * 0.32, 10, 36);
      spoke.geometry.dispose();
      spoke.geometry = new THREE.BoxGeometry(ng.wheelRadius * 1.6, ng.wheelRadius * 0.16, ng.wheelWidth * 1.08);
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
      // physics: theta > 0 tips the body toward +x; a +Z rotation in three.js tips it toward -x
      tiltGroup.rotation.z = -state.theta;
      // each wheel turns by its own simulated angle (so a slipping wheel visibly spins);
      // three.js's +Z rotation turns the top of the wheel backward, hence the minus sign
      wheelLeft.spin.rotation.z = -state.phiL;
      wheelRight.spin.rotation.z = -state.phiR;
    },
  };
}

export function buildGround(THREE, scene) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x05182c, roughness: 0.95, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(40, 160, 0x4f8cc0, 0x1f4f7c);
  grid.position.y = 0.002;
  scene.add(grid);
  return { floor, grid };
}
