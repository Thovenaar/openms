import { randomUUID } from "node:crypto";
import { PROTOCOL, protocolError } from "../../shared/protocol.js";
import {
  createHeldInput,
  assignHeldInput,
  stepMotion,
  captureMotion,
} from "../../shared/motion.js";
import { createSimulation } from "../../client/src/physics/simulation.js";
import { nearestSavedArrival } from "../../client/src/world/field-arrival.js";
import { npcRectangle } from "../../client/src/world/life-geometry-numeric.js";
import { physicalTargetError } from "../../client/src/combat/physical-damage.js";
import { executeAction } from "./actions.js";
import { operationFor } from "./action-rules.js";
import { rebuildActorEffects, expireActorEffects } from "./action-character.js";
import {
  createFieldMobs,
  prepareActorCombat,
  prepareActorPoses,
  advanceCombat,
  beginAttack,
  serverRandom,
} from "./field-combat.js";
import {
  actorEntity,
  lifeEntity,
  dropEntity,
  snapshotParts,
} from "./field-views.js";
import { advanceDrops, createFieldDrop } from "./field-drops.js";
import {
  transitionActor,
  portalContact,
  prepareLogout,
} from "./field-transition.js";
import { developActor, prepareMonsterSpawns } from "./field-development.js";
import { castSkill } from "./field-skills.js";
import { sweepInteractions, releaseInteractions } from "./interactions.js";
import { updateSkillMovement } from "../../client/src/physics/skill-movement.js";
import { projectCharacterStats } from "../../client/src/character/character-stats.js";

const MAX_FIELDS = 128;
const MAX_ACTORS = 128;
const MAX_DEBT_MS = 5000;
const NEUTRAL = Object.freeze({
  horizontal: 0,
  vertical: 0,
  jump: false,
  attack: false,
});

function prepareNpcs(manifest) {
  const npcs = new Map();
  for (const record of manifest.life.placements) {
    if (record.kind !== "npc" || record.authored.hide) continue;
    const template = manifest.life.templates[record.template];
    if (!template || template.kind !== "npc") {
      throw protocolError("CONTENT_MISMATCH");
    }
    const id = randomUUID();
    npcs.set(id, {
      id,
      templateId: Number(template.originalId),
      template,
      record,
      x: record.authored.x,
      y: record.authored.y,
      facing: record.authored.f ? -1 : 1,
      action: template.defaultAction,
      rectangle: npcRectangle(template.info),
    });
  }
  return npcs;
}

function admitMobAttacks(mob) {
  for (const attack of mob.attacks) {
    if (
      !attack.supported ||
      attack.properties.disease ||
      (attack.properties.magic === 1 &&
        !Number.isSafeInteger(mob.template.info.MADamage))
    ) {
      throw protocolError("CONTENT_MISMATCH");
    }
  }
}

function admitFieldMobs(manifest, mobs) {
  for (const mob of mobs) {
    if (!mob.active) continue;
    if (
      physicalTargetError(mob.skillStatus.projected) ||
      (mob.template.info.bodyAttack === 1 &&
        (!manifest.combat?.standardPDD ||
          !Number.isSafeInteger(mob.template.info.PADamage)))
    ) {
      throw protocolError("CONTENT_MISMATCH");
    }
    admitMobAttacks(mob);
  }
}

function consumeActorInput(actor) {
  const sample = actor.inputQueue.get(actor.field.tick);
  actor.input.jumpPressed = false;
  actor.input.attackPressed = false;
  if (sample) {
    actor.inputQueue.delete(actor.field.tick);
    assignHeldInput(actor.input, sample);
    actor.ackInputSeq = Math.max(actor.ackInputSeq ?? 0, sample.inputSeq);
    actor.lastInputTick = actor.field.tick;
  } else if (actor.field.tick - actor.lastInputTick > 3) {
    assignHeldInput(actor.input, NEUTRAL);
  }
}

function applyPendingDamage(world, actor) {
  if (actor.pending || (!actor.pendingDamage && !actor.pendingMpDamage)) return;
  actor.profile.hp = Math.max(0, actor.profile.hp - actor.pendingDamage);
  actor.profile.mp = Math.max(
    0,
    actor.profile.mp - (actor.pendingMpDamage ?? 0),
  );
  actor.pendingDamage = 0;
  actor.pendingMpDamage = 0;
  actor.simulation.movementLocked =
    actor.profile.hp <= 0 ||
    actor.attackState.active ||
    actor.state !== "active";
  world.publish(actor, { type: "snapshot-request" });
}

