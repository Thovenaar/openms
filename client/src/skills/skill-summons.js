import {
  PUPPET_SKILLS,
  STATIONARY_SUMMONS,
  summonMovement,
} from "./skill-world-rules.js";
import {
  createSummonProjectile,
  fireSummonProjectile,
  stepSummonProjectile,
  stopSummonProjectile,
} from "./skill-summon-projectile.js";
import { selectSummonTarget } from "./skill-summon-targets.js";

const MAX_SUMMONS = 32;
// Local deterministic follow policy; original summon animation/attack timings remain authored.
const FOLLOW_SPEED = 180;
const FOLLOW_DISTANCE = 60;
const LOOP = Object.freeze({ loop: true, follow: true });
const ONCE = Object.freeze({ follow: true });

export function createSummon(skill, info, sequences) {
  const attack = skill.properties.summon?.attack1?.info ?? null;
  return {
    skill,
    info,
    sequences,
    attack,
    movement: summonMovement(skill.id),
    remainingMs: 0,
    hp: 0,
    x: 0,
    y: 0,
    facing: 1,
    kind: "summon",
    targetId: null,
    target: null,
    slot: null,
    action: "",
    attackMs: 0,
    fired: false,
    cycleMs: sequences.get("summon/attack1")?.descriptor.durationMs ?? 0,
    projectile: createSummonProjectile(),
    effectShown: false,
    moving: false,
  };
}

export class SkillSummons {
  constructor(system) {
    this.system = system;
    this.records = new Map();
  }

  add(record) {
    if (
      this.records.size >= MAX_SUMMONS &&
      !this.records.has(record.skill.id)
    ) {
      throw new Error("Summon residency limit exceeded");
    }
    this.records.set(record.skill.id, record);
  }

  cast(record, restoring = false) {
    for (const other of this.records.values()) {
      if (
        STATIONARY_SUMMONS.has(other.skill.id) ===
        STATIONARY_SUMMONS.has(record.skill.id)
      ) {
        this.stop(other);
      }
    }
    if (record.skill.id === 1321007 && this.system.level(1320009) > 0) {
      this.system.effects.reserveSource(1320009, 1321007);
    }
    const sim = this.system.scene.simulation;
    record.x = sim.x;
    record.y = sim.y;
    record.facing = sim.facing;
    record.hp = PUPPET_SKILLS.has(record.skill.id) ? record.info.x : 1;
    record.remainingMs = record.info.time * 1000;
    record.attackMs = 0;
    record.target = null;
    this.pose(record, "summon/summoned", false);
    if (!restoring) {
      this.system.startBuff(
        record.skill,
        this.system.level(record.skill.id),
        record.info,
      );
    }
  }

  pose(record, action, loop) {
    const sequence = record.sequences.get(action);
    if (!sequence) return;
    this.system.resources.stop(record.slot);
    record.slot = this.system.resources.playSequence(
      sequence,
      record,
      loop ? LOOP : ONCE,
    );
    record.action = action;
  }

  step(ms) {
    for (const record of this.records.values()) {
      if (record.remainingMs <= 0) continue;
      record.remainingMs -= ms;
      if (record.remainingMs <= 0 || this.system.level(record.skill.id) <= 0) {
        this.stop(record);
        continue;
      }
      if (
        (record.action === "summon/summoned" ||
          record.action.startsWith("summon/skill") ||
          record.action === "summon/hit") &&
        record.slot?.remaining > 0
      ) {
        continue;
      }
      this.move(record, ms);
      this.attack(record, ms);
    }
  }

  move(record, ms) {
    if (record.movement === "stationary" || record.target) return;
    const sim = this.system.scene.simulation;
    const goalX = sim.x - sim.facing * FOLLOW_DISTANCE;
    const goalY = sim.y - (record.movement === "circle" ? FOLLOW_DISTANCE : 0);
    const distance = Math.hypot(goalX - record.x, goalY - record.y);
    record.moving = distance > 1;
    const fraction =
      distance > 0 ? Math.min(1, (FOLLOW_SPEED * ms) / 1000 / distance) : 0;
    record.x += (goalX - record.x) * fraction;
    record.y += (goalY - record.y) * fraction;
    record.facing = sim.facing;
  }

