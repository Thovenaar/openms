import { createHitboxState, updateHitboxes } from "./physics/hitboxes.js";
import {
  applyExternalImpulse,
  relocateSimulation,
} from "./physics/simulation.js";
import { placeBody } from "./life-geometry.js";
import { OfflineMobRenderer } from "./offline-mob-renderer.js";
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

export const COMBAT_POLICY = Object.freeze({
  authority: "offline-local-policy",
  fixedTickMs: 30,
  playerDamage:
    "max(1,floor((4*STR+DEX)*equipped WZ incPAD/10 - WZ PDDamage/2)); nearest eligible original body",
  incomingDamage: "max(1, ceil(original PADamage or MADamage / 20))",
  impact: "first fixed tick at/after half original equipped action duration",
  attackMP: 0,
  recoverAfterDeathMs: 3000,
  passiveRecoveryMs: 3000,
  regeneration: "after 3s without damage: +1 HP/+1 MP, sitting +5 HP/+3 MP",
  respawn:
    "full HP/MP at field-entry position after recovery input; no EXP loss",
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
    this.recoveryMs = 0;
    this.wasAttack = false;
    this.wasJump = false;
    this.recoveryRequested = false;
    this.destroyed = false;
    this.prepared = false;
    this.lastStatus = "offline-local-policy";
    this.lastDamage = 0;
    this.spawn = { x: this.simulation.x, y: this.simulation.y };
    this.deathAction = scene.actor.actions.has("dead") ? "dead" : null;
    this.simulation.movementLocked = this.blocksMovement;
    scene.offlineField = this;
  }

  get dead() {
    return this.phase === "dead";
  }
  get blocksMovement() {
    return this.phase === "attack" || this.dead;
  }
  get playback() {
    return this.phase === "idle" ? "loop" : "once";
  }
  get action() {
    if (this.phase === "attack") return this.attackName;
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
    if (this.destroyed || !this.prepared) return;
    if (ms !== COMBAT_POLICY.fixedTickMs) {
      throw new Error("OfflineField requires one fixed 30-ms tick");
    }
    const attackEdge = !!input.attack && !this.wasAttack;
    const jumpEdge = !!input.jump && !this.wasJump;
    this.wasAttack = !!input.attack;
    this.wasJump = !!input.jump;
    this.phaseMs += ms;
    updateHitboxes(this.hitboxes, this.simulation, this.receiverContext);
    for (const mob of this.mobs) stepMob(mob, ms);
    this.stepPlayer(ms, attackEdge, jumpEdge);
    if (!this.dead) {
      for (const mob of this.mobs) this.stepMobAttack(mob);
      this.contactDamage();
    }
    this.advanceHitPresentation();
    this.simulation.movementLocked = this.blocksMovement;
    this.renderer.synchronize();
  }

  stepPlayer(ms, attackEdge, jumpEdge) {
    if (this.dead) {
      if (
        this.phaseMs >= COMBAT_POLICY.recoverAfterDeathMs &&
        (attackEdge || jumpEdge || this.recoveryRequested)
      ) {
        this.recoverPlayer();
      }
      return;
    }
    const canStart = this.phase === "idle";
    this.advancePlayerPhase();
    if (canStart && attackEdge) this.beginAttack();
    this.passiveRecovery(ms);
  }

  /** Finish the current action without admitting another attack on its final tick. */
  advancePlayerPhase() {
    if (this.phase === "attack") {
      if (!this.attackFired && this.phaseMs >= this.attackDurationMs / 2) {
        this.playerImpact();
      }
      if (this.phaseMs >= this.attackDurationMs) this.phase = "idle";
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
    this.attackName = name;
    this.attackDurationMs = artwork.duration;
    this.attackFired = false;
    this.phase = "attack";
    this.phaseMs = 0;
    this.lastStatus = "local sword attack";
    this.hooks.onAttack?.();
  }

  playerImpact() {
    this.attackFired = true;
    const sim = this.simulation;
    placeBody(this.attackBody, this.attack.rectangle, sim, sim.facing > 0);
    const reactorHit = this.hooks.onStrike?.(this.attackBody, sim.facing, 0);
    const target = this.nearestAttackTarget();
    if (!target) {
      this.lastStatus = reactorHit
        ? "local reactor hit"
        : "local sword impact: no eligible original body";
      return;
    }
    const profile = this.store.profile;
    const attackPower =
      ((4 * profile.str + profile.dex) * this.combat.equipment.incPAD) / 10;
    const amount = Math.min(
      target.hp,
      Math.max(
        1,
        Math.floor(attackPower - (target.template.info.PDDamage ?? 0) / 2),
      ),
    );
    const killed = damageMob(target, amount, sim.facing);
    this.hooks.onMobHit?.(target, amount);
    this.lastStatus = killed
      ? "local mob killed; WZ EXP awarded; no drops"
      : "local mob hit";
    if (killed) this.onKill(target);
  }

  nearestAttackTarget() {
    let target = null;
    let nearest = Infinity;
    for (const mob of this.mobs) {
      if (
        !mob.alive ||
        mob.selectedSkills.length ||
        mob.template.info.invincible ||
        !overlaps(this.attackBody, mob.body)
      ) {
        continue;
      }
      const distance = Math.abs(mob.x - this.simulation.x);
      if (distance < nearest) {
        nearest = distance;
        target = mob;
      }
    }
    return target;
  }

  onKill(mob) {
    const exp = mob.template.info.exp ?? 0;
    const levels = awardExperience(this.store.profile, exp);
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
    hit.amount = Math.max(1, Math.ceil(base / 20));
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
    this.recoveryMs = 0;
    const killed = profile.hp === 0 && !this.dead;
    if (killed) {
      this.phase = "dead";
      this.phaseMs = 0;
    }
    if (hit.amount <= 0 || this.dead) this.blinkTint = PLAYER_HIT.normalTint;
    this.simulation.movementLocked = this.blocksMovement;
    this.lastStatus = this.dead
      ? "local player dead; jump/attack to recover after 3s"
      : "player hit outcome admitted";
    this.hooks.onPlayerHit?.(hit, this.simulation);
    if (killed) this.hooks.onPlayerDeath?.();
    this.changed();
    return true;
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

  passiveRecovery(ms) {
    this.recoveryMs += ms;
    if (
      this.recoveryMs < COMBAT_POLICY.passiveRecoveryMs ||
      this.phase !== "idle"
    ) {
      return;
    }
    this.recoveryMs = 0;
    const profile = this.store.profile;
    const sitting = this.simulation.action === "sit";
    const hp = Math.min(profile.maxHP, profile.hp + (sitting ? 5 : 1));
    const mp = Math.min(profile.maxMP, profile.mp + (sitting ? 3 : 1));
    if (hp === profile.hp && mp === profile.mp) return;
    profile.hp = hp;
    profile.mp = mp;
    this.changed();
  }

  /** Queue recovery for a fixed tick; UI callbacks never mutate simulation. */
  recover() {
    if (
      !this.dead ||
      this.phaseMs < COMBAT_POLICY.recoverAfterDeathMs ||
      this.destroyed
    ) {
      return false;
    }
    this.recoveryRequested = true;
    return true;
  }

  recoverPlayer() {
    const sim = this.simulation;
    relocateSimulation(sim, this.spawn);
    this.store.profile.hp = this.store.profile.maxHP;
    this.store.profile.mp = this.store.profile.maxMP;
    this.phase = "idle";
    this.phaseMs = 0;
    this.hitTimerMs = 0;
    this.blinkTint = PLAYER_HIT.normalTint;
    this.recoveryRequested = false;
    this.lastStatus = "local full recovery at field entry";
    updateHitboxes(this.hitboxes, sim, this.receiverContext);
    this.hooks.onRecover?.();
    this.changed();
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
