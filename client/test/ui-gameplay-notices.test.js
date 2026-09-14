import { describe, expect, test } from "bun:test";
import {
  GameplayNoticeLog,
  noticeInkWidth,
} from "../src/ui/ui-gameplay-notices.js";

const font = {
  measureText(text) {
    const width = Array.from(text).length * 10;
    return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width };
  },
};

function noticeQueue() {
  const log = Object.create(GameplayNoticeLog.prototype);
  log.count = 6;
  log.first = 0;
  log.clock = 0;
  log.owner = { hud: { quickSurface: { root: { visible: false } } } };
  log.syncDensity = () => {};
  log.draw = () => {};
  log.canvas = { append() {} };
  log.rows = Array.from({ length: 6 }, () => ({
    text: "",
    context: font,
    accessible: {},
    y: 0,
  }));
  // Raster backing allocation is exercised by Main's real browser surface.
  log.resizeInk = () => {};
  return log;
}

function visibleRows(log) {
  return Array.from({ length: log.count }, (_, index) => {
    const row = log.rows[(log.first + index) % log.count];
    return { text: row.text, y: row.y };
  }).filter((row) => row.text);
}

describe("native gameplay notice admission", () => {
  test("a long record consumes one slot and retains its complete prefix", () => {
    const log = noticeQueue();
    const text = "a".repeat(40) + " " + "b".repeat(40);
    log.appendLine(text, { kind: "simple" });
    log.positionRows();
    expect(visibleRows(log)).toEqual([{ text, y: 70 }]);
    expect(noticeInkWidth(font, text)).toBe(810);
  });
  test("rotates only the oldest record after the six native slots fill", () => {
    const log = noticeQueue();
    for (let index = 0; index < 7; index++) {
      log.appendLine(String(index), { kind: "simple" });
      log.positionRows();
    }
    expect(visibleRows(log)).toEqual([
      { text: "1", y: 0 },
      { text: "2", y: 14 },
      { text: "3", y: 28 },
      { text: "4", y: 42 },
      { text: "5", y: 56 },
      { text: "6", y: 70 },
    ]);
    log.owner.hud.quickSurface.root.visible = true;
    log.update(390);
    expect(visibleRows(log).map((row) => row.y)).toEqual([
      0, 14, 28, 42, 56, 70,
    ]);
  });

  test("ink backing keeps the native right edge and includes left overhang", () => {
    expect(noticeInkWidth(font, "short")).toBe(290);
    const overhangingFont = {
      measureText() {
        return {
          width: 400,
          actualBoundingBoxLeft: 4,
          actualBoundingBoxRight: 406,
        };
      },
    };
    expect(noticeInkWidth(overhangingFont, "record")).toBe(404);
  });
});