  attack(record, ms) {
    if (!record.attack) {
      this.idle(record);
      return;
    }
    if (!record.target && !this.beginAttack(record)) return;
    record.attackMs += ms;
    if (!record.fired && record.attackMs >= (record.attack.attackAfter ?? 0)) {
      record.fired = true;
      if (record.attack.bulletSpeed) fireSummonProjectile(this.system, record);
      else this.impact(record);
    }
    if (stepSummonProjectile(this.system, record, ms)) this.impact(record);
    this.attackEffect(record);
    this.finishAttackCycle(record);
  }

  finishAttackCycle(record) {
    if (
      record.attackMs >=
        Math.max(
          record.cycleMs,
          record.attack.attackAfter ?? 0,
          record.attack.effectAfter ?? 0,
        ) &&
      !record.projectile.active
    ) {
      record.target = null;
    }
  }

  beginAttack(record) {
    record.target = this.select(record);
    if (!record.target) {
      this.idle(record);
      return false;
    }
    record.facing = record.target.x >= record.x ? 1 : -1;
    record.targetId = record.target.id;
    record.attackMs = 0;
    record.fired = false;
    record.effectShown = false;
    this.pose(record, "summon/attack1", false);
    return true;
  }

  impact(record) {
    this.system.hooks
      .gameplay()
      .externalSkillImpact(record.skill, record.info, record);
    const sequence = record.sequences.get("summon/attack1/info/hit");
    if (sequence) {
      this.system.resources.playSequence(sequence, record.target, ONCE);
    }
    if (record.skill.id === 5211002) this.stop(record);
  }

  attackEffect(record) {
    if (
      record.effectShown ||
      record.attackMs < (record.attack.effectAfter ?? 0)
    ) {
      return;
    }
    record.effectShown = true;
    const sequence = record.sequences.get("summon/attack1/info/effect");
    if (sequence && record.target) {
      this.system.resources.playSequence(sequence, record.target, ONCE);
    }
  }

  beholderEffect() {
    const record = this.records.get(1321007);
    if (!record || record.remainingMs <= 0) return;
    const affected = record.sequences.get("affected");
    if (affected) {
      this.system.resources.playSequence(
        affected,
        this.system.scene.simulation,
        ONCE,
      );
    }
  }

  select(record) {
    return selectSummonTarget(
      record,
      this.system.hooks.gameplay().worldSkills().mobs,
      this.system.scene.simulation,
    );
  }

  idle(record) {
    const action =
      record.moving && record.sequences.has("summon/move")
        ? "summon/move"
        : "summon/stand";
    if (record.action !== action) this.pose(record, action, true);
  }

  active(id) {
    return (this.records.get(id)?.remainingMs ?? 0) > 0;
  }

  targetFor(mob, fallback) {
    if (!mob.aggro?.damageInstances) return fallback;
    for (const record of this.records.values()) {
      if (record.remainingMs > 0 && PUPPET_SKILLS.has(record.skill.id)) {
        return record;
      }
    }
    return fallback;
  }

  interceptContact(mob, attackAction) {
    const target = this.targetFor(mob, null);
    if (!target) return false;
    const body = attackAction ? mob.attackBody : mob.body;
    if (
      !body.active ||
      target.x < body.left ||
      target.x >= body.right ||
      target.y < body.top ||
      target.y > body.bottom
    ) {
      return false;
    }
    // Cosmic DamageSummonHandler: puppet takes the received monster damage, not player vitals.
    const damage = Math.max(
      1,
      attackAction?.info?.PADamage ?? mob.template.info.PADamage,
    );
    target.hp -= damage;
    if (target.hp <= 0) this.stop(target);
    else this.pose(target, "summon/hit", false);
    return true;
  }

  stop(record) {
    if (!record.slot && record.remainingMs <= 0) return;
    this.system.resources.stop(record.slot);
    stopSummonProjectile(this.system, record);
    record.slot = null;
    record.remainingMs = 0;
    record.target = null;
    record.targetId = null;
    record.action = "";
    if (!this.system.transferredEffects) {
      this.system.effects.remove(record.skill.id);
      this.system.effects.releaseOwner(record.skill.id);
    }
    this.system.recompute();
  }

  cancel(id) {
    const record = this.records.get(id);
    if (record) this.stop(record);
  }
  destroy() {
    for (const record of this.records.values()) this.stop(record);
    this.records.clear();
  }
}
