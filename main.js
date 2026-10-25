import * as THREE from 'three';
import RAPIER from 'rapier';
import { Howl, Howler } from 'howler';

/* =========================================================
   1. КОНСТАНТЫ
   ========================================================= */
const K = {
  ROBOT_MASS: 400, ROBOT_RADIUS: 0.55, ROBOT_HALF_HEIGHT: 0.9,
  ROBOT_SPEED: 6, ROBOT_JUMP: 5,
  ROBOT_DASH_IMPULSE: 2400, ROBOT_DASH_COOLDOWN: 0.9,
  ROBOT_HP_MAX: 100, ROBOT_REPAIR_PCT: 0.25,

  HUMAN_MOTOR_STIFFNESS: 900, HUMAN_MOTOR_DAMPING: 90,
  HUMAN_WALK_PHASE_SPEED: 4.0, HUMAN_HIP_AMP: 0.35, HUMAN_KNEE_AMP: 0.7,
  HUMAN_WALK_IMPULSE_K: 400,
  HUMAN_UPRIGHT_K: 500, HUMAN_UPRIGHT_D: 50,

  RIP_FORCE_BASE: 9000, RIP_EFF_MIN: 0.4,
  GRAB_RADIUS: 3.2, SHOCK_JOINT_MULT: 0.7,
  DEATH_LIMB_THRESHOLD: 3, DEATH_BLEEDOUT_TIME: 5.0,

  THROW_LIMB_IMPULSE: 3500, THROW_BODY_IMPULSE: 1800, THROW_WEAPON_IMPULSE: 1500,

  AI_SPEED_BASE: 1.4, AI_WIND_UP_SEC: 0.18,
  MORALE_DROP_PER_KILL: 20, MORALE_FLEE_THRESHOLD: 30, MORALE_RADIUS: 8,

  ARENA_RADIUS: 14, ARENA_WALL_HEIGHT: 2, ARENA_WALL_SEGMENTS: 24,

  FIXED_DT: 1 / 60, GRAVITY: -20, MAX_SUBSTEPS: 5,

  CAM_MIN_DIST: 4, CAM_MAX_DIST: 12, CAM_DEFAULT_DIST: 7.5,
  CAM_MIN_PITCH: 0.15, CAM_MAX_PITCH: 1.2,
  CAM_YAW_SENS: 0.0035, CAM_PITCH_SENS: 0.0030,
  CAM_TARGET_HEIGHT: 1.6, CAM_SMOOTH: 8,

  WAVE_PAUSE_SEC: 5.0,
};

/* =========================================================
   2. EVENT BUS
   ========================================================= */
class EventBus {
  constructor() { this.map = new Map(); }
  on(evt, h) {
    let s = this.map.get(evt);
    if (!s) this.map.set(evt, s = new Set());
    s.add(h);
    return () => s.delete(h);
  }
  emit(evt, ...args) { this.map.get(evt)?.forEach(h => h(...args)); }
}
const eventBus = new EventBus();

/* =========================================================
   3. REGISTRY
   ========================================================= */
const colliderRegistry = new Map();
const weaponColliderRegistry = new Map();

/* =========================================================
   4. УТИЛИТЫ
   ========================================================= */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* =========================================================
   5. МАТЕРИАЛЫ
   ========================================================= */
const MAT = {
  steel: new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.55, metalness: 0.85 }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.7, metalness: 0.6 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xd8a888, roughness: 0.75 }),
  clothRed: new THREE.MeshStandardMaterial({ color: 0x8a2020, roughness: 0.95 }),
  clothBlue: new THREE.MeshStandardMaterial({ color: 0x204a8a, roughness: 0.95 }),
  clothGreen: new THREE.MeshStandardMaterial({ color: 0x207a30, roughness: 0.95 }),
  clothBrown: new THREE.MeshStandardMaterial({ color: 0x5a4020, roughness: 0.95 }),
};
const CLOTH_POOL = [MAT.clothRed, MAT.clothBlue, MAT.clothGreen, MAT.clothBrown];

/* =========================================================
   6. СКЕЛЕТ ЧЕЛОВЕКА
   ========================================================= */
const SEGMENTS = [
  { id:'torso',    shape:'capsule', halfHeight:0.10, radius:0.15, restPos:[0,1.37,0], mass:22, material:'cloth' },
  { id:'pelvis',   shape:'box', halfExtents:[0.17,0.10,0.12], restPos:[0,1.02,0], mass:14, material:'cloth' },
  { id:'head',     shape:'sphere', radius:0.11, restPos:[0,1.71,0], mass:5, material:'skin' },
  { id:'upperArmL',shape:'capsule', halfHeight:0.13, radius:0.05, restPos:[-0.20,1.34,0], mass:3, material:'skin' },
  { id:'upperArmR',shape:'capsule', halfHeight:0.13, radius:0.05, restPos:[ 0.20,1.34,0], mass:3, material:'skin' },
  { id:'forearmL', shape:'capsule', halfHeight:0.12, radius:0.045,restPos:[-0.20,0.995,0],mass:2.5,material:'skin' },
  { id:'forearmR', shape:'capsule', halfHeight:0.12, radius:0.045,restPos:[ 0.20,0.995,0],mass:2.5,material:'skin' },
  { id:'thighL',   shape:'capsule', halfHeight:0.15, radius:0.07, restPos:[-0.10,0.70,0], mass:8, material:'cloth' },
  { id:'thighR',   shape:'capsule', halfHeight:0.15, radius:0.07, restPos:[ 0.10,0.70,0], mass:8, material:'cloth' },
  { id:'shinL',    shape:'capsule', halfHeight:0.15, radius:0.06, restPos:[-0.10,0.27,0], mass:4, material:'cloth' },
  { id:'shinR',    shape:'capsule', halfHeight:0.15, radius:0.06, restPos:[ 0.10,0.27,0], mass:4, material:'cloth' },
];

const JOINTS = [
  { id:'neck', a:'torso', b:'head', type:'spherical', anchorA:[0,0.23,0], anchorB:[0,-0.11,0], hp:100 },
  { id:'spine',a:'torso', b:'pelvis', type:'spherical', anchorA:[0,-0.17,0], anchorB:[0,0.18,0], hp:200 },
  { id:'shoulderL',a:'torso',b:'upperArmL',type:'spherical',anchorA:[-0.20,0.15,0],anchorB:[0,0.18,0],hp:80 },
  { id:'shoulderR',a:'torso',b:'upperArmR',type:'spherical',anchorA:[ 0.20,0.15,0],anchorB:[0,0.18,0],hp:80 },
  { id:'elbowL',a:'upperArmL',b:'forearmL',type:'revolute',axis:[1,0,0],anchorA:[0,-0.18,0],anchorB:[0,0.165,0],hp:55 },
  { id:'elbowR',a:'upperArmR',b:'forearmR',type:'revolute',axis:[1,0,0],anchorA:[0,-0.18,0],anchorB:[0,0.165,0],hp:55 },
  { id:'hipL',a:'pelvis',b:'thighL',type:'revolute',axis:[1,0,0],anchorA:[-0.10,-0.10,0],anchorB:[0,0.22,0],hp:95 },
  { id:'hipR',a:'pelvis',b:'thighR',type:'revolute',axis:[1,0,0],anchorA:[ 0.10,-0.10,0],anchorB:[0,0.22,0],hp:95 },
  { id:'kneeL',a:'thighL',b:'shinL',type:'revolute',axis:[1,0,0],anchorA:[0,-0.22,0],anchorB:[0,0.21,0],hp:65 },
  { id:'kneeR',a:'thighR',b:'shinR',type:'revolute',axis:[1,0,0],anchorA:[0,-0.22,0],anchorB:[0,0.21,0],hp:65 },
];

const LIMB_TO_JOINT = {
  head:'neck',
  upperArmL:'shoulderL', upperArmR:'shoulderR',
  forearmL:'elbowL', forearmR:'elbowR',
  thighL:'hipL', thighR:'hipR',
  shinL:'kneeL', shinR:'kneeR',
};
const DETACHABLE = ['head','upperArmL','upperArmR','forearmL','forearmR','thighL','thighR','shinL','shinR'];

/* =========================================================
   7. МЕШИ ЧЕЛОВЕКА
   ========================================================= */
function buildLimbMesh(def, material) {
  let geo;
  if (def.shape === 'capsule') geo = new THREE.CapsuleGeometry(def.radius, def.halfHeight, 4, 10);
  else if (def.shape === 'sphere') geo = new THREE.IcosahedronGeometry(def.radius, 1);
  else { const [hx,hy,hz] = def.halfExtents; geo = new THREE.BoxGeometry(hx*2, hy*2, hz*2); }
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  if (def.id === 'head' && def.radius) {
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x101010 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), eyeMat);
      eye.position.set(sx * 0.045, 0.02, def.radius * 0.85);
      mesh.add(eye);
    }
  }
  return mesh;
}

/* =========================================================
   8. HUMAN FACTORY
   ========================================================= */
let nextEid = 1;
let nextHumanId = 0;

function cgHuman(id) {
  const bit = 4 + (id % 12);
  const mem = 1 << bit;
  return (mem << 16) | (0xFFFF & ~mem);
}

class HumanFactory {
  constructor(engine) { this.engine = engine; this.all = []; }
  humans() { return this.all; }

