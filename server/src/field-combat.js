import { randomUUID, randomFillSync, createHash } from "node:crypto";
import { protocolError } from "../../shared/protocol.js";
import {
  createMobs,
  stepMob,
  damageMob,
  rectangleState,
  overlaps,
  mobFlipped,
  setMobAction,
  MOB_POLICY,
} from "../../client/src/combat/offline-mobs.js";
import {
  PhysicalDamage,
  physicalTargetError,
} from "../../client/src/combat/physical-damage.js";
import {
  createWeaponUse,
  selectWeaponUse,
  selectAmmunition,
  validateWeaponCombat,
  projectileTargetDistance,
  projectileRange,
  weaponActionDuration,
  weaponActionRelease,
} from "../../client/src/combat/weapon-usage.js";
import {
  createCharacterStats,
  projectCharacterStats,
} from "../../client/src/character/character-stats.js";
import {
  createHitboxState,
  updateHitboxes,
} from "../../client/src/physics/hitboxes.js";
import { applyExternalImpulse } from "../../client/src/physics/simulation.js";
import { placeBody } from "../../client/src/world/life-geometry-numeric.js";
import {
  awardExperience,
  learnedGrowth,
} from "../../client/src/character/offline-progression.js";
import { knockbackChance } from "../../client/src/combat/combat-knockback.js";
import { killDrops } from "./field-drops.js";
import { progressQuestViews } from "./interaction-quest.js";
import {
  consumeItem,
  isRechargeable,
} from "../../client/src/items/inventory-model.js";
import { ownedItem, admitActor } from "./action-rules.js";

/** Private cryptographic stream; never seeded or selected by clients. */
export function serverRandom() {
  const words = new Uint32Array(1024);
  let cursor = words.length;
  return function next() {
    if (cursor === words.length) {
      randomFillSync(words);
      cursor = 0;
    }
    return words[cursor++];
  };
}

export function createFieldMobs(manifest, simulation) {
  const mobs = createMobs(manifest.life, simulation);
  for (const mob of mobs) {
    mob.placementId = mob.id;
    mob.id = randomUUID();
    mob.targetId = null;
    mob.actionStartTick = 0;
  }
  return mobs;
}

export function prepareActorCombat(world, actor) {
  actor.stats = createCharacterStats();
  actor.hitboxes = createHitboxState();
  actor.hitboxContext = {};
  actor.attackBody = rectangleState();
  actor.attackTargets = new Array(6).fill(null);
  actor.targetDistances = new Float64Array(6);
  actor.damage = new PhysicalDamage(world.random, world.nextUint32);
  actor.weaponUse = createWeaponUse();
  actor.useContext = {
    crouching: false,
    job: 0,
    ammunition: null,
    closeTarget: false,
    randomWord: 0,
    items: world.content.items,
  };
  actor.statHooks = createStatHooks(world, actor);
  actor.attackState = {
    active: false,
    action: "stand1",
    id: null,
    impactAt: 0,
    endsAt: 0,
    hit: false,
    skillId: null,
    rank: null,
    percent: 100,
    limit: 1,
    rectangle: null,
  };
  actor.reaction = {
    skillId: 0,
    skillLine: false,
    line: 0,
    critical: false,
    knockbackChance: 0,
    roll: 0,
  };
  actor.projectiles = Array.from({ length: 16 }, createProjectile);
  actor.incoming = {
    magic: false,
    attackPADamage: null,
    standardPDD: actor.field.manifest.combat?.standardPDD,
  };
  actor.invulnerableUntil = 0;
  actor.lastLanding = 0;
  actor.growth = { hp: 0, mp: 0 };
  refreshActorCombat(world, actor);
}

function createStatHooks(world, actor) {
  return {
    items: world.content.items,
    skillLevel(id) {
      const skill = actor.profile.skills[id];
      return skill && (skill.expiresAt === null || skill.expiresAt > world.now)
        ? skill.level
        : 0;
    },
    skillInfo(id, rank) {
      return world.content.catalog.ui.skills[id]?.levels[rank];
    },
    derivedStats() {
      return actor.temporaryStats?.derived ?? null;
    },
  };
}

