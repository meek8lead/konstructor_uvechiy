import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();

// ============================================================
// СЦЕНА
// ============================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e0e14);
scene.fog = new THREE.Fog(0x0e0e14, 30, 75);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 200);

// FPS-риг
const yawObj = new THREE.Object3D();
const pitchObj = new THREE.Object3D();
pitchObj.position.y = 1.7;
yawObj.add(pitchObj);
pitchObj.add(camera);
scene.add(yawObj);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Свет
scene.add(new THREE.HemisphereLight(0xfff5e0, 0x1a2a3a, 0.75));
const sun = new THREE.DirectionalLight(0xffeedd, 1.6);
sun.position.set(15, 30, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 80 });
scene.add(sun);

// ============================================================
// ФИЗИКА
// ============================================================
const world = new RAPIER.World({ x: 0, y: -20, z: 0 });

// ============================================================
// АРЕНА
// ============================================================
const ARENA = 30;
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2a2a38, roughness: 0.95 });

const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(ARENA*2, ARENA*2), stoneMat);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
world.createCollider(
  RAPIER.ColliderDesc.cuboid(ARENA, 0.5, ARENA).setTranslation(0, -0.5, 0),
  floorBody
);

function addWall(w, h, d, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stoneMat);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
  world.createCollider(RAPIER.ColliderDesc.cuboid(w/2, h/2, d/2), body);
}
addWall(ARENA*2, 5, 1, 0, 2.5, -ARENA);
addWall(ARENA*2, 5, 1, 0, 2.5,  ARENA);
addWall(1, 5, ARENA*2, -ARENA, 2.5, 0);
addWall(1, 5, ARENA*2,  ARENA, 2.5, 0);

// Пара ящиков-декораций
function addCrate(x, z) {
  const s = 1 + Math.random() * 0.4;
  const mat = new THREE.MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.9 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
  mesh.position.set(x, s/2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, s/2, z)
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(s/2, s/2, s/2), body);
  return { mesh, body };
}
const crates = [];
for (let i = 0; i < 8; i++) {
  const a = Math.random() * Math.PI * 2;
  const r = 8 + Math.random() * 12;
  crates.push(addCrate(Math.cos(a)*r, Math.sin(a)*r));
}

// ============================================================
// КЛЕШНИ (вид от первого лица)
// ============================================================
function makeClaw(side) {
  const g = new THREE.Group();
  g.position.set(side * 0.36, -0.30, -0.55);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6a7a8a, metalness: 0.85, roughness: 0.3 });
  const fingerMat = new THREE.MeshStandardMaterial({ color: 0xaabbcc, metalness: 0.95, roughness: 0.15 });
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.4), bodyMat);
  forearm.position.z = 0.15;
  g.add(forearm);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), bodyMat);
  palm.position.z = -0.08;
  g.add(palm);
  const f1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), fingerMat);
  f1.position.set(-0.055, 0.07, -0.16);
  const f2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), fingerMat);
  f2.position.set( 0.055, 0.07, -0.16);
  g.add(f1, f2);
  g.userData.f1 = f1;
  g.userData.f2 = f2;
  g.userData.closed = false;
  return g;
}
const clawL = makeClaw(-1);
const clawR = makeClaw( 1);
camera.add(clawL, clawR);

function setClawClosed(claw, closed) {
  if (claw.userData.closed === closed) return;
  claw.userData.closed = closed;
  claw.userData.f1.position.x = closed ? -0.01 : -0.055;
  claw.userData.f2.position.x = closed ?  0.01 :  0.055;
}

// ============================================================
// КРОВЬ
// ============================================================
const MAX_PARTICLES = 600;
const bPositions = new Float32Array(MAX_PARTICLES * 3);
const bVelocities = new Float32Array(MAX_PARTICLES * 3);
const bLife = new Float32Array(MAX_PARTICLES);
bPositions.fill(-9999);

