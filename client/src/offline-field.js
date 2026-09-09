import { createHitboxState, updateHitboxes } from "./physics/hitboxes.js";
import { applyExternalImpulse } from "./physics/simulation.js";
import { placeBody } from "./life-geometry.js";
import { OfflineMobRenderer } from "./offline-mob-renderer.js";
import { PassiveRecovery } from "./passive-recovery.js";
import {
  createMobs,
  stepMob,
  damageMob,
  overlaps,
  rectangleState,
  setMobAction,
  mobFlipped,
  MOB_POLICY,
} from "./offline-mobs.js";
import {
  awardExperience,
  experienceRequired,
  PROGRESSION_POLICY,
} from "./offline-progression.js";
import { REVIVAL_POLICY } from "./revival.js";
const MAX_ATTACK_TARGETS = 6;

export const COMBAT_POLICY = Object.freeze({
  authority: "offline-local-policy",
  fixedTickMs: 30,
  playerDamage:
    "max(1,floor((4*STR+DEX)*equipped WZ incPAD/10 - WZ PDDamage/2)); nearest eligible original body",
  incomingDamage:
    "max(1, ceil(original PADamage or MADamage / 20 - matching learned defense / 2))",
  impact: "first fixed tick at/after half original equipped action duration",
  attackMP: 0,
  regeneration: "native independent HP/MP timers; see passive-recovery.js",
  respawn: REVIVAL_POLICY,
});

/** Original 009581a9 outcome / 00930b27 local-avatar update, not damage policy. */
export const PLAYER_HIT = Object.freeze({
  timerMs: 1500,
  tickMs: 30,
  horizontalImpulse: 200,
  verticalImpulse: -200,
  noDirection: 0x7fffffff,
  normalTint: 0xffffff,
  hitTint: 0x808080,
});

function applyHitImpulse(simulation, direction) {
  const noDirection = direction === PLAYER_HIT.noDirection;
  applyExternalImpulse(
    simulation,
    noDirection ? 0 : (direction < 0 ? -1 : 1) * PLAYER_HIT.horizontalImpulse,
    noDirection ? 0 : PLAYER_HIT.verticalImpulse,
  );
}

/** All authority lives here and in plain mob records, never in a Pixi entity. */
export class OfflineField {
  constructor(scene, store, hooks = {}) {
    this.scene = scene;
    this.store = store;
    this.hooks = hooks;
    this.simulation = scene.simulation;
    this.combat = scene.manifest.combat;
    validateCombat(this.combat);
    this.mobs = createMobs(scene.manifest.life, this.simulation);
    this.byId = new Map(this.mobs.map((mob) => [mob.id, mob]));
    this.renderer = new OfflineMobRenderer(scene, this.mobs);
    this.hitboxes = createHitboxState();
    this.receiverContext = {};
    this.attackBody = rectangleState();
    this.phase = store.profile.hp > 0 ? "idle" : "dead";
    this.attackTargets = new Array(MAX_ATTACK_TARGETS).fill(null);
    this.targetDistances = new Float64Array(MAX_ATTACK_TARGETS);
    this.attackSkill = null;
    this.attackInfo = null;
    this.attackOnHit = null;
    this.attackPower = 0;
    this.phaseMs = 0;
    this.attack = null;
    this.attackName = null;
    this.attackDurationMs = 0;
    this.attackFired = false;
    this.hitTimerMs = 0;
    this.blinkCounter = 0;
    this.blinkTint = PLAYER_HIT.normalTint;
    this.localHit = {
      amount: 0,
      direction: 0,
      locallyInitiated: true,
      source: null,
      attackAction: null,
    };
    this.recovery = new PassiveRecovery(
      this.simulation,
      store,
      hooks,
      scene.manifest.physics.map,
    );
    this.wasAttack = false;
    this.destroyed = false;
    this.prepared = false;
    this.lastStatus = "offline-local-policy";
    this.lastDamage = 0;
    this.deathAction = scene.actor.actions.has("dead") ? "dead" : null;
    this.simulation.movementLocked = this.blocksMovement;
    scene.offlineField = this;
  }

