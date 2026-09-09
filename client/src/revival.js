export const REVIVAL_POLICY = Object.freeze({
  authority: "original WZ returnMap; Cosmic server-reference ordinary respawn",
  autoConfirmMs: 600000,
  restoredHP: 50,
  mp: "unchanged",
  destination:
    "authored returnMap, portal ID 0; no geometric nearest-town guess",
  experience: "existing offline EXP policy; no invented death penalty",
});

/** ChangeMapHandler105 / Character7565: ordinary death return, not forced-return or cash-item revival. */
export function revivalMap(manifest) {
  const info = manifest.physics.map;
  const id = info.returnMap;
  if (!Number.isSafeInteger(id) || id < 0 || id > 999999999) {
    throw new Error("Original returnMap is unavailable");
  }
  return id === 999999999 ? manifest.id : String(id).padStart(9, "0");
}

/** Native field entry0094969d uses portal feet minus10; server-reference ordinary changeMap chooses portal0. */
export function revivalArrival(manifest) {
  let selected = null;
  for (const portal of manifest.physics.portals) {
    if (portal.id !== 0) continue;
    if (selected) throw new Error("Original revival portal ID 0 is ambiguous");
    selected = portal;
  }
  if (
    !selected ||
    !Number.isFinite(selected.x) ||
    !Number.isFinite(selected.y)
  ) {
    throw new Error("Original revival portal ID 0 is unavailable");
  }
  return { x: selected.x, y: selected.y - 10 };
}