function attackHeldInput(world, actor) {
  if (!actor.input.attack || actor.attackState.active || actor.pending) return;
  try {
    world.attack(actor);
  } catch (error) {
    actor.admission =
      error.code ?? "unsupported-content: basic attack unavailable";
  }
}

/** One process owns field clocks. No packet or socket lifetime advances world time. */
export class OnlineWorld {
  constructor({ content, database, publish, development = false }) {
    this.content = content;
    this.database = database;
    this.publish = publish;
    this.development = development;
    this.actors = new Map();
    this.fields = new Map();
    this.fieldLoads = new Map();
    this.now = Date.now();
    this.lastNow = null;
    this.debt = -PROTOCOL.TICK_MS * PROTOCOL.INPUT_BUFFER_TICKS;
    this.overloaded = false;
    this.closed = false;
    this.nextUint32 = serverRandom();
    this.random = () => this.nextUint32() / 0x100000000;
  }

  async fieldFor(mapId, realm = "public") {
    const key = `${realm}:${Number(mapId)}`;
    if (this.fields.has(key)) return this.fields.get(key);
    if (this.fieldLoads.has(key)) return this.fieldLoads.get(key);
    if (this.fields.size + this.fieldLoads.size >= MAX_FIELDS) {
      throw protocolError("SERVER_BUSY");
    }
    const pending = this.createField(mapId, realm, key);
    this.fieldLoads.set(key, pending);
    try {
      return await pending;
    } finally {
      this.fieldLoads.delete(key);
    }
  }

  async createField(mapId, realm, key) {
    const manifest = await this.content.map(mapId);
    const arrival = nearestSavedArrival(manifest, { x: 0, y: 0, facing: 1 });
    const simulation = createSimulation(manifest.physics, arrival);
    const mobs = createFieldMobs(manifest, simulation);
    admitFieldMobs(manifest, mobs);
    const field = {
      id: randomUUID(),
      mapId: Number(manifest.id),
      epoch: randomUUID(),
      realm,
      manifest,
      physics: manifest.physics,
      geometry: simulation.geometry,
      tick: 0,
      characters: new Map(),
      mobs,
      npcs: prepareNpcs(manifest),
      drops: new Map(),
      dropReservations: 0,
      developmentSpawns: 0,
      paused: false,
      fault: null,
      published: new Set(),
    };
    if (field.mobs.length + field.npcs.size + MAX_ACTORS + 128 > 2048) {
      throw protocolError("SERVER_BUSY");
    }
    this.fields.set(key, field);
    return field;
  }

  assertJoiningSession(actor) {
    if (actor.session?.revoked || actor.retiring) {
      throw protocolError("SESSION_EXPIRED");
    }
  }

  async join(actor) {
    if (this.closed || this.overloaded || this.actors.size >= MAX_ACTORS) {
      throw protocolError("SERVER_BUSY");
    }
    if (this.actors.has(actor.id)) throw protocolError("CHARACTER_BUSY");
    actor.realm =
      this.development && actor.role === "developer"
        ? `development:${actor.accountId}`
        : "public";
    const field = await this.fieldFor(
      actor.profile.location.mapId,
      actor.realm,
    );
    this.assertJoiningSession(actor);
    if (field.characters.size >= MAX_ACTORS) throw protocolError("SERVER_BUSY");
    actor.arrival = nearestSavedArrival(field.manifest, actor.profile.location);
    actor.simulation = createSimulation(field.physics, actor.arrival);
    actor.field = field;
    actor.input = createHeldInput();
    actor.inputQueue = new Map();
    actor.inputSeq = 0;
    actor.ackInputSeq = null;
    actor.lastInputTick = field.tick;
    actor.state = "active";
    actor.pending = false;
    actor.pendingDamage = 0;
    actor.developmentReceipts = new Map();
    actor.playSession ??= randomUUID();
    actor.portalUntil = 0;
    actor.actionStartTick = field.tick;
    actor.lastCheckpoint = this.now;
    actor.admission = "OK";
    await prepareActorPoses(this, actor);
    prepareActorCombat(this, actor);
    rebuildActorEffects(actor, this);
    await this.database.bindField(actor, {
      instanceId: field.id,
      fieldEpoch: field.epoch,
      mapId: field.mapId,
    });
    this.assertJoiningSession(actor);
    this.actors.set(actor.id, actor);
    field.characters.set(actor.id, actor);
    this.invalidateField(field);
    return actor;
  }

