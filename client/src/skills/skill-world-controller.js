import { applyExternalImpulse } from "../physics/simulation.js";
import {
  teleportDestination,
  commitTeleport,
} from "../physics/skill-relocation.js";
import {
  worldFamily,
  FLASH_SKILLS,
  DASH_SKILLS,
  AREA_SKILLS,
  summonMovement,
  RUSH_SKILLS,
  RIDING_SKILLS,
  STATIONARY_SUMMONS,
} from "./skill-world-rules.js";
import { SkillSummons, createSummon } from "./skill-summons.js";
import { SkillAreas, createArea } from "./skill-areas.js";
import { SkillForms } from "./skill-forms.js";
import { SkillDoor } from "./skill-door.js";
import { SkillWorldEffects } from "./skill-world-effects.js";
import { SkillRiding } from "./skill-riding.js";
import {
  createRushMotion,
  beginRushMotion,
  advanceRushMotion,
  moveSkillGround,
} from "../physics/skill-rush.js";
import { SkillBarrel } from "./skill-barrel.js";

const MAX_LEARNED_WORLD = 64;

function sequenceNeeded(path, family) {
  if (family === "summon") {
    return path.startsWith("summon/") || path === "affected";
  }
  if (family === "area") return path.startsWith("tile/");
  if (family === "door") {
    return path === "cDoor" || path === "mDoor" || path === "Frame";
  }
  return path === "special" || path === "finish";
}

/** Single local world-skill owner; field remains the sole mob damage/status authority. */
export class SkillWorldController {
  constructor(system) {
    this.system = system;
    this.barrel = new SkillBarrel(system);
    this.summons = new SkillSummons(system);
    this.areas = new SkillAreas(system);
    this.forms = new SkillForms(system);
    this.door = new SkillDoor(system);
    this.visuals = new SkillWorldEffects(system);
    this.riding = new SkillRiding(system);
    this.inheritance = null;
    this.prepared = new Map();
    this.destination = { x: 0, y: 0, foothold: null };
    this.flashUsed = false;
    this.impulseCooldown = 0;
    this.dash = { id: 0, remainingMs: 0, direction: 0 };
    this.wings = { remainingMs: 0 };
    this.rush = createRushMotion();
    this.rushHit = this.onRushHit.bind(this);
  }

  async prepare(skills) {
    if (skills.length > MAX_LEARNED_WORLD) {
      throw new Error("Learned world skill bound exceeded");
    }
    await this.forms.prepare(skills);
    await this.riding.prepare(skills);
    await this.visuals.prepare(skills);
    this.barrel.prepare();
    for (const skill of skills) {
      const family = worldFamily(skill.id);
      if (!family) continue;
      await this.prepareWorldSkill(skill, family);
    }
    this.restoreInheritance();
  }

  async prepareWorldSkill(skill, family) {
    const info = this.system.info(skill.id);
    const prior = this.prepared.get(skill.id);
    if (prior?.info === info && this.resourcesCurrent(prior)) return;
    this.cancel(skill.id);
    const sequences = await this.prepareSequences(skill, family);
    this.prepared.set(skill.id, { skill, info, sequences });
    if (summonMovement(skill.id)) {
      this.summons.add(createSummon(skill, info, sequences));
    }
    if (AREA_SKILLS.has(skill.id)) {
      this.areas.records.set(skill.id, createArea(skill, info, sequences));
    }
    if (family === "door") this.door.prepare(skill, info, sequences);
    if (
      RUSH_SKILLS.has(skill.id) ||
      skill.id === 4211002 ||
      skill.id === 5201006
    ) {
      this.system.hooks
        .gameplay()
        .prepareSkillCombat(skill, info, this.system.level(skill.id), false);
    }
    if (summonMovement(skill.id) || AREA_SKILLS.has(skill.id)) {
      this.system.hooks
        .gameplay()
        .prepareSkillCombat(skill, info, this.system.level(skill.id), true);
    }
  }

  async prepareSequences(skill, family) {
    const result = new Map();
    const paths = Object.keys(skill.visuals ?? {});
    const slots =
      family === "area"
        ? Math.ceil(
            32 /
              Math.max(
                1,
                paths.filter((path) => path.startsWith("tile/")).length,
              ),
          )
        : 1;
    for (const path of paths) {
      const wanted = sequenceNeeded(path, family);
      if (!wanted) continue;
      const sequence = await this.system.resources.acquireSequence(
        skill,
        path,
        slots,
      );
      if (sequence) result.set(path, sequence);
    }
    return result;
  }

