/** Recovered ordinary and strong mob recoil coefficients.
 *
 *  Native `0066b6fc` dispatches the reaction and `009bbdfd`/`009bc2bb` integrate it as a
 *  scalar foothold distance; the ordinary impulse is 130 px/s braking at 400 px/s^2 and the
 *  strong variant is 300/200. `009b1646` maps the scalar distance back onto the supporting
 *  segment with its normalized tangent. The same constants drive the authority's mob step and
 *  the attacker's local prediction, so both produce the same trajectory. */
export const MOB_HIT = Object.freeze({
  velocity: 130,
  deceleration: 40000 / 100,
  strongVelocity: 300,
  strongDeceleration: 20000 / 100,
  minimumMotionMs: 90,
});
