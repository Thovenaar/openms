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
const KEYS = Object.freeze(Object.keys(KEY_ACTIONS));

function recompute(input, held) {
  input.left = false;
  input.right = false;
  input.up = false;
  input.down = false;
  input.jump = false;
  input.attack = false;
  for (let index = 0; index < KEYS.length; index++) {
    if (held[index]) input[KEY_ACTIONS[KEYS[index]]] = true;
  }
}

/** Native pointer focus restores the canvas after browser controls. */
function focusCanvas(event) {
  event.currentTarget.focus({ preventScroll: true });
}

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
    upPressed: false,
  };
  const held = new Uint8Array(KEYS.length);
  function keydown(event) {
    if (event.defaultPrevented) return;
    const index = KEYS.indexOf(event.code);
    if (index < 0) return;
    event.preventDefault();
    if (event.repeat && !held[index]) return;
    const action = KEY_ACTIONS[event.code];
    if (!held[index] && !input[action]) {
      if (action === "jump") input.jumpPressed = true;
      if (action === "up") input.upPressed = true;
    }
    held[index] = 1;
    recompute(input, held);
  }
  function keyup(event) {
    const index = KEYS.indexOf(event.code);
    if (index < 0) return;
    held[index] = 0;
    recompute(input, held);
  }
  function clear() {
    held.fill(0);
    recompute(input, held);
    input.jumpPressed = false;
    input.upPressed = false;
  }
  canvas.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", clear);
  canvas.addEventListener("blur", clear);
  canvas.addEventListener("pointerdown", focusCanvas);
  function destroy() {
    canvas.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", clear);
    canvas.removeEventListener("blur", clear);
    canvas.removeEventListener("pointerdown", focusCanvas);
    clear();
  }
  return { state: input, clear, destroy };
}