  spawn(opts = {}) {
    const pos = opts.position?.clone() ?? new THREE.Vector3();
    const yaw = opts.yaw ?? 0;
    const humanId = nextHumanId++;
    const eid = nextEid++;
    const group = cgHuman(humanId);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), yaw);
    const cloth = opts.clothMaterial ?? pick(CLOTH_POOL);

    const body = {
      eid, humanId,
      limbs: new Map(), joints: new Map(),
      ai: {
        state: opts.aiState ?? 'idle',
        stateTimer: 0,
        targetPos: opts.targetPos?.clone() ?? null,
        walkPhase: Math.random() * Math.PI * 2,
        moveSpeed: K.AI_SPEED_BASE + Math.random() * 0.4,
        painTolerance: 0.6 + Math.random() * 0.8,
        attackCooldown: 0,
        hasWeapon: false,
        role: Math.random() < 0.6 ? 'front' : 'flank',
      },
      morale: 100, blood: 100, alive: true, xEyesAdded: false,
    };

    for (const def of SEGMENTS) {
      const local = new THREE.Vector3(...def.restPos);
      const worldPos = local.clone().applyQuaternion(yawQ).add(pos);
      const rb = this.engine.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(worldPos.x, worldPos.y, worldPos.z)
          .setRotation({ x: yawQ.x, y: yawQ.y, z: yawQ.z, w: yawQ.w })
          .setLinearDamping(0.05).setAngularDamping(0.5)
          .setCcdEnabled(def.id === 'head')
      );
      const cDesc = this.makeCollider(def).setCollisionGroups(group);
      const collider = this.engine.world.createCollider(cDesc, rb);
      const material = def.material === 'skin' ? MAT.skin : cloth;
      const mesh = buildLimbMesh(def, material);
      mesh.position.copy(worldPos);
      mesh.quaternion.copy(yawQ);
      this.engine.scene.add(mesh);
      body.limbs.set(def.id, { id: def.id, body: rb, collider, mesh, detached: false });
      colliderRegistry.set(collider.handle, { human: body, segmentId: def.id });
    }

    for (const jd of JOINTS) {
      const rbA = body.limbs.get(jd.a).body;
      const rbB = body.limbs.get(jd.b).body;
      const jData = this.makeJointData(jd);
      const joint = this.engine.world.createImpulseJoint(jData, rbA, rbB, true);
      if (joint.setContactsEnabled) joint.setContactsEnabled(false);
      body.joints.set(jd.id, { id: jd.id, def: jd, joint, stress: 0, broken: false });
    }

    for (const j of body.joints.values()) {
      if (j.def.type !== 'revolute') continue;
      j.joint.configureMotorPosition(0, K.HUMAN_MOTOR_STIFFNESS, K.HUMAN_MOTOR_DAMPING);
    }

    this.all.push(body);
    return body;
  }

  markDead(body) {
    if (!body.alive) return;
    body.alive = false;
    body.ai.state = 'dead';
    for (const j of body.joints.values()) {
      if (j.broken) continue;
      if (j.def.type === 'revolute') j.joint.configureMotorPosition(0, 0, 0);
    }
    const head = body.limbs.get('head');
    if (head && !head.detached && !body.xEyesAdded) this.addXEyes(head, body);
    eventBus.emit('human:death', body);
  }

  addXEyes(head, body) {
    body.xEyesAdded = true;
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (const sx of [-1, 1]) {
      const a = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.012), mat);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.012), mat);
      a.rotation.z = Math.PI / 4; b.rotation.z = -Math.PI / 4;
      const cross = new THREE.Group();
      cross.add(a, b);
      cross.position.set(sx * 0.045, 0.02, 0.108);
      g.add(cross);
    }
    head.mesh.add(g);
  }

  makeCollider(def) {
    let c;
    if (def.shape === 'capsule') c = RAPIER.ColliderDesc.capsule(def.halfHeight, def.radius);
    else if (def.shape === 'sphere') c = RAPIER.ColliderDesc.ball(def.radius);
    else c = RAPIER.ColliderDesc.cuboid(...def.halfExtents);
    return c.setMass(def.mass).setFriction(0.9).setRestitution(0.02);
  }

  makeJointData(jd) {
    const a = { x: jd.anchorA[0], y: jd.anchorA[1], z: jd.anchorA[2] };
    const b = { x: jd.anchorB[0], y: jd.anchorB[1], z: jd.anchorB[2] };
    if (jd.type === 'spherical') return RAPIER.JointData.spherical(a, b);
    const ax = jd.axis;
    return RAPIER.JointData.revolute(a, b, { x: ax[0], y: ax[1], z: ax[2] });
  }
}

/* =========================================================
   9. ОРУЖИЕ — определения
   ========================================================= */
const WEAPONS = {
  bat:     { kind:'bat',     damage:12, mass:1.2, reach:1.1, cooldown:1.1, canDisarm:true, length:0.75, thickness:0.06, color:0x6a4520, attachmentLocal:[0,-0.14,0], gripLocal:[0,0,0] },
  pipe:    { kind:'pipe',    damage:15, mass:2.0, reach:1.3, cooldown:1.3, canDisarm:true, length:0.9,  thickness:0.05, color:0x555a60, attachmentLocal:[0,-0.14,0], gripLocal:[0,0,0] },
  axe:     { kind:'axe',     damage:22, mass:2.5, reach:1.0, cooldown:1.6, canDisarm:true, length:0.7,  thickness:0.08, color:0x3a2a1a, attachmentLocal:[0,-0.14,0], gripLocal:[0,0,0] },
  sword:   { kind:'sword',   damage:25, mass:2.0, reach:1.2, cooldown:1.2, canDisarm:false,length:0.95, thickness:0.04, color:0xc0c8d0, attachmentLocal:[0,-0.14,0], gripLocal:[0,0,0] },
  pistol:  { kind:'pistol',  damage:8,  mass:1.0, reach:30,  cooldown:1.5, canDisarm:true, length:0.25, thickness:0.05, color:0x222228, attachmentLocal:[0,-0.13,0], gripLocal:[0,0,0] },
  shotgun: { kind:'shotgun', damage:30, mass:3.0, reach:8,   cooldown:2.2, canDisarm:true, length:0.85, thickness:0.07, color:0x4a2010, attachmentLocal:[0,-0.14,0], gripLocal:[0,0,0] },
};

/* =========================================================
   10. WEAPON SYSTEM
   ========================================================= */
let nextWeaponId = 1;
const WPN_FWD = new THREE.Vector3(0, 0, -1);

