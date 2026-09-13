import { COMBAT_SKILLS } from "./skill-combat-rules.js";
import { SkillBallistics } from "./skill-ballistics.js";
import { SkillTargetController } from "./skill-target-controller.js";
import { SkillChainPresentation } from "./skill-chain-presentation.js";
import { skillNumber } from "./skill-costs.js";
import { isEquipped } from "../items/inventory-model.js";

const HOLD_PATHS = ["prepare", "keydown", "keydown0", "keydownend"];
const LOOP_OPTIONS = Object.freeze({ loop: true, follow: true });
const ONCE_OPTIONS = Object.freeze({ follow: true });

/** Original0094a144,0095bedf,00500971: physical key-up and cancellation are distinct. */
export class SkillCombatController {
  constructor(system) {
    this.system = system;
    this.ballistics = new SkillBallistics(system);
    this.targets = new SkillTargetController(system);
    this.chains = new SkillChainPresentation(system.resources);
    this.held = null;
    this.basicFallback = false;
    this.info = null;
    this.rank = 0;
    this.age = 0;
    this.pulseAge = 0;
    this.published = false;
    this.phaseSlot = null;
    this.voice = null;
    this.prepareSlot = null;
    this.projectileOptions = {
      follow: false,
      facing: 1,
      durationMs: 0,
      loop: true,
      flight: true,
      delayMs: 0,
      spreadY: 0,
    };
    this.onHit = system.hit.bind(system);
  }

  resourceDependencies(learnedSkills) {
    return learnedSkills.some((skill) => skill.id === 14111006)
      ? [this.system.catalog[5201002]]
      : [];
  }

  async prepare(learnedSkills) {
    this.chains.sequences.clear();
    const field = this.system.hooks.gameplay();
    field.skillCombat.resources = this.system.resources;
    for (const skill of learnedSkills) {
      await this.prepareLearnedSkill(skill, field);
    }
    for (const id of [11101002, 13101002, 15111006, 5110001, 15100004]) {
      const rank = this.system.level(id);
      if (rank) {
        field.prepareSkillCombat(
          this.system.catalog[id],
          this.system.info(id, rank),
          rank,
        );
      }
      if (rank && id === 15111006 && !this.chains.sequences.has(id)) {
        await this.chains.prepare(this.system.catalog[id], field);
      }
    }
    await this.ballistics.prepare(learnedSkills);
    await this.targets.prepare(learnedSkills);
  }

  async prepareLearnedSkill(skill, field) {
    const rank = this.system.level(skill.id);
    const info = this.system.info(skill.id, rank);
    const external = !!skill.properties.summon;
    field.prepareSkillCombat(skill, info, rank, external);
    const ball = this.system.resources.phasePath(skill, "ball", rank);
    if (skill.id === 2221006 || skill.id === 15111006) {
      await this.chains.prepare(skill, field);
    } else if (ball) {
      await this.system.resources.acquireSequence(
        skill,
        ball,
        Math.max(
          32,
          skillNumber(info.mobCount, 1) * skillNumber(info.bulletCount, 1) * 4,
        ),
      );
    }
    if (!this.deferredCost(skill)) return;
    for (const path of HOLD_PATHS) {
      const selected = this.system.resources.phasePath(skill, path, rank);
      if (selected) {
        await this.system.resources.acquireSequence(skill, selected, 1);
      }
    }
    if (skill.sounds.leaves.KeyDown) {
      await this.system.resources.acquireSound(skill, "KeyDown");
    }
  }

