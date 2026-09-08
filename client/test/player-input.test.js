import { test, expect } from "bun:test";
import { createPlayerInput } from "../src/player-input.js";

function key(target, type, code, repeat = false) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, repeat });
  target.dispatchEvent(event);
}

/** Native EventTargets exercise the keyboard boundary without a renderer or fake timing. */
function withInput(run) {
  const previous = globalThis.window;
  const windowTarget = new EventTarget();
  globalThis.window = windowTarget;
  const canvas = new EventTarget();
  const input = createPlayerInput(canvas);
  try {
    run(input, canvas, windowTarget);
  } finally {
    input.destroy();
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

test("Up tap survives keyup before the next gameplay update", () => {
  withInput((input, canvas, windowTarget) => {
    key(canvas, "keydown", "ArrowUp");
    key(windowTarget, "keyup", "ArrowUp");
    expect(input.state.up).toBe(false);
    expect(input.state.upPressed).toBe(true);
    input.clear();
    expect(input.state.upPressed).toBe(false);
  });
});

test("focus or map clearing does not rearm held keys on OS repeat", () => {
  withInput((input, canvas, windowTarget) => {
    key(canvas, "keydown", "ArrowUp");
    input.clear();
    key(canvas, "keydown", "ArrowUp", true);
    expect(input.state.up).toBe(false);
    expect(input.state.upPressed).toBe(false);
    key(windowTarget, "keyup", "ArrowUp");
    key(canvas, "keydown", "ArrowUp");
    expect(input.state.up).toBe(true);
    expect(input.state.upPressed).toBe(true);
  });
});
