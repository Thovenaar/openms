import { expect, test } from "bun:test";
import { UISurface } from "../src/ui/ui-surface.js";

function artwork() {
  return {
    container: {
      scale: {
        set(x, y) {
          this.x = x;
          this.y = y;
        },
      },
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
    },
  };
}

function buttonPanel() {
  const asset = (width, height, x = 0, y = 0) => ({
    width,
    height,
    origin: { x, y },
  });
  return {
    controls: [],
    assets: {
      "Button/normal/0": asset(47, 18),
      "Button/mouseOver/0": asset(47, 18),
      "Button/mouseOver/1": asset(55, 20, 2, 1),
      "Button/pressed/0": asset(47, 18),
      "Button/keyFocused/0": asset(41, 20, 1, 1),
    },
    stateImage: artwork,
    listen() {},
    element: { append() {} },
  };
}

test("focus art and hit plane encompass later state frames after repositioning", () => {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => ({ style: {}, dataset: {}, setAttribute() {} }),
  };
  try {
    const panel = buttonPanel();
    const button = UISurface.prototype.button.call(panel, "Button", 100, 40, {
      label: "OK",
    });
    button.position(200, 80);
    expect(button.element.style.left).toBe("198px");
    expect(button.element.style.top).toBe("79px");
    expect(button.element.style.cssText).toContain("width:55px;height:20px");
    const focus = button.states.keyFocused;
    const left = focus.x - focus.container.scale.x;
    const top = focus.y - focus.container.scale.y;
    expect(left).toBeCloseTo(197);
    expect(top).toBeCloseTo(78);
    expect(left + 41 * focus.container.scale.x).toBeCloseTo(254);
    expect(top + 20 * focus.container.scale.y).toBeCloseTo(100);
    button.focused = true;
    button.hover = true;
    button.render();
    expect(button.states.keyFocused.container.visible).toBe(true);
    expect(button.states.mouseOver.container.visible).toBe(true);
  } finally {
    globalThis.document = previous;
  }
});