const bGeo = new THREE.BufferGeometry();
bGeo.setAttribute('position', new THREE.BufferAttribute(bPositions, 3));
const bMat = new THREE.PointsMaterial({ color: 0x990000, size: 0.09, sizeAttenuation: true });
const bloodPoints = new THREE.Points(bGeo, bMat);
bloodPoints.frustumCulled = false;
scene.add(bloodPoints);

function spawnBlood(pos, count, burst = 6) {
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < MAX_PARTICLES; j++) {
      if (bLife[j] <= 0) {
        bPositions[j*3]   = pos.x + (Math.random()-0.5)*0.1;
        bPositions[j*3+1] = pos.y + (Math.random()-0.5)*0.1;
        bPositions[j*3+2] = pos.z + (Math.random()-0.5)*0.1;
        bVelocities[j*3]   = (Math.random()-0.5) * burst;
        bVelocities[j*3+1] = Math.random() * burst * 0.8;
        bVelocities[j*3+2] = (Math.random()-0.5) * burst;
        bLife[j] = 1.2 + Math.random() * 0.8;
        break;
      }
    }
  }
}

function updateBlood(dt) {
  let dirty = false;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (bLife[i] > 0) {
      bLife[i] -= dt;
      bPositions[i*3]   += bVelocities[i*3] * dt;
      bPositions[i*3+1] += bVelocities[i*3+1] * dt;
      bPositions[i*3+2] += bVelocities[i*3+2] * dt;
      bVelocities[i*3+1] -= 25 * dt;
      // трение о пол
      if (bPositions[i*3+1] < 0.05) {
        bPositions[i*3+1] = 0.05;
        bVelocities[i*3+1] *= -0.2;
        bVelocities[i*3] *= 0.5;
        bVelocities[i*3+2] *= 0.5;
      }
      if (bLife[i] <= 0) bPositions[i*3+1] = -9999;
      dirty = true;
    }
  }
  if (dirty) bGeo.attributes.position.needsUpdate = true;
}

// ============================================================
// ФАБРИКА ЛЮДЕЙ (рэгдолл из 11 сегментов)
// ============================================================
const humans = [];
const colliderToHuman = new Map(); // collider.handle -> {human, segmentName}

const skinMat = new THREE.MeshStandardMaterial({ color: 0xd4a888, roughness: 0.85 });