class WeaponSystem {
  constructor(engine, robot, blood, audio) {
    this.engine = engine; this.robot = robot; this.blood = blood; this.audio = audio;
    this.instances = new Set();
  }
  update() {
    for (const inst of this.instances) {
      const t = inst.body.translation();
      const r = inst.body.rotation();
      inst.mesh.position.set(t.x, t.y, t.z);
      inst.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
  fixedUpdate() {}

  spawn(kind, worldPos, yaw = 0) {
    const def = WEAPONS[kind];
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), yaw);
    const rb = this.engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldPos.x, worldPos.y, worldPos.z)
        .setRotation({ x:q.x, y:q.y, z:q.z, w:q.w })
        .setLinearDamping(0.3).setAngularDamping(0.7).setCcdEnabled(true)
    );
    const col = this.engine.world.createCollider(
      RAPIER.ColliderDesc.cuboid(def.length/2, def.thickness, def.thickness)
        .setMass(def.mass).setFriction(0.6).setRestitution(0.15), rb
    );
    const geo = new THREE.BoxGeometry(def.thickness*2, def.thickness*2, def.length);
    const mat = new THREE.MeshStandardMaterial({
      color: def.color, roughness: 0.7, metalness: def.kind === 'sword' ? 0.9 : 0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.copy(worldPos); mesh.quaternion.copy(q);
    this.engine.scene.add(mesh);

    const inst = { id: nextWeaponId++, def, body: rb, collider: col, mesh, bloodied: false, holder: null, joint: null, lastStrike: 0 };
    this.instances.add(inst);
    weaponColliderRegistry.set(col.handle, inst);
    return inst;
  }

  attachToHuman(human, forearmId, kind) {
    const forearm = human.limbs.get(forearmId);
    if (!forearm || forearm.detached) return;
    const def = WEAPONS[kind];
    const t = forearm.body.translation();
    const r = forearm.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const offset = new THREE.Vector3(0, -0.18, 0).applyQuaternion(q);
    const worldPos = new THREE.Vector3(t.x, t.y, t.z).add(offset);
    const inst = this.spawn(kind, worldPos);
    this.attachJoint(inst, forearm.body, def, 'human', human, forearmId);
  }

  attachJoint(inst, limbBody, def, holderType, human, forearmId) {
    const g = def.gripLocal; const a = def.attachmentLocal;
    const ident = { x:0, y:0, z:0, w:1 };
    const jData = RAPIER.JointData.fixed(
      { x:a[0], y:a[1], z:a[2] }, ident,
      { x:g[0], y:g[1], z:g[2] }, ident
    );
    const joint = this.engine.world.createImpulseJoint(jData, limbBody, inst.body, true);
    inst.joint = joint;
    if (holderType === 'human' && human && forearmId) {
      inst.holder = { type:'human', human, forearm: forearmId };
      human.limbs.get(forearmId).attachedWeapon = inst;
    } else {
      inst.holder = { type:'robot' };
    }
  }

  attachRobotHeld(inst) {
    this.dropFromRobot();
    this.attachJoint(inst, this.robot.getRightHand(), inst.def, 'robot', null, null);
    this.robot.setHeldWeapon(inst);
    this.audio.play('pickup_clank', { pos: this.robot.getRightHandPos() });
  }

  attachToRobot(kind) {
    this.dropFromRobot();
    const t = this.robot.getRightHand().translation();
    const inst = this.spawn(kind, new THREE.Vector3(t.x, t.y, t.z));
    this.attachJoint(inst, this.robot.getRightHand(), inst.def, 'robot', null, null);
    this.robot.setHeldWeapon(inst);
    return inst;
  }

  findWeaponOf(human) {
    for (const inst of this.instances) {
      if (inst.holder?.type === 'human' && inst.holder.human === human) return inst;
    }
    return null;
  }

  tryPickupForRobot() {
    const handPos = this.robot.getRightHandPos();
    let best = null, bestD = 2.4;
    for (const inst of this.instances) {
      if (inst.holder) continue;
      const t = inst.body.translation();
      const d = handPos.distanceTo(new THREE.Vector3(t.x, t.y, t.z));
      if (d < bestD) { bestD = d; best = inst; }
    }
    if (!best) return false;
    this.attachRobotHeld(best);
    return true;
  }

  tryPickupForHuman(human) {
    const torso = human.limbs.get('torso');
    if (!torso) return false;
    const t = torso.body.translation();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    let best = null, bestD = 1.2;
    for (const inst of this.instances) {
      if (inst.holder) continue;
      const wt = inst.body.translation();
      const d = pos.distanceTo(new THREE.Vector3(wt.x, wt.y, wt.z));
      if (d < bestD) { bestD = d; best = inst; }
    }
    if (!best) return false;
    const forearm = human.limbs.get('forearmR');
    if (!forearm || forearm.detached) return false;
    this.attachJoint(best, forearm.body, best.def, 'human', human, 'forearmR');
    return true;
  }

  tryDisarm(human, attackerPos) {
    const inst = this.findWeaponOf(human);
    if (!inst || !inst.def.canDisarm) return false;
    if (inst.holder?.type !== 'human') return false;
    const forearm = human.limbs.get(inst.holder.forearm);
    const t = forearm.body.translation();
    const dx = t.x - attackerPos.x, dy = t.y - attackerPos.y, dz = t.z - attackerPos.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    forearm.body.applyImpulse({ x: dx/len*1800, y: 200, z: dz/len*1800 }, true);
    const chance = human.alive ? 0.6 : 1.0;
    if (Math.random() < chance) { this.drop(inst); return true; }
    return false;
  }

  drop(inst) {
    if (inst.joint) { this.engine.world.removeImpulseJoint(inst.joint, true); inst.joint = null; }
    if (inst.holder?.type === 'human') {
      const limb = inst.holder.human.limbs.get(inst.holder.forearm);
      if (limb) limb.attachedWeapon = null;
      if (inst.holder.human.alive) {
        inst.holder.human.ai.state = 'disarmed';
        inst.holder.human.ai.stateTimer = 0;
      }
    }
    inst.holder = null;
    const t = inst.body.translation();
    this.audio.play('weapon_drop', { pos: new THREE.Vector3(t.x, t.y, t.z) });
  }

  dropFromRobot() {
    const h = this.robot.getHeldWeapon();
    if (!h) return;
    this.drop(h);
    this.robot.setHeldWeapon(null);
  }

  throwWeapon(inst, dir, impulse) {
    if (inst.joint) { this.engine.world.removeImpulseJoint(inst.joint, true); inst.joint = null; }
    inst.holder = null;
    inst.body.applyImpulse({ x: dir.x*impulse, y: dir.y*impulse+200, z: dir.z*impulse }, true);
  }

  onLimbDetached(human, forearmId) {
    for (const inst of this.instances) {
      if (inst.holder?.type === 'human' && inst.holder.human === human && inst.holder.forearm === forearmId) {
        inst.holder = null;
        const l = human.limbs.get(forearmId);
        if (l) l.attachedWeapon = null;
      }
    }
  }

  performStrike(owner) {
    if (owner === 'robot') {
      const held = this.robot.getHeldWeapon();
      if (held) this.strikeWith(held, 'robot');
      return;
    }
    const inst = this.findWeaponOf(owner);
    if (inst) this.strikeWith(inst, owner);
  }

  strikeWith(inst, owner) {
    const now = performance.now();
    if (now - inst.lastStrike < inst.def.cooldown * 1000) return;
    inst.lastStrike = now;

    const wp = inst.body.translation();
    const rot = inst.body.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const dir = WPN_FWD.clone().applyQuaternion(q).normalize();
    const origin = new THREE.Vector3(wp.x, wp.y, wp.z);
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z }
    );
    const hit = this.engine.world.castRay(ray, inst.def.reach, true);
    if (!hit) return;

    const hitPoint = origin.clone().add(dir.clone().multiplyScalar(hit.timeOfImpact));
    const humanRef = colliderRegistry.get(hit.collider.handle);
    if (humanRef) {
      if (humanRef.human !== owner) this.applyHitToHuman(humanRef.human, hitPoint, dir, inst.def);
    } else if (hit.collider.handle === this.robot.getBodyColliderHandle()) {
      this.applyHitToRobot(hitPoint, dir, inst.def);
    }

    if (!inst.bloodied) {
      inst.bloodied = true;
      inst.mesh.material.color.setHex(0x5a1a1a);
    }
    this.audio.play('weapon_hit', { pos: hitPoint, pitch: 0.9 + Math.random() * 0.2 });
    this.blood.burst(hitPoint, dir, 15);
    eventBus.emit('weapon:hit', hitPoint);
  }

  applyHitToHuman(target, hitPoint, dir, def) {
    let best = null, bestD = Infinity;
    for (const limb of target.limbs.values()) {
      if (limb.detached) continue;
      const t = limb.body.translation();
      const d = hitPoint.distanceToSquared(new THREE.Vector3(t.x, t.y, t.z));
      if (d < bestD) { bestD = d; best = limb; }
    }
    if (!best) return;

    const dmg = def.damage;
    best.body.applyImpulse({ x: dir.x*dmg*40, y: dir.y*dmg*40 + dmg*8, z: dir.z*dmg*40 }, true);

    if (def.kind === 'axe' || def.kind === 'sword') {
      const jid = this.nearestJoint(target, hitPoint);
      if (jid) {
        const j = target.joints.get(jid);
        if (j && !j.broken) {
          j.stress += dmg * 1.5;
          if (j.stress >= j.def.hp) eventBus.emit('weapon:cutJoint', target, jid);
        }
      }
    }

    if (def.damage >= 15) {
      const other = this.findWeaponOf(target);
      if (other && other.holder?.type === 'human') {
        const of = target.limbs.get(other.holder.forearm);
        if (of && !of.detached) {
          const t = of.body.translation();
          const d = hitPoint.distanceTo(new THREE.Vector3(t.x, t.y, t.z));
          if (d < 0.5 && Math.random() < 0.2 + def.damage * 0.01) {
            this.drop(other);
            eventBus.emit('weapon:knockedOut', target, other);
          }
        }
      }
    }

    target.morale -= dmg * 0.4;
    if (target.ai.state !== 'grabbed' && target.alive) {
      target.ai.state = 'flinch';
      target.ai.stateTimer = 0.5 / target.ai.painTolerance;
    }
    this.audio.play('punch_flesh', { pos: hitPoint, pitch: 0.85 + Math.random() * 0.3 });
    this.audio.play('scream_hit', { pos: hitPoint, volume: 0.7, pitch: 0.9 + Math.random() * 0.3 });
  }

  applyHitToRobot(hitPoint, dir, def) {
    this.robot.damage(def.damage);
    this.audio.play('punch_metal', { pos: hitPoint });
  }

  nearestJoint(human, point) {
    let best = null, bestD = Infinity;
    for (const [id, j] of human.joints) {
      const a = human.limbs.get(j.def.a);
      if (!a) continue;
      const t = a.body.translation();
      const d = point.distanceToSquared(new THREE.Vector3(t.x, t.y, t.z));
      if (d < bestD && !j.broken) { bestD = d; best = id; }
    }
    return best;
  }
}

/* =========================================================
   11. AUDIO
   ========================================================= */
const SFX_NAMES = [
  'punch_flesh','punch_metal','weapon_hit','bone_snap','squelch_big','wet_tear','stump_pop',
  'grab_hiss','rip_creak','scream_hit','scream_rip','scream_flee','death_gurgle',
  'step_metal','dash_whoosh','pickup_clank','weapon_drop',
];

class AudioSystem {
  constructor() { this.map = new Map(); this.listener = new THREE.Vector3(); this.right = new THREE.Vector3(); }
  init(camera) {
    Howler.volume(0.8);
    for (const name of SFX_NAMES) {
      const howl = new Howl({
        src: [`./sfx/${name}.ogg`], volume: 1, preload: true,
        onloaderror: () => this.fallback(name),
      });
      this.map.set(name, { howl, vol: 1 });
    }
    this.updateListener(camera);
  }
  play(name, opts = {}) {
    const e = this.map.get(name);
    if (!e) return;
    const id = e.howl.play();
    if (id === undefined) return;
    e.howl.volume(opts.volume ?? e.vol, id);
    const rate = opts.rate ?? opts.pitch ?? 1;
    if (rate !== 1) e.howl.rate(rate, id);
    if (opts.pos) {
      const dx = opts.pos.x - this.listener.x, dy = opts.pos.y - this.listener.y, dz = opts.pos.z - this.listener.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      const vol = Math.max(0, 1 / (1 + dist * 0.4));
      const pan = clamp((dx*this.right.x + dz*this.right.z) / Math.max(0.5, dist), -1, 1);
      e.howl.volume(vol * (opts.volume ?? e.vol), id);
      e.howl.stereo(pan, id);
    }
  }
  updateListener(camera) {
    this.listener.setFromMatrixPosition(camera.matrixWorld);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    this.right.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  }
  fallback(name) {
    try {
      const ctx = Howler.ctx;
      if (!ctx) return;
      const dur = 0.15, sr = ctx.sampleRate;
      const buf = ctx.createBuffer(1, Math.floor(sr * dur), sr);
      const ch = buf.getChannelData(0);
      const decay = name.startsWith('scream') ? 0.05 : 0.02;
      for (let i = 0; i < ch.length; i++) {
        const t = i / sr;
        ch[i] = (Math.random() * 2 - 1) * Math.exp(-t / decay) * 0.5;
      }
      const blob = new Blob([this.wav(buf)], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const h = new Howl({ src: [url], format: ['wav'] });
      this.map.set(name, { howl: h, vol: 0.6 });
    } catch (err) {
      console.warn('[audio] fallback failed', name, err);
    }
  }
  wav(buf) {
    const nCh = buf.numberOfChannels, sr = buf.sampleRate;
    const len = buf.length * nCh * 2 + 44;
    const ab = new ArrayBuffer(len); const view = new DataView(ab);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, len-8, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, nCh, true);
    view.setUint32(24, sr, true); view.setUint32(28, sr*nCh*2, true);
    view.setUint16(32, nCh*2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, len-44, true);
    let off = 44;
    for (let i = 0; i < buf.length; i++)
      for (let c = 0; c < nCh; c++) {
        const v = Math.max(-1, Math.min(1, buf.getChannelData(c)[i]));
        view.setInt16(off, v * 0x7fff, true); off += 2;
      }
    return ab;
  }
}

