import {
  KEY_COORDINATES,
  ACTION_PALETTE,
  canonicalKeyIndex,
} from "./keymap.js";
import { replaceIcons, drawItemCount, retireBindingLayer } from "./ui-icons.js";

export function layoutKeys(panel) {
  const bindings = panel.owner.bindings;
  if (!bindings) throw new Error("Key binding service is not attached");
  bindings.beginEdit();
  panel.keyTargets = KEY_COORDINATES.filter(
    (key) => key.x !== 0 || key.y !== 0,
  );
  panel.keySaveControl = panel.button("KeyConfig/BtOK", 8, 236, {
    label: "Save key configuration",
    action: () => saveKeys(panel),
  });
  panel.keyCancelControl = panel.button("KeyConfig/BtCancel", 58, 236, {
    label: "Cancel key configuration",
    action: () => cancelKeys(panel),
  });
  panel.keyDefaultControl = panel.button("KeyConfig/BtDefault", 112, 236, {
    label: "Restore default keys",
    action: () => defaultKeys(panel),
  });
  panel.keyDeleteControl = panel.button("KeyConfig/BtDelete", 177, 236, {
    label: "Delete all key assignments",
    action: () => clearKeys(panel),
  });
  panel.keyQuickControl = panel.button("KeyConfig/BtQuickSlot", 260, 236, {
    label: "Configure quick-slot keys",
    action: () => panel.owner.openQuickSlotCapture(),
  });
  panel.keyState = panel.text("", 368, 238, 245);
  panel.keyState.setAttribute("aria-live", "polite");
  panel.keysReady = true;
  refreshKeys(panel);
}

function refreshKeyState(panel) {
  const bindings = panel.owner.bindings;
  const busy = bindings.saving || panel.owner.store.profileTransactionPending;
  const text = busy
    ? "Saving…"
    : bindings.hasChanges()
      ? "Unsaved live preview"
      : "Saved";
  if (panel.keyState.textContent !== text) panel.keyState.textContent = text;
  for (const control of [
    panel.keySaveControl,
    panel.keyCancelControl,
    panel.keyDefaultControl,
    panel.keyDeleteControl,
    panel.keyQuickControl,
  ]) {
    control.setDisabled(busy || Boolean(panel.owner.keyNotice));
  }
}

export function refreshKeys(panel) {
  if (!panel?.keysReady || panel.disposed) return;
  refreshKeyState(panel);
  const active = panel.owner.bindings.active;
  const inventory = panel.owner.store?.profile?.inventory || [];
  const signature = JSON.stringify([active.keys, inventory]);
  if (panel.keySignature === signature) return;
  panel.keySignature = signature;
  retireBindingLayer(panel.keyLayer);
  const layer = panel.layer("Key assignments");
  panel.keyLayer = layer;
  for (const key of panel.keyTargets) drawKey(layer, panel, key, active);
  drawPalette(panel, layer, active);
  replaceIcons(panel, keyIconEntries(panel, active), drawBoundIcon).catch(
    (error) => panel.owner.report(error),
  );
}

function drawPalette(panel, layer, active) {
  for (const action of ACTION_PALETTE) {
    if (
      active.keys.some(
        (binding) => binding.type === action.type && binding.id === action.id,
      )
    ) {
      continue;
    }
    const path = `KeyConfig/icon/${action.id}`;
    layer.image(path, action.x, action.y);
    const rect = { x: action.x, y: action.y, width: 32, height: 32 };
    layer.hit(action.name || "Original action", rect, {
      pointerdown: (event) =>
        panel.owner.beginBindingDrag(event, action, null, {
          source: layer,
          path,
        }),
    });
  }
}

function keyIconEntries(panel, active) {
  const items = [];
  for (const key of panel.keyTargets) {
    const binding = active.keys[canonicalKeyIndex(key.index)];
    if (binding.type === 1) {
      items.push({
        key,
        binding,
        template: panel.owner.index.skills[binding.id],
      });
    } else if (binding.type === 2 || binding.type === 3 || binding.type === 7) {
      items.push({
        key,
        binding,
        template: panel.owner.index.items[binding.id],
      });
    }
  }
  return items;
}

