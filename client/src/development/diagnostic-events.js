import { PHYSICAL_CODES } from "../input/keymap.js";

/** Local diagnostic policy, not an original-client input protocol. */
export const NATIVE_EVENT_LIMIT = 8192;
const MAX_PATH = 24;
const MAX_CHILDREN = 4096;
const MAX_TEXT = 8192;
const MAX_SCROLL = 10000000;
const TARGET_FIELDS = ["root", "path", "tag", "label"];
const KEY_FIELDS = ["code", "key", "pointerType"];
const MODIFIERS = [
  "repeat",
  "altKey",
  "ctrlKey",
  "metaKey",
  "shiftKey",
  "isComposing",
];
const POINTER_FIELDS = ["button", "buttons", "pointerId"];
const AXES = ["x", "y"];
const SCROLL_FIELDS = ["scrollTop", "scrollLeft"];
const SELECTION_FIELDS = ["selectionStart", "selectionEnd"];
const OUTSIDE_EVENTS = [
  "pointermove",
  "pointerup",
  "pointercancel",
  "lostpointercapture",
];
const TYPES = [
  "keydown",
  "keyup",
  "mousedown",
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointercancel",
  "pointerenter",
  "pointerleave",
  "pointerover",
  "pointerout",
  "lostpointercapture",
  "click",
  "dblclick",
  "contextmenu",
  "wheel",
  "scroll",
  "input",
  "change",
  "focusin",
  "blur",
  "compositionstart",
  "compositionend",
  "profile-checkpoint",
];
const FIELDS = [
  "type",
  ...TARGET_FIELDS,
  ...KEY_FIELDS,
  ...MODIFIERS,
  ...POINTER_FIELDS,
  "isPrimary",
  ...AXES,
  "value",
  "checked",
  ...SELECTION_FIELDS,
  "detail",
  "keyCode",
  "deltaY",
  ...SCROLL_FIELDS,
  "related",
];

/** Fixed roots only: imports cannot select page chrome, links, files, or agent controls. */
function roots(hooks) {
  const systems = hooks.systems();
  return [
    hooks.canvas,
    systems.ui.host,
    hooks.scene()?.fieldSystems.life.controls.root,
    systems.native?.controls?.root,
    systems.ui.profileControls?.root,
    systems.audio.controls.root,
    document.body,
  ];
}

function targetPath(target, root) {
  const path = [];
  for (let node = target; node !== root; node = node.parentElement) {
    if (!node?.parentElement || path.length === MAX_PATH) {
      throw new Error("Native target exceeds journal depth");
    }
    const children = node.parentElement.children;
    if (children.length > MAX_CHILDREN) {
      throw new Error("Native target exceeds journal width");
    }
    path.push(nativePathPart(node, children));
  }
  return path.reverse();
}

/** Exact sibling labels survive native layer replacement; unlabeled nodes use bounded indices. */
function nativePathPart(node, children) {
  const label = node.getAttribute("aria-label");
  if (label && label.length <= 256) {
    let matches = 0;
    for (const child of children) {
      if (child.getAttribute("aria-label") === label) matches++;
      if (matches > 1) break;
    }
    if (matches === 1) return label;
  }
  return Array.prototype.indexOf.call(children, node);
}

function excluded(target) {
  return Boolean(
    target.closest?.(
      '[aria-label="Game Logs"],[aria-label="Game error notification"],a,input[type="file"],input[type="password"]',
    ),
  );
}

/** Capture only data consumed by ordinary native handlers; no code, selectors, or property dispatch. */
export function captureNativeEvent(event, hooks) {
  let target = event.target;
  if (!(target instanceof Element)) return null;
  const candidates = roots(hooks);
  const root = excluded(target) ? 6 : nativeRootIndex(target, candidates);
  if (root < 0) return null;
  if (root === 6) {
    if (
      !OUTSIDE_EVENTS.includes(event.type) ||
      !ownsNativePointer(hooks.systems().ui)
    ) {
      return null;
    }
    target = candidates[root];
  }
  const value = nativeLocator(target, candidates, root);
  value.type = event.type;
  captureKeyboard(value, event);
  capturePointer(value, event, candidates[root].getBoundingClientRect());
  captureEdit(value, target);
  value.related = relatedLocator(event.relatedTarget, candidates);
  validateNativeEvent(value);
  return value;
}