  leave(actor) {
    actor.state = "retired";
    releaseInteractions(actor, this);
    actor.field?.characters.delete(actor.id);
    this.actors.delete(actor.id);
    this.neutralize(actor);
    if (actor.field) this.invalidateField(actor.field);
  }

  neutralize(actor) {
    if (!actor.input) return;
    assignHeldInput(actor.input, NEUTRAL);
    actor.input.jumpPressed = false;
    actor.input.attackPressed = false;
    actor.inputQueue.clear();
  }

  input(actor, message) {
    if (
      this.closed ||
      this.overloaded ||
      actor.state !== "active" ||
      actor.field.fault
    ) {
      throw protocolError("SERVER_BUSY");
    }
    if (message.fieldEpoch !== actor.field.epoch) {
      throw protocolError("STALE_FIELD");
    }
    if (message.inputSeq <= actor.inputSeq) {
      throw protocolError("INVALID_MESSAGE");
    }
    actor.inputSeq = message.inputSeq;
    const tick = actor.field.tick;
    if (message.targetTick <= tick) {
      actor.ackInputSeq = Math.max(actor.ackInputSeq ?? 0, message.inputSeq);
      return;
    }
    if (message.targetTick > tick + PROTOCOL.INPUT_LEAD_TICKS) {
      throw protocolError("NOT_ALLOWED");
    }
    if (
      actor.inputQueue.has(message.targetTick) ||
      actor.inputQueue.size >= PROTOCOL.INPUT_LEAD_TICKS
    ) {
      throw protocolError("RATE_LIMITED");
    }
    actor.inputQueue.set(message.targetTick, message);
  }

  async command(actor, message) {
    // executeAction performs receipt lookup BEFORE lifecycle/revision/field admission.
    return await executeAction(actor, message, this);
  }

  async develop(actor, request) {
    if (actor.pending) throw protocolError("SERVER_BUSY");
    actor.pending = true;
    try {
      return await developActor(this, actor, request);
    } finally {
      actor.pending = false;
    }
  }

  step(now) {
    if (this.closed) return;
    if (
      !Number.isFinite(now) ||
      (this.lastNow !== null && now < this.lastNow)
    ) {
      throw new Error("World clock must be monotonic");
    }
    this.now = Date.now();
    sweepInteractions(this);
    if (this.lastNow === null) {
      this.lastNow = now;
      return;
    }
    this.debt += now - this.lastNow;
    this.lastNow = now;
    this.overloaded = this.debt > MAX_DEBT_MS;
    for (
      let count = 0;
      count < PROTOCOL.MAX_CATCH_UP && this.debt >= PROTOCOL.TICK_MS;
      count++
    ) {
      this.debt -= PROTOCOL.TICK_MS;
      for (const field of this.fields.values()) {
        if (!field.paused && !field.fault) this.tickField(field);
      }
    }
  }

  tickField(field) {
    if (!Number.isSafeInteger(field.tick + 1)) {
      throw protocolError("SERVER_BUSY");
    }
    field.tick++;
    for (const actor of field.characters.values()) this.moveActor(actor);
    advanceCombat(this, field);
    advanceDrops(this, field);
    for (const actor of field.characters.values()) {
      this.publish(actor, {
        type: "motion",
        fieldEpoch: field.epoch,
        ackInputSeq: actor.ackInputSeq,
        motion: captureMotion(actor.simulation),
        paused: field.paused,
      });
      if (field.tick % 3 === 0) this.publishEntities(actor);
      this.automaticPortal(actor);
      this.checkpoint(actor);
    }
  }

  moveActor(actor) {
    consumeActorInput(actor);
    if (actor.state !== "active" || actor.profile.hp <= 0) {
      this.neutralize(actor);
    }
    if (expireActorEffects(actor, this)) {
      this.publish(actor, { type: "snapshot-request" });
    }
    applyPendingDamage(this, actor);
    if (this.now >= (actor.castUntil ?? 0)) actor.castAction = null;
    actor.simulation.movementLocked =
      actor.profile.hp <= actor.pendingDamage ||
      actor.attackState.active ||
      actor.state !== "active" ||
      this.now < (actor.castUntil ?? 0);
    projectCharacterStats(actor.profile, actor.statHooks, actor.stats);
    updateSkillMovement(actor.simulation, actor.stats);
    const previous = actor.simulation.action;
    stepMotion(actor.simulation, actor.input);
    if (previous !== actor.simulation.action) {
      actor.actionStartTick = actor.field.tick;
    }
    attackHeldInput(this, actor);
    actor.profile.location.x = actor.simulation.x;
    actor.profile.location.y = actor.simulation.y;
    actor.profile.location.facing = actor.simulation.facing;
  }

