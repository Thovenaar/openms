import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";

const MAX_IMAGES = 128;
const MAX_IMAGE_PIXELS = 1048576;
// A65,536-character prose value can contain at most16,384 four-character #L0# tokens.
// Native choice chrome is separate from the128 authored inline-image admission limit.
const MAX_CHOICE_MARKERS = 32768;

/** Inline raster copies scroll with native text; atlas leases are released after copying. */
export async function renderDialogArtwork(panel, signal) {
  const targets = panel.content.querySelectorAll("[data-quest-art]");
  if (targets.length > MAX_IMAGES + MAX_CHOICE_MARKERS) {
    throw new Error("Dialogue artwork node count exceeds policy");
  }
  let authoredImages = 0;
  for (const target of targets) {
    if (target.dataset.choiceMarker === undefined) authoredImages++;
    reserveArtwork(panel, target);
  }
  if (authoredImages > MAX_IMAGES) {
    throw new Error("Dialogue artwork count exceeds policy");
  }
  for (const target of targets) {
    const pending = renderTarget(panel, target, signal);
    if (pending) await pending;
  }
}

function renderTarget(panel, target, signal) {
  signal.throwIfAborted();
  const source = artworkSource(panel, target.dataset.questArt);
  if (source.descriptor) return renderExternal(panel, target, source, signal);
  paintArtwork(panel, target, panel.resource, source.path);
  return null;
}

async function renderExternal(panel, target, source, signal) {
  const resource = await loadVisualBundle(
    source.descriptor,
    panel.owner.services,
    signal,
  );
  try {
    signal.throwIfAborted();
    if (panel.content.contains(target)) {
      paintArtwork(panel, target, resource, source.path);
    }
  } finally {
    resource.destroy();
  }
}

/** Reserve decoded catalog bounds before any await; item-name siblings never become image targets. */
function reserveArtwork(panel, target) {
  const source = artworkSource(panel, target.dataset.questArt);
  const asset = source.descriptor
    ? source
    : panel.resource.manifest.metadata.assets[source.path];
  if (!(asset?.width > 0) || !(asset?.height > 0)) return;
  target.style.cssText += `;display:inline-block;width:${asset.width}px;height:${asset.height}px;vertical-align:middle;font-size:0;`;
}

function artworkSource(panel, token) {
  if (/^#[iv]\d+:?#$/.test(token)) {
    return itemArtwork(panel, Number(token.match(/\d+/)[0]));
  }
  // 009a16d8 string5585: UI/UIWindow.img/Quest/%s.
  if (/^#W[a-zA-Z0-9_]+#$/.test(token)) {
    return { path: `Quest/${token.slice(2, -1)}` };
  }
  const originalPath = token.slice(2, -1);
  const packaged = originalPath
    ? panel.owner.index.dialogArtwork?.[originalPath]
    : null;
  return {
    path: packaged?.path ?? originalPath.replace(/^UI\/UIWindow\.img\//, ""),
    descriptor: packaged?.descriptor,
    width: packaged?.width,
    height: packaged?.height,
  };
}

/** Item icons have their own immutable bundle and dimensions, separate from UI chrome. */
function itemArtwork(panel, id) {
  const template = panel.owner.index.items?.[id];
  return {
    path: template?.iconPath,
    descriptor: template?.descriptor,
    width: template?.iconWidth,
    height: template?.iconHeight,
  };
}

function paintArtwork(panel, target, resource, path) {
  const asset = resource.manifest.metadata.assets[path];
  const entity = resource.manifest.entities.find((entry) => entry.id === path);
  if (!asset || !entity) {
    throw new Error(`Unpackaged dialogue artwork: ${target.dataset.questArt}`);
  }
  if (asset.width * asset.height > MAX_IMAGE_PIXELS) {
    throw new Error("Dialogue artwork exceeds pixel policy");
  }
  const animation = new EntityAnimation(entity, resource.textures);
  try {
    const raster = panel.owner.app.renderer.extract.canvas({
      target: animation.container,
      resolution: 1,
    });
    const canvas = document.createElement("canvas");
    canvas.width = raster.width;
    canvas.height = raster.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Dialogue canvas context unavailable");
    context.drawImage(raster, 0, 0);
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", target.textContent);
    canvas.style.cssText = `vertical-align:middle;width:${asset.width}px;height:${asset.height}px;image-rendering:pixelated;`;
    target.replaceChildren(canvas);
  } finally {
    animation.container.destroy({ children: true });
  }
}
