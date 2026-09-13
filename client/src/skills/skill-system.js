import { skillBooks } from "../ui/ui-skill-books.js";
import {
  rankOf,
  profileSkillAllowed,
  learnedProfileRank,
  allocationError,
  allocationPoints,
  allocateSkill,
} from "./skill-allocation-rules.js";
import { SkillResources } from "./skill-resources.js";
import { temporaryState, TemporaryStats } from "./temporary-stats.js";
import { SkillStateController } from "./skill-state-controller.js";
import { SkillCombatController } from "./skill-combat-controller.js";
import { SkillWorldController } from "./skill-world-controller.js";
import { SkillUtilityController } from "./skill-utility-controller.js";
import { SkillCosts, skillNumber } from "./skill-costs.js";
import { learnedGrowth } from "../character/offline-progression.js";

const MAX_SKILLS = 4096;
// Cosmic Character.java4492..4523: ordinary Recovery ticks every five seconds (not ultra mode).
const RECOVERY_INTERVAL_MS = 5000;
// CField+144 bit1. Original active admissions00950921,009537d5,
// 00969e21 and0096a86e enumerate these attacks/forms/states, not whole skill books.
const FIELD_MOVEMENT_RESTRICTED_SKILLS = new Set([
  4211002, 4221001, 1121006, 1221007, 1321003, 4121008, 5101002, 5101004,
  15101003, 5121005, 21100002, 21110003, 21110006, 3111003, 3211003, 5201004,
  5111005, 5121003, 15111002, 13111005, 5001005, 15001003, 1014, 10001015,
  1121001, 1221001, 1321001,
]);
const OK = Object.freeze({ ok: true });
function refusal(reason) {
  return { ok: false, reason };
}

/** Original ranks/costs/timers; OfflineField alone owns provisional damage and target admission. */
export class SkillSystem {
  constructor(scene, store, catalog, hooks) {
    if (!store?.profile?.skills || !catalog?.ui?.skills) {
      throw new TypeError(
        "SkillSystem requires learned profile and complete skill catalog",
      );
    }
    this.scene = scene;
    this.store = store;
    this.catalog = catalog.ui.skills;
    this.fullCatalog = catalog;
    this.hooks = hooks;
    this.destroyed = false;
    this.time = 0;
    this.wallTime = hooks.now?.() ?? Date.now();
    this.books = [];
    this.profileJob = null;
    this.learnedReference = null;
    this.states = new Map();
    this.effects = new TemporaryStats();
    this.transferredEffects = false;
    this.derivedStats = this.effects.derived;
    this.resources = hooks.resources ?? new SkillResources(scene, hooks);
    this.growthValue = { hp: 0, mp: 0 };
    this.resourceRank = this.resourceRank.bind(this);
    this.onChange = this.refresh.bind(this);
    this.onHit = this.hit.bind(this);
    this.createControllers();
    this.initializeStates();
    this.unsubscribe = store.subscribe(this.onChange);
    this.refresh();
  }

  createControllers() {
    this.costs = new SkillCosts(this);
    this.stateController = new SkillStateController(this);
    this.combatController = new SkillCombatController(this);
    this.worldController = new SkillWorldController(this);
    this.utilityController = new SkillUtilityController(this);
  }

  controllerFor(skill) {
    switch (skill?.classification.owner) {
      case "state":
        return this.stateController;
      case "combat":
        return this.combatController;
      case "world":
        return this.worldController;
      case "utility":
        return this.utilityController;
      default:
        return null;
    }
  }

  resourceRank(id) {
    return this.level(id);
  }

  initializeStates() {
    const records = Object.values(this.catalog);
    if (records.length > MAX_SKILLS) {
      throw new Error("Skill catalog bound exceeded");
    }
    for (const skill of records) {
      if (
        skill.classification.supported &&
        skill.classification.activation !== "passive"
      ) {
        this.states.set(skill.id, temporaryState("skill", skill.id));
      }
    }
  }

  level(id) {
    const skill = this.catalog[id];
    if (this.destroyed || !profileSkillAllowed(skill, this.books)) return 0;
    const rank = learnedProfileRank(this.store.profile, id, this.wallTime);
    return Math.max(rank, this.utilityController.events.rank(skill.id));
  }