/* =========================================================
   12. BLOOD
   ========================================================= */
const MAX_PARTICLES = 2000;

class BloodSystem {
  constructor(scene) {
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.alive = new Uint8Array(MAX_PARTICLES);
    this.writeIdx = 0;
    this.emitters = [];
    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -1000;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8b0a0a, size: 0.06, sizeAttenuation: true,
      transparent: true, opacity: 0.95, depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  addEmitter(pos, dir, rate = 90, ttl = 6) {
    const e = { pos: pos.clone(), dir: dir.clone().normalize(), rate, accum: 0, ttl, speed: 2.2 + Math.random() * 0.8 };
    this.emitters.push(e);
    return e;
  }
  burst(pos, dir, count = 60) {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(
        dir.x + (Math.random()-0.5)*1.8,
        dir.y + (Math.random()-0.3)*1.5,
        dir.z + (Math.random()-0.5)*1.8,
      ).normalize().multiplyScalar(2 + Math.random() * 3);
      this.spawnParticle(pos, v, 0.7 + Math.random() * 0.5);
    }
  }
  fixedUpdate(dt) {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.ttl -= dt;
      if (e.ttl <= 0) { this.emitters.splice(i, 1); continue; }
      e.accum += e.rate * dt;
      while (e.accum >= 1) {
        e.accum -= 1;
        const spread = 0.45;
        const v = new THREE.Vector3(
          e.dir.x + (Math.random()-0.5)*spread,
          e.dir.y + Math.random()*spread*1.2,
          e.dir.z + (Math.random()-0.5)*spread,
        ).normalize().multiplyScalar(e.speed * (0.6 + Math.random()*0.7));
        this.spawnParticle(e.pos, v, 0.6 + Math.random()*0.4);
      }
    }
  }
  update(dt) {
    const p = this.positions, v = this.velocities, l = this.life, a = this.alive;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!a[i]) continue;
      l[i] -= dt;
      if (l[i] <= 0) { a[i] = 0; p[i*3+1] = -1000; continue; }
      v[i*3]     *= (1 - 0.4 * dt);
      v[i*3 + 1] += -18 * dt;
      v[i*3 + 2] *= (1 - 0.4 * dt);
      p[i*3]     += v[i*3]     * dt;
      p[i*3 + 1] += v[i*3 + 1] * dt;
      p[i*3 + 2] += v[i*3 + 2] * dt;
      if (p[i*3 + 1] < 0.02) {
        p[i*3 + 1] = 0.02;
        v[i*3] = v[i*3+1] = v[i*3+2] = 0;
        l[i] = Math.min(l[i], 0.15);
      }
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
  }
  spawnParticle(pos, vel, ttl) {
    const i = this.writeIdx;
    this.writeIdx = (this.writeIdx + 1) % MAX_PARTICLES;
    this.positions[i*3]     = pos.x + (Math.random()-0.5)*0.03;
    this.positions[i*3 + 1] = pos.y + (Math.random()-0.5)*0.03;
    this.positions[i*3 + 2] = pos.z + (Math.random()-0.5)*0.03;
    this.velocities[i*3]     = vel.x;
    this.velocities[i*3 + 1] = vel.y;
    this.velocities[i*3 + 2] = vel.z;
    this.life[i] = ttl;
    this.alive[i] = 1;
  }
}

/* =========================================================
   13. ROBOT
   ========================================================= */
class RobotController {
  constructor(engine) {
    this.engine = engine;
    this.yaw = 0; this.pitch = 0.55;
    this.camDist = K.CAM_DEFAULT_DIST;
    this.camTarget = new THREE.Vector3();
    this.keys = new Set();
    this.dashTimer = 0;
    this._eHeld = false; this._fHeld = false;
    this.hp = K.ROBOT_HP_MAX;
    this.bodyColliderHandle = -1;
    this.heldWeapon = null;
    this.handTargetPos = new THREE.Vector3();
    this.ripHold = false;

    this.createBody();
    this.createVisual();
    this.bindInput();
  }
  createBody() {
    this.body = this.engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 3, 0)
        .setLinearDamping(0.5).setAngularDamping(0.9)
        .lockRotations().setCcdEnabled(true)
    );
    const col = this.engine.world.createCollider(
      RAPIER.ColliderDesc.capsule(K.ROBOT_HALF_HEIGHT, K.ROBOT_RADIUS)
        .setMass(K.ROBOT_MASS).setFriction(0.4).setRestitution(0.05), this.body
    );
    this.bodyColliderHandle = col.handle;

    this.rightHand = this.engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 3, 0)
    );
    this.engine.world.createCollider(
      RAPIER.ColliderDesc.ball(0.12).setCollisionGroups(0), this.rightHand
    );
  }
  createVisual() {
    this.root = new THREE.Group();
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(K.ROBOT_RADIUS, K.ROBOT_HALF_HEIGHT * 2, 8, 16), MAT.steel);
    torso.castShadow = true; torso.receiveShadow = true;
    this.root.add(torso);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.2), MAT.steelDark);
    plate.position.set(0, 0.3, K.ROBOT_RADIUS * 0.95);
    plate.castShadow = true;
    this.root.add(plate);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), MAT.steel);
    head.position.y = K.ROBOT_HALF_HEIGHT + 0.35;
    head.castShadow = true;
    this.root.add(head);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), eyeMat);
      eye.position.set(sx * 0.13, K.ROBOT_HALF_HEIGHT + 0.37, 0.28);
      this.root.add(eye);
    }
    for (const sx of [-1, 1]) {
      const sh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), MAT.steelDark);
      sh.position.set(sx * (K.ROBOT_RADIUS + 0.1), 0.45, 0);
      sh.castShadow = true;
      this.root.add(sh);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.7, 4, 8), MAT.steel);
      arm.position.set(sx * (K.ROBOT_RADIUS + 0.1), 0.05, 0);
      arm.castShadow = true;
      this.root.add(arm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), MAT.steelDark);
      hand.position.set(sx * (K.ROBOT_RADIUS + 0.1), -0.38, 0);
      hand.castShadow = true;
      this.root.add(hand);
    }
    this.engine.scene.add(this.root);
  }
  bindInput() {
    addEventListener('keydown', e => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyE' && !this._eHeld) { this._eHeld = true; eventBus.emit('robot:pickup'); }
      if (e.code === 'KeyF' && !this._fHeld) { this._fHeld = true; eventBus.emit('robot:throw'); }
    });
    addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (e.code === 'KeyE') this._eHeld = false;
      if (e.code === 'KeyF') this._fHeld = false;
    });
    addEventListener('mousemove', e => {
      if (document.pointerLockElement !== this.engine.renderer.domElement) return;
      this.yaw -= e.movementX * K.CAM_YAW_SENS;
      this.pitch = clamp(this.pitch + e.movementY * K.CAM_PITCH_SENS, K.CAM_MIN_PITCH, K.CAM_MAX_PITCH);
    });
    addEventListener('mousedown', e => {
      if (document.pointerLockElement !== this.engine.renderer.domElement) {
        this.engine.renderer.domElement.requestPointerLock();
        return;
      }
      if (e.button === 0) eventBus.emit('robot:grabDown');
      if (e.button === 2) { this.ripHold = true; eventBus.emit('robot:ripDown'); }
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) eventBus.emit('robot:grabUp');
      if (e.button === 2) { this.ripHold = false; eventBus.emit('robot:ripUp'); }
    });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('wheel', e => {
      this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 0.6, K.CAM_MIN_DIST, K.CAM_MAX_DIST);
    }, { passive: true });
  }
  fixedUpdate(dt) {
    this.dashTimer = Math.max(0, this.dashTimer - dt);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dir = new THREE.Vector3();
    if (this.keys.has('KeyW')) dir.add(fwd);
    if (this.keys.has('KeyS')) dir.sub(fwd);
    if (this.keys.has('KeyD')) dir.add(right);
    if (this.keys.has('KeyA')) dir.sub(right);

    const vel = this.body.linvel();
    const tv = dir.lengthSq() > 0 ? dir.normalize().multiplyScalar(K.ROBOT_SPEED) : new THREE.Vector3();
    this.body.applyImpulse({
      x: (tv.x - vel.x) * K.ROBOT_MASS * 4 * dt,
      y: 0,
      z: (tv.z - vel.z) * K.ROBOT_MASS * 4 * dt,
    }, true);

    if (this.keys.has('Space') && this.isGrounded()) {
      this.body.applyImpulse({ x: 0, y: K.ROBOT_MASS * K.ROBOT_JUMP, z: 0 }, true);
    }
    if (this.keys.has('ShiftLeft') && this.dashTimer === 0 && dir.lengthSq() > 0) {
      const d = dir.clone().normalize().multiplyScalar(K.ROBOT_DASH_IMPULSE);
      this.body.applyImpulse({ x: d.x, y: 0, z: d.z }, true);
      this.dashTimer = K.ROBOT_DASH_COOLDOWN;
    }

    const t = this.body.translation();
    const camDir = new THREE.Vector3();
    this.engine.camera.getWorldDirection(camDir);
    const tp = new THREE.Vector3(t.x, t.y, t.z);
    const target = tp.clone().add(new THREE.Vector3(0, 0.4, 0)).add(camDir.clone().multiplyScalar(1.4));
    this.handTargetPos.copy(target);
    this.rightHand.setNextKinematicTranslation({ x: target.x, y: target.y, z: target.z });
  }
  isGrounded() {
    const p = this.body.translation();
    const ray = new RAPIER.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.engine.world.castRay(
      ray, K.ROBOT_HALF_HEIGHT + K.ROBOT_RADIUS + 0.15, true,
      undefined, undefined, undefined, this.body
    );
    return !!hit;
  }
  update(dt) {
    const t = this.body.translation();
    this.root.position.set(t.x, t.y, t.z);
    const tp = new THREE.Vector3(t.x, t.y + K.CAM_TARGET_HEIGHT, t.z);
    this.camTarget.lerp(tp, 1 - Math.exp(-K.CAM_SMOOTH * dt));
    const r = this.camDist * Math.cos(this.pitch);
    const y = this.camDist * Math.sin(this.pitch);
    this.engine.camera.position.set(
      this.camTarget.x + Math.sin(this.yaw) * r,
      this.camTarget.y + y,
      this.camTarget.z + Math.cos(this.yaw) * r
    );
    this.engine.camera.lookAt(this.camTarget);
  }
  getPosition() { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); }
  getForward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  getRightHand() { return this.rightHand; }
  getRightHandPos() { return this.handTargetPos.clone(); }
  getCamera() { return this.engine.camera; }
  getWorld() { return this.engine.world; }
  getHp() { return this.hp; }
  getBodyColliderHandle() { return this.bodyColliderHandle; }
  getHeldWeapon() { return this.heldWeapon; }
  setHeldWeapon(w) { this.heldWeapon = w; }
  damage(amount) {
    this.hp = Math.max(0, this.hp - amount);
    this.engine.addShake(0.05, 0.15);
    eventBus.emit('robot:damaged', amount);
    if (this.hp <= 0) eventBus.emit('robot:dead');
  }
  repair(pct) {
    this.hp = Math.min(K.ROBOT_HP_MAX, this.hp + K.ROBOT_HP_MAX * pct);
    eventBus.emit('robot:healed');
  }
}

