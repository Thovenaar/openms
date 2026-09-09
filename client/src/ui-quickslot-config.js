import { keyIndexForCode } from "./keymap.js";

/** 0072df19 origins; 0072cc05 controls1000..1007, OK1 and Cancel2. */
const POSITIONS = Array.from({ length: 8 }, (_, slot) => ({
  x: 65 + 35 * (slot % 4),
  y: 113 + 34 * Math.floor(slot / 4),
}));

export function layoutQuickSlotConfig(panel) {
  panel.image("KeyConfig/quickslotConfig/backgrnd", 0, 0);
  panel.captureFooter = null;
  panel.element.tabIndex = -1;
  panel.element.setAttribute("role", "dialog");
  panel.element.setAttribute("aria-modal", "true");
  panel.captureControls = POSITIONS.map((point, slot) =>
    panel.button("KeyConfig/quickslotConfig/BtQuickSetting", point.x, point.y, {
      label: `Choose physical key for quick slot ${slot + 1}`,
      action: () => selectControl(panel, slot),
    }),
  );
  panel.captureOK = panel.button("BtOK", 157, 208, {
    label: "OK",
    action: () => panel.owner.close("QuickSlotConfig", true),
  });
  panel.captureCancel = panel.button("BtCancel2", 210, 208, {
    label: "Cancel",
    action: () => panel.owner.close("QuickSlotConfig"),
  });
  // 0072d0b8: leaving the eight-box rectangle clears capture focus, not the draft.
  panel.listen(panel.element, "pointermove", (event) => {
    const point = panel.owner.logicalPointer(event);
    const x = point.x - panel.x,
      y = point.y - panel.y;
    if (
      (panel.owner.quickCapture >= 0 || panel.captureFooter !== null) &&
      (x < 65 || x >= 202 || y < 113 || y >= 177)
    ) {
      selectControl(panel, -1);
    }
  });
  refreshQuickSlotConfig(panel);
}

function selectControl(panel, slot, footer = null) {
  panel.owner.quickCapture = slot;
  panel.captureFooter = footer;
  refreshQuickSlotConfig(panel);
}

export function refreshQuickSlotConfig(panel) {
  if (!panel || panel.disposed) return;
  const keys = panel.owner.bindings.active.quickSlots;
  let changed = !panel.captureKeys;
  for (let i = 0; !changed && i < 8; i++) {
    changed = panel.captureKeys[i] !== keys[i];
  }
  if (changed) {
    panel.captureKeys = keys.slice();
    panel.captureLabels?.destroy();
    const layer = panel.layer("Quick-slot physical keys");
    panel.captureLabels = layer;
    for (let slot = 0; slot < 8; slot++) {
      const point = POSITIONS[slot];
      layer.image(
        `KeyConfig/quickslotConfig/key/${keys[slot]}`,
        point.x + 2,
        point.y + 2,
      );
    }
  }
  for (let slot = 0; slot < 8; slot++) {
    const control = panel.captureControls[slot];
    control.focused = panel.owner.quickCapture === slot;
    control.element.setAttribute("aria-pressed", String(control.focused));
    control.render();
  }
  panel.captureOK.focused = panel.captureFooter === 0;
  panel.captureCancel.focused = panel.captureFooter === 1;
  panel.captureOK.render();
  panel.captureCancel.render();
}

export function closeQuickSlotConfig(owner, committed) {
  if (!committed) {
    for (let i = owner.quickCaptureChanges.length - 1; i >= 0; i--) {
      const change = owner.quickCaptureChanges[i];
      owner.bindings.setQuickSlot(change.slot, change.previous);
    }
  }
  owner.quickCaptureChanges = [];
  owner.quickCapture = null;
}

/** 0072ce91 +0072ddb3/de13/de7b: two focus groups, not eight sequential capture steps. */
export function captureQuickKey(owner, event) {
  if (owner.quickCapture === null) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  const panel = owner.windows.get("QuickSlotConfig");
  if (event.key === "Escape") {
    if (panel && (owner.quickCapture >= 0 || panel.captureFooter !== null)) {
      selectControl(panel, -1);
      panel.element.focus({ preventScroll: true });
    } else owner.close("QuickSlotConfig");
    return true;
  }
  if (!panel) return true;
  if (event.key === "Enter") {
    owner.close("QuickSlotConfig", true);
    return true;
  }
  if (captureFocusKey(owner, panel, event)) return true;
  captureSlotKey(owner, panel, event);
  return true;
}

function captureFocusKey(owner, panel, event) {
  if (event.key === "Tab") {
    const grid = owner.quickCapture < 0;
    const control = grid ? panel.captureControls[0] : panel.captureOK;
    control.element.focus();
    selectControl(panel, grid ? 0 : -1, grid ? null : 0);
    return true;
  }
  if (panel.captureFooter !== null) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const footer = event.key === "ArrowLeft" ? 0 : 1;
      (footer === 0 ? panel.captureOK : panel.captureCancel).element.focus();
      selectControl(panel, -1, footer);
    }
    return true;
  }
  return false;
}

function captureSlotKey(owner, panel, event) {
  const slot = owner.quickCapture;
  if (slot < 0 || navigateGrid(panel, slot, event.key)) return;
  const index = keyIndexForCode(event.code);
  const previous = owner.bindings.active.quickSlots[slot];
  if (index < 0 || previous === index) return true;
  if (!owner.bindings.setQuickSlot(slot, index)) {
    owner.status(
      "This physical key cannot be selected or already belongs to another quick slot.",
    );
    return true;
  }
  owner.quickCaptureChanges.push({ slot, previous });
  // 0072df55 updates the selected slot without ending its capture focus.
  refreshQuickSlotConfig(panel);
  return true;
}

function navigateGrid(panel, slot, key) {
  let next = slot;
  if (key === "ArrowLeft" && slot % 4 !== 0) next--;
  if (key === "ArrowRight" && slot % 4 !== 3) next++;
  if (key === "ArrowUp" && slot >= 4) next -= 4;
  if (key === "ArrowDown" && slot < 4) next += 4;
  if (!key.startsWith("Arrow")) return false;
  if (next !== slot) {
    panel.captureControls[next].element.focus();
    selectControl(panel, next);
  }
  return true;
}
