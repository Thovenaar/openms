import { placeBody, sweepBody } from "./life-geometry.js";

export const MOB_POLICY = Object.freeze({
  authority: "offline-local-policy",
  walkPixelsPerSecondAtSpeedZero: 60,
  knockbackPixelsPerSecond: 120,
  knockbackMs: 240,
  respawnMs: 10000,
  attackCooldownMs: 2400,
  recoveryMs: 5000,
  maxTransitions: 32,
  specialMovement: "stationary: fly/jump/controller rules unavailable",
  mobTime: "preserved, not interpreted as respawn seconds",
});
const MAX_MOBS = 4096;
const MAX_ACTIONS = 128;
const MAX_FRAMES = 1024;

export function rectangleState() {
  return { active: false, left: 0, top: 0, right: 0, bottom: 0 };
}

/** Exact rectangle intersection; no pixel bounds can enter this path. */
export function overlaps(a, b) {
  return (
    a.active &&
    b.active &&
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

/** Compile original frame delays once; unknown timing remains frozen. */
function compileActions(template) {
  const actions = Object.create(null);
  const entries = Object.entries(template.actions);
  validateMobInfo(template.info);
  if (entries.length > MAX_ACTIONS) throw new Error("Mob action limit");
  for (const [name, source] of entries) {
    if (!source.frames.length || source.frames.length > MAX_FRAMES) {
      throw new Error("Mob frame limit");
    }
    const ends = new Float64Array(source.frames.length);
    let duration = 0;
    for (let index = 0; index < source.frames.length; index++) {
      const delay = source.frames[index].delayMs;
      validateBody(source.frames[index].body);
      if (source.timingKnown && (!Number.isFinite(delay) || delay <= 0)) {
        throw new Error("Invalid mob delay");
      }
      duration += source.timingKnown ? delay : 0;
      ends[index] = duration;
    }
    actions[name] = { ends, duration, frames: source.frames };
  }
  return actions;
}

function validateBody(body) {
  if (!body) return;
  if (
    ![body.left, body.top, body.right, body.bottom].every(Number.isFinite) ||
    body.left > body.right ||
    body.top > body.bottom
  ) {
    throw new Error("Invalid original mob body");
  }
}

function validateMobInfo(info) {
  for (const key of [
    "maxHP",
    "maxMP",
    "PADamage",
    "PDDamage",
    "MADamage",
    "exp",
    "hpRecovery",
    "mpRecovery",
  ]) {
    if (
      info[key] !== undefined &&
      (!Number.isSafeInteger(info[key]) || info[key] < 0)
    ) {
      throw new Error("Invalid original mob statistic");
    }
  }
  if (
    info.speed !== undefined &&
    (!Number.isSafeInteger(info.speed) || Math.abs(info.speed) > 1000000)
  ) {
    throw new Error("Invalid original mob speed");
  }
}

/** Stable state exists for every authored mob, including explicitly inactive records. */
export function createMobs(life, simulation) {
  if (
    !life ||
    !Array.isArray(life.placements) ||
    life.placements.length > MAX_MOBS
  ) {
    throw new Error("Invalid offline mob placements");
  }
  const definitions = new Map();
  const mobs = [];
  const ids = new Set();
  for (const record of life.placements) {
    if (record.kind !== "mob") continue;
    if (![record.authored.x, record.authored.y].every(Number.isSafeInteger)) {
      throw new Error("Invalid mob origin");
    }
    if (ids.has(record.id)) throw new Error("Duplicate local mob identity");
    ids.add(record.id);
    const template = life.templates[record.template];
    if (!template || template.kind !== "mob") {
      throw new Error("Missing mob template");
    }
    if (!definitions.has(record.template)) {
      definitions.set(
        record.template,
        normalizeMobTemplate(template, compileActions(template)),
      );
    }
    mobs.push(
      createMob(record, template, definitions.get(record.template), simulation),
    );
  }
  return mobs;
}

/** Normalize inputs already checked by compileActions/validateMobInfo, before play. */
function normalizeMobTemplate(template, actions) {
  const info = template.info;
  const maxHP = info.maxHP ?? 0;
  const maxMP = info.maxMP ?? 0;
  return {
    actions,
    maxHP,
    maxMP,
    defaultAction: template.defaultAction ?? Object.keys(actions)[0] ?? null,
    selectedSkills: template.combat?.allowedSkills ?? [],
    attacks: template.combat?.attacks ?? [],
    speed:
      (MOB_POLICY.walkPixelsPerSecondAtSpeedZero *
        Math.max(0, 100 + (info.speed ?? 0))) /
      100,
  };
}

/** Resolve authored contact without inventing support for special controllers. */
function mobContact(authored, info, actions, geometry) {
  const foothold = geometry.byId.get(authored.fh) ?? null;
  const ground =
    foothold &&
    foothold.dx > 0 &&
    Number.isFinite(authored.rx0) &&
    Number.isFinite(authored.rx1);
  const movement =
    ground && !actions.fly && !info.flySpeed && !info.mobType && !info.noFlip
      ? "ground-patrol"
      : "stationary-special";
  return { foothold, movement };
}

/** Preserve admission precedence: artwork, positive HP, then authored gates. */
function mobInactiveReason(record, template, definition) {
  if (!definition.defaultAction) return "unavailable-original-artwork";
  if (!definition.maxHP) return "unavailable-positive-original-maxHP";
  const authored = record.authored;
  if (
    authored.hide === 1 ||
    !!authored.limitedname ||
    template.info.inactive === 1
  ) {
    return "inactive-authored-gate";
  }
  return null;
}

/** Ground patrol starts on its original segment; special movement stays authored. */
function mobSpawn(authored, info, contact) {
  const { foothold, movement } = contact;
  let x = authored.x;
  let y = authored.y;
  if (movement === "ground-patrol") {
    x = Math.max(foothold.x1, Math.min(foothold.x2, x));
    y = groundY(foothold, x);
  }
  const facing = info.noFlip ? -1 : authored.f === 0 ? 1 : -1;
  return {
    x,
    y,
    previousX: x,
    previousY: y,
    facing,
    spawnFacing: facing,
    foothold,
    spawnFoothold: foothold,
    spawnX: x,
    spawnY: y,
    movement,
  };
}

/** Allocate every mutable timer and geometry scratch record before play. */
function mobInitialState(definition, inactiveReason) {
  const active = !inactiveReason;
  return {
    hp: definition.maxHP,
    mp: definition.maxMP,
    alive: active,
    visible: active,
    active,
    state: inactiveReason ?? "idle",
    inactiveReason,
    action: definition.defaultAction,
    actionMs: 0,
    frame: 0,
    stateMs: 0,
    respawnMs: 0,
    cooldownMs: MOB_POLICY.attackCooldownMs,
    recoveryMs: 0,
    knockbackMs: 0,
    knockbackFacing: 0,
    pendingAttack: null,
    attackFired: false,
    attackIndex: 0,
    body: rectangleState(),
    sweptBody: rectangleState(),
    attackBody: rectangleState(),
    delta: { x: 0, y: 0 },
    deaths: 0,
    lastDamage: 0,
    presentation: null,
    fault: null,
  };
}

function createMob(record, template, definition, simulation) {
  const contact = mobContact(
    record.authored,
    template.info,
    definition.actions,
    simulation.geometry,
  );
  const inactiveReason = mobInactiveReason(record, template, definition);
  const mob = {
    id: record.id,
    templateId: Number(template.originalId),
    record,
    template,
    ...definition,
    ...mobSpawn(record.authored, template.info, contact),
    ...mobInitialState(definition, inactiveReason),
  };
  updateMobBody(mob);
  return mob;
}

function groundY(segment, x) {
  return segment.y1 + ((x - segment.x1) * segment.dy) / segment.dx;
}

export function setMobAction(mob, name) {
  if (!mob.actions[name]) name = mob.defaultAction;
  if (mob.action === name) return;
  mob.action = name;
  mob.actionMs = 0;
  mob.frame = 0;
}

function advanceMobAction(mob, ms) {
  const action = mob.actions[mob.action];
  mob.actionMs += ms;
  if (!action.duration) {
    mob.frame = 0;
    return;
  }
  const once = !mob.alive || mob.state === "hit" || mob.state === "attack";
  const elapsed = once
    ? Math.min(action.duration - 0.001, mob.actionMs)
    : mob.actionMs % action.duration;
  for (let index = 0; index < action.ends.length; index++) {
    if (elapsed < action.ends[index]) {
      mob.frame = index;
      return;
    }
  }
}

export function updateMobBody(mob) {
  const local = mob.alive
    ? mob.actions[mob.action]?.frames[mob.frame]?.body
    : null;
  placeBody(mob.body, local, mob, mob.facing > 0);
  mob.delta.x = mob.previousX - mob.x;
  mob.delta.y = mob.previousY - mob.y;
  sweepBody(mob.sweptBody, mob.body, mob.delta);
}

/** Preserve state offscreen; artwork residency never gates simulation. */
export function stepMob(mob, ms) {
  mob.previousX = mob.x;
  mob.previousY = mob.y;
  if (!mob.active || mob.fault) return;
  mob.stateMs += ms;
  if (!mob.alive) {
    stepDeadMob(mob, ms);
    return;
  }
  mob.cooldownMs = Math.max(0, mob.cooldownMs - ms);
  if (
    mob.state === "hit" &&
    mob.stateMs >= Math.max(240, mob.actions[mob.action].duration)
  ) {
    mob.state = "idle";
  }
  if (
    mob.state === "attack" &&
    mob.stateMs >=
      Math.max(
        mob.actions[mob.action].duration,
        mob.pendingAttack.properties.attackAfter + 30,
      )
  ) {
    mob.state = "idle";
    mob.pendingAttack = null;
  }
  stepMobMotion(mob, ms);
  recoverMob(mob, ms);
  advanceMobAction(mob, ms);
  updateMobBody(mob);
}

function stepMobMotion(mob, ms) {
  if (mob.knockbackMs > 0) {
    moveMob(
      mob,
      (mob.knockbackFacing *
        MOB_POLICY.knockbackPixelsPerSecond *
        Math.min(ms, mob.knockbackMs)) /
        1000,
    );
    mob.knockbackMs = Math.max(0, mob.knockbackMs - ms);
    return;
  }
  if (mob.state !== "idle") return;
  if (mob.movement === "ground-patrol" && mob.speed > 0) {
    moveMob(mob, (mob.facing * mob.speed * ms) / 1000);
    setMobAction(mob, "move");
  } else setMobAction(mob, "stand");
}

function connectedSegment(segment, direction) {
  const next = direction > 0 ? segment.next : segment.prev;
  if (
    !next ||
    next.dx <= 0 ||
    next.layer !== segment.layer ||
    next.group !== segment.group
  ) {
    return null;
  }
  const connected =
    direction > 0
      ? next.x1 === segment.x2 && next.y1 === segment.y2
      : next.x2 === segment.x1 && next.y2 === segment.y1;
  return connected ? next : null;
}

/** Local patrol only follows contiguous original floor links; no invented gap jumping. */
function moveMob(mob, distance) {
  if (mob.movement !== "ground-patrol") return;
  const authored = mob.record.authored;
  const target = Math.max(
    authored.rx0,
    Math.min(authored.rx1, mob.x + distance),
  );
  const direction = Math.sign(distance);
  if (target !== mob.x + distance) mob.facing = -direction;
  for (let count = 0; count < MOB_POLICY.maxTransitions; count++) {
    const segment = mob.foothold;
    if (target >= segment.x1 && target <= segment.x2) {
      mob.x = target;
      mob.y = groundY(segment, target);
      return;
    }
    const next = connectedSegment(segment, direction);
    if (!next) {
      mob.x = direction > 0 ? segment.x2 : segment.x1;
      mob.y = direction > 0 ? segment.y2 : segment.y1;
      mob.facing = -direction;
      return;
    }
    mob.foothold = next;
  }
  mob.fault = "local foothold traversal budget exhausted";
}

function recoverMob(mob, ms) {
  mob.recoveryMs += ms;
  if (mob.recoveryMs < MOB_POLICY.recoveryMs) return;
  mob.recoveryMs -= MOB_POLICY.recoveryMs;
  mob.hp = Math.min(
    mob.maxHP,
    mob.hp + Math.max(0, mob.template.info.hpRecovery ?? 0),
  );
  mob.mp = Math.min(
    mob.maxMP,
    mob.mp + Math.max(0, mob.template.info.mpRecovery ?? 0),
  );
}

function stepDeadMob(mob, ms) {
  mob.respawnMs += ms;
  advanceMobAction(mob, ms);
  const duration = mob.actions[mob.action].duration;
  if (mob.stateMs >= duration) {
    mob.visible = false;
    mob.state = "dead";
  }
  if (mob.respawnMs < Math.max(MOB_POLICY.respawnMs, duration)) return;
  mob.x = mob.spawnX;
  mob.y = mob.spawnY;
  mob.previousX = mob.x;
  mob.previousY = mob.y;
  mob.facing = mob.spawnFacing;
  mob.foothold = mob.spawnFoothold;
  mob.hp = mob.maxHP;
  mob.mp = mob.maxMP;
  mob.alive = true;
  mob.visible = true;
  mob.state = "idle";
  mob.stateMs = 0;
  mob.respawnMs = 0;
  mob.cooldownMs = MOB_POLICY.attackCooldownMs;
  mob.recoveryMs = 0;
  mob.knockbackMs = 0;
  mob.pendingAttack = null;
  setMobAction(mob, "stand");
  updateMobBody(mob);
}

/** Returns true exactly for the lethal transition, never for repeated dead hits. */
export function damageMob(mob, amount, facing) {
  if (
    !mob.alive ||
    !mob.active ||
    mob.selectedSkills.length ||
    mob.template.info.invincible
  ) {
    return false;
  }
  mob.lastDamage = amount;
  mob.hp = Math.max(0, mob.hp - amount);
  mob.stateMs = 0;
  mob.actionMs = 0;
  mob.frame = 0;
  mob.pendingAttack = null;
  if (mob.hp === 0) {
    mob.alive = false;
    mob.state = "dying";
    mob.deaths++;
    mob.respawnMs = 0;
    setMobAction(mob, "die1");
    mob.body.active = false;
    mob.sweptBody.active = false;
    return true;
  }
  mob.state = "hit";
  mob.knockbackMs = MOB_POLICY.knockbackMs;
  mob.knockbackFacing = facing;
  setMobAction(mob, "hit1");
  updateMobBody(mob);
  return false;
}
