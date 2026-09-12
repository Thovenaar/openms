import { Graphics } from "pixi.js";

/** Browser inspection rectangles, never collision/damage authority. */
export function rectangleSlot(color) {
  const graphic = new Graphics().rect(0, 0, 1, 1).fill({ color, alpha: 0.18 });
  graphic.eventMode = "none";
  graphic.visible = false;
  return { graphic, active: false, left: 0, top: 0, right: 0, bottom: 0 };
}

/** 00664559 translates the facing body at current/previous actor positions. */
export function placeBody(slot, rectangle, position, mirrored) {
  slot.active = !!rectangle;
  if (!rectangle) return;
  slot.left = position.x + (mirrored ? -rectangle.right : rectangle.left);
  slot.right = position.x + (mirrored ? -rectangle.left : rectangle.right);
  slot.top = position.y + rectangle.top;
  slot.bottom = position.y + rectangle.bottom;
}

/** Original sweep uses the SAME current rectangle at both positions, not previous frame bounds. */
export function sweepBody(target, current, delta) {
  target.active = current.active;
  if (!current.active) return;
  target.left = current.left + Math.min(0, delta.x);
  target.right = current.right + Math.max(0, delta.x);
  target.top = current.top + Math.min(0, delta.y);
  target.bottom = current.bottom + Math.max(0, delta.y);
}

/** Mutate prebuilt unit-rectangle geometry; no Graphics.clear/draw in the hot loop. */
export function showRectangle(slot, visible) {
  const graphic = slot.graphic;
  graphic.visible = visible && slot.active;
  if (!graphic.visible) return;
  graphic.position.set(slot.left, slot.top);
  graphic.scale.set(slot.right - slot.left, slot.bottom - slot.top);
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

/** Authored fh is only a reference; show exact segment, authored cy and horizontal range. */
export function contactGraphic(record, segment) {
  const graphic = new Graphics();
  const a = record.authored;
  if ([a.rx0, a.rx1, a.cy].every(Number.isFinite)) {
    graphic
      .moveTo(a.rx0, a.cy)
      .lineTo(a.rx1, a.cy)
      .stroke({ color: 0xf5b942, width: 1 });
  }
  if (Number.isFinite(a.cy)) {
    graphic
      .moveTo(a.x, a.y)
      .lineTo(a.x, a.cy)
      .stroke({ color: 0xf5b942, width: 1 });
    graphic.circle(a.x, a.cy, 3).fill(0xf5b942);
  }
  if (segment) {
    graphic
      .moveTo(segment.x1, segment.y1)
      .lineTo(segment.x2, segment.y2)
      .stroke({ color: 0x64d8ff, width: 2 });
  }
  graphic.eventMode = "none";
  graphic.visible = false;
  return graphic;
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
