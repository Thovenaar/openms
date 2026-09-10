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
  const { path, descriptor } = artworkSource(panel, target.dataset.questArt);
  let resource = panel.resource;
  if (descriptor) {
    resource = await loadVisualBundle(descriptor, panel.owner.services, signal);
  }
  try {
    signal.throwIfAborted();
    paintArtwork(panel, target, resource, path);
  } finally {
    if (resource !== panel.resource) resource.destroy();
  }
}

function artworkSource(panel, token) {
  if (/^#[iv]\d+#$/.test(token)) {
    const template = panel.owner.index.items?.[Number(token.slice(2, -1))];
    return { path: template?.iconPath, descriptor: template?.descriptor };
  }
  const originalPath = token.slice(2, -1);
  const packaged = originalPath
    ? panel.owner.index.dialogArtwork?.[originalPath]
    : null;
  return {
    path: packaged?.path ?? originalPath.replace(/^UI\/UIWindow\.img\//, ""),
    descriptor: packaged?.descriptor,
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
