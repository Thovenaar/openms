import { attachGround } from "./geometry.js";
import { relocateSimulation } from "./simulation.js";

/** Horizontal casts use the 80px floor tolerance; vertical casts use signed range. */
function legalTeleportFloor(sim, range, floor) {
  if (sim.horizontalInput) return !(Math.abs(floor - sim.y) > 80);
  return !(
    sim.verticalInput * (floor - sim.y) <= 0 || Math.abs(floor - sim.y) > range
  );
}

/** Original00957b74: held directions, horizontal destination floor within80px;
 * vertical destination searches only in requested direction and range. */
export function teleportDestination(sim, range, output) {
  // 00957b74: ordinary skill relocation tests CField+144 bit1.
  if (sim.fieldLimit & 2) return "Teleport is forbidden in this field";
  const dx = sim.horizontalInput;
  const dy = sim.verticalInput;
  if ((!dx && !dy) || sim.state !== "ground") {
    return "Teleport requires ground and a held direction";
  }
  const x = sim.x + dx * range;
  if (x < sim.bounds.left || x > sim.bounds.right) {
    return "Teleport destination is outside the field";
  }
  return findTeleportFloor(sim, range, output, x);
}

/** Select the nearest legal floor, preserving source-order ties and output writes. */
function findTeleportFloor(sim, range, output, x) {
  const y = sim.y + sim.verticalInput * range;
  let selected = null;
  let distance = Infinity;
  for (const segment of sim.geometry.segments) {
    if (segment.dx <= 0 || x < segment.x1 || x > segment.x2) continue;
    const floor = segment.y1 + ((x - segment.x1) * segment.dy) / segment.dx;
    if (!legalTeleportFloor(sim, range, floor)) continue;
    const delta = Math.abs(floor - y);
    if (delta >= distance) continue;
    selected = segment;
    distance = delta;
    output.x = x;
    output.y = floor;
  }
  if (!selected) return "No legal teleport foothold in the requested direction";
  output.foothold = selected;
  return null;
}

/** Reuse the sole relocation reset; attaching restores the exact destination plane. */
export function commitTeleport(sim, destination) {
  relocateSimulation(sim, destination);
  attachGround(sim, destination.foothold);
}
