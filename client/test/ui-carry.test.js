import { expect, test } from "bun:test";
import { Container, Texture } from "pixi.js";
import { GameUI } from "../src/game-ui.js";
import { KeyBindings } from "../src/key-bindings.js";
import { createProfile } from "../src/profile-validation.js";
import { UICursor } from "../src/ui-cursor.js";
import { EntityAnimation } from "../src/animation.js";
import { retireBindingLayer } from "../src/ui-icons.js";

function pointer(target, values = {}) {
  return {
    target,
    currentTarget: target,
    pointerId: 7,
    pointerType: "mouse",
    type: "pointerdown",
    button: 0,
    clientX: 12,
    clientY: 12,
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
    ...values,
  };
}

function surface() {
  const element = {
    contains(hit) {
      return hit === this;
    },
    setAttribute() {},
  };
  return { element, root: { visible: true }, x: 0, y: 0 };
}

const item = {
  id: 2000000,
  category: "Consume",
  iconPath: "item",
  info: {},
  properties: {},
  spec: { hp: 50 },
};
function fixture() {
  const profile = createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 });
  profile.inventory.push({ id: 2000000, count: 2 });
  const store = {
    profile,
    subscribe: () => () => {},
    markDirty() {},
    flush: async () => {},
  };
  const bindings = new KeyBindings(
    store,
    { ui: { items: { 2000000: item } } },
    {
      isBlocked: () => false,
      now: () => 0,
      report() {},
      onAction: () => true,
    },
  );
  const keys = {
    ...surface(),
    name: "KeyConfig",
    keysReady: true,
    keyTargets: [
      { index: 29, x: 10, y: 10 },
      { index: 30, x: 50, y: 10 },
    ],
  };
  const quick = { ...surface(), x: 100, y: 100 };
  const ui = carryUi(bindings, store, quick, item);
  const source = {
    owner: ui,
    root: { visible: true },
    element: {},
    entities: new Map([
      ["item", {}],
      ["KeyConfig/icon/52", {}],
      ["KeyConfig/icon/53", {}],
    ]),
    destroy() {
      this.disposed = true;
    },
  };
  quick.keyLayer = source;
  quick.iconLayer = source;
  const capture = {
    held: true,
    hasPointerCapture: () => capture.held,
    releasePointerCapture() {
      capture.held = false;
      ui.onCaptureLost({ pointerId: 7 });
    },
  };
  return { ui, bindings, profile, store, keys, quick, source, capture };
}

function carryUi(bindings, store, quick, item) {
  const ui = Object.create(GameUI.prototype);
  Object.assign(ui, {
    bindings,
    store,
    windows: new Map(),
    pending: new Map(),
    bindingDrag: null,
    bindingClickPointer: null,
    quickCapture: null,
    drag: null,
    pointerPoint: {},
    index: { items: { 2000000: item }, skills: {} },
    screenScaleX: 1,
    screenScaleY: 1,
    host: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    hud: { ...surface(), quickSurface: quick },
    tooltip: { hidden: true },
    hooks: { clearInput() {} },
    cursor: {
      ghost: null,
      surface: { root: { visible: true } },
      drag() {
        this.ghost = {};
      },
      clearGhost() {
        this.ghost = null;
      },
      move() {},
      release() {},
    },
  });
  return ui;
}

function atElement(element, action) {
  const previous = globalThis.document;
  globalThis.document = { elementFromPoint: () => element };
  try {
    action();
  } finally {
    globalThis.document = previous;
  }
}

function pick(
  f,
  binding = { type: 2, id: 2000000 },
  index = null,
  path = "item",
) {
  expect(
    f.ui.beginBindingDrag(pointer(f.capture), binding, index, {
      source: f.source,
      path,
    }),
  ).toBe(true);
}

function place(f, element, x, y) {
  const down = pointer(element, { clientX: x, clientY: y });
  f.ui.captureBindingPointer(down);
  expect(down.stopped).toBe(true);
  atElement(element, () =>
    f.ui.onBindingMouseDown(
      pointer(element, {
        pointerId: undefined,
        type: "mousedown",
        detail: 1,
        clientX: x,
        clientY: y,
      }),
    ),
  );
}