function createHuman(spawnPos) {
  const human = {
    segments: {},
    joints: {},
    parentSegmentOf: {},
    parentJointOf: {},
    alive: true,
    limbsLost: 0,
    headless: false,
    state: 'APPROACH',
    attackCd: 1.5,
    bleeders: [],
  };

  function addSegment(name, localPos, colliderDesc, mesh, parentName = null, anchors = null) {
    const wp = new THREE.Vector3(
      spawnPos.x + localPos.x,
      spawnPos.y + localPos.y,
      spawnPos.z + localPos.z
    );
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(wp.x, wp.y, wp.z)
      .setLinearDamping(0.6)
      .setAngularDamping(0.7);
    const body = world.createRigidBody(bodyDesc);
    const collider = world.createCollider(colliderDesc, body);

    mesh.position.copy(wp);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    human.segments[name] = { body, mesh, collider };
    colliderToHuman.set(collider.handle, { human, segmentName: name });

    if (parentName && anchors) {
      const jd = RAPIER.JointData.spherical(anchors.self, anchors.parent);
      const joint = world.createImpulseJoint(jd, body, human.segments[parentName].body, true);
      const jName = 'j_' + name;
      human.joints[jName] = { joint, bodyA: body, bodyB: human.segments[parentName].body, broken: false };
      human.parentSegmentOf[name] = parentName;
      human.parentJointOf[name] = jName;
    }
    return human.segments[name];
  }

  // ---- Пельвис (корень) ----
  addSegment('pelvis',
    { x: 0, y: 1.08, z: 0 },
    RAPIER.ColliderDesc.cuboid(0.175, 0.1, 0.11),
    new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.22), skinMat)
  );

  // ---- Торс ----
  addSegment('torso',
    { x: 0, y: 1.43, z: 0 },
    RAPIER.ColliderDesc.cuboid(0.2, 0.25, 0.125),
    new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.25), skinMat),
    'pelvis',
    { self: { x: 0, y: -0.25, z: 0 }, parent: { x: 0, y: 0.1, z: 0 } }
  );

  // ---- Голова ----
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), skinMat);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const eyes = [];
  for (const xOff of [-0.05, 0.05]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), eyeMat);
    eye.position.set(xOff, 0.03, 0.13);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), pupilMat);
    pupil.position.set(xOff, 0.03, 0.152);
    headMesh.add(eye, pupil);
    eyes.push({ eye, pupil });
  }
  headMesh.userData.eyes = eyes;
  addSegment('head',
    { x: 0, y: 1.83, z: 0 },
    RAPIER.ColliderDesc.ball(0.15),
    headMesh,
    'torso',
    { self: { x: 0, y: -0.15, z: 0 }, parent: { x: 0, y: 0.25, z: 0 } }
  );

  // ---- Руки ----
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    const armX = side * 0.28;
    addSegment('upperArm' + s,
      { x: armX, y: 1.425, z: 0 },
      RAPIER.ColliderDesc.capsule(0.125, 0.05),
      new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.25, 4, 8), skinMat),
      'torso',
      { self: { x: 0, y: 0.175, z: 0 }, parent: { x: side * 0.2, y: 0.17, z: 0 } }
    );
    addSegment('forearm' + s,
      { x: armX, y: 1.075, z: 0 },
      RAPIER.ColliderDesc.capsule(0.125, 0.05),
      new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.25, 4, 8), skinMat),
      'upperArm' + s,
      { self: { x: 0, y: 0.175, z: 0 }, parent: { x: 0, y: -0.175, z: 0 } }
    );
  }

  // ---- Ноги ----
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    const legX = side * 0.12;
    addSegment('thigh' + s,
      { x: legX, y: 0.755, z: 0 },
      RAPIER.ColliderDesc.capsule(0.165, 0.06),
      new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.33, 4, 8), skinMat),
      'pelvis',
      { self: { x: 0, y: 0.225, z: 0 }, parent: { x: legX, y: -0.1, z: 0 } }
    );
    addSegment('shin' + s,
      { x: legX, y: 0.305, z: 0 },
      RAPIER.ColliderDesc.capsule(0.165, 0.06),
      new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.33, 4, 8), skinMat),
      'thigh' + s,
      { self: { x: 0, y: 0.225, z: 0 }, parent: { x: 0, y: -0.225, z: 0 } }
    );
  }

  humans.push(human);
  return human;
}

// ============================================================
// КРЕСТИКИ-ЗРАЧКИ
// ============================================================
function addXEyes(headMesh) {
  if (headMesh.userData.hasX) return;
  headMesh.userData.hasX = true;
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  for (const e of headMesh.userData.eyes) {
    e.eye.visible = false;
    e.pupil.visible = false;
  }
  for (const xOff of [-0.05, 0.05]) {
    const g = new THREE.Group();
    g.position.set(xOff, 0.03, 0.14);
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.012), black);
    b1.rotation.z = Math.PI / 4;
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.012), black);
    b2.rotation.z = -Math.PI / 4;
    g.add(b1, b2);
    headMesh.add(g);
  }
}

// ============================================================
// РАСЧЛЕНЕНИЕ
// ============================================================
let killCount = 0;
let robotHP = 100;

function updateHUD() {
  document.getElementById('hp').textContent = Math.max(0, Math.round(robotHP));
  document.getElementById('hpbar').style.width = Math.max(0, robotHP) + '%';
  document.getElementById('kills').textContent = killCount;
}

