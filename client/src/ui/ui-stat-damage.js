import { shownDamageRange } from "../../../shared/combat-formulas.js";

/** UI and combat use the same modern range. The output must be caller-owned. */
export function statDamage(stats, output = stats) {
  return shownDamageRange(stats, output);
}