  activationId(id) {
    if (id !== 21000002 && id !== 21100001) return id;
    if (this.level(21120002)) return id === 21000002 ? 21120009 : 21120010;
    if (this.level(21110002)) return id === 21000002 ? 21110007 : 21110008;
    return id;
  }

  info(id, rank = this.level(id)) {
    return this.catalog[id]?.levels[rank] ?? null;
  }
  derived() {
    return this.derivedStats;
  }

  /** Reuse the learned native HP/MP growth projection for kills and quest transactions. */
  growth(profile = this.store.profile) {
    return learnedGrowth(
      profile,
      this.catalog,
      this.wallTime,
      this.growthValue,
    );
  }

  refresh() {
    if (this.destroyed) return;
    const profile = this.store.profile;
    if (
      this.profileJob === profile.job &&
      this.learnedReference === profile.skills
    ) {
      return;
    }
    this.wallTime = Math.max(this.wallTime, this.hooks.now?.() ?? Date.now());
    const previousSkills = this.learnedReference;
    const previousBooks = this.books;
    if (this.profileJob !== profile.job) this.books = skillBooks(profile.job);
    this.profileJob = profile.job;
    this.learnedReference = profile.skills;
    this.reconcileSkills(previousSkills, previousBooks);
    if (this.stateController.learningError(1320009, this.level(1320009))) {
      // External profile replacement may revoke an actor, never overcommit its future source.
      this.worldController.cancel(1321007);
    }
    this.stateController.syncBeholderReservation();
    this.recompute();
  }

  reconcileSkills(previousSkills, previousBooks) {
    for (const [id, state] of this.states) {
      if (this.hooks.retainsReceivedEffect?.(id, state)) continue;
      if (!this.skillStateInvalid(id, state, previousSkills, previousBooks)) {
        continue;
      }
      this.effects.remove(id);
      this.controllerFor(this.catalog[id])?.cancel?.(id);
    }
  }

  skillStateInvalid(id, state, previousSkills, previousBooks) {
    const current = this.store.profile.skills[id];
    const previous = previousSkills?.[id];
    const oldRank = previousBooks.includes(this.catalog[id].bookId)
      ? (previous?.level ?? 0)
      : 0;
    const rank = this.level(id);
    if (rank === 0) return oldRank > 0 || state.remaining > 0;
    return (
      previous?.level !== current?.level ||
      (state.remaining > 0 && rank !== state.rank)
    );
  }

  /** Explicit, bounded async preparation belongs to entry/profile-change code, not a simulation tick. */
  async prepare() {
    if (this.destroyed) throw new Error("Skill owner destroyed");
    const learned = [];
    const groups = { state: [], combat: [], world: [], utility: [] };
    for (const skill of Object.values(this.catalog)) {
      if (this.level(skill.id) && skill.classification.supported) {
        learned.push(skill);
        groups[skill.classification.owner].push(skill);
      }
    }
    await this.resources.prepare(
      learned,
      this.resourceRank,
      this.combatController.resourceDependencies(groups.combat),
    );
    // The shared sequence/voice lease owner is the serialized publication boundary.
    await this.stateController.prepare(groups.state);
    await this.worldController.prepare(groups.world);
    await this.combatController.prepare(groups.combat);
    await this.utilityController.prepare(groups.utility);
  }

  allocationError(profile, skill) {
    const reason = allocationError(profile, skill, this.wallTime);
    if (reason) return reason;
    return this.stateController.learningError(
      skill.id,
      rankOf(profile, skill.id, this.wallTime) + 1,
    );
  }

  allocationPoints(profile, skill) {
    return allocationPoints(profile, skill, this.wallTime);
  }

