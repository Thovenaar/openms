/** Native 00a02e34 / 00764c72 / 00764d62 / 00764f44.
 * Unmapped temporary-stat/chair and exclusion states are not synthesized. */
export class PassiveRecovery {
  constructor(simulation, store, hooks, map) {
    this.simulation = simulation;
    this.store = store;
    this.hooks = hooks;
    this.multiplier = map.recovery ?? 1;
    if (!Number.isFinite(this.multiplier) || this.multiplier < 0) {
      throw new Error("Invalid original map recovery multiplier");
    }
    this.hpMs = 0;
    this.mpMs = 0;
    this.action = simulation.action;
    this.hpEligible = false;
    this.mpEligible = false;
    this.hpIntervalMs = 0;
    this.x = simulation.x;
    this.y = simulation.y;
  }

  rank(id) {
    return this.hooks.skillLevel?.(id) ?? 0;
  }

  info(id, field) {
    const rank = this.rank(id);
    if (!rank) return 0;
    const value = this.hooks.skillInfo?.(id, rank)?.[field];
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Missing learned recovery skill ${id}/${rank}/${field}`);
    }
    return value;
  }

  /** Advance once after physics; MP is deliberately independent of movement. */
  step(ms, action) {
    const profile = this.store.profile;
    const sim = this.simulation;
    const stationary = sim.x === this.x && sim.y === this.y;
    this.x = sim.x;
    this.y = sim.y;
    const eligible = profile.hp > 0 && !this.hooks.recoveryExcluded?.();
    const interval = this.hpInterval(action);
    this.action = action;
    this.hpIntervalMs = interval;
    this.hpEligible =
      eligible && stationary && interval > 0 && profile.hp < profile.maxHP;
    this.mpEligible = eligible && profile.mp < profile.maxMP;
    this.hpMs = this.hpEligible ? this.hpMs + ms : 0;
    this.mpMs = this.mpEligible ? this.mpMs + ms : 0;
    const hp = this.recoverHP(interval);
    const mp = this.recoverMP();
    return hp || mp;
  }

  recoverHP(interval) {
    if (interval <= 0 || this.hpMs < interval) return false;
    const profile = this.store.profile;
    this.hpMs = 0;
    const amount = Math.trunc((10 + this.hpBonus()) * this.multiplier);
    const accepted = Math.min(amount, profile.maxHP - profile.hp);
    profile.hp += accepted;
    if (accepted > 0) this.hooks.onRecovery?.(amount, this.simulation);
    return accepted > 0;
  }

  recoverMP() {
    if (this.mpMs < 10000) return false;
    const profile = this.store.profile;
    this.mpMs = 0;
    const amount = Math.trunc((3 + this.mpBonus()) * this.multiplier);
    const accepted = Math.min(amount, profile.maxMP - profile.mp);
    profile.mp += accepted;
    return accepted > 0;
  }

  hpInterval(action) {
    const job = this.store.profile.job;
    const family = Math.trunc((job % 1000) / 100);
    if (action === "stand1" || action === "stand2" || action === "sit") {
      return family === 1 && this.rank(1000000) > 0 ? 5000 : 10000;
    }
    if (
      action !== "ladder" &&
      action !== "rope" &&
      action !== "ladder2" &&
      action !== "rope2"
    ) {
      return 0;
    }
    const id = family === 1 ? 1000002 : thiefSkill(job);
    return id ? this.info(id, "time") * 1000 : 0;
  }

  hpBonus() {
    const job = this.store.profile.job;
    const id = Math.trunc((job % 1000) / 100) === 1 ? 1000000 : thiefSkill(job);
    return id ? this.info(id, "hp") : 0;
  }

  mpBonus() {
    const profile = this.store.profile;
    if (Math.trunc((profile.job % 1000) / 100) === 2) {
      return Math.trunc(profile.level * this.rank(2000000) * 0.1);
    }
    let id = thiefSkill(profile.job);
    if (!id && jobMatches(profile.job, 111)) id = 1110000;
    if (!id && jobMatches(profile.job, 1111)) id = 11110000;
    if (!id && jobMatches(profile.job, 121)) id = 1210000;
    return id ? this.info(id, "mp") : 0;
  }

  /** Demand-only inspection; never allocate from the fixed-step path. */
  snapshot() {
    return {
      action: this.action,
      hpEligible: this.hpEligible,
      mpEligible: this.mpEligible,
      hpElapsedMs: this.hpMs,
      mpElapsedMs: this.mpMs,
      hpIntervalMs: this.hpIntervalMs,
      mpIntervalMs: 10000,
    };
  }
}

/** Exact 007669dd job ancestry predicate. */
function jobMatches(job, ancestor) {
  if (ancestor % 100 === 0) {
    return Math.trunc(job / 100) === Math.trunc(ancestor / 100);
  }
  return (
    Math.trunc(job / 10) === Math.trunc(ancestor / 10) &&
    job % 10 >= ancestor % 10
  );
}

function thiefSkill(job) {
  if (jobMatches(job, 410)) return 4100002;
  if (jobMatches(job, 420)) return 4200001;
  return 0;
}