/* =========================================================
   14. GRAB
   ========================================================= */
class GrabSystem {
  constructor(robot) { this.robot = robot; this.grab = null; this._v = new THREE.Vector3(); }
  current() { return this.grab; }
  tryGrab() {
    if (this.grab) return false;
    const cam = this.robot.getCamera();
    const origin = cam.position;
    const dir = this._v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z }
    );
    const hit = this.robot.getWorld().castRay(ray, 60, true);
    if (!hit) return false;
    const ref = colliderRegistry.get(hit.collider.handle);
    if (!ref) return false;
    const limb = ref.human.limbs.get(ref.segmentId);
    if (!limb) return false;

    const handPos = this.robot.getRightHandPos();
    const t = limb.body.translation();
    if (handPos.distanceTo(new THREE.Vector3(t.x, t.y, t.z)) > K.GRAB_RADIUS) return false;

    const hitWorld = new THREE.Vector3(
      origin.x + dir.x * hit.timeOfImpact,
      origin.y + dir.y * hit.timeOfImpact,
      origin.z + dir.z * hit.timeOfImpact
    );
    const q = limb.body.rotation();
    const worldQ = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const local = hitWorld.clone()
      .sub(new THREE.Vector3(t.x, t.y, t.z))
      .applyQuaternion(worldQ.invert());

    const jData = RAPIER.JointData.spherical(
      { x: 0, y: 0, z: 0 },
      { x: local.x, y: local.y, z: local.z }
    );
    const joint = this.robot.getWorld().createImpulseJoint(
      jData, this.robot.getRightHand(), limb.body, true
    );
    this.grab = { human: ref.human, segmentId: ref.segmentId, limb, joint };
    if (!limb.detached && ref.human.alive) ref.human.ai.state = 'grabbed';
    return true;
  }
  release() {
    if (!this.grab) return;
    this.robot.getWorld().removeImpulseJoint(this.grab.joint, true);
    if (this.grab.human.alive && !this.grab.limb.detached) this.grab.human.ai.state = 'approach';
    this.grab = null;
  }
  forceRelease() { this.grab = null; }
}

/* =========================================================
   15. RIP
   ========================================================= */
class RipSystem {
  constructor(engine, robot, grab, blood, factory, weaponSys, audio) {
    this.engine = engine; this.robot = robot; this.grab = grab;
    this.blood = blood; this.factory = factory; this.weaponSys = weaponSys; this.audio = audio;
    this._dir = new THREE.Vector3(); this._tmp = new THREE.Vector3();
    this.dying = [];

    eventBus.on('weapon:cutJoint', (human, jid) => {
      const j = human.joints.get(jid);
      if (!j || j.broken) return;
      if (!DETACHABLE.includes(j.def.b)) return;
      this.detach(human, j.def.b, jid, j);
    });
  }
  fixedUpdate(dt) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.timer -= dt;
      if (d.timer <= 0) {
        if (d.human.alive) this.factory.markDead(d.human);
        this.dying.splice(i, 1);
      }
    }

    const g = this.grab.current();
    if (!g) return;
    if (g.limb.detached) { this.grab.forceRelease(); return; }
    if (!this.robot.ripHold) return;

    const hp = this.robot.getRightHandPos();
    const t = g.limb.body.translation();
    this._dir.set(hp.x - t.x, hp.y - t.y, hp.z - t.z);
    if (this._dir.lengthSq() < 1e-4) return;
    this._dir.normalize();

    const force = K.RIP_FORCE_BASE;
    g.limb.body.applyImpulse({
      x: this._dir.x * force * dt,
      y: this._dir.y * force * dt,
      z: this._dir.z * force * dt,
    }, true);

    const jid = LIMB_TO_JOINT[g.segmentId];
    if (!jid) return;
    const j = g.human.joints.get(jid);
    if (!j || j.broken) return;

    const eff = Math.max(K.RIP_EFF_MIN, this.alignment(g.segmentId, g.human, this._dir));
    const shockMult = (!g.human.alive || g.human.ai.state === 'shock') ? K.SHOCK_JOINT_MULT : 1;
    j.stress += force * dt * eff / shockMult;

    eventBus.emit('rip:progress', Math.min(1, j.stress / j.def.hp));
    if (j.stress >= j.def.hp) this.detach(g.human, g.segmentId, jid, j);
  }
  update() {
    const g = this.grab.current();
    if (!g || g.limb.detached || !this.robot.ripHold) return;
    const jid = LIMB_TO_JOINT[g.segmentId];
    if (!jid) return;
    const j = g.human.joints.get(jid);
    if (!j || j.broken) return;

    const p = Math.min(1, j.stress / j.def.hp);
    const hp = this.robot.getRightHandPos();
    const t = g.limb.body.translation();
    this._tmp.set(hp.x - t.x, hp.y - t.y, hp.z - t.z).normalize();
    const s = p * 0.06;
    g.limb.mesh.position.x += this._tmp.x * s;
    g.limb.mesh.position.y += this._tmp.y * s;
    g.limb.mesh.position.z += this._tmp.z * s;
    if (p > 0.7) {
      const j2 = (p - 0.7) * 0.04;
      g.limb.mesh.position.x += (Math.random() - 0.5) * j2;
      g.limb.mesh.position.y += (Math.random() - 0.5) * j2;
    }
  }
  detach(human, segId, jid, joint) {
    if (joint.broken) return;
    joint.broken = true;
    this.engine.world.removeImpulseJoint(joint.joint, true);
    const limb = human.limbs.get(segId);
    limb.detached = true;

    const jd = human.joints.get(jid).def;
    const parent = human.limbs.get(jd.a);
    const stumpLocal = new THREE.Vector3(jd.anchorA[0], jd.anchorA[1], jd.anchorA[2]);
    const stumpMat = new THREE.MeshStandardMaterial({ color: 0x6a0a0a, roughness: 0.9 });
    const stump = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), stumpMat);
    stump.position.copy(stumpLocal);
    parent.mesh.add(stump);

    const pt = parent.body.translation();
    const pr = parent.body.rotation();
    const pq = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w);
    const stumpWorld = stumpLocal.clone().applyQuaternion(pq).add(new THREE.Vector3(pt.x, pt.y, pt.z));

    const dirDown = new THREE.Vector3(0, -1, 0);
    this.blood.addEmitter(stumpWorld, dirDown, 70, 6);
    this.blood.burst(stumpWorld, dirDown, 40);

    this.audio.play('squelch_big', { pos: stumpWorld, volume: 1, pitch: 0.9 + Math.random() * 0.2 });
    this.audio.play('bone_snap', { pos: stumpWorld, volume: 0.6 });
    if (human.alive) this.audio.play('scream_rip', { pos: stumpWorld, volume: 0.9 });

    this.grab.forceRelease();
    eventBus.emit('rip:progress', 0);
    this.checkDeath(human, segId);
    eventBus.emit('human:partDetached', human, segId, jid);
  }
  checkDeath(human, segId) {
    if (!human.alive) return;
    if (segId === 'head') {
      this.factory.markDead(human);
      this.engine.addShake(0.15, 0.4);
      eventBus.emit('ui:flash', 0.35);
      return;
    }
    let n = 0;
    for (const s of DETACHABLE) if (human.limbs.get(s)?.detached) n++;
    if (n >= K.DEATH_LIMB_THRESHOLD) {
      human.ai.state = 'shock';
      this.dying.push({ human, timer: K.DEATH_BLEEDOUT_TIME });
    }
  }
  alignment(segId, human, dir) {
    const limb = human.limbs.get(segId);
    if (!limb) return 0;
    if (segId === 'head') return dir.y;
    const torso = human.limbs.get('torso');
    if (!torso) return 0;
    const e = limb.body.translation(); const t = torso.body.translation();
    this._tmp.set(e.x - t.x, e.y - t.y, e.z - t.z).normalize();
    return this._tmp.dot(dir);
  }
}

/* =========================================================
   16. AI
   ========================================================= */
class AISystem {
  constructor(robot, weaponSys, audio) {
    this.robot = robot; this.weaponSys = weaponSys; this.audio = audio;
    this._humans = [];
    this.pendingAttacks = [];
  }
  humans() { return this._humans; }
  register(h) { this._humans.push(h); }

