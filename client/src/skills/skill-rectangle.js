/** Authored attack geometry shared by the local-authority combat field and the browser's own
 *  hit presentation. This module owns no simulation state, so the online graph may import it. */

/** Resolve the authored skill rectangle, falling back to its weapon action. */
export function attackRectangle(info, weapon) {
  if (!info.lt || !info.rb) return weapon?.rectangle;
  return {
    left: info.lt.x,
    top: info.lt.y,
    right: info.rb.x,
    bottom: info.rb.y,
  };
}

/**
 * Weapon attack node for an action, else the weapon's ordinary action. Authored WZ:
 * Savage Blow 4201005 names the body pose `savage`, which the equipped dagger
 * (Character.wz:Weapon/01332000.img) authors no attack node for; the weapon's
 * default action rectangle is therefore the admitted melee geometry.
 */
export function actionWeapon(combat, action) {
  return combat?.attacks[action] ?? combat?.attacks[combat?.defaultAction];
}