function breakJoint(human, jointName) {
  const j = human.joints[jointName];
  if (!j || j.broken) return;
  j.broken = true;

  // Кто отделился?
  let detached = null;
  for (const segName in human.parentJointOf) {
    if (human.parentJointOf[segName] === jointName) { detached = segName; break; }
  }
  if (!detached) return;

  const t = j.bodyA.translation();
  spawnBlood(new THREE.Vector3(t.x, t.y, t.z), 30, 10);

  world.removeImpulseJoint(j.joint, true);

  if (detached === 'head') {
    human.headless = true;
    human.alive = false;
    addXEyes(human.segments.head.mesh);
    killCount++;
    updateHUD();
  } else {
    human.limbsLost++;
    human.bleeders.push({ segName: detached, time: 6 });
    if (human.alive && human.limbsLost >= 3) {
      human.alive = false;
      if (!human.headless) addXEyes(human.segments.head.mesh);
      killCount++;
      updateHUD();
    }
  }
}

// ============================================================
// УПРАВЛЕНИЕ
// ============================================================
const keys = {};
addEventListener('keydown', e => { keys[e.code] = true; });
addEventListener('keyup',   e => { keys[e.code] = false; });

let pointerLocked = false;
document.getElementById('menu').addEventListener('click', () => {
  document.getElementById('menu').style.display = 'none';
  renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  if (!pointerLocked) {
    document.getElementById('menu').style.display = 'flex';
    document.getElementById('menu').querySelector('p').textContent = 'Пауза — кликни, чтобы продолжить';
  }
});
addEventListener('mousemove', e => {
  if (!pointerLocked) return;
  yawObj.rotation.y -= e.movementX * 0.0022;
  pitchObj.rotation.x -= e.movementY * 0.0022;
  pitchObj.rotation.x = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, pitchObj.rotation.x));
});

// ============================================================
// ЗАХВАТ
// ============================================================
const grabState = {
  L: { grabbed: null, strain: 0 },
  R: { grabbed: null, strain: 0 },
};
const raycaster = new THREE.Raycaster();
raycaster.far = 3.5;

function tryGrab(side) {
  const gs = grabState[side];
  if (gs.grabbed) return;

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const meshes = [];
  for (const h of humans) {
    for (const name in h.segments) meshes.push(h.segments[name].mesh);
  }
  for (const c of crates) meshes.push(c.mesh);

  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0) return;

  const hit = hits[0];
  const mesh = hit.object;

  // Ищем к чему относится
  let found = null;
  for (const h of humans) {
    for (const name in h.segments) {
      if (h.segments[name].mesh === mesh) { found = { human: h, segmentName: name }; break; }
    }
    if (found) break;
  }

  if (found) {
    gs.grabbed = {
      kind: 'human',
      human: found.human,
      segmentName: found.segmentName,
      body: found.human.segments[found.segmentName].body,
    };
    setClawClosed(side === 'L' ? clawL : clawR, true);
    document.getElementById('crosshair').classList.add('grab');
    return;
  }

  // Ящик
  for (const c of crates) {
    if (c.mesh === mesh) {
      gs.grabbed = { kind: 'crate', body: c.body, mesh: c.mesh };
      setClawClosed(side === 'L' ? clawL : clawR, true);
      return;
    }
  }
}

function releaseGrab(side, throwIt = false) {
  const gs = grabState[side];
  if (!gs.grabbed) return;

  if (throwIt) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const imp = 45;
    gs.grabbed.body.applyImpulse(
      { x: dir.x * imp, y: dir.y * imp + 8, z: dir.z * imp },
      true
    );
  }
  gs.grabbed = null;
  gs.strain = 0;
  setClawClosed(side === 'L' ? clawL : clawR, false);
  if (!grabState.L.grabbed && !grabState.R.grabbed) {
    document.getElementById('crosshair').classList.remove('grab');
  }
}