  projectile(shot) {
    if (shot.beam) return this.chains.play(shot);
    const resources = this.system.resources;
    const path = resources.phasePath(shot.skill, "ball", shot.rank);
    const sequence = path && resources.sequence(shot.skill, path);
    if (!sequence) {
      if (shot.projectileId) {
        this.system.hooks.gameplay().hooks.onProjectile?.(shot);
      }
      return null;
    }
    const options = this.projectileOptions;
    options.facing = shot.facing;
    const count = Math.max(1, skillNumber(shot.info.bulletCount, 1));
    //00954540..009547: fourteen-pixel endpoint fan; stars have120ms spacing.
    const spacing = Math.trunc(shot.projectileId / 10000) === 207 ? 120 : 0;
    for (let index = 0; index < count; index++) {
      options.delayMs = index * spacing;
      options.spreadY = 7 * (2 * index + 1 - count);
      options.durationMs = shot.duration + options.delayMs;
      if (!resources.playSequence(sequence, shot, options)) {
        throw new Error("Prepared skill projectile slots exhausted");
      }
    }
    return null;
  }

  copyProjectile(field) {
    field.skillCombat.use.projectilePAD = this.system.costs.projectilePAD;
    field.skillCombat.use.projectileId = this.system.costs.projectileId;
  }

  /**009696a2 routes real weapon-star skills through00950921 before skill costs. */
  prepareBasicFallback(skill, info) {
    this.basicFallback = false;
    const field = this.system.hooks.gameplay();
    const quantity =
      skillNumber(info.bulletConsume) || skillNumber(info.bulletCount);
    if (!this.canUseBasicFallback(skill, field) || !quantity) {
      return false;
    }
    const record = field.skillCombat.prepared.get(skill.id);
    if (
      field.skillCastError() ||
      field.diseases.admissionError(skill) ||
      field.skillCombat.actorError(record, info) ||
      field.skillCombat.weaponError(skill, record)
    ) {
      return false;
    }
    field.prepareWeaponUse(field.store.profile, quantity);
    if (field.weaponUse.ranged) field.probeMeleeTarget();
    this.basicFallback = !field.weaponUse.ranged;
    return this.basicFallback;
  }

  canUseBasicFallback(skill, field) {
    const spec = COMBAT_SKILLS.get(skill.id);
    return (
      !this.held &&
      field?.combat?.weaponType === 47 &&
      isEquipped(field.store.profile, field.combat.weaponId) &&
      !!spec?.ammunition &&
      !!spec.projectile
    );
  }

  castBasicFallback() {
    this.basicFallback = false;
    this.system.hooks.gameplay().beginAttack(true);
  }

  deferredCost(skill) {
    const kind = COMBAT_SKILLS.get(skill.id)?.kind;
    return kind === "charge" || kind === "continuous" || kind === "magnet";
  }

  admissionError(skill, info) {
    if (this.held) return "Another original skill is being held";
    if (this.ballistics.handles(skill.id)) {
      return this.ballistics.admissionError(skill, info);
    }
    if (this.targets.handles(skill.id)) {
      return this.targets.admissionError(skill, info);
    }
    return this.system.hooks.gameplay().skillAttackError(skill, info);
  }

  cast(skill, info, rank) {
    const field = this.system.hooks.gameplay();
    if (this.targets.handles(skill.id)) {
      this.targets.cast(skill, info, rank);
      return true;
    }
    if (!this.deferredCost(skill)) {
      field.beginSkillAttack(skill, info, this.onHit);
      this.copyProjectile(field);
      return true;
    }
    this.held = skill;
    this.info = info;
    this.rank = rank;
    this.age = 0;
    this.pulseAge = 0;
    this.published = false;
    this.playPhase("prepare", false);
    this.playPhase("keydown", true);
    field.attackName = field.skillCombat.prepared.get(skill.id).action;
    field.phase = "hold";
    field.simulation.movementLocked = true;
    this.voice = this.system.resources.sound(skill, "KeyDown", true);
    return true;
  }

  playPhase(path, loop) {
    const resources = this.system.resources;
    const selected = resources.phasePath(this.held, path, this.rank);
    const sequence = selected && resources.sequence(this.held, selected);
    if (!sequence) return;
    const slot = resources.playSequence(
      sequence,
      this.system.scene.simulation,
      loop ? LOOP_OPTIONS : ONCE_OPTIONS,
    );
    if (path === "prepare") this.prepareSlot = slot;
    else this.phaseSlot = slot;
  }

