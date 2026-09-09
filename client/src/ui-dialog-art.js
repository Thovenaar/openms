import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";

const MAX_IMAGES = 128;
const MAX_IMAGE_PIXELS = 1048576;

/** Inline raster copies scroll with native text; atlas leases are released after copying. */
export async function renderDialogArtwork(panel, signal) {
  const targets = panel.content.querySelectorAll("[data-quest-art]");
  if (targets.length > MAX_IMAGES) {
    throw new Error("Dialogue artwork count exceeds policy");
  }
  for (const target of targets) {
    await renderTarget(panel, target, signal);
  }
}

async function renderTarget(panel, target, signal) {
  signal.throwIfAborted();
  const token = target.dataset.questArt;
  const item = /^#[iv]\d+#$/.test(token);
  const template = item
    ? panel.owner.index.items?.[Number(token.slice(2, -1))]
    : null;
  const path = item
    ? template?.iconPath
    : token.slice(2, -1).replace(/^UI\/UIWindow\.img\//, "");
  let resource = panel.resource;
  if (item && template?.descriptor) {
    resource = await loadVisualBundle(
      template.descriptor,
      panel.owner.services,
      signal,
    );
  }
  try {
    signal.throwIfAborted();
    paintArtwork(panel, target, resource, path);
  } finally {
    if (resource !== panel.resource) resource.destroy();
  }
}

function paintArtwork(panel, target, resource, path) {
  const asset = resource.manifest.metadata.assets[path];
  const entity = resource.manifest.entities.find((entry) => entry.id === path);
  if (!asset || !entity) return;
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
    canvas.style.cssText = "vertical-align:middle;max-width:100%;height:auto;";
    target.replaceChildren(canvas);
  } finally {
    animation.container.destroy({ children: true });
  }
}