function drawBoundIcon(icons, entry) {
  const panel = icons.owner.windows.get("KeyConfig");
  const inventory = icons.owner.store?.profile?.inventory || [];
  const path = entry.template?.iconPath;
  if (!path) return;
  if (entry.binding.type === 1) icons.image(path, entry.key.x, entry.key.y);
  else icons.image(path, entry.key.x, entry.key.y + 32, true);
  drawKeyLabel(icons, entry.key.index, entry.key.x, entry.key.y);
  const rect = { x: entry.key.x, y: entry.key.y, width: 32, height: 32 };
  if (entry.binding.type === 2) {
    const count =
      inventory.find((item) => item.id === entry.binding.id)?.count || 0;
    drawItemCount(icons, count, rect);
  }
  const button = icons.hit(entry.template.name, rect, {
    pointerdown: (event) =>
      panel.owner.beginBindingDrag(
        event,
        entry.binding,
        canonicalKeyIndex(entry.key.index),
        { source: icons, path },
      ),
    contextmenu: (event) => {
      event.preventDefault();
      panel.owner.bindings.remove(entry.key.index);
    },
    keydown: (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      event.preventDefault();
      panel.owner.bindings.remove(entry.key.index);
    },
  });
  button.dataset.keyIndex = String(entry.key.index);
}

function drawKey(layer, panel, key, active) {
  const index = canonicalKeyIndex(key.index);
  const binding = active.keys[index];
  const path = `KeyConfig/icon/${binding.id}`;
  if (binding.type >= 4 && binding.type <= 6) layer.image(path, key.x, key.y);
  if (binding.type === 0 || (binding.type >= 4 && binding.type <= 6)) {
    drawKeyLabel(layer, key.index, key.x, key.y);
  }
  const action = ACTION_PALETTE.find(
    (entry) => entry.type === binding.type && entry.id === binding.id,
  );
  const rect = { x: key.x, y: key.y, width: 32, height: 32 };
  const button = layer.hit(
    action?.name || (binding.type ? "Assigned key" : "Unassigned key"),
    rect,
    {
      pointerdown: (event) => {
        panel.selectedKey = index;
        if (binding.type >= 4 && binding.type <= 6) {
          panel.owner.beginBindingDrag(event, binding, index, {
            source: layer,
            path,
          });
        }
      },
      contextmenu: (event) => {
        event.preventDefault();
        panel.owner.bindings.remove(index);
      },
      keydown: (event) => {
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        event.preventDefault();
        panel.owner.bindings.remove(index);
      },
    },
  );
  button.dataset.keyIndex = String(key.index);
}

/** 008340e9: key legends sit four pixels in, except Shift (+2) and Space (+0). */
export function drawKeyLabel(layer, index, x, y) {
  index = canonicalKeyIndex(index);
  const path = `KeyConfig/key/${index}`;
  const offset = index === 42 ? 2 : index === 57 ? 0 : 4;
  if (layer.assets[path]) layer.image(path, x + offset, y + 4);
}

/** Explicit Save is the sole durable publication path for both UI and normal commands. */
export async function saveKeys(panel, signal) {
  if (panel.keySaving) return false;
  panel.keySaving = true;
  const bindings = panel.owner.bindings;
  try {
    await bindings.save();
    if (signal?.aborted) {
      if (
        panel.owner.bindings === bindings &&
        panel.owner.windows.get("KeyConfig") === panel
      ) {
        bindings.beginEdit();
      }
      return true;
    }
    if (panel.owner.windows.get("KeyConfig") === panel) {
      panel.owner.close("KeyConfig", true);
    }
    return true;
  } catch (error) {
    if (signal?.aborted || panel.owner.bindings !== bindings) return false;
    panel.owner.status(`Key configuration was not saved: ${error.message}`);
    panel.owner.report(error);
    return false;
  } finally {
    panel.keySaving = false;
  }
}