  step(ms) {
    this.ballistics.step(ms);
    this.targets.step(ms);
    if (!this.held) return;
    const field = this.system.hooks.gameplay();
    if (field.dead || field.simulation.state === "ladder") {
      this.cancelHold();
      return;
    }
    this.age += ms;
    if (COMBAT_SKILLS.get(this.held.id)?.kind !== "continuous") return;
    this.pulseAge += ms;
    // Native0094ba: wait until elapsed>100, then store the current timestamp.
    if (this.pulseAge <= 100) return;
    this.pulseAge = 0;
    this.pulse(field);
  }

  pulse(field) {
    if (this.system.hooks.commitSkillPhase) {
      return this.system.hooks.commitSkillPhase(this.held, this.info, () =>
        this.commitPulse(field),
      );
    }
    return this.commitPulse(field);
  }

  commitPulse(field) {
    const skill = this.held;
    const error =
      field.skillAttackError(skill, this.info) ??
      this.system.costs.consume(skill, this.info);
    if (error) {
      this.cancelHold();
      return;
    }
    field.skillCombat.begin(skill, this.info, this.onHit);
    this.copyProjectile(field);
    field.skillCombat.impact();
    field.phase = "hold";
    field.attackFired = true;
    if (!this.published) {
      this.published = true;
      this.system.publishCast(skill, this.info, this.rank);
    }
  }

  release(id) {
    if (!this.held || this.held.id !== id) return false;
    const skill = this.held;
    const info = this.info;
    const rank = this.rank;
    const spec = COMBAT_SKILLS.get(id);
    const age = Math.max(30, Math.min(spec.chargeMs ?? 1000, this.age));
    const field = this.system.hooks.gameplay();
    if (spec.kind === "continuous") {
      this.cancelHold(id, true);
      return true;
    }
    const error =
      (this.ballistics.handles(id)
        ? this.ballistics.admissionError(skill, info)
        : field.skillAttackError(skill, info)) ??
      this.system.costs.error(skill, info);
    if (error) {
      this.cancelHold(id);
      return false;
    }
    const release = { skill, info, rank, age, field };
    const publish = () => this.commitRelease(release);
    if (this.system.hooks.commitSkillPhase) {
      this.system.hooks.commitSkillPhase(skill, info, publish);
      return true;
    }
    return publish();
  }

  commitRelease({ skill, info, rank, age, field }) {
    this.cancelHold(skill.id, true);
    if (this.system.costs.consume(skill, info)) return false;
    if (this.ballistics.handles(skill.id)) {
      this.copyProjectile(field);
      this.system.publishCast(skill, info, rank);
      this.ballistics.release(skill, info, rank, age);
      return true;
    }
    field.beginSkillAttack(skill, info, this.onHit, age);
    this.copyProjectile(field);
    this.system.publishCast(skill, info, rank);
    return true;
  }

  cancelHold(id = this.held?.id, ended = false) {
    if (!this.held || this.held.id !== id) return false;
    const field = this.system.hooks.gameplay();
    this.system.resources.stop(this.phaseSlot);
    this.system.resources.stop(this.prepareSlot);
    this.prepareSlot = null;
    this.system.resources.stopSound(this.voice);
    this.voice = null;
    this.phaseSlot = null;
    if (ended) this.playPhase("keydownend", false);
    this.held = null;
    this.info = null;
    this.age = 0;
    if (field.phase === "hold") field.phase = "idle";
    field.simulation.movementLocked = field.blocksMovement;
    return true;
  }

  cancel(id) {
    this.cancelHold(id);
    this.ballistics.cancel(id);
    this.targets.cancel(id);
  }
  onDeath() {
    this.cancelHold();
    this.ballistics.clear();
    this.targets.cancel();
    this.system.hooks.gameplay().skillCombat.clear();
  }
  inherit() {
    /* Native held input never survives a field-owner transition. */
  }
  destroy() {
    this.cancelHold();
    this.ballistics.destroy();
    this.targets.destroy();
  }
}