  fixedUpdate(dt) {
    for (let i = this.pendingAttacks.length - 1; i >= 0; i--) {
      const pa = this.pendingAttacks[i];
      pa.delay -= dt;
      if (pa.delay <= 0 && !pa.invoked) {
        pa.invoked = true;
        if (pa.human.alive && pa.human.ai.state !== 'grabbed' && pa.human.ai.state !== 'dead') {
          const sh = pa.human.limbs.get('upperArmR');
          if (sh && !sh.detached) sh.body.applyImpulse({ x: 0, y: -50, z: -50 }, true);
          this.weaponSys.performStrike(pa.human);
        }
        this.pendingAttacks.splice(i, 1);
      }
    }
    for (const h of this._humans) {
      if (!h.alive) continue;
      this.tickHuman(h, dt);
    }
  }
  update() {
    for (const h of this._humans) {
      for (const l of h.limbs.values()) {
        const t = l.body.translation(); const r = l.body.rotation();
        l.mesh.position.set(t.x, t.y, t.z);
        l.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
      h.ai.hasWeapon = !!this.weaponSys.findWeaponOf(h);
    }
  }
  onHumanLimbLost(h, segId) {
    if (!h.alive || segId === 'head') return;
    h.ai.state = 'limbLost';
    h.ai.stateTimer = 2.5;
    if (segId === 'forearmR') h.ai.hasWeapon = false;
  }
  onAllyDismembered(nearby) {
    for (const h of nearby) {
      if (!h.alive) continue;
      h.morale -= K.MORALE_DROP_PER_KILL;
      if (h.morale < K.MORALE_FLEE_THRESHOLD && h.ai.state !== 'flee') {
        h.ai.state = 'flee';
        const t = h.limbs.get('torso')?.body.translation();
        if (t) this.audio.play('scream_flee', {
          pos: new THREE.Vector3(t.x, t.y, t.z), volume: 0.8, pitch: 0.9 + Math.random() * 0.3,
        });
      }
    }
  }
  tickHuman(h, dt) {
    const skip = !h.alive || h.ai.state === 'grabbed' || h.ai.state === 'shock';
    if (!skip) this.upright(h, dt);
    h.ai.stateTimer -= dt;
    h.ai.attackCooldown -= dt;
    const torso = h.limbs.get('torso');
    if (!torso) return;
    const t = torso.body.translation();
    const tp = new THREE.Vector3(t.x, t.y, t.z);
    switch (h.ai.state) {
      case 'idle': return this.idle(h);
      case 'approach': return this.doApproach(h, tp, dt);
      case 'attack': return this.doAttack(h, tp);
      case 'flinch': return this.doFlinch(h);
      case 'disarmed': return this.doDisarmed(h);
      case 'limbLost': return this.doLimbLost(h);
      case 'flee': return this.driveFlee(h, tp, dt);
      default: this.idle(h);
    }
  }
  doApproach(h, tp, dt) {
    const tgt = h.ai.targetPos;
    if (!tgt) return this.idle(h);
    const to = tgt.clone().sub(tp); to.y = 0;
    const dist = to.length();
    if (h.ai.role === 'flank' && dist > 2.5) {
      const r = new THREE.Vector3(-to.z, 0, to.x).normalize();
      to.addScaledVector(r, Math.min(dist * 0.5, 2.0));
    }
    if (dist < 1.8) { h.ai.state = 'attack'; h.ai.stateTimer = 0; return; }
    h.ai.walkPhase += K.HUMAN_WALK_PHASE_SPEED * dt;
    this.walkCycle(h);
    const dir = to.normalize();
    const torso = h.limbs.get('torso');
    const imp = dir.multiplyScalar(h.ai.moveSpeed * torso.body.mass() * K.HUMAN_WALK_IMPULSE_K * dt);
    torso.body.applyImpulse({ x: imp.x, y: 0, z: imp.z }, true);
    if (h.morale < K.MORALE_FLEE_THRESHOLD) h.ai.state = 'flee';
  }
  doAttack(h, tp) {
    const tgt = h.ai.targetPos;
    if (!tgt) return this.idle(h);
    const to = tgt.clone().sub(tp); to.y = 0;
    if (to.length() > 2.0) { h.ai.state = 'approach'; return; }
    if (h.ai.attackCooldown > 0) return this.idle(h);
    if (h.ai.hasWeapon) {
      const sh = h.limbs.get('upperArmR');
      if (sh && !sh.detached) sh.body.applyImpulse({ x: 0, y: 30, z: 0 }, true);
      h.ai.attackCooldown = 1.2 + Math.random() * 0.5;
      this.pendingAttacks.push({ human: h, delay: K.AI_WIND_UP_SEC, invoked: false });
    } else {
      const rp = this.robot.getPosition();
      const dir = rp.clone().sub(tp).setY(0).normalize();
      h.limbs.get('torso').body.applyImpulse(
        { x: dir.x * 80, y: 20, z: dir.z * 80 }, true);
      h.ai.attackCooldown = 1.4 + Math.random() * 0.5;
    }
  }
  doFlinch(h) {
    this.idle(h);
    if (h.ai.stateTimer <= 0) h.ai.state = h.ai.hasWeapon ? 'attack' : 'approach';
  }
  doDisarmed(h) {
    if (this.weaponSys.tryPickupForHuman(h)) { h.ai.hasWeapon = true; h.ai.state = 'approach'; return; }
    h.ai.state = 'approach';
  }
  doLimbLost(h) {
    this.idle(h);
    if (h.ai.stateTimer <= 0) {
      const lL = h.limbs.get('thighL')?.detached;
      const lR = h.limbs.get('thighR')?.detached;
      h.ai.moveSpeed = (lL && lR) ? 0.35 : (lL || lR ? 0.7 : 1.2);
      h.ai.state = 'approach';
    }
  }
  driveFlee(h, tp, dt) {
    const out = tp.clone().setY(0).normalize();
    const edge = out.clone().multiplyScalar(K.ARENA_RADIUS - 1);
    const to = edge.clone().sub(tp).setY(0);
    if (to.length() < 0.5) return this.idle(h);
    h.ai.walkPhase += K.HUMAN_WALK_PHASE_SPEED * dt;
    this.walkCycle(h);
    const dir = to.normalize();
    const torso = h.limbs.get('torso');
    const imp = dir.multiplyScalar(torso.body.mass() * K.HUMAN_WALK_IMPULSE_K * dt);
    torso.body.applyImpulse({ x: imp.x, y: 0, z: imp.z }, true);
  }
  walkCycle(h) {
    const phase = h.ai.walkPhase;
    const TAU = Math.PI * 2;
    const legs = [
      { hip: 'hipL', knee: 'kneeL', off: 0 },
      { hip: 'hipR', knee: 'kneeR', off: 0.5 },
    ];
    for (const l of legs) {
      if (h.joints.get(l.hip)?.broken) continue;
      const ph = phase + l.off;
      const hip = -0.05 - K.HUMAN_HIP_AMP * Math.cos(TAU * ph);
      const knee = Math.max(0, -K.HUMAN_KNEE_AMP * Math.sin(TAU * ph));
      this.setMotor(h, l.hip, hip);
      this.setMotor(h, l.knee, knee);
    }
  }
  idle(h) {
    for (const j of h.joints.values()) {
      if (j.def.type !== 'revolute' || j.broken) continue;
      j.joint.configureMotorPosition(0, K.HUMAN_MOTOR_STIFFNESS * 0.5, K.HUMAN_MOTOR_DAMPING);
    }
  }
  setMotor(h, id, angle) {
    const j = h.joints.get(id);
    if (!j || j.broken || j.def.type !== 'revolute') return;
    j.joint.configureMotorPosition(angle, K.HUMAN_MOTOR_STIFFNESS, K.HUMAN_MOTOR_DAMPING);
  }
  upright(h, dt) {
    if (!h.alive || h.ai.state === 'grabbed') return;
    const torso = h.limbs.get('torso');
    if (!torso || torso.detached) return;
    const q = torso.body.rotation();
    const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const tilt = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
    const av = torso.body.angvel();
    torso.body.applyTorqueImpulse({
      x: (tilt.x * K.HUMAN_UPRIGHT_K - av.x * K.HUMAN_UPRIGHT_D) * dt,
      y: (tilt.y * K.HUMAN_UPRIGHT_K - av.y * K.HUMAN_UPRIGHT_D) * dt,
      z: (tilt.z * K.HUMAN_UPRIGHT_K - av.z * K.HUMAN_UPRIGHT_D) * dt,
    }, true);
  }
}

/* =========================================================
   17. WAVE
   ========================================================= */
const WAVE_DEFS = [
  { count: 2, weapons: ['bat'] },
  { count: 3, weapons: ['bat', 'pipe'] },
  { count: 4, weapons: ['bat', 'pipe', 'axe'] },
  { count: 5, weapons: ['pipe', 'axe', 'sword'] },
  { count: 3, weapons: ['axe', 'sword'], boss: true },
];

class WaveSystem {
  constructor(robot, factory, ai, weaponSys) {
    this.robot = robot; this.factory = factory; this.ai = ai; this.weaponSys = weaponSys;
    this.phase = 'idle'; this.waveIdx = -1; this.betweenTimer = 0;
    this.waveStartTime = 0; this.active = [];
    this.stats = { wave: 0, humansKilled: 0, limbsRipped: 0, weaponsPicked: 0, timeSec: 0 };
  }
  start() { this.startNextWave(); }
  update(dt) {
    if (this.phase === 'gameover' || this.phase === 'victory') return;
    if (this.phase === 'between') {
      this.betweenTimer -= dt;
      if (this.betweenTimer <= 0) this.startNextWave();
    }
  }
  fixedUpdate() {
    if (this.phase !== 'fighting') return;
    this.active = this.active.filter(h => h.alive);
    if (this.active.length === 0) this.endWave();
  }
  registerStatsListeners() {
    eventBus.on('human:partDetached', () => this.stats.limbsRipped++);
    eventBus.on('human:death', () => this.stats.humansKilled++);
    eventBus.on('weapon:pickedByRobot', () => this.stats.weaponsPicked++);
    eventBus.on('robot:dead', () => { this.phase = 'gameover'; eventBus.emit('wave:gameover', this.stats); });
  }
  startNextWave() {
    this.waveIdx++;
    if (this.waveIdx >= WAVE_DEFS.length) {
      this.phase = 'victory';
      eventBus.emit('wave:victory', this.stats);
      return;
    }
    const def = WAVE_DEFS[this.waveIdx];
    this.phase = 'fighting';
    this.waveStartTime = performance.now();
    this.stats.wave = this.waveIdx + 1;
    eventBus.emit('wave:start', this.waveIdx + 1, def.boss ? 'БОСС' : '');
    for (let i = 0; i < def.count; i++) {
      const angle = (i / def.count) * Math.PI * 2 + Math.random() * 0.4;
      const radius = 5 + Math.random() * 3;
      const px = Math.cos(angle) * radius;
      const pz = Math.sin(angle) * radius;
      const weapon = def.weapons[i % def.weapons.length];
      const h = this.factory.spawn({
        position: new THREE.Vector3(px, 0, pz),
        yaw: Math.atan2(-px, -pz),
        aiState: 'approach',
        targetPos: new THREE.Vector3(0, 0, 0),
      });
      if (def.boss && i === 0) this.upgradeBoss(h);
      this.ai.register(h);
      this.weaponSys.attachToHuman(h, 'forearmR', weapon);
      this.active.push(h);
    }
  }
  endWave() {
    this.stats.timeSec += (performance.now() - this.waveStartTime) / 1000;
    this.phase = 'between';
    this.betweenTimer = K.WAVE_PAUSE_SEC;
    this.robot.repair(K.ROBOT_REPAIR_PCT);
    eventBus.emit('wave:end', this.waveIdx + 1, K.WAVE_PAUSE_SEC);
  }
  upgradeBoss(h) {
    for (const limb of h.limbs.values()) {
      const m = limb.collider.mass();
      limb.collider.setMass(m * 2.5);
      limb.mesh.scale.setScalar(1.35);
    }
    for (const j of h.joints.values()) j.def.hp *= 1.5;
    h.ai.moveSpeed = 1.0;
    h.ai.painTolerance = 1.4;
    h.morale = 200;
  }
}

/* =========================================================
   18. CROWD
   ========================================================= */
const RING_R = K.ARENA_RADIUS + 3, RING_H = 3.2, ROWS = 3, PER_ROW = 40, TOTAL = ROWS * PER_ROW;

class Crowd {
  constructor(scene) {
    const geo = new THREE.CapsuleGeometry(0.12, 0.35, 3, 6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x808898, roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(geo, mat, TOTAL);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.specs = [];
    this.dummy = new THREE.Object3D();
    this._t = 0;
    for (let r = 0; r < ROWS; r++) {
      const radius = RING_R + r * 0.8, y = RING_H + r * 0.5;
      for (let i = 0; i < PER_ROW; i++) {
        const a = (i / PER_ROW) * Math.PI * 2;
        const idx = r * PER_ROW + i;
        this.specs.push({ baseY: y, phase: Math.random() * Math.PI * 2, excite: 0, angle: a, radius });
        const c = new THREE.Color().setHSL(0.55 + Math.random() * 0.2, 0.4, 0.3 + Math.random() * 0.2);
        this.mesh.setColorAt(idx, c);
      }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    eventBus.on('human:partDetached', () => this.excite(1.0));
    eventBus.on('human:death', () => this.excite(0.6));
    eventBus.on('weapon:hit', () => this.excite(0.35));
    eventBus.on('robot:damaged', () => this.excite(0.5));
    eventBus.on('wave:start', () => this.excite(0.8));
  }
  excite(a) { for (const s of this.specs) s.excite = Math.min(1.5, s.excite + a); }
  fixedUpdate() {}
  update(dt) {
    this._t += dt;
    for (let i = 0; i < TOTAL; i++) {
      const s = this.specs[i];
      s.excite = Math.max(0, s.excite - dt * 1.2);
      const idle = Math.sin(this._t * 1.2 + s.phase) * 0.02;
      const jump = s.excite * (0.35 + Math.sin(this._t * 18 + s.phase) * 0.15);
      const x = Math.cos(s.angle) * s.radius;
      const z = Math.sin(s.angle) * s.radius;
      this.dummy.position.set(x, s.baseY + idle + Math.max(0, jump), z);
      this.dummy.rotation.set(Math.sin(this._t * 10 + s.phase) * 0.15 * s.excite, -s.angle + Math.PI / 2, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* =========================================================
   19. ARENA
   ========================================================= */
class Arena {
  constructor(engine) {
    this.engine = engine;
    this.buildFloor();
    this.buildWalls();
    this.buildDecor();
    this.buildTribune();
  }
  buildFloor() {
    const R = K.ARENA_RADIUS;
    const rb = this.engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.15, 0));
    this.engine.world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.15, R).setFriction(0.9), rb);
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, 0.3, 64),
      new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.95 }));
    mesh.receiveShadow = true; mesh.position.y = -0.15;
    this.engine.scene.add(mesh);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.65, R * 0.66, 64),
      new THREE.MeshBasicMaterial({ color: 0x6b3010, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
    this.engine.scene.add(ring);
  }
  buildWalls() {
    const R = K.ARENA_RADIUS, H = K.ARENA_WALL_HEIGHT, N = K.ARENA_WALL_SEGMENTS;
    const thickness = 0.4, segA = (Math.PI * 2) / N;
    for (let i = 0; i < N; i++) {
      const a = i * segA;
      const cx = Math.cos(a) * R, cz = Math.sin(a) * R;
      const w = 2 * R * Math.sin(segA / 2) + 0.05;
      const rb = this.engine.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(cx, H / 2, cz)
          .setRotation({ x: 0, y: Math.sin(-a / 2), z: 0, w: Math.cos(-a / 2) })
      );
      this.engine.world.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, H / 2, thickness / 2).setFriction(0.8), rb);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, H, thickness),
        new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 0.9, metalness: 0.2 }));
      mesh.position.set(cx, H / 2, cz);
      mesh.rotation.y = -a;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.engine.scene.add(mesh);
    }
  }
  buildDecor() {
    for (const [x, z] of [[-6,-6],[6,-6],[-6,6],[6,6]]) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.35, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 1 }));
      pillar.position.set(x, 2, z); pillar.castShadow = true;
      this.engine.scene.add(pillar);
      const rb = this.engine.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, 2, z));
      this.engine.world.createCollider(
        RAPIER.ColliderDesc.cylinder(2, 0.35).setFriction(0.7), rb);
    }
  }
  buildTribune() {
    const trib = new THREE.Mesh(
      new THREE.CylinderGeometry(K.ARENA_RADIUS + 6, K.ARENA_RADIUS + 6, 1, 64, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x2a2218, side: THREE.DoubleSide }));
    trib.position.y = 3.0;
    this.engine.scene.add(trib);
  }
  fixedUpdate() {} update() {}
}