addEventListener('mousedown', e => {
  if (!pointerLocked) return;
  if (e.button === 0) tryGrab('L');
  if (e.button === 2) tryGrab('R');
});
addEventListener('mouseup', e => {
  if (e.button === 0) releaseGrab('L');
  if (e.button === 2) releaseGrab('R');
});
addEventListener('contextmenu', e => e.preventDefault());

// ============================================================
// AI
// ============================================================
function updateHuman(human, dt) {
  // Кровотечение
  if (human.alive) {
    for (const b of human.bleeders) {
      b.time -= dt;
      if (b.time > 0 && Math.random() < 0.4) {
        const seg = human.segments[b.segName];
        if (seg) {
          const t = seg.body.translation();
          spawnBlood(new THREE.Vector3(t.x, t.y, t.z), 2, 3);
        }
      }
    }
    human.bleeders = human.bleeders.filter(b => b.time > 0);
  }

  if (!human.alive || human.headless) return;

  const pelvis = human.segments.pelvis.body;
  const pp = pelvis.translation();
  const dx = yawObj.position.x - pp.x;
  const dz = yawObj.position.z - pp.z;
  const dist = Math.sqrt(dx*dx + dz*dz);

  if (dist > 1.8) {
    const nx = dx / dist, nz = dz / dist;
    pelvis.applyImpulse({ x: nx * 6, y: 0, z: nz * 6 }, true);
    // Попытка «привстать» если упал
    const torso = human.segments.torso.body;
    const tp = torso.translation();
    if (tp.y < 1.1 && human.limbsLost < 2) {
      torso.applyImpulse({ x: 0, y: 6, z: 0 }, true);
    }
  } else {
    human.attackCd -= dt;
    if (human.attackCd <= 0) {
      human.attackCd = 1.4;
      robotHP -= 12;
      updateHUD();
      const torso = human.segments.torso.body;
      const tp = torso.translation();
      torso.applyImpulse({ x: dx * 3, y: 3, z: dz * 3 }, true);
    }
  }
}

// ============================================================
// ВОЛНЫ
// ============================================================
let wave = 0;
let spawnQueue = [];
let spawnTimer = 0;

function startWave() {
  wave++;
  document.getElementById('wave').textContent = wave;
  const count = Math.min(3 + wave, 10);
  spawnQueue = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 14 + Math.random() * 6;
    spawnQueue.push(new THREE.Vector3(Math.cos(a)*r, 0, Math.sin(a)*r));
  }
  spawnTimer = 0;
  showMsg(`ВОЛНА ${wave}`, '#f33');
}

let msgTimeout = null;
function showMsg(text, color = '#fff') {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.style.color = color;
  el.style.opacity = 1;
  clearTimeout(msgTimeout);
  msgTimeout = setTimeout(() => el.style.opacity = 0, 1800);
}

// ============================================================
// ГЛАВНЫЙ ЦИКЛ
// ============================================================
const FIXED_DT = 1/60;
let acc = 0;
let lastTime = performance.now() / 1000;

updateHUD();
startWave();

