import { airVelocity, floatVelocity } from "./dynamics.js";
import { airContacts } from "./contacts.js";
import { crossingFraction } from "./geometry.js";
import { updateEnvironment } from "./environment.js";

const SECONDS = 0.03;

/**009ba95a: use ordinary air integration, but terminate on the first real contact,
 * rather than letting the projectile become a walking character. No mob collision. */
export function stepBallisticPhysics(sim) {
  if (sim.foothold) return true;
  sim.previousX = sim.x;
  sim.previousY = sim.y;
  const vx = sim.vx;
  const vy = sim.vy;
  updateEnvironment(sim);
  sim.state = sim.movementMode;
  if (sim.movementMode === "air") airVelocity(sim, 0, SECONDS);
  else floatVelocity(sim, 0, 0, SECONDS);
  sim.x += (vx + sim.vx) * SECONDS * 0.5;
  sim.y += (vy + sim.vy) * SECONDS * 0.5;
  const contact = hasBallisticContact(sim);
  airContacts(sim, SECONDS, vx, vy);
  return contact || sim.foothold !== null;
}

/**009b34c8 integer directed sweep and009b3f1b endpoint wedge, shared semantics. */
function hasBallisticContact(sim) {
  for (const segment of sim.geometry.segments) {
    if (
      segment.tx <= 0 &&
      segment.group !== sim.spaceGroup &&
      segment.group !== sim.contactGroup
    ) {
      continue;
    }
    const fraction = crossingFraction(sim, segment);
    if (fraction < 0 || fraction >= 1) continue;
    const x = Math.trunc(sim.previousX);
    const y = Math.trunc(sim.previousY);
    const dx = Math.trunc(sim.x) - x;
    const dy = Math.trunc(sim.y) - y;
    const firstSide = (segment.y1 - y) * dx - (segment.x1 - x) * dy;
    const lastSide = (segment.y2 - y) * dx - (segment.x2 - x) * dy;
    if (firstSide === 0 && !endpointCrosses(segment.prev, segment, sim)) {
      continue;
    }
    if (
      firstSide !== 0 &&
      lastSide === 0 &&
      !endpointCrosses(segment, segment.next, sim)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function sideOf(segment, x, y) {
  return segment.dx * (y - segment.y1) - segment.dy * (x - segment.x1);
}

function endpointCrosses(first, last, sim) {
  if (!first || !last) return false;
  const x = Math.trunc(sim.x);
  const y = Math.trunc(sim.y);
  const convex = sideOf(first, last.x2, last.y2) > 0;
  const firstSide = sideOf(first, x, y) > 0;
  const lastSide = sideOf(last, x, y) > 0;
  return convex ? firstSide && lastSide : firstSide || lastSide;
}