  async learn(id) {
    if (this.destroyed || !Number.isSafeInteger(id)) {
      return refusal("Invalid skill owner/ID");
    }
    if (this.store.profileTransactionPending) {
      return refusal("A profile operation is pending");
    }
    const skill = this.catalog[id];
    try {
      await this.store.commitProfile((draft) => {
        if (this.destroyed) throw new Error("Skill owner destroyed");
        const reason = this.allocationError(draft, skill);
        if (reason) throw new Error(reason);
        allocateSkill(draft, skill);
        if (id === 1320009) {
          this.stateController.syncBeholderReservation(draft.skills[id].level);
        }
      });
      return OK;
    } catch (error) {
      return refusal(error.message);
    } finally {
      if (id === 1320009 && !this.destroyed) {
        this.stateController.syncBeholderReservation();
      }
    }
  }

  castError(skill, info) {
    if (!skill || !info || !this.level(skill.id)) {
      return "Skill has no learned rank in this job";
    }
    if (skill.flags.disabled || skill.flags.timeLimited) {
      return "Skill requires disabled/time-limited authority";
    }
    const requirement = this.skillRequirementError(skill);
    if (requirement) return requirement;
    if (!skill.classification.supported) return skill.classification.reason;
    if (!this.controllerFor(skill)) return "Skill has no runtime controller";
    if (skill.classification.activation === "passive") {
      return "Passive skill has no active cast";
    }
    return this.castAdmissionError(skill, info);
  }

  skillRequirementError(skill) {
    if (
      skill.properties.reqLev &&
      this.store.profile.level < skill.properties.reqLev
    ) {
      return "Character level requirement not met";
    }
    for (const requirement of skill.prerequisites) {
      if (this.level(requirement.skillId) < requirement.rank) {
        return `Requires skill ${requirement.skillId} rank ${requirement.rank}`;
      }
    }
    return null;
  }

  castAdmissionError(skill, info) {
    const state = this.castStateError(skill, info);
    if (state) return state;
    if (this.controllerFor(skill).prepareBasicFallback?.(skill, info)) {
      return null;
    }
    const resources = this.resources.admissionError(skill, info);
    if (resources) return resources;
    const action = this.actionError(skill, info);
    if (action) return action;
    return this.costError(skill, info);
  }

  castStateError(skill, info) {
    const profile = this.store.profile;
    if (
      this.scene.simulation.fieldLimit & 2 &&
      FIELD_MOVEMENT_RESTRICTED_SKILLS.has(skill.id)
    ) {
      return "This skill is forbidden by the field movement restriction";
    }
    if (this.store.profileTransactionPending || this.effects.reservation) {
      return "A profile/item operation is pending";
    }
    if (profile.hp <= 0 || this.hooks.isBlocked()) {
      return "Character is dead or input is modal";
    }
    const denied = this.hooks.validateCast(skill, info);
    if (denied) return denied;
    const eventError = this.utilityController.events.error(skill);
    if (eventError) return eventError;
    if (
      this.stateController.hasSource(skill.id) &&
      !this.effects.canStart(skill.id)
    ) {
      return "Active buff capacity is full";
    }
    if (this.states.get(skill.id).cooldown > 0) {
      return "Skill cooldown is active";
    }
    return null;
  }

  actionError(skill, info) {
    for (const action of skill.actions) {
      if (!this.hooks.supportsAction(action)) {
        return `Actor lacks original action ${action}`;
      }
    }
    const partyError = this.hooks.partySkillError?.(skill, info);
    return partyError !== undefined
      ? partyError
      : this.controllerFor(skill).admissionError(skill, info);
  }

  costError(skill, info) {
    for (const key of ["time", "cooltime"]) {
      const milliseconds = skillNumber(info[key]) * 1000;
      if (
        !Number.isSafeInteger(milliseconds) ||
        milliseconds < 0 ||
        milliseconds > 2147483647
      ) {
        return `Invalid original ${key}`;
      }
    }
    return this.costs.error(skill, info);
  }

