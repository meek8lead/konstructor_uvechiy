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
const world = new RAPIER.World({ x: 0, y: -15, z: 0 });

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

const crates = [];
function addCrate(x, z) {
  const s = 1 + Math.random() * 0.4;
  const mat = new THREE.MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.9 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
  mesh.position.set(x, s/2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, s/2, z).setLinearDamping(1.0)
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(s/2, s/2, s/2), body);
  crates.push({ mesh, body });
  return { mesh, body };
}
for (let i = 0; i < 8; i++) {
  const a = Math.random() * Math.PI * 2;
  const r = 8 + Math.random() * 12;
  addCrate(Math.cos(a)*r, Math.sin(a)*r);
}

// ============================================================
// КЛЕШНИ
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
const bMat = new THREE.PointsMaterial({ color: 0x990000, size: 0.09 });
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
// СТОЙКА (оффсеты относительно rootY)
// ============================================================
const STANDING_OFFSETS = {
  pelvis:    { x: 0,     y: 0,      z: 0 },
  torso:     { x: 0,     y: 0.35,   z: 0 },
  head:      { x: 0,     y: 0.75,   z: 0 },
  upperArmL: { x: -0.28, y: 0.345,  z: 0 },
  upperArmR: { x: 0.28,  y: 0.345,  z: 0 },
  forearmL:  { x: -0.28, y: -0.005, z: 0 },
  forearmR:  { x: 0.28,  y: -0.005, z: 0 },
  thighL:    { x: -0.12, y: -0.325, z: 0 },
  thighR:    { x: 0.12,  y: -0.325, z: 0 },
  shinL:     { x: -0.12, y: -0.775, z: 0 },
  shinR:     { x: 0.12,  y: -0.775, z: 0 },
};
const ROOT_Y = 1.0;
const POSE_KP = 800;
const POSE_KD = 60;

// ============================================================
// ЧЕЛОВЕК (рэгдолл из 11 сегментов)
// ============================================================
const humans = [];
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
    attackCd: 1.5,
    bleeders: [],
    targetPos: new THREE.Vector3(spawnPos.x, 0, spawnPos.z),
    facing: 0,
  };

  function addSegment(name, localPos, colliderDesc, mesh, parentName = null, anchors = null) {
    const wp = new THREE.Vector3(
      spawnPos.x + localPos.x,
      spawnPos.y + localPos.y,
      spawnPos.z + localPos.z
    );
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(wp.x, wp.y, wp.z)
      .setLinearDamping(0.8)
      .setAngularDamping(2.5)
      .setCcdEnabled(true);
    const body = world.createRigidBody(bodyDesc);
    world.createCollider(colliderDesc, body);

    mesh.position.copy(wp);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    human.segments[name] = { body, mesh, collider: mesh.userData.collider };
    if (parentName && anchors) {
      const jd = RAPIER.JointData.spherical(anchors.self, anchors.parent);
      const joint = world.createImpulseJoint(jd, body, human.segments[parentName].body, true);
      const jName = 'j_' + name;
      human.joints[jName] = { joint, broken: false };
      human.parentSegmentOf[name] = parentName;
      human.parentJointOf[name] = jName;
    }
    return human.segments[name];
  }

  addSegment('pelvis',
    { x: 0, y: 1.08, z: 0 },
    RAPIER.ColliderDesc.cuboid(0.175, 0.1, 0.11),
    new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.22), skinMat)
  );
  addSegment('torso',
    { x: 0, y: 1.43, z: 0 },
    RAPIER.ColliderDesc.cuboid(0.2, 0.25, 0.125),
    new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.25), skinMat),
    'pelvis',
    { self: { x: 0, y: -0.25, z: 0 }, parent: { x: 0, y: 0.1, z: 0 } }
  );

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

  let detached = null;
  for (const segName in human.parentJointOf) {
    if (human.parentJointOf[segName] === jointName) { detached = segName; break; }
  }
  if (!detached) return;

  const t = human.segments[detached].body.translation();
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