function ownsNativePointer(ui) {
  return Boolean(
    ui.drag || ui.bindingDrag || Number.isInteger(ui.cursor?.pointerId),
  );
}

function nativeRootIndex(target, candidates) {
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (candidate && (candidate === target || candidate.contains(target))) {
      return index;
    }
  }
  return -1;
}

function nativeLocator(target, candidates, root) {
  return {
    root,
    path: targetPath(target, candidates[root]),
    tag: target.tagName,
    label: target.getAttribute("aria-label") ?? "",
  };
}

function relatedLocator(target, candidates) {
  if (!target) return null;
  if (!(target instanceof Element) || excluded(target)) return "outside";
  const root = nativeRootIndex(target, candidates);
  return root < 0 || root === 6
    ? "outside"
    : nativeLocator(target, candidates, root);
}

function captureKeyboard(value, event) {
  value.code = event.code ?? "";
  value.key = event.key ?? "";
  value.keyCode = event.keyCode ?? 0;
  for (const key of MODIFIERS) value[key] = Boolean(event[key]);
}

function capturePointer(value, event, rect) {
  value.button = event.button ?? 0;
  value.buttons = event.buttons ?? 0;
  value.pointerId = event.pointerId ?? 0;
  value.isPrimary = Boolean(event.isPrimary);
  value.pointerType = event.pointerType ?? "";
  value.detail = event.detail ?? 0;
  value.deltaY = event.deltaY ?? 0;
  value.x = rect.width
    ? ((event.clientX ?? rect.left) - rect.left) / rect.width
    : 0;
  value.y = rect.height
    ? ((event.clientY ?? rect.top) - rect.top) / rect.height
    : 0;
}

function captureEdit(value, target) {
  value.value = target.matches("input,textarea,select") ? target.value : null;
  value.checked = target.matches('input[type="checkbox"],input[type="radio"]')
    ? target.checked
    : null;
  value.selectionStart = target.selectionStart ?? null;
  value.selectionEnd = target.selectionEnd ?? null;
  value.scrollTop = target.scrollTop;
  value.scrollLeft = target.scrollLeft;
}

/** Called after bounded JSON admission, before any scene/UI/input mutation. */
export function validateNativeEvent(value) {
  validateDataFields(value, FIELDS);
  if (!TYPES.includes(value.type)) throw new Error("Invalid native event kind");
  validateNativeLocator(value);
  validateFixedTarget(value);
  validateKeyboard(value);
  validatePointer(value);
  validateEdit(value);
  if (value.related !== null && value.related !== "outside") {
    validateDataFields(value.related, TARGET_FIELDS);
    validateNativeLocator(value.related);
    if (value.related.root === 6) {
      throw new Error(
        "Outside related targets require the fixed outside marker",
      );
    }
  }
}

function validateFixedTarget(value) {
  if (
    value.type === "profile-checkpoint" &&
    (value.root !== 0 || value.path.length)
  ) {
    throw new Error("Native checkpoints require the fixed canvas owner");
  }
  if (
    value.root === 6 &&
    (value.path.length ||
      value.tag !== "BODY" ||
      !OUTSIDE_EVENTS.includes(value.type))
  ) {
    throw new Error(
      "Outside pointer releases require the fixed inert body target",
    );
  }
}
function validateDataFields(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid native event data");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Native event must be plain data");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key))
  ) {
    throw new Error("Unknown native event field");
  }
  for (const key of keys) {
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")) {
      throw new Error("Native event accessors are forbidden");
    }
  }
}