const tmpQ = new THREE.Quaternion();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now() / 1000;
  let dt = Math.min(now - lastTime, 0.1);
  lastTime = now;
  acc += dt;

  // --- Физика фикс. шагом ---
  while (acc >= FIXED_DT) {
    world.step();
    acc -= FIXED_DT;
  }

  // --- Движение игрока ---
  if (pointerLocked) {
    const speed = 6;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(yawObj.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(yawObj.quaternion);
    fwd.y = 0; fwd.normalize();
    right.y = 0; right.normalize();
    const move = new THREE.Vector3();
    if (keys['KeyW']) move.add(fwd);
    if (keys['KeyS']) move.sub(fwd);
    if (keys['KeyD']) move.add(right);
    if (keys['KeyA']) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      yawObj.position.add(move);
      // Ограничение арены
      const r = Math.sqrt(yawObj.position.x ** 2 + yawObj.position.z ** 2);
      if (r > ARENA - 1.5) {
        const k = (ARENA - 1.5) / r;
        yawObj.position.x *= k;
        yawObj.position.z *= k;
      }
    }
  }

  // --- Q = бросить ---
  if (keys['KeyQ']) {
    if (grabState.L.grabbed) releaseGrab('L', true);
    else if (grabState.R.grabbed) releaseGrab('R', true);
    keys['KeyQ'] = false;
  }

  // --- Захват: физика и разрыв ---
  const camWorldPos = new THREE.Vector3();
  camera.getWorldPosition(camWorldPos);
  const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(tmpQ));

  for (const side of ['L', 'R']) {
    const gs = grabState[side];
    if (!gs.grabbed) continue;

    const targetPos = camWorldPos.clone().add(camDir.clone().multiplyScalar(1.6));
    const bt = gs.grabbed.body.translation();
    const dx = targetPos.x - bt.x;
    const dy = targetPos.y - bt.y;
    const dz = targetPos.z - bt.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

    // P-контроллер (мягкий)
    const k = 12;
    const maxImp = 25;
    let ix = dx * k, iy = dy * k, iz = dz * k;
    const mag = Math.sqrt(ix*ix + iy*iy + iz*iz);
    if (mag > maxImp) { const s = maxImp / mag; ix *= s; iy *= s; iz *= s; }
    gs.grabbed.body.applyImpulse({ x: ix, y: iy, z: iz }, true);

    // Разрыв (только для конечностей, не для торса/пельвиса/ящиков)
    if (gs.grabbed.kind === 'human') {
      const name = gs.grabbed.segmentName;
      const isCore = (name === 'torso' || name === 'pelvis');
      if (!isCore) {
        gs.strain += dt * (1 + Math.min(dist, 2));
        const breakTime = name === 'head' ? 0.7 : 1.2;
        if (gs.strain > breakTime) {
          const human = gs.grabbed.human;
          const jointName = human.parentJointOf[name];
          if (jointName && !human.joints[jointName].broken) {
            breakJoint(human, jointName);
            gs.grabbed = null;
            gs.strain = 0;
            setClawClosed(side === 'L' ? clawL : clawR, false);
            if (!grabState.L.grabbed && !grabState.R.grabbed) {
              document.getElementById('crosshair').classList.remove('grab');
            }
          } else {
            // Уже оторван — просто держим
            gs.strain = 0;
          }
        }
      }
    }
  }

  // --- AI + синхронизация мешей ---
  for (const h of humans) {
    updateHuman(h, dt);
    for (const name in h.segments) {
      const seg = h.segments[name];
      const t = seg.body.translation();
      const r = seg.body.rotation();
      seg.mesh.position.set(t.x, t.y, t.z);
      seg.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  // Синхронизация ящиков
  for (const c of crates) {
    const t = c.body.translation();
    const r = c.body.rotation();
    c.mesh.position.set(t.x, t.y, t.z);
    c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  // --- Спавн волны ---
  spawnTimer += dt;
  if (spawnQueue.length > 0 && spawnTimer > 0.6) {
    spawnTimer = 0;
    const pos = spawnQueue.shift();
    createHuman(pos);
  }
  if (spawnQueue.length === 0 && humans.every(h => !h.alive)) {
    // Волна зачищена — но не сразу (проверка на то, что всё уже создалось)
    if (humans.length > 0 && wave * 3 <= humans.filter(h => !h.alive).length + killCount) {
      // Небольшая задержка перед следующей волной
      if (spawnTimer > 2.5) {
        spawnTimer = -10; // cooldown
        showMsg('ВОЛНА ЗАЧИЩЕНА', '#0f0');
        setTimeout(() => startWave(), 2500);
      }
    }
  }

  // --- Кровь ---
  updateBlood(dt);

  // --- HP и смерть робота ---
  if (robotHP <= 0) {
    robotHP = 100;
    updateHUD();
    showMsg('СИСТЕМА ПЕРЕЗАГРУЖЕНА', '#0f0');
  }

  renderer.render(scene, camera);
}

animate();
