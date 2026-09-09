import {
  createDefaultBindings,
  heldActionForCode,
  PHYSICAL_CODES,
} from "./keymap.js";

/** Native pointer focus restores the canvas after browser controls. */
function focusCanvas(event) {
  event.currentTarget.focus({ preventScroll: true });
}

function recompute(context) {
  const input = context.input;
  input.left = false;
  input.right = false;
  input.up = false;
  input.down = false;
  input.jump = context.tappedJump;
  input.attack = context.tappedAttack;
  for (let index = 0; index < PHYSICAL_CODES.length; index++) {
    if (!context.held[index]) continue;
    const action = actionForCode(context, PHYSICAL_CODES[index]);
    if (action) input[action] = true;
  }
}

function actionForCode(context, code) {
  return context.bindings
    ? context.bindings.actionForCode(code)
    : heldActionForCode(code, context.defaults);
}

function press(context, event) {
  if (event.defaultPrevented || event.metaKey) return;
  const index = PHYSICAL_CODES.indexOf(event.code);
  if (index < 0) return;
  const action = actionForCode(context, event.code);
  if (!action) return;
  event.preventDefault();
  if (event.repeat && !context.held[index]) return;
  if (!context.held[index] && !context.input[action]) {
    if (action === "jump") context.input.jumpPressed = true;
    if (action === "up") context.input.upPressed = true;
  }
  context.held[index] = 1;
  recompute(context);
}

function createInputContext() {
  return {
    input: {
      left: false,
      right: false,
      up: false,
      down: false,
      jump: false,
      attack: false,
      jumpPressed: false,
      upPressed: false,
    },
    held: new Uint8Array(PHYSICAL_CODES.length),
    defaults: createDefaultBindings(),
    bindings: null,
    unsubscribe: null,
    tappedJump: false,
    tappedAttack: false,
  };
}

/** Preallocated physical holds preserve modifier aliases until both sides release. */
export function createPlayerInput(canvas) {
  const context = createInputContext();
  function keydown(event) {
    press(context, event);
  }
  function keyup(event) {
    const index = PHYSICAL_CODES.indexOf(event.code);
    if (index < 0) return;
    context.held[index] = 0;
    recompute(context);
  }
  function clear(event) {
    if (event?.type === "visibilitychange" && !globalThis.document?.hidden) {
      return;
    }
    context.held.fill(0);
    context.tappedJump = false;
    context.tappedAttack = false;
    recompute(context);
    context.input.jumpPressed = false;
    context.input.upPressed = false;
  }
  function setBindings(service) {
    context.unsubscribe?.();
    context.bindings = service;
    context.unsubscribe = service ? service.subscribe(clear) : null;
    clear();
  }
  function tap(action) {
    if (action === "jump") {
      context.tappedJump = true;
      context.input.jumpPressed = true;
    } else if (action === "attack") context.tappedAttack = true;
    else throw new TypeError("Only jump and attack have gameplay taps.");
    recompute(context);
  }
  function afterTick() {
    context.input.jumpPressed = false;
    context.input.upPressed = false;
    if (!context.tappedJump && !context.tappedAttack) return;
    context.tappedJump = false;
    context.tappedAttack = false;
    recompute(context);
  }
  function destroy() {
    attachInput(canvas, handlers, false);
    context.unsubscribe?.();
    clear();
  }
  const handlers = { keydown, keyup, clear };
  attachInput(canvas, handlers, true);
  return { state: context.input, clear, setBindings, tap, afterTick, destroy };
}

function attachInput(canvas, handlers, attach) {
  if (attach) {
    canvas.addEventListener("keydown", handlers.keydown);
    window.addEventListener("keyup", handlers.keyup);
    window.addEventListener("blur", handlers.clear);
    canvas.addEventListener("blur", handlers.clear);
    globalThis.document?.addEventListener("visibilitychange", handlers.clear);
    canvas.addEventListener("pointerdown", focusCanvas);
  } else {
    canvas.removeEventListener("keydown", handlers.keydown);
    window.removeEventListener("keyup", handlers.keyup);
    window.removeEventListener("blur", handlers.clear);
    canvas.removeEventListener("blur", handlers.clear);
    globalThis.document?.removeEventListener(
      "visibilitychange",
      handlers.clear,
    );
    canvas.removeEventListener("pointerdown", focusCanvas);
  }
}
