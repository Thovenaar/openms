/** Original Win32 PtInRect truncates feet and excludes right/bottom boundaries. */
export function portalRectangleContains(portal, pose, halfWidth, halfHeight) {
  const x = Math.trunc(pose.x),
    y = Math.trunc(pose.y);
  return (
    x >= portal.x - halfWidth &&
    x < portal.x + halfWidth &&
    y >= portal.y - halfHeight &&
    y < portal.y + halfHeight
  );
}

/** 0094df9b ->00712ab1: original entry rectangle. */
export function portalEntryContains(portal, pose) {
  return portalRectangleContains(portal, pose, 20, 50);
}

/** 00950555 ->00712c57: nearby reveal uses the wider native rectangle. */
export function portalRevealContains(portal, pose) {
  return portalRectangleContains(portal, pose, 100, 50);
}

/** Region-owned reveal artwork only; no travel, interaction, or motion authority. */
export function updatePortalGraphics(scene, record, desired) {
  if (
    !record.entityId ||
    (record.portal.type !== 10 && record.portal.type !== 11)
  ) {
    return;
  }
  const animation = scene.byId.get(record.entityId);
  if (!animation) {
    record.animation = null;
    record.phase = "hidden";
    return;
  }
  if (record.animation !== animation) {
    record.animation = animation;
    record.phase = "hidden";
    record.desired = false;
    animation.container.visible = false;
  }
  if (desired !== record.desired) {
    record.desired = desired;
    record.phase = desired ? "portalStart" : "portalExit";
    animation.container.visible = true;
    animation.setAction(record.phase, "once");
  }
  if (
    record.phase === "portalStart" &&
    animation.elapsedMs >= animation.current.duration
  ) {
    record.phase = "portalContinue";
    animation.setAction(record.phase);
  } else if (
    record.phase === "portalExit" &&
    animation.elapsedMs >= animation.current.duration
  ) {
    record.phase = "hidden";
    animation.container.visible = false;
  }
}
