import {
  attachGround,
  detachGround,
} from "../../client/src/physics/geometry.js";
import { releaseLadder } from "../../client/src/physics/ladders.js";

/** Binary64 projection tolerance, not permission to move a report to nearby terrain. */
const CONTACT_EPSILON = 0.000001;

function supportsMotion(segment, sim) {
  if (segment.tx <= 0) return false;
  const dx = sim.x - segment.x1;
  const dy = sim.y - segment.y1;
  const distance = dx * segment.tx + dy * segment.ty;
  const normal = dx * segment.ty - dy * segment.tx;
  const velocity = sim.vx * segment.ty - sim.vy * segment.tx;
  return (
    distance >= -CONTACT_EPSILON &&
    distance <= segment.length + CONTACT_EPSILON &&
    Math.abs(normal) <= CONTACT_EPSILON &&
    Math.abs(velocity) <= CONTACT_EPSILON
  );
}

/** Retain matching contact cheaply; only a contact change searches validated geometry. */
function supportingGround(sim) {
  if (sim.foothold && supportsMotion(sim.foothold, sim)) return sim.foothold;
  for (const segment of sim.geometry.segments) {
    if (segment.id === sim.ignoredFootholdId) continue;
    if (supportsMotion(segment, sim)) return segment;
  }
  return null;
}

function retainsLadder(sim) {
  const ladder = sim.ladder;
  return (
    ladder &&
    Math.abs(sim.x - ladder.x) <= CONTACT_EPSILON &&
    sim.y >= ladder.y1 &&
    sim.y <= ladder.y2 &&
    Math.abs(sim.vx) <= CONTACT_EPSILON &&
    Math.abs(sim.vy) <= CONTACT_EPSILON
  );
}

/** Adopt an already admitted report and align contacts without changing its trajectory.
 * A delayed report can cross multiple footholds or leave a ladder. Keeping the old
 * contact would project it back there on the next kernel step and fabricate a fault.
 * Ground contact must contain the actual point and velocity; no nearest-floor snap.
 */
export function adoptMotion(sim, motion) {
  const dx = motion.x - sim.x;
  const dy = motion.y - sim.y;
  sim.x = motion.x;
  sim.y = motion.y;
  sim.previousX += dx;
  sim.previousY += dy;
  sim.vx = motion.vx;
  sim.vy = motion.vy;
  if (retainsLadder(sim)) return;
  if (sim.ladder) releaseLadder(sim);
  const ground = supportingGround(sim);
  if (ground) attachGround(sim, ground);
  else if (sim.foothold) detachGround(sim);
}
