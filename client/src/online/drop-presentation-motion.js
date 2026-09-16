import {
  DROP_MOTION,
  stepDropFlight,
  hoverDrop,
  dropDrawY,
  dropRotation,
  fadeDisappearingDrop,
} from "../world/drop-motion.js";

const QUANTUM = DROP_MOTION.quantumMs;
const CORRECT_MS = 180;
const FIELDS = [
  "state",
  "age",
  "phaseAge",
  "sourceX",
  "sourceY",
  "groundX",
  "groundY",
  "durationMs",
  "launchSpeed",
  "rotation",
  "alpha",
];

function phaseDuration(slot) {
  if (slot.state === "waiting") return QUANTUM;
  if (slot.state === "launching") {
    return Math.ceil(slot.durationMs / QUANTUM) * QUANTUM;
  }
  if (slot.state === "falling") {
    return (
      Math.ceil(
        ((slot.groundY - slot.sourceY) * 1000) / slot.launchSpeed / QUANTUM,
      ) * QUANTUM
    );
  }
  return Infinity;
}

/** Jump between at most four known phases; no catch-up loop proportional to network age. */
export function projectDrop(slot, entity, elapsed) {
  for (const key of FIELDS) slot[key] = entity.dropMotion[key];
  slot.x = entity.position.x;
  slot.y = entity.position.y;
  slot.itemId = entity.templateId;
  for (let transitions = 0; transitions < 4 && elapsed > 0; transitions++) {
    const remaining = Math.max(0, phaseDuration(slot) - slot.phaseAge);
    const step = Math.min(elapsed, remaining);
    slot.phaseAge += step;
    slot.age += step;
    elapsed -= step;
    if (slot.state === "waiting") {
      if (step === remaining) {
        slot.state = "launching";
        slot.phaseAge = 0;
      }
    } else if (slot.state === "grounded") hoverDrop(slot);
    else stepDropFlight(slot);
    if (elapsed === 0) break;
  }
  slot.visible = slot.state !== "waiting";
  if (entity.dropInfo.disappearing && fadeDisappearingDrop(slot)) {
    slot.visible = false;
  }
  return slot;
}

/** The authored origin phase of a published drop plan. `projectDrop` seeds its projection from
 *  the stored plan, so a replaying drop needs the state/phase/age rewound to spawn — not just a
 *  local clock reset — while keeping the authority's duration and launch speed. */
function replayPlan(motion) {
  return {
    state: "waiting",
    age: 0,
    phaseAge: 0,
    sourceX: motion.sourceX,
    sourceY: motion.sourceY,
    groundX: motion.groundX,
    groundY: motion.groundY,
    durationMs: motion.durationMs,
    launchSpeed: motion.launchSpeed,
    x: motion.sourceX,
    y: motion.sourceY,
    rotation: 0,
    alpha: 1,
  };
}

/** A server-published source/landing plan owns a disposable, monotonic local visual clock. */
export class DropPresentationMotion {
  constructor(entity, tick, now) {
    this.lower = {};
    this.upper = {};
    this.x = entity.position.x;
    this.y = entity.position.y;
    this.offsetX = this.offsetY = 0;
    this.tick = -Infinity;
    this.observe(entity, tick, now);
  }
  observe(entity, tick, now) {
    if (tick <= this.tick) return;
    if (this.entity) this.sample(now);
    const priorX = this.x,
      priorY = this.y;
    // The whole source/landing plan is published, so a drop first seen at its spawn replays
    // the authored launch from the beginning. Anchoring it to the authority's already-elapsed
    // age (what `max(local, server)` did) showed an observer only the second half of the arc
    // once the ack-gated entity frame arrived. A drop already in flight or grounded when it is
    // first seen (a late join) still anchors to the authority's own age, and once a drop has
    // started it keeps its own monotonic clock, so a delayed copy can never rewind it.
    const motion = entity.dropMotion;
    const fresh =
      !this.entity &&
      (motion.state === "waiting" || motion.state === "launching");
    if (fresh) {
      this.replay = true;
      // Rewind the projection itself, not only the clock: `projectDrop` seeds its phase from
      // the stored plan, so the received mid-flight state has to be replaced by the origin.
      this.plan = replayPlan(motion);
    }
    if (this.replay) {
      entity = {
        ...entity,
        position: { x: this.plan.sourceX, y: this.plan.sourceY },
        dropMotion: this.plan,
      };
    }
    const localAge = Number.isFinite(this.age) ? this.age : 0;
    this.anchorAge = this.replay
      ? fresh
        ? 0
        : localAge
      : Math.max(localAge, motion.age);
    this.entity = entity;
    this.tick = tick;
    this.received = now;
    this.offsetX = this.offsetY = 0;
    this.sample(now);
    this.offsetX = priorX - this.x;
    this.offsetY = priorY - this.y;
    this.sample(now);
  }
  sample(now) {
    const elapsed = Math.max(0, now - this.received);
    this.age = this.anchorAge + elapsed;
    const since = Math.max(0, this.age - this.entity.dropMotion.age);
    const whole = Math.floor(since / QUANTUM) * QUANTUM;
    this.fraction = (since - whole) / QUANTUM;
    projectDrop(this.lower, this.entity, whole);
    projectDrop(this.upper, this.entity, whole + QUANTUM);
    const t = Math.min(1, elapsed / CORRECT_MS);
    this.remaining = 1 - t * t * (3 - 2 * t);
    this.x =
      this.lower.x +
      (this.upper.x - this.lower.x) * this.fraction +
      this.offsetX * this.remaining;
    this.y =
      this.lower.y +
      (this.upper.y - this.lower.y) * this.fraction +
      this.offsetY * this.remaining;
    this.rotation = dropRotation(
      this.lower,
      since - whole,
      this.entity.templateId !== 0,
    );
    this.alpha =
      this.lower.alpha + (this.upper.alpha - this.lower.alpha) * this.fraction;
    this.visible = this.lower.visible;
    return this;
  }
  renderY(halfHeight) {
    const first = dropDrawY(this.lower, halfHeight);
    return (
      first +
      (dropDrawY(this.upper, halfHeight) - first) * this.fraction +
      this.offsetY * this.remaining
    );
  }
}