function createProjectile() {
  return {
    active: false,
    target: null,
    generation: 0,
    amount: 0,
    impactAt: 0,
    facing: 1,
    actionId: null,
    rank: null,
    reaction: {
      skillId: 0,
      skillLine: false,
      line: 0,
      critical: false,
      knockbackChance: 0,
      roll: 0,
    },
  };
}

export function refreshActorCombat(world, actor) {
  let weaponId = 0;
  for (const item of actor.profile.equipment) {
    if (item.slot === -11) weaponId = item.id;
  }
  actor.combat =
    world.content.catalog.ui.avatar?.entries[weaponId]?.combat ?? null;
  validateWeaponCombat(actor.combat);
  projectCharacterStats(actor.profile, actor.statHooks, actor.stats);
  actor.incoming.standardPDD = actor.field.manifest.combat?.standardPDD;
}

function admitAttack(world, actor, skill) {
  if (
    actor.profile.hp <= 0 ||
    actor.state !== "active" ||
    actor.simulation.state === "ladder"
  ) {
    throw protocolError("NOT_ALLOWED");
  }
  if (
    actor.tradeId ||
    actor.conversation ||
    (!skill && world.now < (actor.castUntil ?? 0))
  ) {
    throw protocolError("NOT_ALLOWED");
  }
  admitAttackCooldown(world, actor);
  refreshActorCombat(world, actor);
  if (!actor.combat) throw protocolError("REQUIREMENTS_NOT_MET");
}

function admitAttackCooldown(world, actor) {
  if (
    actor.attackState.active ||
    world.now < (actor.profile.onlineState?.cooldowns?.attack ?? 0)
  ) {
    throw protocolError("COOLDOWN");
  }
}

function selectActorWeaponUse(world, actor, skill) {
  const context = actor.useContext;
  context.crouching = actor.simulation.crouching;
  context.job = actor.profile.job;
  context.randomWord = world.nextUint32();
  context.ammunition = selectAmmunition(
    actor.profile,
    world.content.items,
    actor.combat.weaponId,
  );
  context.closeTarget = false;
  selectWeaponUse(actor.combat, context, actor.weaponUse);
  if (skill?.action) actor.weaponUse.action = skill.action;
}

function scheduleAttack(world, actor) {
  const frames = actor.actionPoses[actor.weaponUse.action];
  if (!frames?.length || frames.length > 4096) {
    throw protocolError("CONTENT_MISMATCH");
  }
  const temporary = actor.temporaryStats?.derived;
  const speed = Math.max(
    2,
    Math.min(
      10,
      actor.combat.equipment.attackSpeed +
        (temporary?.booster ?? 0) +
        (temporary?.speedInfusion ?? 0),
    ),
  );
  const actionTiming = { frames };
  const duration = weaponActionDuration(actionTiming, speed);
  const state = actor.attackState;
  state.active = true;
  state.action = actor.weaponUse.action;
  state.id = randomUUID();
  state.impactAt = world.now + weaponActionRelease(actionTiming, duration);
  state.endsAt = world.now + duration;
  state.hit = false;
}

function configureAttackTargets(actor, skill) {
  const state = actor.attackState;
  const attack = actor.combat.attacks[actor.weaponUse.action];
  state.skillId = skill?.id ?? null;
  state.percent = skill?.info.damage ?? 100;
  state.limit = skill?.info.mobCount ?? 1;
  state.rectangle = skill?.rectangle ?? attack?.rectangle;
  state.range = skill?.info.range ?? 0;
}

export function beginAttack(world, actor, skill = null) {
  admitAttack(world, actor, skill);
  selectActorWeaponUse(world, actor, skill);
  scheduleAttack(world, actor);
  configureAttackTargets(actor, skill);
  actor.attackState.rank = skill === null ? null : skill.rank;
  actor.actionStartTick = actor.field.tick;
  actor.simulation.movementLocked = true;
  return { code: "OK" };
}

function nearestTarget(field, mob) {
  let target = null;
  let distance = Infinity;
  for (const actor of field.characters.values()) {
    if (actor.profile.hp <= 0) continue;
    const dx = actor.simulation.x - mob.x,
      dy = actor.simulation.y - mob.y;
    const squared = dx * dx + dy * dy;
    if (squared < distance) {
      distance = squared;
      target = actor;
    }
  }
  return target;
}