function validateNativeLocator(value) {
  if (!Number.isInteger(value.root) || value.root < 0 || value.root >= 7) {
    throw new Error("Invalid native event root");
  }
  if (
    !Array.isArray(value.path) ||
    value.path.length > MAX_PATH ||
    value.path.some(invalidNativePathPart)
  ) {
    throw new Error("Invalid native target path");
  }
  if (
    typeof value.tag !== "string" ||
    value.tag.length > 256 ||
    typeof value.label !== "string" ||
    value.label.length > 256
  ) {
    throw new Error("Invalid native target identity");
  }
}

function invalidNativePathPart(part) {
  if (typeof part === "string") return !part.length || part.length > 256;
  return !Number.isInteger(part) || part < 0 || part >= MAX_CHILDREN;
}

function validateKeyboard(value) {
  for (const key of KEY_FIELDS) {
    if (typeof value[key] !== "string" || value[key].length > 256) {
      throw new Error("Invalid native event text");
    }
  }
  if (value.code && !PHYSICAL_CODES.includes(value.code)) {
    throw new Error("Unsupported native key code");
  }
  if (
    !Number.isInteger(value.keyCode) ||
    value.keyCode < 0 ||
    value.keyCode > 255
  ) {
    throw new Error("Invalid native legacy key code");
  }
  for (const key of MODIFIERS) {
    if (typeof value[key] !== "boolean") {
      throw new Error("Invalid native modifier");
    }
  }
}

function validatePointer(value) {
  validatePointerCoordinates(value);
  if (typeof value.isPrimary !== "boolean") {
    throw new Error("Invalid native primary pointer flag");
  }
  for (const key of POINTER_FIELDS) {
    if (
      !Number.isSafeInteger(value[key]) ||
      value[key] < -1 ||
      value[key] > 0x7fffffff
    ) {
      throw new Error("Invalid native pointer data");
    }
  }
  if (
    !Number.isInteger(value.detail) ||
    value.detail < 0 ||
    value.detail > MAX_CHILDREN
  ) {
    throw new Error("Invalid native click count");
  }
  if (!Number.isFinite(value.deltaY) || Math.abs(value.deltaY) > MAX_SCROLL) {
    throw new Error("Invalid native wheel displacement");
  }
}

function validatePointerCoordinates(value) {
  for (const key of AXES) {
    if (!Number.isFinite(value[key]) || Math.abs(value[key]) > 64) {
      throw new Error("Invalid native pointer coordinate");
    }
  }
}

function validateEdit(value) {
  if (
    value.value !== null &&
    (typeof value.value !== "string" || value.value.length > MAX_TEXT)
  ) {
    throw new Error("Native edit exceeds text limit");
  }
  if (value.checked !== null && typeof value.checked !== "boolean") {
    throw new Error("Invalid native checkbox value");
  }
  validateSelection(value);
  for (const key of SCROLL_FIELDS) {
    if (!Number.isFinite(value[key]) || Math.abs(value[key]) > MAX_SCROLL) {
      throw new Error("Invalid native scroll offset");
    }
  }
}

function validateSelection(value) {
  for (const key of SELECTION_FIELDS) {
    if (
      value[key] !== null &&
      (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > MAX_TEXT)
    ) {
      throw new Error("Invalid native text selection");
    }
  }
}

/** Labels are data identities inside one owned parent, never imported query selectors. */
function nativePathChild(parent, part) {
  if (!parent) return null;
  const children = parent.children;
  if (children.length > MAX_CHILDREN) {
    throw new Error("Replay native target exceeds the child limit");
  }
  if (typeof part === "number") return children[part];
  let match = null;
  for (const child of children) {
    if (child.getAttribute("aria-label") !== part) continue;
    if (match) {
      throw new Error(
        `Replay diverged: ambiguous native sibling ${JSON.stringify(part)}`,
      );
    }
    match = child;
  }
  return match;
}