  async prepareImpactArea(skill, info) {
    const prior = this.prepared.get(skill.id);
    if (prior?.info === info && this.resourcesCurrent(prior)) return;
    this.areas.cancel(skill.id);
    const sequences = await this.prepareSequences(skill, "area");
    this.areas.records.set(skill.id, createArea(skill, info, sequences));
    this.prepared.set(skill.id, { skill, info, sequences });
    this.system.hooks
      .gameplay()
      .prepareSkillCombat(skill, info, this.system.level(skill.id), true);
  }

  placeImpactArea(id, origin) {
    const record = this.areas.records.get(id);
    if (!record) throw new Error("Impact area was not prepared");
    this.areas.cast(record, origin);
  }

  resourcesCurrent(record) {
    for (const [path, sequence] of record.sequences) {
      if (this.system.resources.sequence(record.skill, path) !== sequence) {
        return false;
      }
    }
    return true;
  }

  admissionError(skill, info) {
    const family = worldFamily(skill.id);
    if (!family || family === "drop") {
      return "This skill is not an active world action";
    }
    if (!this.prepared.has(skill.id)) {
      return "World skill resources are not prepared";
    }
    const visualError = this.visuals.admissionError(skill.id);
    if (visualError) return visualError;
    if (RIDING_SKILLS.has(skill.id)) return this.riding.admissionError(skill);
    if (family === "form") return this.forms.admissionError(skill, info);
    if (family === "door") return this.door.admissionError();
    if (family === "summon") return this.summonAdmission(skill);
    return this.motionAdmission(skill, info, family);
  }

  summonAdmission(skill) {
    if (this.system.scene.simulation.state !== "ground") {
      return "This skill requires a grounded placement";
    }
    if (
      skill.id === 1321007 &&
      this.system.level(1320009) > 0 &&
      !this.system.effects.canStart(1321007, 1320009)
    ) {
      return "No temporary-source capacity for Beholder and its learned Hex";
    }
    return null;
  }

  motionAdmission(skill, info, family) {
    const sim = this.system.scene.simulation;
    if (
      (this.system.scene.manifest.physics.map.fieldLimit ?? 0) & 2 &&
      (family === "impulse" || family === "wings")
    ) {
      return "Original field movement-skill restriction";
    }
    if (family === "teleport") {
      return teleportDestination(sim, info.range, this.destination);
    }
    if (family === "impulse") return this.impulseError(skill.id);
    if (family === "rush" || family === "assault" || family === "recoil") {
      return this.attackAdmission(skill, info, family);
    }
    if (family === "area") {
      return sim.state !== "ground"
        ? "This skill requires a grounded placement"
        : null;
    }
    return null;
  }

  impulseError(id) {
    const sim = this.system.scene.simulation;
    if (this.impulseCooldown > 0) return "Movement skill recovery is active";
    if (FLASH_SKILLS.has(id)) {
      return sim.state !== "air" || this.flashUsed
        ? "Flash Jump requires an unused airborne jump"
        : null;
    }
    return sim.state === "ground"
      ? null
      : "This movement skill requires ground";
  }

  cast(skill, info, rank) {
    const family = worldFamily(skill.id);
    if (family === "teleport") this.teleport(skill.id);
    else if (family === "impulse") this.impulse(skill.id, info, rank);
    else if (family === "rush") {
      this.system.hooks.admitAttack(skill, info, this.rushHit);
    } else if (family === "dash") this.startDash(skill.id, info);
    else if (family === "wings") this.startWings(info);
    else if (family === "summon") {
      this.summons.cast(this.summons.records.get(skill.id));
    } else if (family === "area") {
      this.areas.cast(this.areas.records.get(skill.id));
    } else if (family === "assault" || family === "recoil") {
      this.attackCast(skill, info, rank);
    } else this.castFormOrDoor(skill, info, rank, family);
  }

  castFormOrDoor(skill, info, rank, family) {
    if (RIDING_SKILLS.has(skill.id)) {
      this.forms.cancel();
      this.riding.cast(skill, info, rank);
    } else if (family === "form") {
      this.riding.cancel();
      this.barrel.reset();
      this.forms.cast(skill, info, rank);
    } else if (family === "door") this.door.cast();
  }

