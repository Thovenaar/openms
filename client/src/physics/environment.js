import { coordinate } from "./geometry.js";
const MAX_WATER_AREAS = 4096;

/** 0052b2b5 loads swimArea rectangles; 005983f4 includes occupied edge neighbors. */
export function prepareWaterAreas(map) {
  const source = map.$unrecognized?.swimArea ?? {};
  const entries = Object.values(source);
  if (entries.length > MAX_WATER_AREAS) {
    throw new Error("Unsupported local water area count");
  }
  const output = [];
  for (const entry of entries) {
    const left = coordinate(entry.x1);
    const top = coordinate(entry.y1);
    const right = coordinate(entry.x2);
    const bottom = coordinate(entry.y2);
    if (left > right || top > bottom) {
      throw new Error("Reversed local water area bounds");
    }
    output.push({ left, top, right, bottom });
  }
  return output;
}

/** Mode selection is sampled at the start of the original30ms integration step. */
export function updateEnvironment(sim) {
  sim.movementMode = sim.baseMode;
  if (sim.baseMode !== "air") return;
  const x = Math.trunc(sim.x);
  const y = Math.trunc(sim.y);
  for (const area of sim.waterAreas) {
    if (
      x >= area.left &&
      x <= area.right &&
      y >= area.top &&
      y <= area.bottom
    ) {
      sim.movementMode = "swim";
      return;
    }
  }
}