  get dead() {
    return this.phase === "dead";
  }
  get blocksMovement() {
    return this.phase !== "idle";
  }
  get playback() {
    return this.phase === "idle" ? "loop" : "once";
  }
  get action() {
    if (this.phase === "attack" || this.phase === "cast") {
      return this.attackName;
    }
    return this.dead ? this.deathAction : null;
  }

  async prepare(signal) {
    try {
      await this.renderer.prepare(signal);
      this.prepared = true;
      this.renderer.synchronize();
      return this;
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  /** Called exactly once after each executed original 30-ms physics quantum. */
  step(ms, input) {
    if (
      this.destroyed ||
      !this.prepared ||
      this.store.profileTransactionPending
    ) {
      return;
    }
    if (ms !== COMBAT_POLICY.fixedTickMs) {
      throw new Error("OfflineField requires one fixed 30-ms tick");
    }
    const attackEdge = !!input.attack && !this.wasAttack;
    this.wasAttack = !!input.attack;
    this.phaseMs += ms;
    updateHitboxes(this.hitboxes, this.simulation, this.receiverContext);
    for (const mob of this.mobs) stepMob(mob, ms);
    this.stepPlayer(attackEdge);
    if (!this.dead) {
      for (const mob of this.mobs) this.stepMobAttack(mob);
      this.contactDamage();
    }
    if (this.recovery.step(ms, this.action ?? this.simulation.action)) {
      this.changed();
    }
    this.advanceHitPresentation();
    this.simulation.movementLocked = this.blocksMovement;
    this.renderer.synchronize();
  }

  stepPlayer(attackEdge) {
    if (this.dead) return;
    const canStart = this.phase === "idle";
    this.advancePlayerPhase();
    if (canStart && attackEdge) this.beginAttack();
  }

  /** Finish the current action without admitting another attack on its final tick. */
  advancePlayerPhase() {
    if (this.phase === "attack") {
      if (!this.attackFired && this.phaseMs >= this.attackDurationMs / 2) {
        this.playerImpact();
      }
    }
    if (
      (this.phase === "attack" || this.phase === "cast") &&
      this.phaseMs >= this.attackDurationMs
    ) {
      this.phase = "idle";
    }
  }

  beginAttack() {
    const profile = this.store.profile;
    if (!profile.equipment.includes(this.combat.weaponId)) {
      this.lastStatus = "attack unavailable: extracted weapon not equipped";
      return;
    }
    if (this.simulation.state === "ladder") {
      this.lastStatus = "attack unavailable while climbing";
      return;
    }
    const name = this.simulation.crouching
      ? this.combat.proneAction
      : this.combat.defaultAction;
    const descriptor = this.combat.attacks[name];
    const artwork = this.scene.actor.actions.get(name);
    if (!descriptor || !artwork || artwork.duration <= 0) {
      this.lastStatus =
        "attack unavailable: original rectangle/action timing missing";
      return;
    }
    this.attack = descriptor;
    this.attackSkill = null;
    this.attackInfo = null;
    this.attackOnHit = null;
    this.startPose(name, "attack");
    this.lastStatus = "local sword attack";
    this.hooks.onAttack?.();
  }

  skillCastError() {
    if (
      !this.prepared ||
      this.destroyed ||
      this.dead ||
      this.store.profileTransactionPending
    ) {
      return "Character/field is unavailable";
    }
    if (this.phase !== "idle") return "Another character action is active";
    if (this.simulation.state === "ladder") {
      return "Active skill rope/ladder pose controller is unavailable";
    }
    return null;
  }

  skillAttackName(skill) {
    return (
      skill.actions[0] ??
      (this.simulation.crouching
        ? this.combat.proneAction
        : this.combat.defaultAction)
    );
  }

  skillAttackError(skill, info) {
    if (!this.store.profile.equipment.includes(this.combat.weaponId)) {
      return "Extracted sword is not equipped";
    }
    const name = this.skillAttackName(skill);
    if (!this.combat.attacks[name] || !this.scene.actor.actions.has(name)) {
      return "Original weapon action/rectangle is unavailable";
    }
    return this.skillDamageError(info);
  }

  skillDamageError(info) {
    const count = info.mobCount ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > MAX_ATTACK_TARGETS) {
      return "Unsupported original target count";
    }
    if ((info.attackCount ?? 1) !== 1) {
      return "Multiple damage-line controller is unavailable";
    }
    if (!Number.isFinite(info.damage) || info.damage <= 0) {
      return "Original damage multiplier is unavailable";
    }
    if (
      info.range !== undefined &&
      (!Number.isFinite(info.range) || info.range <= 0)
    ) {
      return "Invalid original melee extension range";
    }
    return null;
  }

  /** Called synchronously after skill validation; no costs or second damage authority here. */
  beginSkillAttack(skill, info, onHit) {
    const name = this.skillAttackName(skill);
    this.attack = this.combat.attacks[name];
    this.attackSkill = skill;
    this.attackInfo = info;
    this.attackOnHit = onHit;
    this.startPose(name, "attack");
    this.lastStatus = "learned sword skill admitted";
  }

  beginSkillPose(action) {
    this.attackSkill = null;
    this.attackInfo = null;
    this.attackOnHit = null;
    this.startPose(action, "cast");
    this.lastStatus = "learned self-buff pose";
  }

  startPose(name, phase) {
    this.attackName = name;
    this.attackDurationMs = this.scene.actor.actions.get(name).duration;
    this.attackFired = false;
    this.phase = phase;
    this.phaseMs = 0;
    this.simulation.movementLocked = true;
  }

  /** Explicit development edits may change mortality without inventing a received hit. */
  synchronizeProfile() {
    const dead = this.store.profile.hp === 0;
    if (dead === this.dead) return;
    this.phase = dead ? "dead" : "idle";
    this.phaseMs = 0;
    this.hitTimerMs = 0;
    this.blinkTint = PLAYER_HIT.normalTint;
    this.attackSkill = null;
    this.attackInfo = null;
    this.attackOnHit = null;
    this.simulation.movementLocked = this.blocksMovement;
  }

  playerImpact() {
    this.attackFired = true;
    const sim = this.simulation;
    placeBody(this.attackBody, this.attack.rectangle, sim, sim.facing > 0);
    this.extendSkillRange();
    const reactorHit = this.hooks.onStrike?.(
      this.attackBody,
      sim.facing,
      this.attackSkill?.id ?? 0,
    );
    const count = this.selectAttackTargets(this.attackInfo?.mobCount ?? 1);
    if (!count) {
      this.lastStatus = reactorHit
        ? "local reactor hit"
        : "local impact: no eligible original body";
      return;
    }
    this.attackPower = this.localAttackPower();
    for (let index = 0; index < count; index++) {
      this.damageTarget(this.attackTargets[index]);
    }
  }

  /** 00951571..0095165c: a basic-range target unlocks Slash Blast's absolute forward extension. */
  extendSkillRange() {
    const range = this.attackInfo?.range ?? 0;
    if (!range || !this.selectAttackTargets(1)) return;
    const sim = this.simulation;
    if (sim.facing > 0) {
      this.attackBody.right = Math.max(this.attackBody.right, sim.x + range);
    } else this.attackBody.left = Math.min(this.attackBody.left, sim.x - range);
  }

  localAttackPower() {
    const profile = this.store.profile;
    const extra = this.hooks.derivedStats?.().pad ?? 0;
    const base =
      ((4 * profile.str + profile.dex) *
        (this.combat.equipment.incPAD + extra)) /
      10;
    return base * ((this.attackInfo?.damage ?? 100) / 100);
  }

  damageTarget(target) {
    const amount = Math.min(
      target.hp,
      Math.max(
        1,
        Math.floor(this.attackPower - (target.template.info.PDDamage ?? 0) / 2),
      ),
    );
    const killed = damageMob(target, amount, this.simulation.facing);
    this.hooks.onMobHit?.(target, amount);
    if (this.attackSkill) this.attackOnHit(this.attackSkill.id, target);
    this.lastStatus = killed
      ? "local mob killed; WZ EXP awarded; no drops"
      : "local mob hit";
    if (killed) this.onKill(target);
  }

  /** Bounded nearest-first insertion into reusable target slots; stable ties keep field order. */
  selectAttackTargets(limit) {
    let count = 0;
    for (const mob of this.mobs) {
      if (!this.canAttackMob(mob) || !overlaps(this.attackBody, mob.body)) {
        continue;
      }
      const distance = Math.abs(mob.x - this.simulation.x);
      if (count === limit && distance >= this.targetDistances[count - 1]) {
        continue;
      }
      let index = Math.min(count, limit - 1);
      while (index > 0 && distance < this.targetDistances[index - 1]) {
        this.attackTargets[index] = this.attackTargets[index - 1];
        this.targetDistances[index] = this.targetDistances[index - 1];
        index--;
      }
      this.attackTargets[index] = mob;
      this.targetDistances[index] = distance;
      if (count < limit) count++;
    }
    return count;
  }

  canAttackMob(mob) {
    return (
      mob.alive &&
      !mob.template.info.invincible &&
      (!mob.selectedSkills.length ||
        mob.selectedSkills.includes(this.attackSkill?.id ?? 0))
    );
  }

  onKill(mob) {
    const exp = mob.template.info.exp ?? 0;
    const levels = awardExperience(
      this.store.profile,
      exp,
      this.hooks.hpGrowth?.() ?? 0,
    );
    this.hooks.onKill?.(mob.templateId);
    if (levels > 0) this.hooks.onEffect?.("LevelUp");
    this.changed();
  }

  stepMobAttack(mob) {
    if (!mob.alive || !mob.active || mob.fault || mob.state === "hit") return;
    if (mob.state === "attack") {
      this.mobImpact(mob);
      return;
    }
    if (mob.cooldownMs > 0) return;
    for (let offset = 0; offset < mob.attacks.length; offset++) {
      const index = (mob.attackIndex + offset) % mob.attacks.length;
      const attack = mob.attacks[index];
      if (!attack.supported || (attack.properties.conMP ?? 0) > mob.mp) {
        continue;
      }
      placeBody(mob.attackBody, attack.rectangle, mob, mobFlipped(mob));
      if (!overlaps(mob.attackBody, this.hitboxes.body)) continue;
      this.beginMobAttack(mob, attack, index);
      return;
    }
  }

  /** Fire the pending original area once at its authored delay. */
  mobImpact(mob) {
    const attack = mob.pendingAttack;
    if (mob.attackFired || mob.stateMs < attack.properties.attackAfter) return;
    mob.attackFired = true;
    placeBody(mob.attackBody, attack.rectangle, mob, mobFlipped(mob));
    if (overlaps(mob.attackBody, this.hitboxes.body)) {
      this.proposeMobHit(mob, attack.properties.magic === 1, attack.action);
    }
  }

  beginMobAttack(mob, attack, index) {
    mob.state = "attack";
    mob.stateMs = 0;
    mob.actionMs = 0;
    mob.pendingAttack = attack;
    mob.attackFired = false;
    mob.attackIndex = (index + 1) % mob.attacks.length;
    mob.mp -= attack.properties.conMP ?? 0;
    mob.cooldownMs = MOB_POLICY.attackCooldownMs;
    setMobAction(mob, attack.action);
    this.hooks.onMobAttack?.(mob);
  }

  contactDamage() {
    for (const mob of this.mobs) {
      if (
        mob.template.info.bodyAttack === 1 &&
        overlaps(mob.sweptBody, this.hitboxes.body)
      ) {
        if (this.proposeMobHit(mob, false)) return;
      }
    }
  }

  /** Damage magnitude and geometry-derived side remain explicit offline policy. */
  proposeMobHit(mob, magic, attackAction = null) {
    const base = magic
      ? mob.template.info.MADamage
      : mob.template.info.PADamage;
    if (!Number.isFinite(base) || base < 0) {
      this.lastStatus = "mob damage unavailable: original stat missing";
      return false;
    }
    const hit = this.localHit;
    const defense = this.hooks.derivedStats?.();
    const reduction = magic ? (defense?.mdd ?? 0) : (defense?.pdd ?? 0);
    hit.amount = Math.max(1, Math.ceil(base / 20 - reduction / 2));
    hit.direction = this.simulation.x >= mob.x ? 1 : -1;
    hit.source = mob;
    hit.attackAction = attackAction;
    return this.tryReceiveHit(hit);
  }

  /** One outcome boundary for contact/authored attacks and already-authorized hits.
   * 009581a9 bypasses timer/death in authorized mode. Its separate status/action
   * deadlines are not equivalent to every ordinary attack being invulnerable. */
  tryReceiveHit(hit) {
    validatePlayerHit(hit);
    if (this.rejectsHit(hit)) return false;
    applyHitImpulse(this.simulation, hit.direction);
    const profile = this.store.profile;
    if (hit.amount > 0) profile.hp = Math.max(0, profile.hp - hit.amount);
    this.lastDamage = hit.amount;
    this.hitTimerMs = hit.amount > 0 ? PLAYER_HIT.timerMs : -PLAYER_HIT.timerMs;
    if (hit.amount > 0) {
      this.scene.actor.setExpression("hit", PLAYER_HIT.timerMs);
    }
    const killed = profile.hp === 0 && !this.dead;
    if (killed) {
      this.phase = "dead";
      this.phaseMs = 0;
    }
    this.projectHitState(hit);
    this.hooks.onPlayerHit?.(hit, this.simulation);
    if (killed) this.hooks.onPlayerDeath?.();
    this.changed();
    return true;
  }

  projectHitState(hit) {
    if (hit.amount <= 0 || this.dead) this.blinkTint = PLAYER_HIT.normalTint;
    this.simulation.movementLocked = this.blocksMovement;
    this.lastStatus = this.dead
      ? "player dead; original revival confirmation required"
      : "player hit outcome admitted";
  }

  rejectsHit(hit) {
    if (this.destroyed) return true;
    if (hit.locallyInitiated && (this.hitTimerMs !== 0 || this.dead)) {
      return true;
    }
    const source = hit.source;
    return !!source && (!source.alive || !source.active || !!source.fault);
  }

  /** 00930b27 decrements before tint selection, once on the existing actor clock.
   * The persistent blink phase is not restarted by another admitted outcome. */
  advanceHitPresentation() {
    if (this.hitTimerMs > 0) {
      this.hitTimerMs = Math.max(0, this.hitTimerMs - PLAYER_HIT.tickMs);
    } else if (this.hitTimerMs < 0) {
      this.hitTimerMs = Math.min(0, this.hitTimerMs + PLAYER_HIT.tickMs);
    }
    this.blinkTint = PLAYER_HIT.normalTint;
    if (!this.dead && this.hitTimerMs > 0) {
      this.blinkCounter = (this.blinkCounter + 1) >>> 0;
      if ((this.blinkCounter & 3) < 2) this.blinkTint = PLAYER_HIT.hitTint;
    }
  }

  changed() {
    this.store.markDirty();
    this.hooks.onChange?.();
  }

  updateDemand() {
    if (!this.destroyed) this.renderer.updateDemand();
  }

  snapshot() {
    return structuredClone({
      authority: COMBAT_POLICY.authority,
      policy: COMBAT_POLICY,
      playerHit: PLAYER_HIT,
      mobPolicy: MOB_POLICY,
      progressionPolicy: PROGRESSION_POLICY,
      prepared: this.prepared,
      destroyed: this.destroyed,
      phase: this.phase,
      action: this.action,
      playback: this.playback,
      dead: this.dead,
      blocksMovement: this.blocksMovement,
      status: this.lastStatus,
      hitTimerMs: this.hitTimerMs,
      blinkTint: this.blinkTint,
      lastDamage: this.lastDamage,
      player: {
        ...this.store.profile,
        nextLevelExp: experienceRequired(this.store.profile.level),
      },
      capabilities: this.combat.capabilities,
      residency: { pending: this.renderer.pending, error: this.renderer.error },
      mobs: this.mobs.map(snapshotMob),
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hitTimerMs = 0;
    this.blinkTint = PLAYER_HIT.normalTint;
    this.renderer.destroy();
    if (this.scene.offlineField === this) this.scene.offlineField = null;
    this.simulation.movementLocked = false;
  }
}

/** Signed original integer outcome; authorized mode must be explicitly selected. */
function validatePlayerHit(hit) {
  if (
    !hit ||
    !Number.isSafeInteger(hit.amount) ||
    hit.amount < -0x80000000 ||
    hit.amount > 0x7fffffff ||
    !Number.isSafeInteger(hit.direction) ||
    hit.direction < -0x80000000 ||
    hit.direction > 0x7fffffff ||
    typeof hit.locallyInitiated !== "boolean"
  ) {
    throw new Error("Invalid player hit outcome");
  }
}

function validateCombat(combat) {
  if (!combat || combat.schemaVersion !== 1) {
    throw new Error("Missing original equipped combat metadata");
  }
  if (
    !Number.isSafeInteger(combat.weaponId) ||
    !Number.isSafeInteger(combat.equipment?.incPAD) ||
    combat.equipment.incPAD <= 0
  ) {
    throw new Error("Original weapon damage input unavailable");
  }
  const attacks = Object.values(combat.attacks);
  if (!attacks.length || attacks.length > 128) {
    throw new Error("Invalid equipped attack inventory");
  }
  for (const attack of attacks) validateAttackRectangle(attack.rectangle);
}

function validateAttackRectangle(r) {
  if (
    !r ||
    ![r.left, r.top, r.right, r.bottom].every(Number.isFinite) ||
    r.left > r.right ||
    r.top > r.bottom ||
    typeof r.source !== "string"
  ) {
    throw new Error("Invalid original equipped attack rectangle");
  }
}

function snapshotMob(mob) {
  return {
    id: mob.id,
    templateId: mob.templateId,
    x: mob.x,
    y: mob.y,
    previousX: mob.previousX,
    previousY: mob.previousY,
    facing: mob.facing,
    footholdId: mob.foothold?.id ?? 0,
    hp: mob.hp,
    maxHP: mob.maxHP,
    mp: mob.mp,
    maxMP: mob.maxMP,
    alive: mob.alive,
    visible: mob.visible,
    active: mob.active,
    state: mob.state,
    movement: mob.movement,
    action: mob.action,
    frame: mob.frame,
    actionMs: mob.actionMs,
    body: { ...mob.body },
    sweptBody: { ...mob.sweptBody },
    deaths: mob.deaths,
    respawnMs: mob.respawnMs,
    lastDamage: mob.lastDamage,
    resident: !!mob.presentation,
    authored: mob.record.authored,
    selectedSkills: mob.selectedSkills,
    attacks: mob.attacks,
    fault: mob.fault,
    authority: COMBAT_POLICY.authority,
  };
}
