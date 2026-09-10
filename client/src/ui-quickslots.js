import { loadVisualBundle } from "./visual-resources.js";
import { ACTION_PALETTE, canonicalKeyIndex } from "./keymap.js";
import { replaceIcons, drawItemCount, retireBindingLayer } from "./ui-icons.js";
import { drawKeyLabel } from "./ui-keyconfig.js";
import { HUD_CLIENT_Y } from "./ui-hud.js";
import { bindingTooltip } from "./ui-tooltip.js";

// 008de8d5 / DAT_00be2db0: CWnd-local647,427; add the native window origin.
export const QUICK_SLOT_COORDINATES = Object.freeze([
  { x: 7, y: 8 },
  { x: 42, y: 8 },
  { x: 77, y: 8 },
  { x: 112, y: 8 },
  { x: 7, y: 41 },
  { x: 42, y: 41 },
  { x: 77, y: 41 },
  { x: 112, y: 41 },
]);

export function quickKeyAtPoint(owner, point) {
  const panel = owner.hud?.quickSurface;
  if (!panel?.root.visible) return null;
  const x = point.x - panel.x,
    y = point.y - panel.y;
  for (let slot = 0; slot < 8; slot++) {
    const rect = QUICK_SLOT_COORDINATES[slot];
    if (x >= rect.x && x < rect.x + 32 && y >= rect.y && y < rect.y + 32) {
      return canonicalKeyIndex(owner.bindings.active.quickSlots[slot]);
    }
  }
  return null;
}

export async function toggleQuickSlots(owner) {
  const commandSignal = owner.commandSignal;
  if (!owner.hud || !owner.bindings) return;
  if (owner.quickLoading) return owner.quickLoading;
  let panel = owner.hud.quickSurface;
  if (!panel) {
    owner.quickLoading = createQuickSlots(owner);
    try {
      panel = await owner.quickLoading;
    } finally {
      owner.quickLoading = null;
    }
    if (!panel) return;
    if (commandSignal?.aborted) return;
  } else {
    panel.root.visible = !panel.root.visible;
    panel.element.hidden = !panel.root.visible;
  }
  refreshQuickSlots(owner);
  owner.hooks.focusGame();
}

async function createQuickSlots(owner) {
  const hud = owner.hud;
  const signal = owner.commandSignal
    ? AbortSignal.any([owner.controller.signal, owner.commandSignal])
    : owner.controller.signal;
  const resource = await loadVisualBundle(
    owner.index.bundles.KeyConfig,
    owner.services,
    signal,
  );
  if (signal.aborted || hud.disposed || owner.hud !== hud) {
    resource.destroy();
    return null;
  }
  const panel = hud.layer("Quick slots");
  try {
    panel.dependencies.push(resource);
    panel.borrow(resource);
    panel.width = 151;
    panel.height = 80;
    panel.element.style.width = "151px";
    panel.element.style.height = "80px";
    panel.position(647, 427 + HUD_CLIENT_Y);
    // Independent +cc4 layer opens at screen y453; hit/icon origin is449.
    panel.image("base/quickSlot", 0, 4);
    hud.quickSurface = panel;
    return panel;
  } catch (error) {
    panel.destroy();
    throw error;
  }
}

export function refreshQuickSlots(owner) {
  const panel = owner.hud?.quickSurface;
  if (!panel || panel.disposed || owner.disposed || !owner.bindings) return;
  owner.hud.quickControl.setVisible(!panel.root.visible);
  owner.hud.quickDownControl.setVisible(panel.root.visible);
  const active = owner.bindings.active;
  const records = active.quickSlots.map((physical, slot) => {
    const index = canonicalKeyIndex(physical),
      binding = active.keys[index];
    const item = owner.store?.profile?.inventory.find(
      (entry) => entry.id === binding.id,
    );
    return {
      index,
      slot,
      binding,
      count: item?.count || 0,
      template:
        binding.type === 1
          ? owner.index.skills[binding.id]
          : owner.index.items[binding.id],
    };
  });
  const signature = JSON.stringify(
    records.map((record) => [record.index, record.binding, record.count]),
  );
  if (signature === panel.quickSignature) return;
  panel.quickSignature = signature;
  retireBindingLayer(panel.keyLayer);
  const layer = panel.layer("Quick-slot keys");
  panel.keyLayer = layer;
  for (const record of records) drawQuickSlot(layer, record);
  const icons = records.filter(
    (record) =>
      record.binding.type === 1 ||
      record.binding.type === 2 ||
      record.binding.type === 3 ||
      record.binding.type === 7,
  );
  replaceIcons(panel, icons, (imageLayer, record) => {
    const point = QUICK_SLOT_COORDINATES[record.slot];
    const path = record.template?.iconPath;
    if (!path) return;
    if (record.binding.type === 1) imageLayer.image(path, point.x, point.y);
    else imageLayer.image(path, point.x, point.y + 32, true);
    drawKeyLabel(imageLayer, record.index, point.x, point.y);
    if (record.binding.type === 2) {
      drawItemCount(imageLayer, record.count, point);
    }
    quickHit(imageLayer, record, path);
  }).catch((error) => owner.report(error));
}

function drawQuickSlot(layer, record) {
  const { binding, index, slot } = record;
  const point = QUICK_SLOT_COORDINATES[slot];
  let path = null;
  if (binding.type >= 4 && binding.type <= 6) {
    path = `KeyConfig/icon/${binding.id}`;
    layer.image(path, point.x, point.y);
  }
  if (binding.type === 0 || path) drawKeyLabel(layer, index, point.x, point.y);
  quickHit(layer, record, path);
}

function quickHit(layer, record, path) {
  const point = QUICK_SLOT_COORDINATES[record.slot];
  const action = ACTION_PALETTE.find(
    (entry) =>
      entry.type === record.binding.type && entry.id === record.binding.id,
  );
  const label =
    record.template?.name ||
    action?.name ||
    (record.binding.type ? "Unavailable action" : "Empty");
  const rect = { x: point.x, y: point.y, width: 32, height: 32 };
  const button = layer.hit(
    `Quick slot ${record.slot + 1}: ${label}${record.count ? ` × ${record.count}` : ""}`,
    rect,
    {
      click: () => {
        layer.owner.bindings.activateKey(record.index);
        layer.owner.hooks.focusGame();
      },
      pointerdown: (event) => {
        if (path) {
          layer.owner.beginBindingDrag(event, record.binding, record.index, {
            source: layer,
            path,
          });
        }
      },
    },
    () => ({
      ...bindingTooltip(
        layer.owner,
        record.binding,
        `Quick slot ${record.slot + 1}`,
      ),
      source: path ? { surface: layer, path } : null,
    }),
  );
  button.dataset.quickSlot = String(record.slot);
  if (!record.binding.type) button.dataset.cursorState = "0";
}
