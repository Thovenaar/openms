import { expect, test } from "bun:test";
import { GameUI } from "../src/ui/game-ui.js";
import { KeyBindings } from "../src/input/key-bindings.js";
import { ItemUse } from "../src/items/item-use.js";
import { createProfile } from "../src/profile/profile-validation.js";
import { retireBindingLayer } from "../src/ui/ui-icons.js";
import { ProfileStore } from "./fixtures/memory-profile-store.js";
import { beginItemCarry } from "../src/ui/ui-carry.js";

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
  descriptor: {
    url: "/generated/test-item.json",
    sha256: "0".repeat(64),
    bytes: 1,
  },
  info: { slotMax: 100 },
  properties: {},
  spec: { hp: 50 },
};
function fixture() {
  const initial = createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 });
  initial.equipment = [];
  initial.inventory.push({
    uid: "carry-item",
    id: 2000000,
    count: 2,
    slot: 1,
    owner: "",
    flags: 0,
    expiresAt: null,
  });
  const store = ProfileStore.memory(initial, { items: { 2000000: item } });
  const catalog = { ui: { items: { 2000000: item } } };
  const hooks = {
    isBlocked: () => false,
    now: () => 0,
    report() {},
    onAction: () => true,
  };
  const bindings = new KeyBindings(store, catalog, {
    ...hooks,
    itemUse: new ItemUse(store, catalog, hooks),
    saveBindings: (value) => store.commitKeyBindings(value),
  });
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
  const source = carrySource(ui);
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
  return {
    ui,
    bindings,
    get profile() {
      return store.profile;
    },
    store,
    keys,
    quick,
    source,
    capture,
  };
}

function carrySource(ui) {
  return {
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
}

function carryUi(bindings, store, quick, item) {
  const ui = Object.create(GameUI.prototype);
  Object.assign(ui, {
    bindings,
    store,
    controller: new AbortController(),
    epoch: 0,
    windows: new Map(),
    pending: new Map(),
    bindingDrag: null,
    bindingClickPointer: null,
    quickCapture: null,
    keyNotice: null,
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
    return action();
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
  return atElement(element, () =>
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

test("occupied quickslot publishes outside an editor and carries the displaced action for the next placement", async () => {
  const f = fixture();
  const inventory = structuredClone(f.profile.inventory);
  pick(f);
  f.ui.endDrag(pointer(f.capture, { type: "pointerup" }));
  await place(f, f.quick.element, 108, 142);
  expect(f.profile.keyBindings.keys[29]).toEqual({ type: 2, id: 2000000 });
  expect(f.ui.bindingDrag.binding).toEqual({ type: 5, id: 52 });
  f.ui.endDrag(pointer(f.quick.element, { type: "pointerup" }));
  await place(f, f.quick.element, 108, 109);
  expect(f.profile.keyBindings.keys[42]).toEqual({ type: 5, id: 52 });
  expect(f.profile.inventory).toEqual(inventory);
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

test("native item doubleclick consumes through item authority, never placing an intermediate quick binding", async () => {
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
  expect(f.store.profile.hp).toBe(1);
  expect(f.store.profile.inventory[0].count).toBe(2);
  const result = await f.bindings.lastItemUse.pending;
  expect(result.ok).toBe(true);
  expect(f.store.profile.hp).toBe(50);
  expect(f.store.profile.inventory).toEqual([
    {
      uid: "carry-item",
      id: 2000000,
      count: 1,
      slot: 1,
      owner: "",
      flags: 0,
      expiresAt: null,
    },
  ]);
  expect(f.store.profile.keyBindings.keys[29]).toEqual({ type: 5, id: 52 });
  expect(f.ui.cursor.ghost).toBeNull();
  const double = pointer(f.capture, { type: "dblclick" });
  f.ui.captureBindingClick(double);
  expect(double.stopped).toBe(true);
  f.bindings.destroy();
});

test("ground placement releases carry before its quantity dialog and cancellation does not pick it up again", async () => {
  const f = fixture();
  const canvas = {};
  const answer = Promise.withResolvers();
  f.ui.app = { canvas };
  f.ui.prompt = () => answer.promise;
  f.ui.hooks.inventoryActions = () => ({
    drop() {
      throw new Error("Cancelled quantity input must not discard inventory");
    },
  });
  const begin = () =>
    beginItemCarry(f.ui, pointer(f.capture), f.profile.inventory[0], {
      source: f.source,
      path: "item",
    });
  try {
    expect(begin()).toBe(true);
    f.ui.endDrag(pointer(f.capture, { type: "pointerup" }));
    place(f, canvas, 300, 200);
    const next = pointer(canvas);
    expect(f.ui.captureBindingPointer(next)).toBe(false);
    expect(next.defaultPrevented).toBe(false);
    answer.resolve(null);
    await answer.promise;
    await Promise.resolve();
    expect(begin()).toBe(true);
    expect(f.store.profile.inventory[0].count).toBe(2);
  } finally {
    answer.resolve(null);
    f.ui.endBindingDrag();
    f.bindings.destroy();
    await f.store.destroy();
  }
});
