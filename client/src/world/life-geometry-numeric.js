/** 00664559 translates the facing body at current/previous actor positions. */
export function placeBody(slot, rectangle, position, mirrored) {
  slot.active = !!rectangle;
  if (!rectangle) return;
  slot.left = position.x + (mirrored ? -rectangle.right : rectangle.left);
  slot.right = position.x + (mirrored ? -rectangle.left : rectangle.right);
  slot.top = position.y + rectangle.top;
  slot.bottom = position.y + rectangle.bottom;
}

/** Original sweep uses the SAME current rectangle at both positions. */
export function sweepBody(target, current, delta) {
  target.active = current.active;
  if (!current.active) return;
  target.left = current.left + Math.min(0, delta.x);
  target.right = current.right + Math.max(0, delta.x);
  target.top = current.top + Math.min(0, delta.y);
  target.bottom = current.bottom + Math.max(0, delta.y);
}

export function containsPoint(slot, point) {
  return (
    slot.active &&
    point.x >= slot.left &&
    point.x <= slot.right &&
    point.y >= slot.top &&
    point.y <= slot.bottom
  );
}

/** 006dd584..006dd6f0 defaults each absent dc edge; 006d3fde never mirrors it. */
export function npcRectangle(info) {
  const rectangle = {
    left: info.dcLeft ?? -22,
    top: info.dcTop ?? -65,
    right: info.dcRight ?? 22,
    bottom: info.dcBottom ?? 0,
  };
  if (!Object.values(rectangle).every(Number.isSafeInteger)) {
    throw new Error("Invalid authored NPC interaction rectangle");
  }
  if (rectangle.left > rectangle.right || rectangle.top > rectangle.bottom) {
    throw new Error("Inverted authored NPC interaction rectangle");
  }
  return rectangle;
}
