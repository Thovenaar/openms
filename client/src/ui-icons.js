import { loadVisualBundle } from "./visual-resources.js";
import { PROFILE_LIMITS } from "./profile-validation.js";
import { itemTooltip } from "./ui-tooltip.js";

/** Native type8 IDs index five authored macro icons, including group zero. */
export function bindingTemplate(owner, binding) {
  if (binding.type === 1) return owner.index.skills[binding.id];
  if (binding.type !== 8) return owner.index.items[binding.id];
  return {
    name:
      owner.store.profile.skillMacros[binding.id]?.name ||
      `Skill macro ${binding.id + 1}`,
    iconPath: `SkillMacro/Macroicon/${binding.id}/icon`,
    descriptor: owner.index.bundles.SkillMacro,
  };
}
const MAX_VISIBLE_ICONS = Math.max(96, PROFILE_LIMITS.equipment);
const ICON_CONCURRENCY = 4;

/** Event-driven replacement retains the last complete raster until every demand load succeeds. */
export async function replaceIcons(panel, records, compose) {
  if (records.length > MAX_VISIBLE_ICONS) {
    throw new Error("UI icon budget exceeded");
  }
  panel.iconController?.abort();
  const controller = new AbortController();
  panel.iconController = controller;
  if (!panel.iconCleanup) {
    panel.iconCleanup = true;
    panel.cleanups.push(() => panel.iconController?.abort());
  }
  const signal = AbortSignal.any([
    controller.signal,
    panel.owner.controller.signal,
  ]);
  const layer = panel.layer(`${panel.name} icons`);
  layer.root.visible = false;
  layer.element.hidden = true;
  const load = iconLoader(panel, records, layer, signal);
  try {
    const results = await Promise.allSettled(
      Array.from({ length: ICON_CONCURRENCY }, load),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    signal.throwIfAborted();
    if (panel.disposed) return;
    for (let i = 0; i < records.length; i++) compose(layer, records[i], i);
    installIconLayer(panel, layer);
  } catch (error) {
    controller.abort();
    if (panel.iconController === controller) {
      panel.inventorySignature = null;
      panel.equipmentSignature = null;
      panel.skillSignature = null;
      panel.keySignature = null;
      panel.quickSignature = null;
    }
    panel.owner.report(error);
  } finally {
    if (panel.iconLayer !== layer) layer.destroy();
  }
}

function iconLoader(panel, records, layer, signal) {
  let next = 0;
  return async function load() {
    for (let attempt = 0; attempt < MAX_VISIBLE_ICONS; attempt++) {
      const index = next++;
      if (index >= records.length) return;
      const record = records[index];
      if (!record.template?.descriptor) continue;
      const resource = await loadVisualBundle(
        record.template.descriptor,
        panel.owner.services,
        signal,
      );
      if (layer.disposed || signal.aborted) {
        resource.destroy();
        signal.throwIfAborted();
        return;
      }
      layer.dependencies.push(resource);
      signal.throwIfAborted();
      layer.borrow(resource);
    }
  };
}

function installIconLayer(panel, layer) {
  retireBindingLayer(panel.iconLayer);
  panel.iconLayer = layer;
  layer.root.visible = true;
  layer.element.hidden = false;
}

/** A carried icon borrows its old atlas until placement/cancellation retires the carry. */
export function retireBindingLayer(layer) {
  if (layer && layer.owner.bindingDrag?.source === layer) {
    layer.root.visible = false;
    layer.element.hidden = true;
    layer.retainedForDrag = true;
  } else layer?.destroy();
}

export function itemIcon(layer, entry, rect) {
  const path = entry.template?.iconPath;
  if (path && layer.assets[path]) {
    layer.image(path, rect.x, rect.y + 32, true);
  }
  const label = `${entry.template?.name || `Item ${entry.id}`} × ${entry.count}`;
  const button = layer.hit(
    label,
    rect,
    {
      pointerdown: (event) => {
        if (event.button !== 0 || !path) return;
        layer.owner.beginItemCarry(event, entry, { source: layer, path });
      },
      dblclick: () =>
        layer.owner.hooks.inventoryItemDoubleClick?.(entry, "inventory"),
    },
    {
      tooltip: () => ({
        ...itemTooltip(layer.owner, entry.template, entry.id, {
          uid: entry.uid,
        }),
        source: { surface: layer, path },
      }),
    },
  );
  button.dataset.itemId = String(entry.id);
  button.dataset.itemUid = entry.uid;
  button.dataset.itemSlot = String(entry.slot);
  button.dataset.inventoryType = String(Math.floor(entry.id / 1000000));
  const category = Math.floor(entry.id / 1000000);
  if ((category >= 2 && category <= 4) || entry.count > 1) {
    drawItemCount(layer, entry.count, rect);
  }
}

/** 0081df24..54: spacing0; original ItemNo at slot.left, slot.bottom-12. */
export function drawItemCount(layer, count, rect) {
  let x = rect.x;
  for (const digit of String(count)) {
    const path = `ItemNo/${digit}`;
    layer.image(path, x, rect.y + 20);
    x += layer.assets[path].width;
  }
}