export function advanceCombat(world, field) {
  for (const mob of field.mobs) {
    const target = nearestTarget(field, mob);
    const previous = mob.action;
    stepMob(mob, 30, target?.simulation ?? null);
    if (previous !== mob.action) mob.actionStartTick = field.tick;
  }
  for (const actor of field.characters.values()) {
    updateHitboxes(actor.hitboxes, actor.simulation, actor.hitboxContext);
    advanceAttack(world, actor);
    advanceProjectiles(world, actor);
    receiveContact(world, actor);
    if (actor.lastLanding !== actor.simulation.landing.sequence) {
      actor.lastLanding = actor.simulation.landing.sequence;
      receiveDamage(world, actor, actor.simulation.landing.amount, null);
    }
  }
  for (const mob of field.mobs) advanceMobAttack(world, field, mob);
}

function advanceAttack(world, actor) {
  const state = actor.attackState;
  if (!state.active) return;
  if (actor.profile.hp <= 0) {
    state.active = false;
    return;
  }
  if (!state.hit && world.now >= state.impactAt && !actor.pending) {
    state.hit = true;
    impactAttack(world, actor);
  }
  if (world.now >= state.endsAt && state.hit) {
    state.active = false;
    actor.simulation.movementLocked =
      actor.state !== "active" || actor.profile.hp <= 0;
  }
}

function selectedTargets(actor) {
  const state = actor.attackState;
  let count = 0;
  if (state.rectangle) {
    placeBody(
      actor.attackBody,
      state.rectangle,
      actor.simulation,
      actor.simulation.facing > 0,
    );
  }
  extendSlashBlast(actor);
  const range = actor.weaponUse.ranged
    ? projectileRange(
        actor.combat.weaponType,
        actor.profile.job,
        actor.statHooks,
      )
    : 0;
  for (const mob of actor.field.mobs) {
    if (!attackTargetEligible(actor, mob, range)) continue;
    const distance = Math.abs(mob.x - actor.simulation.x);
    if (count === state.limit && distance >= actor.targetDistances[count - 1]) {
      continue;
    }
    let index = Math.min(count, state.limit - 1);
    while (index > 0 && distance < actor.targetDistances[index - 1]) {
      actor.attackTargets[index] = actor.attackTargets[index - 1];
      actor.targetDistances[index] = actor.targetDistances[index - 1];
      index--;
    }
    actor.attackTargets[index] = mob;
    actor.targetDistances[index] = distance;
    if (count < state.limit) count++;
  }
  return count;
}

function attackTargetEligible(actor, mob, range) {
  if (
    !mob.alive ||
    !mob.active ||
    physicalTargetError(mob.skillStatus.projected)
  ) {
    return false;
  }
  if (
    mob.selectedSkills.length &&
    !mob.selectedSkills.includes(actor.attackState.skillId ?? 0)
  ) {
    return false;
  }
  return actor.weaponUse.ranged
    ? Number.isFinite(
        projectileTargetDistance(mob.body, actor.simulation, range, 65),
      )
    : overlaps(actor.attackBody, mob.body);
}

function extendSlashBlast(actor) {
  const state = actor.attackState;
  if (
    (state.skillId !== 1001005 && state.skillId !== 11001003) ||
    !state.range
  ) {
    return;
  }
  for (const mob of actor.field.mobs) {
    if (!mob.alive || !mob.active || !overlaps(actor.attackBody, mob.body)) {
      continue;
    }
    if (actor.simulation.facing > 0) {
      actor.attackBody.right = Math.max(
        actor.attackBody.right,
        actor.simulation.x + state.range,
      );
    } else {
      actor.attackBody.left = Math.min(
        actor.attackBody.left,
        actor.simulation.x - state.range,
      );
    }
    return;
  }
}

function impactAttack(world, actor) {
  if (!actor.weaponUse.ammunition) {
    applyAttackImpact(world, actor);
    return;
  }
  actor.pending = true;
  debitAmmunitionImpact(world, actor)
    .catch((error) => {
      actor.admission = error.code ?? "ammunition-debit-failed";
    })
    .finally(() => {
      actor.pending = false;
    });
}