function isDetached(human, name) {
  let cur = name;
  while (human.parentSegmentOf[cur]) {
    const jn = human.parentJointOf[cur];
    if (human.joints[jn]?.broken) return true;
    cur = human.parentSegmentOf[cur];
  }
  return false;
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
  for (const h of humans) for (const name in h.segments) meshes.push(h.segments[name].mesh);
  for (const c of crates) meshes.push(c.mesh);

  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0) return;
  const hit = hits[0];

  for (const h of humans) {
    for (const name in h.segments) {
      if (h.segments[name].mesh === hit.object) {
        gs.grabbed = { kind: 'human', human: h, segmentName: name, body: h.segments[name].body };
        setClawClosed(side === 'L' ? clawL : clawR, true);
        document.getElementById('crosshair').classList.add('grab');
        return;
      }
    }
  }
  for (const c of crates) {
    if (c.mesh === hit.object) {
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
    gs.grabbed.body.applyImpulse({ x: dir.x * imp, y: dir.y * imp + 8, z: dir.z * imp }, true);
  }
  gs.grabbed = null;
  gs.strain = 0;
  setClawClosed(side === 'L' ? clawL : clawR, false);
  if (!grabState.L.grabbed && !grabState.R.grabbed)
    document.getElementById('crosshair').classList.remove('grab');
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
// AI: pose-контроллер активного рэгдолла
// ============================================================
function updateHumanAI(human, dt, time) {
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

  if (!human.alive) return; // мёртвые — просто рэгдолл

  // Проверка: захвачен ли человек вообще
  let isGrabbed = false;
  for (const side of ['L', 'R']) {
    const g = grabState[side].grabbed;
    if (g?.kind === 'human' && g.human === human) { isGrabbed = true; break; }
  }

  const pelvis = human.segments.pelvis.body;
  const pp = pelvis.translation();
  const dx = yawObj.position.x - pp.x;
  const dz = yawObj.position.z - pp.z;
  const dist = Math.sqrt(dx*dx + dz*dz);

  let walking = false;
  let attackNow = false;

  if (!isGrabbed) {
    human.facing = Math.atan2(dx, dz);

    if (dist > 2.2) {
      // Идёт к игроку
      const nx = dx / dist, nz = dz / dist;
      human.targetPos.x += nx * 1.8 * dt;
      human.targetPos.z += nz * 1.8 * dt;
      // Клэмп внутри арены
      const r = Math.hypot(human.targetPos.x, human.targetPos.z);
      if (r > ARENA - 2) {
        human.targetPos.x *= (ARENA - 2) / r;
        human.targetPos.z *= (ARENA - 2) / r;
      }
      walking = true;
    } else {
      human.attackCd -= dt;
      if (human.attackCd <= 0) { human.attackCd = 1.2; attackNow = true; }
    }
  }

  const cos = Math.cos(human.facing);
  const sin = Math.sin(human.facing);
  const bob = walking ? Math.sin(time * 6) * 0.03 : 0;
  const rootY = ROOT_Y + bob;

  // Pose-контроллер: каждый сегмент пружиной тянется к своей точке
  for (const name in human.segments) {
    // Пропускаем: захваченный игроком
    let skip = false;
    for (const side of ['L', 'R']) {
      const g = grabState[side].grabbed;
      if (g?.kind === 'human' && g.human === human && g.segmentName === name) { skip = true; break; }
    }
    if (skip) continue;
    // Пропускаем оторванный (и его детей)
    if (isDetached(human, name)) continue;

    const off = STANDING_OFFSETS[name];
    if (!off) continue;

    let lx = off.x, lz = off.z;

    // Анимация ходьбы: ноги и руки качаются
    if (walking) {
      const phase = time * 6;
      const isLeft = name.endsWith('L');
      const isLeg = name.startsWith('thigh') || name.startsWith('shin');
      const isArm = name.startsWith('upperArm') || name.startsWith('forearm');
      if (isLeg || isArm) {
        const sidePhase = isLeft ? 0 : Math.PI;
        const amp = isLeg ? 0.2 : 0.1;
        lz += Math.sin(phase + sidePhase) * amp;
      }
    }

    // Поворот локального оффсета по facing
    const wx = lx * cos + lz * sin;
    const wz = -lx * sin + lz * cos;

    const tx = human.targetPos.x + wx;
    const ty = rootY + off.y;
    const tz = human.targetPos.z + wz;

    const seg = human.segments[name];
    const body = seg.body;
    const pos = body.translation();
    const vel = body.linvel();

    const fx = (tx - pos.x) * POSE_KP - vel.x * POSE_KD;
    const fy = (ty - pos.y) * POSE_KP - vel.y * POSE_KD;
    const fz = (tz - pos.z) * POSE_KP - vel.z * POSE_KD;

    body.applyImpulse({ x: fx * dt, y: fy * dt, z: fz * dt }, true);

    // Гасим вращение
    const av = body.angvel();
    body.applyTorqueImpulse({ x: -av.x * 12 * dt, y: -av.y * 12 * dt, z: -av.z * 12 * dt }, true);
  }

  // Атака
  if (attackNow) {
    robotHP -= 10;
    updateHUD();
    const arm = human.segments.upperArmR.body;
    const ap = arm.translation();
    const ax = yawObj.position.x - ap.x;
    const ay = yawObj.position.y - ap.y;
    const az = yawObj.position.z - ap.z;
    const alen = Math.sqrt(ax*ax + ay*ay + az*az) || 1;
    arm.applyImpulse({ x: ax/alen*15, y: ay/alen*8, z: az/alen*15 }, true);
  }
}

// ============================================================
// ВОЛНЫ
// ============================================================
let wave = 0;
let spawnQueue = [];
let spawnTimer = 0;
let nextWaveCooldown = 0;

function startWave() {
  wave++;
  document.getElementById('wave').textContent = wave;
  const count = Math.min(3 + wave, 8);
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
const camWorldPos = new THREE.Vector3();
const camDir = new THREE.Vector3();
const targetPos = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now() / 1000;
  const dt = Math.min(now - lastTime, 0.1);
  lastTime = now;
  acc += dt;

  while (acc >= FIXED_DT) {
    world.step();
    acc -= FIXED_DT;
  }

  // --- Игрок ---
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
      const r = Math.hypot(yawObj.position.x, yawObj.position.z);
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

  // --- Захват: пружина + strain ---
  camera.getWorldPosition(camWorldPos);
  camera.getWorldQuaternion(tmpQ);
  camDir.set(0, 0, -1).applyQuaternion(tmpQ);

  for (const side of ['L', 'R']) {
    const gs = grabState[side];
    if (!gs.grabbed) continue;

    const body = gs.grabbed.body;
    const bt = body.translation();
    const vel = body.linvel();
    const mass = Math.max(body.mass(), 0.05);

    targetPos.copy(camWorldPos).addScaledVector(camDir, 1.6);
    const dx = targetPos.x - bt.x;
    const dy = targetPos.y - bt.y;
    const dz = targetPos.z - bt.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

    // Пружина к точке захвата
    const kGrab = 500, kdGrab = 50;
    const fx = dx * kGrab * mass - vel.x * kdGrab * mass;
    const fy = dy * kGrab * mass - vel.y * kdGrab * mass;
    const fz = dz * kGrab * mass - vel.z * kdGrab * mass;
    body.applyImpulse({ x: fx * dt, y: fy * dt, z: fz * dt }, true);

    // Strain (только для конечностей)
    if (gs.grabbed.kind === 'human') {
      const name = gs.grabbed.segmentName;
      if (name === 'torso' || name === 'pelvis') continue;

      // strain растёт если сегмент не может дотянуться до цели (тянут)
      if (dist > 0.3) gs.strain += dt * 1.8;
      else gs.strain += dt * 0.5;

      const breakTime = name === 'head' ? 0.5 : 1.4;
      if (gs.strain > breakTime) {
        const human = gs.grabbed.human;
        const jointName = human.parentJointOf[name];
        if (jointName && !human.joints[jointName].broken) {
          // Импульс вырывания — конечность отлетает
          const pushDir = { x: dx/dist * 12, y: dy/dist * 12 + 3, z: dz/dist * 12 };
          body.applyImpulse(pushDir, true);
          breakJoint(human, jointName);
        }
        gs.grabbed = null;
        gs.strain = 0;
        setClawClosed(side === 'L' ? clawL : clawR, false);
        if (!grabState.L.grabbed && !grabState.R.grabbed)
          document.getElementById('crosshair').classList.remove('grab');
      }
    }
  }

  // --- AI + синхронизация мешей ---
  for (const h of humans) {
    updateHumanAI(h, dt, now);
    for (const name in h.segments) {
      const seg = h.segments[name];
      const t = seg.body.translation();
      const r = seg.body.rotation();
      seg.mesh.position.set(t.x, t.y, t.z);
      seg.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  for (const c of crates) {
    const t = c.body.translation();
    const r = c.body.rotation();
    c.mesh.position.set(t.x, t.y, t.z);
    c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  // --- Спавн ---
  spawnTimer += dt;
  if (spawnQueue.length > 0 && spawnTimer > 0.6) {
    spawnTimer = 0;
    createHuman(spawnQueue.shift());
  }

  // --- Проверка зачистки волны ---
  if (nextWaveCooldown > 0) {
    nextWaveCooldown -= dt;
    if (nextWaveCooldown <= 0) startWave();
  } else if (spawnQueue.length === 0 && humans.length > 0) {
    const allDead = humans.every(h => !h.alive);
    if (allDead) {
      showMsg('ВОЛНА ЗАЧИЩЕНА', '#0f0');
      nextWaveCooldown = 3.0;
    }
  }

  updateBlood(dt);

  if (robotHP <= 0) {
    robotHP = 100;
    updateHUD();
    showMsg('СИСТЕМА ПЕРЕЗАГРУЖЕНА', '#0f0');
  }

  renderer.render(scene, camera);
}

animate();