  teleport(id) {
    const sim = this.system.scene.simulation;
    this.visuals.play(id, sim);
    commitTeleport(sim, this.destination);
    this.visuals.play(id, sim, 1);
  }

  attackAdmission(skill, info, family) {
    if (this.impulseCooldown > 0) return "Movement attack recovery is active";
    if (
      family !== "recoil" &&
      this.system.scene.simulation.state !== "ground"
    ) {
      return "This movement attack requires ground";
    }
    return this.system.hooks.validateAttack(skill, info);
  }

  /** Every movement-skill impulse merges through the shared kernel entry point so
   *  the predictor and this controller cannot drift. `onExternalImpulse` lets an
   *  authority publish the exact divert it just applied; offline it is absent. */
  applyMovementImpulse(sim, vx, vy) {
    applyExternalImpulse(
      sim,
      vx,
      vy,
      this.system.hooks.onExternalImpulse ?? null,
    );
  }

  attackCast(skill, info, rank) {
    this.system.hooks.admitAttack(skill, info, this.rushHit);
    if (skill.id !== 5201006) return;
    const sim = this.system.scene.simulation;
    //00955537..009555c9: Recoil Shot reverses the horizontal rank impulse.
    this.applyMovementImpulse(
      sim,
      -sim.facing * (250 + Math.trunc(rank / 4) * 40),
      -(250 + Math.trunc(rank / 4) * 20),
    );
    this.impulseCooldown = 2000;
  }

  impulse(id, info, rank) {
    const sim = this.system.scene.simulation;
    this.visuals.play(id, sim);
    if (id === 21001001) {
      this.applyMovementImpulse(sim, sim.facing * info.x, 0);
      this.impulseCooldown = 1000; //009535e3.
      return;
    }
    const level = id === 11101005 ? rank * 2 : rank;
    this.applyMovementImpulse(
      sim,
      sim.facing * (350 + Math.trunc(level / 4) * 40),
      -(250 + Math.trunc(level / 4) * 20),
    );
    this.flashUsed = true;
    if (id === 11101005) this.impulseCooldown = 1500;
  }

  startDash(id, info) {
    this.stopDash();
    const sim = this.system.scene.simulation;
    this.dash.id = id;
    this.dash.remainingMs = info.time * 1000;
    this.dash.direction = sim.facing;
    this.system.startBuff(this.system.catalog[id], this.system.level(id), info);
  }

  stopDash() {
    if (!this.dash.id) return;
    if (!this.system.transferredEffects) {
      this.system.effects.remove(this.dash.id);
    }
    this.dash.id = 0;
    this.dash.remainingMs = 0;
    this.system.recompute();
  }

  startWings(info) {
    this.wings.remainingMs = info.time * 1000;
    this.system.scene.simulation.worldMovement.wingsX = info.x;
  }

  onRushHit(id, target) {
    this.system.hit(id, target);
    const sim = this.system.scene.simulation;
    if (id === 4211002) {
      moveSkillGround(sim, target.x - sim.x + sim.facing * 30, 120);
      return;
    }
    if (!RUSH_SKILLS.has(id) || this.rush.remainingMs > 0) return;
    beginRushMotion(this.rush, this.system.info(id).lt.x, sim.facing);
    if (id === 21100002) this.rush.waitMs = 60;
    else this.impulseCooldown = 1770; //00952eff, native Rush repeat guard.
  }

  step(ms) {
    const sim = this.system.scene.simulation;
    if (sim.state === "ground") this.flashUsed = false;
    this.impulseCooldown = Math.max(0, this.impulseCooldown - ms);
    this.stepMotion(ms);
    this.summons.step(ms);
    this.areas.step(ms);
    this.forms.step(ms);
    this.riding.step(ms);
    this.visuals.step(ms);
    this.door.step(ms);
  }

  stepMotion(ms) {
    const sim = this.system.scene.simulation;
    if (this.dash.remainingMs > 0) {
      this.dash.remainingMs = Math.max(0, this.dash.remainingMs - ms);
      if (!sim.horizontalInput || sim.horizontalInput !== this.dash.direction) {
        this.dash.remainingMs = 0;
      }
      if (!this.dash.remainingMs) this.stopDash();
    }
    this.wings.remainingMs = Math.max(0, this.wings.remainingMs - ms);
    if (!this.wings.remainingMs) sim.worldMovement.wingsX = 0;
    advanceRushMotion(sim, this.rush, ms);
    this.barrel.step();
  }