  checkpoint(actor) {
    if (actor.pending || this.now - actor.lastCheckpoint < 1000) return;
    actor.lastCheckpoint = this.now;
    actor.pending = true;
    this.database
      .checkpoint(actor)
      .catch((error) => {
        actor.field.fault = error.code ?? "checkpoint-failed";
        this.publish(actor, {
          type: "closing",
          code: "SERVER_BUSY",
          retryAfterMs: 1000,
        });
      })
      .finally(() => {
        actor.pending = false;
      });
  }

  automaticPortal(actor) {
    if (
      actor.pending ||
      actor.state !== "active" ||
      actor.profile.hp <= 0 ||
      this.now < actor.portalUntil
    ) {
      return;
    }
    for (const portal of actor.field.manifest.physics.portals) {
      if (portal.type !== 3 || !portalContact(actor, portal)) continue;
      const message = {
        fieldEpoch: actor.field.epoch,
        operationId: randomUUID(),
        expectedRevision: actor.revision,
        action: { kind: "portal.enter", portalId: portal.id },
      };
      actor.pending = true;
      this.transition(actor, { portalId: portal.id }, operationFor(message))
        .catch((error) => {
          actor.admission = error.code ?? "TRANSITION_FAILED";
          actor.portalUntil = this.now + 500;
        })
        .finally(() => {
          actor.pending = false;
        });
      return;
    }
  }

  entities(actor) {
    const result = [];
    for (const peer of actor.field.characters.values()) {
      result.push(actorEntity(peer));
    }
    for (const mob of actor.field.mobs) {
      if (mob.visible) result.push(lifeEntity(mob, "mob"));
    }
    for (const npc of actor.field.npcs.values()) {
      result.push(lifeEntity(npc, "npc"));
    }
    for (const drop of actor.field.drops.values()) {
      result.push(dropEntity(drop));
    }
    return result;
  }

  /** NPC identity is field-owned; the original client applies no invented reach gate. */
  npc(actor, id) {
    const npc = actor.field.npcs.get(id);
    if (!npc) throw protocolError("NOT_FOUND");
    return npc;
  }

  nearby(actor, id, kind, maxDistance) {
    const field = actor.field;
    const target =
      kind === "player"
        ? field.characters.get(id)
        : kind === "npc"
          ? field.npcs.get(id)
          : kind === "drop"
            ? field.drops.get(id)
            : field.mobs.find((mob) => mob.id === id);
    if (!target) throw protocolError("NOT_FOUND");
    const position = target.simulation ?? target.position ?? target;
    const dx = actor.simulation.x - position.x,
      dy = actor.simulation.y - position.y;
    if (dx * dx + dy * dy > maxDistance * maxDistance) {
      throw protocolError("NOT_IN_RANGE");
    }
    return target;
  }

  publishEntities(actor) {
    this.publish(actor, {
      type: "entities-request",
      entities: this.entities(actor),
    });
  }

  invalidateField(field) {
    for (const actor of field.characters.values()) {
      this.publish(actor, { type: "snapshot-request" });
    }
  }
  broadcast(field, message) {
    for (const actor of field.characters.values()) this.publish(actor, message);
  }
  snapshot(actor) {
    return snapshotParts(this, actor);
  }
  prepareLogout(actor) {
    return prepareLogout(this, actor);
  }
  attack(actor) {
    return beginAttack(this, actor);
  }
  transition(actor, destination, operation) {
    return transitionActor(this, actor, destination, operation);
  }
  createDrop(actor, request) {
    return createFieldDrop(this, actor, request);
  }
  async spawnMonster(actor, templateId, count = 1) {
    const mobs = await prepareMonsterSpawns(this, actor, templateId, count);
    actor.field.mobs.push(...mobs);
    actor.field.developmentSpawns += mobs.length;
    this.invalidateField(actor.field);
    return mobs;
  }

  async cast(actor, action, operation) {
    return await castSkill(this, actor, action, operation);
  }

  close() {
    this.closed = true;
    for (const actor of this.actors.values()) this.neutralize(actor);
    this.actors.clear();
    this.fields.clear();
  }
}