test("pickup survives release and implicit capture loss; later down moves the binding without row activation", () => {
  const f = fixture();
  f.bindings.beginEdit();
  f.ui.windows.set("KeyConfig", f.keys);
  pick(f, { type: 5, id: 52 }, 29, "KeyConfig/icon/52");
  f.ui.endDrag(pointer(f.capture, { type: "pointerup" }));
  expect(f.capture.held).toBe(false);
  expect(f.bindings.actionForCode("ControlLeft")).toBe("attack");
  expect(f.ui.cursor.ghost).not.toBeNull();
  const click = pointer(f.capture, { type: "click" });
  f.ui.captureBindingClick(click);
  expect(click.stopped).toBe(true);
  retireBindingLayer(f.source);
  expect(f.source.disposed).not.toBe(true);
  place(f, f.keys.element, 52, 12);
  expect(f.bindings.actionForCode("ControlLeft")).toBeNull();
  expect(f.bindings.actionForCode("KeyA")).toBe("attack");
  expect(f.source.disposed).toBe(true);
  expect(f.ui.cursor.ghost).toBeNull();
  const placedClick = pointer(f.keys.element, { type: "click" });
  f.ui.captureBindingClick(placedClick);
  expect(placedClick.stopped).toBe(true);
  f.bindings.destroy();
});

test("release over another key is not held-drop; invalid later down cancels without source removal", () => {
  const f = fixture();
  f.bindings.beginEdit();
  f.ui.windows.set("KeyConfig", f.keys);
  pick(f, { type: 5, id: 52 }, 29, "KeyConfig/icon/52");
  f.ui.endDrag(pointer(f.keys.element, { type: "pointerup", clientX: 52 }));
  expect(f.bindings.actionForCode("KeyA")).toBeNull();
  expect(f.ui.cursor.ghost).not.toBeNull();
  place(f, {}, 500, 500);
  expect(f.ui.cursor.ghost).toBeNull();
  expect(f.bindings.actionForCode("ControlLeft")).toBe("attack");
  f.bindings.destroy();
});

test("placing a carried assignment in the palette removes it rather than activating it", () => {
  const f = fixture();
  f.bindings.beginEdit();
  f.ui.windows.set("KeyConfig", f.keys);
  pick(f, { type: 5, id: 52 }, 29, "KeyConfig/icon/52");
  f.ui.endDrag(pointer(f.capture, { type: "pointerup" }));
  place(f, f.keys.element, 10, 268);
  expect(f.bindings.actionForCode("ControlLeft")).toBeNull();
  expect(f.ui.bindingDrag).toBeNull();
  expect(f.profile.keyBindings.keys[29]).toEqual({ type: 5, id: 52 });
  f.bindings.destroy();
});

test("occupied quickslot publishes outside an editor and carries the displaced action for the next placement", () => {
  const f = fixture();
  pick(f);
  f.ui.endDrag(pointer(f.capture, { type: "pointerup" }));
  place(f, f.quick.element, 108, 142);
  expect(f.profile.keyBindings.keys[29]).toEqual({ type: 2, id: 2000000 });
  expect(f.ui.bindingDrag.binding).toEqual({ type: 5, id: 52 });
  expect(f.bindings.editing).toBe(false);
  f.ui.endDrag(pointer(f.quick.element, { type: "pointerup" }));
  place(f, f.quick.element, 108, 109);
  expect(f.profile.keyBindings.keys[42]).toEqual({ type: 5, id: 52 });
  expect(f.profile.inventory).toEqual([{ id: 2000000, count: 2 }]);
  expect(f.ui.bindingDrag).toBeNull();
  f.bindings.destroy();
});