/* =========================================================
   20. HUD
   ========================================================= */
class HUD {
  constructor(robotHpGetter) {
    this.robotHpGetter = robotHpGetter;
    this.createDOM();
    this.bindEvents();
  }
  createDOM() {
    const panel = document.createElement('div');
    panel.style.cssText = `position:fixed;left:16px;top:16px;color:#eee;font:14px/1.4 monospace;pointer-events:none;user-select:none;text-shadow:0 1px 2px #000;z-index:40`;
    panel.innerHTML = `
      <div style="margin-bottom:8px">
        <div style="color:#888;font-size:11px">БРОНЯ</div>
        <div style="width:180px;height:14px;background:#200;border:1px solid #555;position:relative">
          <div id="hp-fill" style="width:100%;height:100%;background:linear-gradient(90deg,#0a4,#2a8);transition:width 150ms"></div>
          <div id="hp-text" style="position:absolute;inset:0;text-align:center;font-size:11px;line-height:14px">100</div>
        </div>
      </div>
      <div id="wave-text" style="font-size:12px;color:#ccc"></div>
    `;
    document.body.appendChild(panel);
    this.hpFill = panel.querySelector('#hp-fill');
    this.hpText = panel.querySelector('#hp-text');
    this.waveText = panel.querySelector('#wave-text');

    this.ripBar = document.createElement('div');
    this.ripBar.style.cssText = `position:fixed;left:50%;bottom:60px;transform:translateX(-50%);width:220px;height:8px;background:rgba(0,0,0,0.6);border:1px solid #444;display:none;z-index:40`;
    this.ripFill = document.createElement('div');
    this.ripFill.style.cssText = `width:0%;height:100%;background:linear-gradient(90deg,#b00,#f33);transition:width 60ms linear`;
    this.ripBar.appendChild(this.ripFill);
    document.body.appendChild(this.ripBar);

    this.messageBox = document.createElement('div');
    this.messageBox.style.cssText = `position:fixed;left:50%;top:30%;transform:translate(-50%,-50%);color:#fff;font:700 32px/1.2 sans-serif;text-align:center;text-shadow:0 2px 8px #000,0 0 20px #f00;pointer-events:none;opacity:0;transition:opacity 250ms;z-index:45`;
    document.body.appendChild(this.messageBox);

    this.vignette = document.getElementById('vignette');
    this.flash = document.getElementById('flash');
  }
  bindEvents() {
    eventBus.on('robot:damaged', () => this.refreshHP());
    eventBus.on('robot:healed', () => this.refreshHP());
    eventBus.on('rip:progress', p => {
      this.ripBar.style.display = p > 0 ? 'block' : 'none';
      this.ripFill.style.width = `${Math.round(p * 100)}%`;
    });
    eventBus.on('robot:grabUp', () => { this.ripBar.style.display = 'none'; });
    eventBus.on('wave:start', (n, tag) => {
      this.waveText.textContent = `ВОЛНА ${n}` + (tag ? ` — ${tag}` : '');
      this.showMessage(`ВОЛНА ${n}`);
    });
    eventBus.on('wave:end', (n, pause) => {
      this.showMessage(`ВОЛНА ${n} ЗАЧИЩЕНА`, 1500);
      setTimeout(() => this.showMessage(`СЛЕДУЮЩАЯ ЧЕРЕЗ ${Math.ceil(pause)}`, 1500), 1600);
    });
    eventBus.on('wave:victory', s => this.showEnd('ПОБЕДА', s, true));
    eventBus.on('wave:gameover', s => this.showEnd('РАЗОБРАН', s, false));
    eventBus.on('ui:flash', v => {
      this.flash.style.opacity = String(v);
      setTimeout(() => this.flash.style.opacity = '0', 60);
    });
  }
  refreshHP() {
    const hp = this.robotHpGetter();
    const pct = Math.max(0, Math.min(100, (hp / K.ROBOT_HP_MAX) * 100));
    this.hpFill.style.width = `${pct}%`;
    this.hpText.textContent = String(Math.round(hp));
    if (pct < 30) this.hpFill.style.background = 'linear-gradient(90deg,#a00,#f33)';
    else if (pct < 60) this.hpFill.style.background = 'linear-gradient(90deg,#a80,#fa0)';
    else this.hpFill.style.background = 'linear-gradient(90deg,#0a4,#2a8)';
    const vigA = Math.max(0, (60 - pct) / 100);
    this.vignette.style.boxShadow = `inset 0 0 180px 40px rgba(180,0,0,${vigA * 1.2})`;
  }
  showMessage(text, hideAfter = 1800) {
    this.messageBox.textContent = text;
    this.messageBox.style.opacity = '1';
    if (hideAfter > 0) setTimeout(() => this.messageBox.style.opacity = '0', hideAfter);
  }
  showEnd(title, stats, win) {
    this.messageBox.style.opacity = '0';
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;color:#eee;font:16px/1.5 monospace;z-index:1000;flex-direction:column;text-align:center`;
    wrap.innerHTML = `
      <div style="font-size:48px;font-weight:700;color:${win ? '#4f4' : '#f44'};margin-bottom:24px">${title}</div>
      <div style="font-size:14px;color:#aaa;min-width:320px;text-align:left">
        <div>Волн пройдено: <b>${stats.wave}</b></div>
        <div>Людей убито: <b>${stats.humansKilled}</b></div>
        <div>Конечностей оторвано: <b>${stats.limbsRipped}</b></div>
        <div>Оружий подобрано: <b>${stats.weaponsPicked}</b></div>
        <div>Время: <b>${stats.timeSec.toFixed(1)} с</b></div>
      </div>
      <button id="restart" style="margin-top:32px;padding:10px 24px;font:16px monospace;background:#333;color:#eee;border:1px solid #666;cursor:pointer">ЗАНОВО</button>
    `;
    document.body.appendChild(wrap);
    wrap.querySelector('#restart').addEventListener('click', () => location.reload());
  }
}

