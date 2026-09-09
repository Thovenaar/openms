import { skillBooks } from "./ui-skill-books.js";
import { SkillResources } from "./skill-resources.js";

const MAX_SKILLS = 4096;
const MAX_ACTIVE = 64;
const STATS = ["pad", "pdd", "mad", "mdd", "acc", "eva", "speed", "jump"];
const OK = Object.freeze({ ok: true });
function refusal(reason) {
  return { ok: false, reason };
}
function rankOf(profile, id, now) {
  const record = profile.skills[id];
  return record && (record.expiresAt === null || record.expiresAt > now)
    ? record.level
    : 0;
}
function fourthJob(book) {
  return book % 1000 >= 100 && book % 10 === 2;
}
export function skillPointPool(book) {
  return book >= 2210 && book <= 2218 ? book - 2209 : 0;
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
    this.hooks = hooks;
    this.destroyed = false;
    this.time = 0;
    this.wallTime = hooks.now?.() ?? Date.now();
    this.books = [];
    this.profileJob = null;
    this.learnedReference = null;
    this.states = new Map();
    this.derivedStats = Object.fromEntries(STATS.map((key) => [key, 0]));
    this.resources = new SkillResources(scene, hooks);
    this.onChange = this.refresh.bind(this);
    this.onHit = this.hit.bind(this);
    this.unsubscribe = store.subscribe(this.onChange);
    this.initializeStates();
    this.refresh();
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
        this.states.set(skill.id, {
          cooldown: 0,
          remaining: 0,
          rank: 0,
          expiresAt: null,
        });
      }
    }
  }

  level(id) {
    const skill = this.catalog[id];
    if (this.destroyed || !skill || !this.books.includes(skill.bookId)) {
      return 0;
    }
    return rankOf(this.store.profile, id, this.wallTime);
  }

  info(id, rank = this.level(id)) {
    return this.catalog[id]?.levels[rank] ?? null;
  }
  derived() {
    return this.derivedStats;
  }

  /** Cosmic Character.java6358..60 consumes original learned growth x on level-up. */
  hpGrowth(profile = this.store.profile) {
    const family = Math.trunc(profile.job / 100);
    const id = family === 1 ? 1000001 : family === 11 ? 11000000 : null;
    if (id === null) return 0;
    return this.info(id, rankOf(profile, id, this.wallTime))?.x ?? 0;
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
    if (this.profileJob !== profile.job) this.books = skillBooks(profile.job);
    this.profileJob = profile.job;
    this.learnedReference = profile.skills;
    for (const [id, state] of this.states) {
      if (!this.level(id) || this.level(id) !== state.rank) state.remaining = 0;
    }
    this.recompute();
  }

  /** Explicit, bounded async preparation belongs to entry/profile-change code, not a simulation tick. */
  prepare() {
    if (this.destroyed) {
      return Promise.reject(new Error("Skill owner destroyed"));
    }
    const learned = [];
    for (const id of Object.keys(this.store.profile.skills)) {
      const skill = this.catalog[id];
      if (
        this.level(id) &&
        skill?.classification.supported &&
        skill.classification.activation !== "passive"
      ) {
        learned.push(skill);
      }
    }
    return this.resources.prepare(learned);
  }

  allocationError(profile, skill) {
    if (!skill || !skillBooks(profile.job).includes(skill.bookId)) {
      return "Skill is outside the current job books";
    }
    const eligibility = this.allocationAuthorityError(skill);
    if (eligibility) return eligibility;
    const rankError = this.allocationRankError(profile, skill);
    if (rankError) return rankError;
    for (const req of skill.prerequisites) {
      if (rankOf(profile, req.skillId, this.wallTime) < req.rank) {
        return `Requires skill ${req.skillId} rank ${req.rank}`;
      }
    }
    return this.allocationPoints(profile, skill) > 0
      ? null
      : "No skill points available";
  }

  allocationAuthorityError(skill) {
    if (
      skill.flags.disabled ||
      skill.flags.invisible ||
      skill.flags.timeLimited ||
      (skill.bookId >= 800 && skill.bookId < 1000)
    ) {
      return "Skill requires original hidden/event/expiration authority";
    }
    return skill.allocationCost.kind === "unknown"
      ? "Original allocation-cost consumer is unavailable"
      : null;
  }

  allocationRankError(profile, skill) {
    const current = profile.skills[skill.id];
    const rank = rankOf(profile, skill.id, this.wallTime);
    const cap = fourthJob(skill.bookId)
      ? Math.min(skill.maxLevel, current?.masterLevel ?? 0)
      : skill.maxLevel;
    if (rank >= cap) return "Skill max/master rank reached";
    if (current?.expiresAt !== null && current?.expiresAt !== undefined) {
      return "Expiring skill allocation requires expiration authority";
    }
    if (skill.properties.reqLev && profile.level < skill.properties.reqLev) {
      return "Character level requirement not met";
    }
    return null;
  }

  allocationPoints(profile, skill) {
    if (skill.allocationCost.kind !== "beginner-entitlement") {
      return profile.remainingSp[skillPointPool(skill.bookId)];
    }
    const root = Math.floor(profile.job / 1000) * 10000000;
    let used = 0;
    for (let i = 0; i < 3; i++) {
      used += rankOf(profile, root + 1000 + i, this.wallTime);
    }
    return Math.min(profile.level - 1, 6) - used;
  }

  async learn(id) {
    if (this.destroyed || !Number.isSafeInteger(id)) {
      return refusal("Invalid skill owner/ID");
    }
    const skill = this.catalog[id];
    try {
      await this.store.commitProfile((draft) => {
        if (this.destroyed) throw new Error("Skill owner destroyed");
        const reason = this.allocationError(draft, skill);
        if (reason) throw new Error(reason);
        const current = draft.skills[id];
        const masterLevel = fourthJob(skill.bookId)
          ? current.masterLevel
          : skill.maxLevel;
        draft.skills[id] = {
          level: (current?.level ?? 0) + 1,
          masterLevel,
          expiresAt: null,
        };
        if (skill.allocationCost.kind === "sp") {
          draft.remainingSp[skillPointPool(skill.bookId)]--;
        }
      });
      return OK;
    } catch (error) {
      return refusal(error.message);
    }
  }

  castError(skill, info) {
    if (!skill || !info || !this.level(skill.id)) {
      return "Skill has no learned rank in this job";
    }
    if (skill.flags.disabled || skill.flags.timeLimited) {
      return "Skill requires disabled/time-limited authority";
    }
    if (!skill.classification.supported) return skill.classification.reason;
    if (skill.classification.activation === "passive") {
      return "Passive skill has no active cast";
    }
    return this.castAdmissionError(skill, info);
  }

  castAdmissionError(skill, info) {
    const profile = this.store.profile;
    if (profile.hp <= 0 || this.hooks.isBlocked()) {
      return "Character is dead or input is modal";
    }
    const denied = this.hooks.validateCast(skill, info);
    if (denied) return denied;
    if (this.states.get(skill.id).cooldown > 0) {
      return "Skill cooldown is active";
    }
    const resources = this.resources.admissionError(skill, info);
    if (resources) return resources;
    const action = this.actionError(skill, info);
    if (action) return action;
    return this.costError(skill, info);
  }

  actionError(skill, info) {
    for (const action of skill.actions) {
      if (!this.hooks.supportsAction(action)) {
        return `Actor lacks original action ${action}`;
      }
    }
    return skill.classification.activation === "melee"
      ? this.hooks.validateAttack(skill, info)
      : null;
  }

  costError(skill, info) {
    for (const key of ["hpCon", "mpCon", "time", "cooltime"]) {
      if (
        info[key] !== undefined &&
        (!Number.isFinite(info[key]) || info[key] < 0)
      ) {
        return `Invalid original ${key}`;
      }
    }
    return this.consumptionError(info) ?? this.buffBudgetError(skill);
  }

  consumptionError(info) {
    const profile = this.store.profile;
    if (
      info.itemCon ||
      info.itemConsume ||
      info.moneyCon ||
      info.bulletConsume
    ) {
      return "Item/meso/projectile consumption controller unavailable";
    }
    if (profile.hp <= (info.hpCon ?? 0)) {
      return "Insufficient HP (skill cannot kill its caster)";
    }
    if (profile.mp < (info.mpCon ?? 0)) return "Insufficient MP";
    return null;
  }

  buffBudgetError(skill) {
    if (skill.classification.activation === "self-buff") {
      let active = 0;
      for (const state of this.states.values()) {
        if (state.remaining > 0) active++;
      }
      if (!this.states.get(skill.id).remaining && active >= MAX_ACTIVE) {
        return "Active buff budget exceeded";
      }
    }
    return null;
  }

  activate(id) {
    if (this.destroyed || !Number.isSafeInteger(id)) {
      return refusal("Invalid skill owner/ID");
    }
    const skill = this.catalog[id],
      rank = this.level(id),
      info = this.info(id, rank);
    const reason = this.castError(skill, info);
    if (reason) return refusal(reason);
    // No asynchronous boundary: field admission is guaranteed by its immediately preceding validation.
    if (skill.classification.activation === "melee") {
      this.hooks.admitAttack(skill, info, this.onHit);
    } else this.hooks.startAction(skill.actions[0]);
    const state = this.states.get(id),
      profile = this.store.profile;
    profile.hp -= info.hpCon ?? 0;
    profile.mp -= info.mpCon ?? 0;
    state.cooldown = (info.cooltime ?? 0) * 1000;
    if (skill.classification.activation === "self-buff") {
      state.remaining = info.time * 1000;
      state.rank = rank;
      state.expiresAt = profile.skills[id].expiresAt;
      this.recompute();
    }
    this.store.markDirty();
    this.resources.sound(skill, "Use");
    this.resources.play(skill, "Use", this.scene.simulation);
    return OK;
  }

  /** OfflineField calls once per admitted target at its authored hit phase, never on button press. */
  hit(id, target) {
    if (this.destroyed) return;
    const skill = this.catalog[id];
    if (!skill) return;
    this.resources.sound(skill, "Hit");
    this.resources.play(skill, "Hit", target);
  }

  /** Self-stat overlap uses strongest positive/negative modifier, not additive recast stacking. */
  recompute() {
    for (const key of STATS) this.derivedStats[key] = 0;
    for (const [id, state] of this.states) {
      if (state.remaining <= 0) continue;
      const info = this.info(id, state.rank);
      for (const key of STATS) {
        const amount = info?.[key] ?? 0;
        if (Math.abs(amount) > Math.abs(this.derivedStats[key])) {
          this.derivedStats[key] = amount;
        }
      }
    }
  }

  step(ms) {
    if (this.destroyed) return;
    if (!Number.isFinite(ms) || ms < 0 || ms > 60000) {
      throw new Error("Invalid skill elapsed milliseconds");
    }
    this.time += ms;
    this.wallTime = Math.max(
      this.wallTime + ms,
      this.hooks.now?.() ?? Date.now(),
    );
    this.advanceTimers(ms);
    this.resources.step(ms);
  }

  advanceTimers(ms) {
    let expired = false;
    for (const state of this.states.values()) {
      if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - ms);
      if (state.remaining <= 0) continue;
      state.remaining = Math.max(0, state.remaining - ms);
      if (state.expiresAt !== null && state.expiresAt <= this.wallTime) {
        state.remaining = 0;
      }
      if (!state.remaining) expired = true;
    }
    if (expired) this.recompute();
  }

  /** Ordinary map commits preserve the same character's timers; temporary stores remain isolated. */
  inherit(previous) {
    if (!previous || previous === this || previous.store !== this.store) return;
    this.time = previous.time;
    this.wallTime = previous.wallTime;
    for (const [id, state] of this.states) {
      const source = previous.states.get(id);
      if (source) Object.assign(state, source);
    }
    this.profileJob = null;
    this.refresh();
  }

  onDeath() {
    for (const state of this.states.values()) state.remaining = 0;
    this.recompute();
  }

  snapshot() {
    const activeBuffs = [],
      cooldowns = [];
    for (const [id, state] of this.states) {
      if (state.remaining > 0) {
        activeBuffs.push({
          id,
          rank: state.rank,
          remainingMs: state.remaining,
        });
      }
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
      cooldownPolicy: "character-session; retained across map commits",
      buffOverlapPolicy: "strongest-absolute-modifier-local-policy",
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.resources.destroy();
    this.states.clear();
  }
}
