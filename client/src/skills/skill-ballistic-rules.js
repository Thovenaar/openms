// Original 00500971/0095bedf: charge clamps to30..1000ms; 00766157 accepts
// knuckle(48) and bare-hand(39) for both Corkscrews. Grenades consume no ammunition.
const CORKSCREW = Object.freeze({
  kind: "charge",
  ballistic: true,
  chargeMs: 1000,
  weapons: Object.freeze([39, 48]),
  grounded: true,
});
const BOMB = Object.freeze({ kind: "charge", ballistic: true, chargeMs: 1000 });
export const BALLISTIC_SKILLS = new Map([
  [5101004, CORKSCREW],
  [15101003, CORKSCREW],
  [5201002, BOMB],
  [14111006, BOMB],
]);

export function ballisticCharge(chargeMs) {
  if (!Number.isFinite(chargeMs)) {
    throw new Error("Invalid ballistic charge duration");
  }
  return Math.max(30, Math.min(1000, Math.trunc(chargeMs)));
}

/**00942150: trunc(heldMilliseconds * double00af0e10(.001) *00af82c0(600)). */
export function ballisticImpulse(chargeMs) {
  return Math.trunc(ballisticCharge(chargeMs) * 0.001 * 600);
}

//00952f25..00953008: fixed authored displacement, NOT a charge-scaled dash.
export const CORKSCREW_DELTAS = Object.freeze([
  109, 0, 9, 0, 6, 0, 4, 0, 2, 0, 0,
]);
export const CORKSCREW_DURATIONS = Object.freeze([
  30, 90, 30, 90, 30, 90, 30, 90, 30, 90, 1200,
]);