test("another pointer cannot release or place the carry; modal and lifecycle cancellation release its icon", () => {
  for (const boundary of ["blur", "pointercancel", "Escape", "map", "modal"]) {
    const f = fixture();
    pick(f);
    f.ui.endDrag(pointer(f.capture, { type: "pointerup", pointerId: 8 }));
    f.ui.captureBindingPointer(pointer(f.quick.element, { pointerId: 8 }));
    expect(f.capture.held).toBe(true);
    expect(f.ui.cursor.ghost).not.toBeNull();
    if (boundary === "Escape") {
      f.ui.capturePriorityKey(pointer(f.capture, { key: "Escape" }), null);
    } else if (boundary === "map") f.ui.setScene({});
    else if (boundary === "modal") {
      f.ui.windows.set("UtilDlgEx", { ...surface(), name: "UtilDlgEx" });
      f.ui.syncModalState();
    } else f.ui.endDrag(pointer(f.capture, { type: boundary }));
    expect(f.capture.held).toBe(false);
    expect(f.ui.cursor.ghost).toBeNull();
    expect(f.profile.keyBindings.keys[29]).toEqual({ type: 5, id: 52 });
    f.bindings.destroy();
  }
});

test("native item doubleclick consumes through item authority, never placing an intermediate quick binding", () => {
  const f = fixture();
  f.profile.hp = 1;
  pick(f);
  f.ui.endDrag(pointer(f.capture, { type: "pointerup" }));
  f.ui.captureBindingPointer(pointer(f.quick.element));
  f.ui.onBindingMouseDown(
    pointer(f.quick.element, {
      type: "mousedown",
      pointerId: undefined,
      detail: 2,
    }),
  );
  expect(f.profile.hp).toBe(50);
  expect(f.profile.inventory).toEqual([{ id: 2000000, count: 1 }]);
  expect(f.profile.keyBindings.keys[29]).toEqual({ type: 5, id: 52 });
  expect(f.ui.cursor.ghost).toBeNull();
  const double = pointer(f.capture, { type: "dblclick" });
  f.ui.captureBindingClick(double);
  expect(double.stopped).toBe(true);
  f.bindings.destroy();
});

function animatedEntity() {
  return {
    id: "icon",
    kind: "ui",
    x: 0,
    y: 0,
    z: 99,
    action: "default",
    actions: {
      default: [
        { delay: 50, parts: [{ texture: "pixel", x: 0, y: 0, z: 0 }] },
        { delay: 50, parts: [{ texture: "pixel", x: 3, y: 0, z: 0 }] },
      ],
    },
  };
}

test("animated carry stays below the visible original cursor even when Pixi sorts children", () => {
  const entity = animatedEntity();
  const resource = { textures: new Map([["pixel", Texture.WHITE]]) };
  const root = new Container({ sortableChildren: true });
  const states = Array.from({ length: 13 }, () => {
    const sprite = new EntityAnimation(entity, resource.textures);
    sprite.container.zIndex = 0;
    sprite.container.visible = false;
    root.addChild(sprite.container);
    return sprite;
  });
  const cursor = Object.assign(Object.create(UICursor.prototype), {
    owner: { bindingDrag: null },
    surface: { root },
    states,
    current: 0,
    fallback: 0,
    ghost: null,
    pointerId: null,
    worldTarget: false,
  });
  states[0].container.visible = true;
  cursor.set(4);
  cursor.press({ pointerId: 7 });
  cursor.owner.bindingDrag = { pointerId: 7 };
  cursor.drag(
    { entities: new Map([["icon", entity]]), sources: new Map(), resource },
    "icon",
  );
  root.sortChildren();
  expect(root.children.indexOf(cursor.ghost.container)).toBeLessThan(
    root.children.indexOf(states[11].container),
  );
  cursor.update(60);
  expect(cursor.ghost.sprites[0].x).toBe(3);
  expect(states[11].sprites[0].x).toBe(3);
  cursor.owner.bindingDrag = null;
  cursor.release({ pointerId: 7 });
  cursor.clearGhost();
  expect(cursor.current).toBe(4);
  root.destroy({ children: true });
});
