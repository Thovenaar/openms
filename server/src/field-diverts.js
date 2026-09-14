import { captureMotion } from "../../shared/motion.js";

/** At most this many external impulses are described in one motion checkpoint.
 *  A tick can carry a mob hit and a movement skill; more than that is a fault. */
const MAX_DIVERTS_PER_TICK = 2;
/** A pending divert is dropped when it was not published within this many ticks:
 *  the actor left the active set or the field changed under it, so the checkpoint
 *  the client would place it against no longer exists. */
const MAX_DIVERT_AGE_TICKS = 1;

/** Record one authoritative external impulse together with the kernel checkpoint
 *  from immediately before the merge. The pre-merge state cannot be reconstructed
 *  afterwards — `applyExternalImpulse` merges through a non-invertible clamp and
 *  detaches ground/ladder/seat — so the client needs it to re-step the same suffix
 *  through the same kernel entry point instead of adopting the post-impulse state.
 *  `simulation` must be the actor's own field simulation; `divert` carries the exact
 *  `{vx, vy}` merge vector and its `source`. */
export function recordMotionDivert(actor, simulation, divert) {
  const pending = actor.motionDiverts;
  if (!pending || !actor.field || simulation !== actor.simulation) return;
  if (!Number.isFinite(divert.vx) || !Number.isFinite(divert.vy)) return;
  if (pending.entries.length >= MAX_DIVERTS_PER_TICK) return;
  pending.entries.push({
    vx: divert.vx,
    vy: divert.vy,
    source: divert.source,
    tick: actor.field.tick,
    before: captureMotion(simulation),
  });
}

/** Allocate the buffer once per field entry, never per tick. */
export function prepareMotionDiverts(actor, field) {
  actor.motionDiverts = { field, entries: [] };
}

/** Stamp the diverts this tick's published checkpoint first reflects. An impulse is only
 *  ever merged after its own tick's kernel step (combat and skills run after `moveActor`)
 *  or between ticks, so it is always integrated by the step of `entry.tick + 1`, whose
 *  `before` is the checkpoint of `entry.tick`. An entry recorded during the tick that has
 *  not stepped past it yet is retained for the next publication rather than mislabelled;
 *  entries the client can no longer place are dropped. */
export function takeMotionDiverts(actor, field) {
  const pending = actor.motionDiverts;
  if (!pending || pending.field !== field) return [];
  const published = [];
  let keep = 0;
  for (const entry of pending.entries) {
    if (field.tick - entry.tick > MAX_DIVERT_AGE_TICKS) continue;
    if (field.tick < entry.tick + 1) {
      pending.entries[keep++] = entry;
      continue;
    }
    published.push({
      tick: entry.tick + 1,
      vx: entry.vx,
      vy: entry.vy,
      source: entry.source,
      before: entry.before,
    });
  }
  pending.entries.length = keep;
  return published;
}

/** Whether an impulse is queued for the step this actor is about to take. The client's
 *  report for that tick extends its pre-impulse trajectory, so adopting it would erase
 *  the divert before the checkpoint that describes it is published. */
export function motionDivertPending(actor, field) {
  const pending = actor.motionDiverts;
  if (!pending || pending.field !== field) return false;
  for (const entry of pending.entries) {
    if (field.tick - entry.tick <= MAX_DIVERT_AGE_TICKS) return true;
  }
  return false;
}

/** Drop any unpublishable divert when the actor leaves its field. */
export function releaseMotionDiverts(actor) {
  actor.motionDiverts = null;
}
