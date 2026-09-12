import {
  BALLISTIC_SKILLS,
  ballisticCharge,
  ballisticImpulse,
  CORKSCREW_DELTAS,
  CORKSCREW_DURATIONS,
} from "./skill-ballistic-rules.js";
import {
  createSimulation,
  relocateSimulation,
  applyExternalImpulse,
} from "../physics/simulation.js";
import { moveSkillGround } from "../physics/skill-rush.js";
import { stepBallisticPhysics } from "../physics/skill-ballistic.js";

const MAX_BALLS = 8; // Browser residency/capacity policy, checked before resource debit.
const MAX_STEPS = 8;
const QUANTUM_MS = 30;
const LOOP = Object.freeze({ loop: true, follow: true });

function createBall(world, origin) {
  return {
    active: false,
    skill: null,
    info: null,
    rank: 0,
    chargeMs: 0,
    x: origin.x,
    y: origin.y,
    facing: 1,
    targetId: null,
    kind: "ballistic",
    simulation: createSimulation(world, origin),
    slot: null,
    specialSlot: null,
    visual: null,
    special: null,
  };
}

/** Owns held-release motion only. OfflineField remains the sole mob damage/status authority. */
export class SkillBallistics {
  constructor(system) {
    this.system = system;
    this.prepared = new Map();
    this.balls = [];
    this.destroyed = false;
    this.recastMs = 0;
    this.motion = {
      id: 0,
      phase: 0,
      phaseMs: 0,
      accumulatorMs: 0,
      facing: 1,
      x: 0,
      y: 0,
      chargeMs: 0,
      targetId: null,
      kind: "ballistic",
    };
    this.arrival = { x: 0, y: 0, facing: 1 };
  }

  handles(id) {
    return BALLISTIC_SKILLS.has(id);
  }

  async prepare(skills) {
    if (this.destroyed) return;
    for (const skill of skills) {
      if (!this.handles(skill.id)) continue;
      const rank = this.system.level(skill.id);
      if (rank <= 0) continue;
      const info = this.system.info(skill.id, rank);
      const spec = BALLISTIC_SKILLS.get(skill.id);
      const record = { skill, info, rank, spec, ball: null, special: null };
      if (!spec.grounded) await this.prepareBomb(record);
      this.system.hooks.gameplay().prepareSkillCombat(skill, info, rank, true);
      this.prepared.set(skill.id, record);
    }
  }

  async prepareBomb(record) {
    const resources = this.system.resources;
    //0058f959 loads this exact shared path for both thrown skill IDs.
    const flightSkill = this.system.catalog[5201002];
    const ball = resources.phasePath(flightSkill, "ball", 1);
    const special = resources.phasePath(record.skill, "special", record.rank);
    if (!ball || !special) {
      throw new Error("Original bomb flight/detonation artwork is missing");
    }
    record.ball = await resources.acquireSequence(flightSkill, ball, MAX_BALLS);
    record.special = await resources.acquireSequence(
      record.skill,
      special,
      MAX_BALLS,
    );
    if (record.skill.id === 14111006) {
      await this.system.worldController.prepareImpactArea(
        record.skill,
        record.info,
      );
    }
    if (this.balls.length !== 0) return;
    for (let index = 0; index < MAX_BALLS; index++) {
      this.balls.push(
        createBall(
          this.system.scene.manifest.physics,
          this.system.scene.simulation,
        ),
      );
    }
  }

  admissionError(skill, info) {
    if (this.destroyed || !this.prepared.has(skill.id)) {
      return "Ballistic resources are not prepared";
    }
    const record = this.prepared.get(skill.id);
    if (record.rank !== this.system.level(skill.id) || record.info !== info) {
      return "Ballistic rank preparation is stale";
    }
    const sim = this.system.scene.simulation;
    if (sim.ladder || sim.seat) {
      return "Cannot release this skill while climbing or seated";
    }
    if (record.spec.grounded) return this.corkscrewAdmission(sim);
    return this.projectileAdmission();
  }

  corkscrewAdmission(sim) {
    if (this.recastMs > 0) {
      return "Corkscrew recovery has not finished";
    }
    if (!this.system.scene.actor.actions.has("screw")) {
      return "Original Corkscrew pose is not prepared";
    }
    return sim.foothold ? null : "Corkscrew requires a foothold";
  }

  projectileAdmission() {
    for (const ball of this.balls) {
      if (!ball.active && !ball.specialSlot?.remaining) return null;
    }
    return "Ballistic projectile capacity is full";
  }

  /** Called only after admission, atomic cost debit and publishCast. */
  release(skill, info, rank, chargeMs) {
    const record = this.prepared.get(skill.id);
    if (record.rank !== rank || record.info !== info) {
      throw new Error("Ballistic rank changed after admission");
    }
    const charge = ballisticCharge(chargeMs);
    if (record.spec.grounded) return this.releaseCorkscrew(record, charge);
    for (const ball of this.balls) {
      if (ball.active || ball.specialSlot?.remaining) continue;
      this.launch(ball, record, charge);
      return true;
    }
    throw new Error("Admitted ballistic capacity changed before release");
  }