/* =========================================================
   21. ENGINE
   ========================================================= */
class Engine {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1410);
    this.scene.fog = new THREE.Fog(0x1a1410, 25, 55);
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
    this.camera.position.set(0, 6, 12);

    this.clock = new THREE.Clock();
    this.accumulator = 0;
    this.systems = [];
    this.running = false;
    this.shakeAmp = 0; this.shakeTime = 0; this.shakeDur = 0;

    addEventListener('resize', () => this.onResize());
    this.setupLights();
  }
  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: K.GRAVITY, z: 0 });
    this.world.timestep = K.FIXED_DT;
  }
  addSystem(s) { this.systems.push(s); }
  addShake(amp, dur) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeDur = Math.max(this.shakeDur, dur);
    this.shakeTime = this.shakeDur;
  }
  setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xb8c4d8, 0x2a1e14, 0.8));
    const sun = new THREE.DirectionalLight(0xffe6c4, 1.4);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 18;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun); this.scene.add(sun.target);
    const fire = new THREE.PointLight(0xff3010, 1.2, 30);
    fire.position.set(0, 1.5, 0);
    this.scene.add(fire);
  }
  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
  start() {
    this.running = true;
    this.clock.start();
    this.loop();
  }
  loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const frameDt = Math.min(this.clock.getDelta(), 0.1);
    this.accumulator += frameDt;

    let steps = 0;
    while (this.accumulator >= K.FIXED_DT && steps < K.MAX_SUBSTEPS) {
      for (const s of this.systems) s.fixedUpdate?.(K.FIXED_DT);
      this.world.step();
      this.accumulator -= K.FIXED_DT;
      steps++;
    }
    if (steps === K.MAX_SUBSTEPS) this.accumulator = 0;

    const alpha = this.accumulator / K.FIXED_DT;
    for (const s of this.systems) s.update?.(frameDt, alpha);

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - frameDt);
      const k = this.shakeTime / this.shakeDur;
      const a = this.shakeAmp * k;
      this.camera.position.x += (Math.random() - 0.5) * a;
      this.camera.position.y += (Math.random() - 0.5) * a;
      this.camera.position.z += (Math.random() - 0.5) * a;
      if (this.shakeTime === 0) this.shakeAmp = 0;
    }
    this.renderer.render(this.scene, this.camera);
  };
}

/* =========================================================
   22. BOOT
   ========================================================= */
async function boot() {
  const root = document.getElementById('app') || document.body;
  const engine = new Engine(root);
  await engine.init();

  const audio = new AudioSystem();
  audio.init(engine.camera);

  const arena    = new Arena(engine);
  const crowd    = new Crowd(engine.scene);
  const robot    = new RobotController(engine);
  const factory  = new HumanFactory(engine);
  const blood    = new BloodSystem(engine.scene);
  const weaponSys= new WeaponSystem(engine, robot, blood, audio);
  const grab     = new GrabSystem(robot);
  const rip      = new RipSystem(engine, robot, grab, blood, factory, weaponSys, audio);
  const ai       = new AISystem(robot, weaponSys, audio);
  const waves    = new WaveSystem(robot, factory, ai, weaponSys);

  // порядок важен: ai.update (sync mesh) → rip.update (visual stretch)
  engine.addSystem(arena);
  engine.addSystem(crowd);
  engine.addSystem(robot);
  engine.addSystem(ai);
  engine.addSystem(blood);
  engine.addSystem(rip);
  engine.addSystem(weaponSys);
  engine.addSystem(waves);

  new HUD(() => robot.getHp());

  // ── Ввод-связки ─────────────────────────────
  eventBus.on('robot:grabDown', () => {
    if (grab.tryGrab()) audio.play('grab_hiss', { pos: robot.getRightHandPos() });
  });
  eventBus.on('robot:grabUp', () => {
    if (!robot.ripHold) { grab.release(); eventBus.emit('rip:progress', 0); }
  });
  eventBus.on('robot:ripUp', () => eventBus.emit('rip:progress', 0));
  eventBus.on('robot:pickup', () => {
    if (weaponSys.tryPickupForRobot()) eventBus.emit('weapon:pickedByRobot');
    else {
      const g = grab.current();
      if (g) weaponSys.tryDisarm(g.human, robot.getPosition());
    }
  });
  eventBus.on('robot:throw', () => {
    const cam = robot.getCamera();
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const g = grab.current();
    if (g) {
      if (g.limb.detached) {
        g.limb.body.applyImpulse({
          x: dir.x * K.THROW_LIMB_IMPULSE,
          y: dir.y * K.THROW_LIMB_IMPULSE + 300,
          z: dir.z * K.THROW_LIMB_IMPULSE,
        }, true);
      } else {
        for (const l of g.human.limbs.values()) {
          if (l.detached) continue;
          l.body.applyImpulse({
            x: dir.x * K.THROW_BODY_IMPULSE * 0.15,
            y: dir.y * K.THROW_BODY_IMPULSE * 0.15 + 80,
            z: dir.z * K.THROW_BODY_IMPULSE * 0.15,
          }, true);
        }
        if (g.human.alive) {
          g.human.ai.state = 'flinch';
          g.human.ai.stateTimer = 1.5;
        }
      }
      grab.forceRelease();
      eventBus.emit('rip:progress', 0);
      engine.addShake(0.08, 0.2);
      return;
    }
    const held = robot.getHeldWeapon();
    if (held) {
      weaponSys.throwWeapon(held, dir, K.THROW_WEAPON_IMPULSE);
      robot.setHeldWeapon(null);
      engine.addShake(0.04, 0.15);
    }
  });

  eventBus.on('human:partDetached', (human, segId) => {
    ai.onHumanLimbLost(human, segId);
    if (segId === 'forearmR' || segId === 'forearmL') weaponSys.onLimbDetached(human, segId);
    const tb = human.limbs.get('torso')?.body.translation();
    if (!tb) return;
    const nearby = ai.humans().filter(o => {
      if (o === human || !o.alive) return false;
      const ta = o.limbs.get('torso')?.body.translation();
      if (!ta) return false;
      return Math.hypot(ta.x-tb.x, ta.y-tb.y, ta.z-tb.z) < K.MORALE_RADIUS;
    });
    ai.onAllyDismembered(nearby);
  });

  waves.registerStatsListeners();
  waves.start();
  engine.start();

  window.__engine = engine;
  window.__robot = robot;
  window.__grab = grab;
  window.__ai = ai;
  window.__waves = waves;
  window.__weapons = weaponSys;

  // R — пропустить волну (дебаг)
  addEventListener('keydown', e => {
    if (e.code === 'KeyR') for (const h of ai.humans()) if (h.alive) factory.markDead(h);
  });
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#f88;font:12px monospace;padding:20px">${err?.stack ?? err}</pre>`;
});