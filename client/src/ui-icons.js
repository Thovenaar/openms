import { loadVisualBundle } from "./visual-resources.js";
import { itemBindingType } from "./keymap.js";
import { PROFILE_LIMITS } from "./profile-validation.js";

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
  const previous = panel.iconLayer;
  if (previous && panel.owner.bindingDrag?.source === previous) {
    previous.root.visible = false;
    previous.element.hidden = true;
    previous.retainedForDrag = true;
  } else previous?.destroy();
  panel.iconLayer = layer;
  layer.root.visible = true;
  layer.element.hidden = false;
}

export function itemIcon(layer, entry, rect) {
  const path = entry.template?.iconPath;
  if (path && layer.assets[path]) {
    layer.image(path, rect.x, rect.y + 32, true);
  }
  const label = `${entry.template?.name || `Item ${entry.id}`} × ${entry.count}`;
  const button = layer.hit(label, rect, {
    pointerdown: (event) => {
      if (event.button !== 0 || !path) return;
      layer.owner.beginBindingDrag(
        event,
        { type: itemBindingType(entry.template), id: entry.id },
        null,
        { source: layer, path },
      );
    },
    dblclick: () => layer.owner.bindings?.useItem(entry.id),
  });
  button.dataset.itemId = String(entry.id);
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