/** Ammo is committed before its shot, never restored by a later inventory hydration. */
async function debitAmmunitionImpact(world, actor) {
  const field = actor.field;
  const ammoId = actor.weaponUse.ammunition.uid;
  const operation = {
    operationId: actor.attackState.id,
    digest: createHash("sha256").update(ammoId).digest("hex"),
    expectedRevision: actor.inventoryRevision,
    domain: "inventory",
    kind: "combat.ammunition",
    fieldEpoch: field.epoch,
  };
  const receipt = await world.database.commit(actor, operation, (draft) => {
    admitActor(actor, world, field.epoch);
    const item = ownedItem(draft, actor, ammoId, Date.now());
    if (item.count < 1 || actor.profile.hp <= actor.pendingDamage) {
      throw protocolError("NOT_ALLOWED");
    }
    if (isRechargeable(item.id)) item.count--;
    else consumeItem(draft, item.uid, 1);
  });
  if (receipt.status !== "committed" || actor.field !== field) return;
  if (actor.profile.hp > actor.pendingDamage) applyAttackImpact(world, actor);
  world.publish(actor, { type: "snapshot-request" });
}

function applyAttackImpact(world, actor) {
  const state = actor.attackState;
  projectCharacterStats(actor.profile, actor.statHooks, actor.stats);
  const hits = [];
  const count = selectedTargets(actor);
  for (let index = 0; index < count; index++) {
    const mob = actor.attackTargets[index];
    const amount = Math.min(
      mob.hp,
      Math.max(
        0,
        actor.damage.generate(
          actor.stats,
          mob.skillStatus.projected,
          state.percent,
          actor.weaponUse,
        ),
      ),
    );
    const reaction = actor.reaction;
    reaction.skillId = state.skillId ?? 0;
    reaction.skillLine = state.skillId !== null;
    reaction.knockbackChance = knockbackChance(
      world.content.items[actor.stats.weaponId]?.info.knockback ?? 0,
    );
    reaction.roll = world.nextUint32() % 100;
    if (actor.weaponUse.ranged) {
      launchProjectile(world, actor, mob, amount);
      continue;
    }
    if (damageMob(mob, amount, actor.simulation.facing, reaction)) {
      killMob(world, actor, mob);
    }
    hits.push({
      targetId: mob.id,
      damage: amount,
      outcome: amount ? "hit" : "miss",
    });
  }
  world.broadcast(actor.field, {
    type: "event",
    fieldEpoch: actor.field.epoch,
    event: {
      kind: "combat",
      actionId: state.id,
      actorId: actor.id,
      skillId: state.skillId,
      rank: state.rank,
      hits,
      impactTick: actor.field.tick,
    },
  });
}

function launchProjectile(world, actor, mob, amount) {
  const shot = actor.projectiles.find((entry) => !entry.active);
  if (!shot) throw protocolError("SERVER_BUSY");
  const x = actor.simulation.x + actor.simulation.facing * 65;
  const y = actor.simulation.y - 28;
  const dx = (mob.body.left + mob.body.right) / 2 - x;
  const dy = (mob.body.top + mob.body.bottom) / 2 - y;
  shot.active = true;
  shot.target = mob;
  shot.generation = mob.deaths;
  shot.amount = amount;
  shot.impactAt =
    world.now + Math.max(1, Math.trunc(Math.sqrt(dx * dx + dy * dy) * 1.5));
  shot.facing = actor.simulation.facing;
  shot.actionId = actor.attackState.id;
  shot.rank = actor.attackState.rank;
  Object.assign(shot.reaction, actor.reaction);
  world.broadcast(actor.field, {
    type: "event",
    fieldEpoch: actor.field.epoch,
    event: {
      kind: "projectile",
      actionId: shot.actionId,
      actorId: actor.id,
      targetId: mob.id,
      templateId: actor.stats.projectileId,
      skillId: actor.attackState.skillId,
      rank: shot.rank,
      facing: shot.facing,
      source: { x, y },
      destination: { x: x + dx, y: y + dy },
      durationMs: shot.impactAt - world.now,
      launchTick: actor.field.tick,
    },
  });
}