  active(id) {
    return (
      this.summons.active(id) ||
      this.forms.current?.skillId === id ||
      this.riding.current?.skillId === id ||
      (this.areas.records.get(id)?.remainingMs ?? 0) > 0
    );
  }
  remainingMs(id) {
    return this.summons.records.get(id)?.remainingMs ?? 0;
  }
  beholderEffect(heal) {
    this.summons.beholderEffect(heal);
  }
  cooldownOnCast(skill) {
    return skill.id !== 5221006;
  }
  targetFor(mob, fallback) {
    return this.summons.targetFor(mob, fallback);
  }
  interceptContact(mob, action, outcome = null) {
    if (this.summons.interceptContact(mob, action, outcome)) return true;
    const form = this.forms.current;
    return !action && form?.skillId === 5101007
      ? this.barrel.intercept(mob, form.info, outcome)
      : false;
  }
  protects(x, y) {
    return this.areas.protects(x, y);
  }
  present(pose) {
    this.forms.present(pose);
    this.riding.present(pose);
  }
  supportsAction(action) {
    return (
      this.forms.supportsAction(action) ||
      (this.riding.current?.animation.actions.has(action) ?? false)
    );
  }
  useDoor() {
    return this.door.use();
  }
  damageForm(amount) {
    this.riding.damage(amount);
  }

  cancel(id) {
    this.summons.cancel(id);
    this.areas.cancel(id);
    this.forms.cancel(id);
    if (this.riding.current?.skillId === id) this.riding.cancel();
    if (id === 2311002) this.door.cancel();
    if (DASH_SKILLS.has(id) && this.dash.id === id) this.stopDash();
    if (id === 5201005) {
      this.wings.remainingMs = 0;
      this.system.scene.simulation.worldMovement.wingsX = 0;
    }
  }

  onDeath() {
    for (const id of this.prepared.keys()) this.cancel(id);
    this.rush.remainingMs = 0;
  }
  inherit(previous) {
    this.door.inherit(previous.door);
    const summons = [];
    for (const record of previous.summons.records.values()) {
      if (record.remainingMs <= 0) continue;
      if (STATIONARY_SUMMONS.has(record.skill.id)) {
        this.system.effects.remove(record.skill.id);
      } else {
        summons.push({
          id: record.skill.id,
          remainingMs: record.remainingMs,
          hp: record.hp,
        });
      }
    }
    this.inheritance = {
      summons,
      form: activeForm(previous.forms),
      riding: activeForm(previous.riding),
    };
    this.riding.shipHP = previous.riding.shipHP;
    this.riding.fatigueMs = previous.riding.fatigueMs;
    this.dash.id = previous.dash.id;
    this.dash.remainingMs = previous.dash.remainingMs;
    this.dash.direction = previous.dash.direction;
    this.restoreInheritance();
    this.system.recompute();
  }

  restoreInheritance() {
    const inherited = this.inheritance;
    if (!inherited) return;
    for (const source of inherited.summons) {
      const record = this.summons.records.get(source.id);
      if (!record) continue;
      this.summons.cast(record, true);
      record.remainingMs = source.remainingMs;
      record.hp = source.hp;
    }
    if (inherited.form) {
      const skill = this.system.catalog[inherited.form.id];
      this.forms.cast(
        skill,
        this.system.info(skill.id),
        this.system.level(skill.id),
        true,
      );
      this.forms.current.remainingMs = inherited.form.remainingMs;
    }
    if (inherited.riding) {
      const skill = this.system.catalog[inherited.riding.id];
      if (this.riding.admissionError(skill)) {
        this.system.effects.remove(skill.id);
      } else {
        this.riding.cast(
          skill,
          this.system.info(skill.id),
          this.system.level(skill.id),
          true,
        );
        this.riding.current.remainingMs = inherited.riding.remainingMs;
      }
    }
    this.inheritance = null;
  }

  destroy() {
    this.onDeath();
    this.summons.destroy();
    this.areas.destroy();
    this.forms.destroy();
    this.riding.destroy();
    this.visuals.destroy();
    this.door.cancel();
    this.prepared.clear();
  }
}

function activeForm(controller) {
  return controller.current
    ? {
        id: controller.current.skillId,
        remainingMs: controller.current.remainingMs,
      }
    : null;
}