  releaseCorkscrew(record, charge) {
    const sim = this.system.scene.simulation;
    this.system.hooks.gameplay().beginSkillPose("screw");
    const motion = this.motion;
    motion.x = sim.x;
    motion.y = sim.y;
    motion.facing = sim.facing;
    motion.chargeMs = charge;
    const count = this.system.hooks
      .gameplay()
      .externalSkillImpact(record.skill, record.info, motion);
    if (count > 0) {
      motion.id = record.skill.id;
      motion.phase = 0;
      motion.phaseMs = CORKSCREW_DURATIONS[0];
      motion.accumulatorMs = 0;
      this.recastMs = 1450; //0095300d: release clock +0x5aa, separate from motion queue lifetime.
    }
    return true;
  }

  launch(ball, record, charge) {
    const sim = this.system.scene.simulation;
    ball.skill = record.skill;
    ball.info = record.info;
    ball.rank = record.rank;
    ball.facing = sim.facing;
    ball.chargeMs = 0;
    ball.x = sim.x + sim.facing;
    ball.y = sim.y - 20;
    this.arrival.x = ball.x;
    this.arrival.y = ball.y;
    this.arrival.facing = ball.facing;
    relocateSimulation(ball.simulation, this.arrival);
    ball.simulation.accumulatorMs = 0;
    ball.simulation.accumulatorError = 0;
    const impulse = ballisticImpulse(charge);
    applyExternalImpulse(ball.simulation, impulse * ball.facing, -impulse);
    ball.visual = record.ball;
    ball.special = record.special;
    ball.slot = this.system.resources.playSequence(ball.visual, ball, LOOP);
    ball.active = true;
  }

  step(ms) {
    if (this.destroyed) return;
    if (this.system.store.profile.hp <= 0) {
      this.clear();
      return;
    }
    this.recastMs = Math.max(0, this.recastMs - ms);
    this.stepCorkscrew(ms);
    for (const ball of this.balls) {
      if (!ball.active) continue;
      if (this.system.level(ball.skill.id) <= 0) {
        this.stopBall(ball);
        continue;
      }
      ball.simulation.accumulatorMs += ms;
      for (
        let tick = 0;
        tick < MAX_STEPS &&
        ball.active &&
        ball.simulation.accumulatorMs >= QUANTUM_MS;
        tick++
      ) {
        ball.simulation.accumulatorMs -= QUANTUM_MS;
        const contact = stepBallisticPhysics(ball.simulation);
        ball.x = ball.simulation.x;
        ball.y = ball.simulation.y;
        if (contact) this.detonate(ball);
      }
    }
  }

  stepCorkscrew(ms) {
    const motion = this.motion;
    if (!motion.id) return;
    if (this.system.level(motion.id) <= 0) {
      motion.id = 0;
      return;
    }
    motion.accumulatorMs += ms;
    for (
      let tick = 0;
      tick < MAX_STEPS && motion.accumulatorMs >= QUANTUM_MS && motion.id;
      tick++
    ) {
      motion.accumulatorMs -= QUANTUM_MS;
      const delta = CORKSCREW_DELTAS[motion.phase] * motion.facing;
      //0094e728 consumes zero phases without a terrain query.
      if (
        delta &&
        !moveSkillGround(
          this.system.scene.simulation,
          delta,
          Math.abs(Math.max(30, delta)),
        )
      ) {
        motion.id = 0;
        break;
      }
      motion.phaseMs -= QUANTUM_MS;
      if (motion.phaseMs > 0) continue;
      motion.phase++;
      if (motion.phase === CORKSCREW_DURATIONS.length) motion.id = 0;
      else motion.phaseMs = CORKSCREW_DURATIONS[motion.phase];
    }
  }

  detonate(ball) {
    ball.active = false;
    this.system.resources.stop(ball.slot);
    ball.slot = null;
    ball.specialSlot = this.system.resources.playSequence(ball.special, ball);
    this.system.hooks
      .gameplay()
      .externalSkillImpact(ball.skill, ball.info, ball);
    if (ball.skill.id === 14111006) {
      this.system.worldController.placeImpactArea(ball.skill.id, ball);
    }
  }

  stopBall(ball) {
    this.system.resources.stop(ball.slot);
    this.system.resources.stop(ball.specialSlot);
    ball.slot = null;
    ball.specialSlot = null;
    ball.active = false;
  }

  cancel(id) {
    if (this.motion.id === id) {
      this.motion.id = 0;
      this.recastMs = 0;
    }
    for (const ball of this.balls) {
      if (ball.skill?.id === id) this.stopBall(ball);
    }
    if (id === 14111006) this.system.worldController.cancel(id);
  }

  clear() {
    this.motion.id = 0;
    this.recastMs = 0;
    for (const ball of this.balls) this.stopBall(ball);
    this.system.worldController.cancel(14111006);
  }

  destroy() {
    this.clear();
    this.destroyed = true;
    this.prepared.clear();
    this.balls.length = 0;
  }
}