  activate(id) {
    if (this.destroyed || !Number.isSafeInteger(id)) {
      return refusal("Invalid skill owner/ID");
    }
    if (!this.level(id)) {
      return refusal("Skill has no learned rank in this job");
    }
    id = this.activationId(id);
    const skill = this.catalog[id],
      rank = this.level(id),
      info = this.info(id, rank);
    const reason = this.castError(skill, info);
    if (reason) return refusal(reason);
    const controller = this.controllerFor(skill);
    if (controller.basicFallback) {
      controller.castBasicFallback();
      return OK;
    }
    if (controller.deferredCost?.(skill)) {
      controller.cast(skill, info, rank);
      return OK;
    }
    const cost = this.costs.consume(skill, info);
    if (cost) return refusal(cost);
    // Combat commits its event meter with the actual attack; state casts commit here.
    if (skill.classification.owner === "state") {
      this.utilityController.events.consume(skill);
    }
    controller.cast(skill, info, rank);
    this.publishCast(skill, info, rank);
    return OK;
  }

  /** Deferred attacks call only after their first successful debit/attack publication. */
  publishCast(skill, info, rank) {
    if (this.controllerFor(skill).cooldownOnCast?.(skill) !== false) {
      this.states.get(skill.id).cooldown = skillNumber(info.cooltime) * 1000;
    }
    this.resources.sound(skill, "Use");
    this.resources.play(skill, "Use", this.scene.simulation, rank);
  }

  startBuff(skill, rank, info) {
    this.stateController.configure(skill, rank, info);
  }

  release(id) {
    if (this.destroyed) return false;
    return this.combatController.release(id);
  }

  cancelHold(id) {
    this.combatController.cancelHold(id);
  }

  present(ms) {
    if (this.destroyed) return;
    this.stateController.present(ms);
    this.worldController.present(this.scene.presentation);
    this.utilityController.present?.(ms);
  }

