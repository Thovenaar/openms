const KEY_ACTIONS = Object.freeze({
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "up",
  KeyW: "up",
  ArrowDown: "down",
  KeyS: "down",
  Space: "jump",
  KeyX: "attack",
  ControlLeft: "attack",
});

/** Real keyboard state is preallocated; aliases remain held until both keys release. */
export function createPlayerInput(canvas) {
  const input = {
    left: false,
    right: false,
    up: false,
    down: false,
    jump: false,
    attack: false,
    jumpPressed: false,
  };
  const keys = Object.keys(KEY_ACTIONS);
  const held = new Uint8Array(keys.length);
  function recompute() {
    input.left = false;
    input.right = false;
    input.up = false;
    input.down = false;
    input.jump = false;
    input.attack = false;
    for (let index = 0; index < keys.length; index++) {
      if (held[index]) input[KEY_ACTIONS[keys[index]]] = true;
    }
  }
  function keydown(event) {
    const index = keys.indexOf(event.code);
    if (index < 0) return;
    event.preventDefault();
    if (KEY_ACTIONS[event.code] === "jump" && !held[index] && !input.jump) {
      input.jumpPressed = true;
    }
    held[index] = 1;
    recompute();
  }
  function keyup(event) {
    const index = keys.indexOf(event.code);
    if (index < 0) return;
    held[index] = 0;
    recompute();
  }
  function clear() {
    held.fill(0);
    recompute();
    input.jumpPressed = false;
  }
  canvas.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", clear);
  canvas.addEventListener("blur", clear);
  function destroy() {
    canvas.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", clear);
    canvas.removeEventListener("blur", clear);
    clear();
  }
  return { state: input, clear, destroy };
}