function resolveLocator(value, hooks) {
  const root = roots(hooks)[value.root];
  let target = root;
  for (const part of value.path) target = nativePathChild(target, part);
  if (
    !target ||
    target.tagName !== value.tag ||
    (target.getAttribute("aria-label") ?? "") !== value.label ||
    excluded(target)
  ) {
    let cursor = root;
    const observed = value.path.map((index) => {
      cursor = nativePathChild(cursor, index);
      return cursor
        ? `${cursor.tagName} ${JSON.stringify(cursor.getAttribute("aria-label") ?? "")} (${cursor.children.length})`
        : "missing";
    });
    throw new Error(
      `Replay diverged: native target changed at ${value.root}:${value.path.join(".")}; expected ${value.tag} ${JSON.stringify(value.label)}, found ${target?.tagName ?? "missing"}; ancestry ${observed.join(" > ")}`,
    );
  }
  return { root, target };
}

function resolveTarget(value, hooks) {
  const { root, target } = resolveLocator(value, hooks);
  if (value.value !== null && !target.matches("input,textarea,select")) {
    throw new Error("Replay diverged: edit target changed");
  }
  if (
    value.checked !== null &&
    !target.matches('input[type="checkbox"],input[type="radio"]')
  ) {
    throw new Error("Replay diverged: checkbox target changed");
  }
  return { root, target };
}

function resolveRelated(value, hooks) {
  if (value === null) return null;
  if (value === "outside") return document.body;
  return resolveLocator(value, hooks).target;
}

/** Dispatch into the same registered owners as browser input. No profile deltas or generated code. */
export async function replayNativeEvent(value, hooks) {
  const { root, target } = resolveTarget(value, hooks);
  if (value.type === "profile-checkpoint") {
    hooks.systems().hooks.onSave();
    await hooks.settle();
    return { accepted: true };
  }
  const rect = root.getBoundingClientRect();
  const options = {
    ...value,
    bubbles: !["pointerenter", "pointerleave", "scroll"].includes(value.type),
    cancelable: true,
    clientX: rect.left + value.x * rect.width,
    clientY: rect.top + value.y * rect.height,
    relatedTarget: resolveRelated(value.related, hooks),
  };
  if (value.value !== null) target.value = value.value;
  if (value.checked !== null) {
    target.checked = value.type === "click" ? !value.checked : value.checked;
  }
  if (value.selectionStart !== null && target.setSelectionRange) {
    target.setSelectionRange(value.selectionStart, value.selectionEnd);
  }
  if (value.type === "scroll") {
    target.scrollTop = value.scrollTop;
    target.scrollLeft = value.scrollLeft;
  }
  const ui = hooks.systems().ui;
  const previous = ui.commandSignal;
  ui.commandSignal = hooks.signal();
  try {
    dispatchNativeEvent(value, target, options);
  } finally {
    ui.commandSignal = previous;
  }
  await hooks.settle();
  return { accepted: true };
}

function dispatchNativeEvent(value, target, options) {
  if (value.type === "focusin") target.focus({ preventScroll: true });
  else if (value.type === "blur") target.blur();
  else if (value.type.startsWith("key")) {
    dispatchKeyboard(value, target, options);
  } else if (
    value.type.startsWith("pointer") ||
    value.type === "lostpointercapture"
  ) {
    target.dispatchEvent(new PointerEvent(value.type, options));
  } else if (value.type === "wheel") {
    target.dispatchEvent(new WheelEvent(value.type, options));
  } else if (
    ["mousedown", "click", "dblclick", "contextmenu"].includes(value.type)
  ) {
    target.dispatchEvent(new MouseEvent(value.type, options));
  } else target.dispatchEvent(new Event(value.type, options));
}

function dispatchKeyboard(value, target, options) {
  const event = new KeyboardEvent(value.type, options);
  // Legacy IME229 is consumed by the native chat/key paths, even on browsers ignoring init.keyCode.
  if (event.keyCode !== value.keyCode) {
    Object.defineProperty(event, "keyCode", { value: value.keyCode });
  }
  target.dispatchEvent(event);
}

export function listenNativeEvents(handler, signal) {
  for (const type of TYPES) {
    window.addEventListener(type, handler, { capture: true, signal });
  }
}
