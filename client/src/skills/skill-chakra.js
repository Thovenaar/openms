export const CHAKRA_SKILL = 4211001;

/** Native0096a86e ->0096cf1d ->00969e21: preparation precedes the ordinary cost packet. */
export class SkillChakra {
  constructor(system) {
    this.system = system;
    this.skill = null;
    this.info = null;
    this.rank = 0;
    this.remaining = 0;
    this.slot = null;
    this.x = 0;
    this.y = 0;
  }

  async prepare(skills) {
    for (const skill of skills) {
      if (skill.id === CHAKRA_SKILL) {
        await this.system.resources.acquireSequence(skill, "prepare", 1);
      }
    }
  }

  admissionError() {
    if (this.skill) return "Chakra is already preparing";
    const profile = this.system.store.profile;
    if (Math.trunc((profile.hp * 100) / this.system.derived().maxHP) > 49) {
      return "Chakra requires HP below fifty percent";
    }
    return null;
  }

  cast(skill, info, rank) {
    const system = this.system;
    system.hooks.startAction(skill.actions[0]);
    this.skill = skill;
    this.info = info;
    this.rank = rank;
    // Native deadline is the selected original actor action completion, not rank.time.
    this.remaining = system.hooks.gameplay().attackDurationMs;
    this.x = system.scene.simulation.x;
    this.y = system.scene.simulation.y;
    this.slot = system.resources.play(
      skill,
      "prepare",
      system.scene.simulation,
      rank,
    );
  }

  step(ms) {
    if (!this.skill) return;
    const actor = this.system.scene.simulation;
    if (
      this.system.store.profile.hp <= 0 ||
      actor.x !== this.x ||
      actor.y !== this.y
    ) {
      this.cancel();
      return;
    }
    this.remaining -= ms;
    if (this.remaining <= 0) this.complete();
  }

  complete() {
    if (this.system.hooks.commitSkillPhase) {
      return this.system.hooks.commitSkillPhase(this.skill, this.info, () =>
        this.commitComplete(),
      );
    }
    return this.commitComplete();
  }

  commitComplete() {
    const system = this.system;
    const skill = this.skill;
    const info = this.info;
    const rank = this.rank;
    const denied =
      system.store.profileTransactionPending || system.costs.error(skill, info);
    if (denied) {
      this.cancel();
      return;
    }
    const stats = system.derived();
    // Authorized Cosmic StatEffect1431..1441; use actual WZ y, not stale String skill percentages.
    const low = Math.trunc((stats.luk * 2.3 * info.y) / 100);
    const high = Math.trunc((stats.luk * 3.5 * info.y) / 100);
    const heal =
      low +
      Math.floor((system.hooks.random ?? Math.random)() * (high - low + 1));
    if (system.costs.consume(skill, info)) {
      this.cancel();
      return;
    }
    system.store.profile.hp = Math.min(
      stats.maxHP,
      system.store.profile.hp + heal,
    );
    system.store.markDirty();
    this.cancel();
    system.publishCast(skill, info, rank);
  }

  input(input) {
    if (
      input.left ||
      input.right ||
      input.up ||
      input.down ||
      input.jump ||
      input.attack
    ) {
      this.cancel();
    }
  }

  damagePercent() {
    // Native009581a9 rank+0x13c x: trunc(damage*x/100), minimum one on a received hit.
    return this.skill ? this.info.x : 100;
  }

  cancel() {
    if (!this.skill) return;
    const field = this.system.hooks.gameplay();
    this.system.resources.stop(this.slot);
    if (field.phase === "cast") {
      field.phase = "idle";
      field.simulation.movementLocked = field.blocksMovement;
    }
    this.skill = null;
    this.info = null;
    this.slot = null;
    this.remaining = 0;
  }
}
