import { Graphics } from "pixi.js";

/** Browser inspection rectangles, never collision/damage authority. */
export function rectangleSlot(color) {
  const graphic = new Graphics().rect(0, 0, 1, 1).fill({ color, alpha: 0.18 });
  graphic.eventMode = "none";
  graphic.visible = false;
  return { graphic, active: false, left: 0, top: 0, right: 0, bottom: 0 };
}

/** Mutate prebuilt unit-rectangle geometry; no Graphics.clear/draw in the hot loop. */
export function showRectangle(slot, visible) {
  const graphic = slot.graphic;
  graphic.visible = visible && slot.active;
  if (!graphic.visible) return;
  graphic.position.set(slot.left, slot.top);
  graphic.scale.set(slot.right - slot.left, slot.bottom - slot.top);
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