  /** Cosmic TakeDamageHandler253..263: MP shortfall falls through to HP, never negates damage. */
  absorbDamage(amount, profile = this.store.profile, outcome = null) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error("Invalid incoming damage");
    }
    if (this.destroyed || (!outcome && this.store.profileTransactionPending)) {
      return amount;
    }
    if (profile.hp <= 0) return amount;
    const percent = this.derivedStats.magicGuard;
    const spent = Math.min(profile.mp, Math.trunc((amount * percent) / 100));
    if (spent > 0) {
      profile.mp -= spent;
      if (!outcome) this.store.markDirty();
    }
    return amount - spent;
  }

  /** OfflineField calls once per admitted target at its authored hit phase, never on button press. */
  hit(id, target) {
    if (this.destroyed) return;
    const skill = this.catalog[id];
    if (!skill) return;
    this.resources.sound(skill, "Hit");
    this.resources.play(skill, "Hit", target, this.level(id));
  }

  /** Stat projection and source precedence share one authority for both skills and items. */
  recompute() {
    this.effects.recompute();
    this.stateController.syncVitals();
  }

  /** 0045b9fc right-up cancellation removes source effects, never skill cooldown admission. */
  cancelEffect(kind, id) {
    if (!this.canCancelEffect(kind, id)) return false;
    let removed = this.effects.remove(kind === "item" ? -id : id);
    if (kind === "skill") {
      removed = this.controllerFor(this.catalog[id])?.cancel?.(id) || removed;
    }
    if (removed) this.recompute();
    return removed;
  }

  canCancelEffect(kind, id) {
    return (
      !this.destroyed &&
      !this.store.profileTransactionPending &&
      !this.effects.reservation &&
      !this.hooks.isBlocked() &&
      (kind === "item" || (kind === "skill" && id !== 0x14011e))
    );
  }

  effectCount() {
    return this.effects.visibleCount;
  }

  effectAt(index) {
    return this.effects.visible[index] ?? null;
  }

  step(ms) {
    if (this.destroyed) return;
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000) {
      throw new Error("Invalid skill elapsed milliseconds");
    }
    this.stateController.step(ms);
    this.combatController.step(ms);
    this.worldController.step(ms);
    this.utilityController.step(ms);
    this.time += ms;
    this.wallTime = Math.max(
      this.wallTime + ms,
      this.hooks.now?.() ?? Date.now(),
    );
    this.advanceTimers(ms);
    this.resources.step(ms);
  }

  advanceTimers(ms) {
    for (const state of this.states.values()) {
      if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - ms);
    }
    let expired = false;
    for (let index = this.effects.count - 1; index >= 0; index--) {
      const state = this.effects.sources[index];
      if (state.kind === "skill") this.advanceRecovery(state.id, state, ms);
      state.remaining = Math.max(0, state.remaining - ms);
      if (state.expiresAt !== null && state.expiresAt <= this.wallTime) {
        state.remaining = 0;
      }
      if (state.remaining === 0) {
        this.effects.remove(state.source);
        expired = true;
      }
    }
    if (expired) this.recompute();
  }

  /** Bounded arithmetic catch-up includes the last authored tick, never ticks past learned expiry. */
  advanceRecovery(id, state, ms) {
    if (this.catalog[id].classification.hooks[0] !== "periodic-recovery") {
      return;
    }
    const untilExpiry =
      state.expiresAt === null
        ? state.remaining
        : Math.max(0, state.expiresAt - (this.wallTime - ms));
    const activeMs = Math.min(ms, state.remaining, untilExpiry);
    const elapsed = state.recoveryElapsed + activeMs;
    let ticks = Math.floor(elapsed / RECOVERY_INTERVAL_MS);
    state.recoveryElapsed = elapsed % RECOVERY_INTERVAL_MS;
    if (
      ticks > 0 &&
      state.recoveryElapsed === 0 &&
      state.expiresAt !== null &&
      state.expiresAt <= this.wallTime &&
      activeMs === untilExpiry
    ) {
      ticks--;
    }
    const profile = this.store.profile;
    if (!ticks || profile.hp <= 0 || this.store.profileTransactionPending) {
      return;
    }
    const hp = Math.min(
      profile.maxHP,
      profile.hp + ticks * this.info(id, state.rank).x,
    );
    if (hp !== profile.hp) {
      profile.hp = hp;
      this.store.markDirty();
    }
  }

  /** Ordinary map commits preserve the same character's timers; temporary stores remain isolated. */
  inherit(previous) {
    if (!previous || previous === this || previous.store !== this.store) return;
    this.time = previous.time;
    this.wallTime = previous.wallTime;
    for (const id of this.states.keys()) {
      const source = previous.states.get(id);
      if (source) this.states.set(id, source);
    }
    this.effects = previous.effects;
    previous.transferredEffects = true;
    this.derivedStats = this.effects.derived;
    this.profileJob = null;
    this.refresh();
    this.stateController.inherit(previous.stateController);
    this.combatController.inherit(previous.combatController);
    this.worldController.inherit(previous.worldController);
    this.utilityController.inherit?.(previous.utilityController);
  }

  onDeath() {
    this.effects.clear();
    this.combatController.onDeath();
    this.worldController.onDeath();
    this.utilityController.onDeath?.();
    this.stateController.onDeath();
  }

  snapshot() {
    const activeBuffs = [],
      cooldowns = [];
    for (let index = 0; index < this.effects.count; index++) {
      const state = this.effects.sources[index];
      activeBuffs.push({
        kind: state.kind,
        id: state.id,
        source: state.source,
        rank: state.rank,
        remainingMs: state.remaining,
        totalMs: state.totalMs,
        noShadow: state.noShadow,
        maskLow: state.maskLow,
        maskHigh: state.maskHigh,
        maskUpperLow: state.maskUpperLow ?? 0,
        maskUpperHigh: state.maskUpperHigh ?? 0,
      });
    }
    for (const [id, state] of this.states) {
      if (state.cooldown > 0) {
        cooldowns.push({ id, remainingMs: state.cooldown });
      }
    }
    return {
      activeBuffs,
      cooldowns,
      derived: { ...this.derivedStats },
      preparing: Boolean(this.resources.pending),
      prepared: [...this.resources.records.keys()],
      heldSkill: this.combatController.held?.id ?? null,
      world: this.worldController.snapshot?.() ?? null,
      cooldownPolicy: "character-session; retained across map commits",
      buffOverlapPolicy:
        "Cosmic configured numeric maximum; broader source then newest ties",
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.combatController.destroy();
    this.worldController.destroy();
    this.utilityController.destroy();
    this.stateController.destroy();
    if (!this.transferredEffects) {
      this.effects.destroyed = true;
      this.effects.clear();
    }
    this.resources.destroy();
    this.states.clear();
  }
}