function advanceProjectiles(world, actor) {
  if (actor.pending) return;
  for (const shot of actor.projectiles) {
    if (!shot.active || world.now < shot.impactAt) continue;
    shot.active = false;
    const mob = shot.target;
    shot.target = null;
    if (!mob.alive || mob.deaths !== shot.generation) continue;
    const amount = Math.min(mob.hp, shot.amount);
    if (damageMob(mob, amount, shot.facing, shot.reaction)) {
      killMob(world, actor, mob);
    }
    world.broadcast(actor.field, {
      type: "event",
      fieldEpoch: actor.field.epoch,
      event: {
        kind: "combat",
        actionId: shot.actionId,
        actorId: actor.id,
        skillId: shot.reaction.skillId || null,
        rank: shot.rank,
        hits: [
          {
            targetId: mob.id,
            damage: amount,
            outcome: amount ? "hit" : "miss",
          },
        ],
        impactTick: actor.field.tick,
      },
    });
  }
}

function killMob(world, actor, mob) {
  const before = progressQuestViews(actor, world);
  learnedGrowth(
    actor.profile,
    world.content.catalog.ui.skills,
    world.now,
    actor.growth,
  );
  awardExperience(
    actor.profile,
    mob.template.info.exp ?? 0,
    actor.growth,
    world.content.items,
  );
  for (const quest of before) {
    if (quest.state !== "active") continue;
    for (const objective of quest.objectives) {
      if (
        objective.kind !== "kill" ||
        objective.templateId !== mob.templateId
      ) {
        continue;
      }
      actor.profile.quests[quest.id].kills[mob.templateId] = Math.min(
        objective.required,
        objective.current + 1,
      );
    }
  }
  for (const quest of progressQuestViews(actor, world)) {
    if (
      !quest.ready ||
      before.find((previous) => previous.id === quest.id)?.ready
    ) {
      continue;
    }
    world.publish(actor, {
      type: "event",
      fieldEpoch: actor.field.epoch,
      event: {
        kind: "quest.ready",
        questId: quest.id,
        questRevision: actor.revision,
      },
    });
  }
  killDrops(world, actor, mob);
  world.publish(actor, { type: "snapshot-request" });
}

function receiveContact(world, actor) {
  if (actor.profile.hp <= 0 || world.now < actor.invulnerableUntil) return;
  projectCharacterStats(actor.profile, actor.statHooks, actor.stats);
  for (const mob of actor.field.mobs) {
    if (
      !mob.alive ||
      mob.template.info.bodyAttack !== 1 ||
      !overlaps(mob.sweptBody, actor.hitboxes.body)
    ) {
      continue;
    }
    if (
      physicalTargetError(mob.skillStatus.projected) ||
      !actor.incoming.standardPDD
    ) {
      actor.admission =
        "unsupported-content: original incoming statistics unavailable";
      continue;
    }
    const amount = actor.damage.receive(
      actor.stats,
      mob.skillStatus.projected,
      actor.incoming,
    );
    receiveDamage(world, actor, amount, mob);
    return;
  }
}

function receiveDamage(world, actor, amount, mob) {
  const hp = actor.profile.hp - actor.pendingDamage;
  if (amount <= 0 || hp <= 0 || world.now < actor.invulnerableUntil) return;
  const guard = actor.temporaryStats?.derived.magicGuard ?? 0;
  const diverted = Math.min(
    actor.profile.mp - (actor.pendingMpDamage ?? 0),
    Math.trunc((amount * guard) / 100),
  );
  amount -= diverted;
  if (actor.pending) {
    actor.pendingDamage += amount;
    actor.pendingMpDamage = (actor.pendingMpDamage ?? 0) + diverted;
  } else {
    actor.profile.hp = Math.max(0, actor.profile.hp - amount);
    actor.profile.mp -= diverted;
  }
  actor.invulnerableUntil = world.now + 1500;
  applyDamageRecoil(actor, mob);
  publishDamage(world, actor, amount, mob);
}