/** 0083665b: original notices0/1/2 own default/delete/save-close decisions. */
export function requestKeyNotice(panel, kind) {
  const owner = panel.owner;
  if (owner.keyNotice || owner.bindings.saving) return false;
  const notice = { panel, kind };
  owner.keyNotice = notice;
  refreshKeys(panel);
  owner.open("KeyConfigNotice").catch((error) => {
    if (owner.keyNotice === notice) owner.keyNotice = null;
    refreshKeys(panel);
    owner.report(error);
  });
  return true;
}

export function defaultKeys(panel) {
  return requestKeyNotice(panel, 0);
}

export function clearKeys(panel) {
  return requestKeyNotice(panel, 1);
}

export function cancelKeys(panel) {
  if (panel.owner.bindings.hasChanges()) return requestKeyNotice(panel, 2);
  panel.owner.bindings.cancel();
  panel.owner.close("KeyConfig", true);
  return true;
}

/** Native266x116 window, original266x85 prompt, controls at160/210,55 (00836877). */
export function layoutKeyNotice(panel) {
  const notice = panel.owner.keyNotice;
  if (!notice) throw new Error("Key configuration notice has no transaction");
  panel.image(`KeyConfig/notice/${notice.kind}`, 0, 0);
  const labels = [
    "Restore default keys",
    "Delete all key assignments",
    "Save changes",
  ];
  panel.element.setAttribute("aria-label", labels[notice.kind]);
  panel.button("KeyConfig/BtOK", 160, 55, {
    label: labels[notice.kind],
    action: () => answerKeyNotice(panel.owner, true),
  });
  panel.button("KeyConfig/BtCancel", 210, 55, {
    label: notice.kind === 2 ? "Discard changes" : "Keep current keys",
    action: () => answerKeyNotice(panel.owner, false),
  });
  const bindings = panel.owner.bindings;
  const changed = bindings.active.quickSlots.some(
    (key, slot) => key !== bindings.store.profile.keyBindings.quickSlots[slot],
  );
  if (changed && notice.kind !== 1) {
    panel.text(
      notice.kind === 0
        ? "The changes you've made to the Quick Slots will also change to default."
        : "The changes you've made to the Quick Slot will also be canceled.",
      12,
      85,
      242,
    );
  }
}

/** Outer destruction restores saved maps (00832834); nested OK never persists alone. */
export async function answerKeyNotice(owner, accepted) {
  const notice = owner.keyNotice;
  if (
    !notice ||
    owner.bindings.saving ||
    owner.store.profileTransactionPending
  ) {
    return false;
  }
  owner.keyNotice = null;
  owner.close("KeyConfigNotice", true);
  refreshKeys(notice.panel);
  if (notice.kind === 2) {
    if (accepted) return saveKeys(notice.panel);
    owner.bindings.cancel();
    owner.close("KeyConfig", true);
  } else if (accepted) {
    if (notice.kind === 0) owner.bindings.resetDefaults();
    else owner.bindings.clearKeys();
  }
  return true;
}

/** Pointer coordinates, never the captured DOM target, decide the destination. */
export function keyAtPoint(panel, point) {
  if (!panel?.keysReady) return null;
  const x = point.x - panel.x,
    y = point.y - panel.y;
  for (const key of panel.keyTargets) {
    if (inKeyCell(x, y, key.x, key.y)) return canonicalKeyIndex(key.index);
  }
  for (let cell = 0; cell < 54; cell++) {
    const left = 9 + 34 * (cell % 18),
      top = 267 + 34 * Math.floor(cell / 18);
    if (inKeyCell(x, y, left, top)) return 91 + cell;
  }
  return null;
}

function inKeyCell(x, y, left, top) {
  return x >= left && x < left + 32 && y >= top && y < top + 32;
}