function applyDamageRecoil(actor, mob) {
  const direction = mob
    ? actor.simulation.x >= mob.x
      ? 1
      : -1
    : actor.simulation.facing;
  // Original PLAYER_HIT: 009581a9 / 00930b27 ordinary recoil.
  applyExternalImpulse(actor.simulation, direction * 270, -270);
  if (actor.profile.hp - actor.pendingDamage <= 0) {
    actor.simulation.movementLocked = true;
  }
}

function publishDamage(world, actor, amount, mob) {
  world.broadcast(actor.field, {
    type: "event",
    fieldEpoch: actor.field.epoch,
    event: {
      kind: "combat",
      actionId: randomUUID(),
      actorId: mob?.id ?? actor.id,
      skillId: null,
      rank: null,
      hits: [{ targetId: actor.id, damage: amount, outcome: "hit" }],
      impactTick: actor.field.tick,
    },
  });
  world.publish(actor, { type: "snapshot-request" });
}

/** Existing authored attack selection/impact policy, shared across every field observer. */
export function advanceMobAttack(world, field, mob) {
  if (!mob.alive || !mob.active || mob.fault || mob.state === "hit") return;
  if (mob.state === "attack") {
    releaseMobAttack(world, field, mob);
    return;
  }
  if (mob.cooldownMs > 0) return;
  for (let offset = 0; offset < mob.attacks.length; offset++) {
    const index = (mob.attackIndex + offset) % mob.attacks.length;
    const attack = mob.attacks[index];
    if (!attack.supported || (attack.properties.conMP ?? 0) > mob.mp) continue;
    placeBody(mob.attackBody, attack.rectangle, mob, mobFlipped(mob));
    if (mobAttackHasTarget(field, mob)) {
      startMobAttack(field, mob, attack, index);
      return;
    }
  }
}

function releaseMobAttack(world, field, mob) {
  const attack = mob.pendingAttack;
  if (
    !attack ||
    mob.attackFired ||
    mob.stateMs < attack.properties.attackAfter
  ) {
    return;
  }
  mob.attackFired = true;
  placeBody(mob.attackBody, attack.rectangle, mob, mobFlipped(mob));
  for (const actor of field.characters.values()) {
    if (!overlaps(mob.attackBody, actor.hitboxes.body)) continue;
    actor.incoming.magic = attack.properties.magic === 1;
    actor.incoming.attackPADamage = attack.properties.PADamage ?? null;
    projectCharacterStats(actor.profile, actor.statHooks, actor.stats);
    const amount = actor.damage.receive(
      actor.stats,
      mob.skillStatus.projected,
      actor.incoming,
    );
    receiveDamage(world, actor, amount, mob);
    actor.incoming.magic = false;
    actor.incoming.attackPADamage = null;
  }
}

function mobAttackHasTarget(field, mob) {
  for (const actor of field.characters.values()) {
    if (
      actor.profile.hp <= actor.pendingDamage ||
      !overlaps(mob.attackBody, actor.hitboxes.body)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function startMobAttack(field, mob, attack, index) {
  mob.state = "attack";
  mob.stateMs = 0;
  mob.actionMs = 0;
  mob.pendingAttack = attack;
  mob.attackFired = false;
  mob.attackIndex = (index + 1) % mob.attacks.length;
  mob.mp -= attack.properties.conMP ?? 0;
  mob.cooldownMs = MOB_POLICY.attackCooldownMs;
  setMobAction(mob, attack.action);
  mob.actionStartTick = field.tick;
}

/** Original body poses retain signed-delay release and alias provenance without Pixi. */
export async function prepareActorPoses(world, actor) {
  const skin =
    world.content.catalog.ui.avatar.skins[actor.profile.appearance.skin];
  const entry = world.content.catalog.ui.avatar.entries[skin?.body];
  if (!entry) throw protocolError("CONTENT_MISMATCH");
  const bundle = await world.content.json(entry.descriptor);
  const poses = bundle.metadata?.avatar?.poses;
  if (!poses || Object.keys(poses).length > 512) {
    throw protocolError("CONTENT_MISMATCH");
  }
  actor.actionPoses = poses;
}
