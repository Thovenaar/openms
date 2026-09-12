const MAX_DISPLAY_DENSITY = 4;
const MAX_WIDTH = 2560;
const MAX_HEIGHT = 1440;

/** Backing density changes pixels, never logical field or native-window coordinates. */
function displayDensity() {
  const density = window.devicePixelRatio;
  if (!Number.isFinite(density) || density <= 0 || density > MAX_DISPLAY_DENSITY) {
    throw new RangeError("Display density must be positive and at most 4.");
  }
  return density;
}

/** Both authority modes own the same WebGL surface, native coordinate plane and canvas focus. */
export async function initializeBrowserSurface(app, viewport) {
  await app.init({
    preference: "webgl",
    preferWebGLVersion: 2,
    width: 1,
    height: 1,
    resolution: displayDensity(),
    autoDensity: true,
    antialias: false,
    background: "#101820",
    autoStart: false,
    sharedTicker: false,
    preserveDrawingBuffer: true,
  });
  app.stage.sortableChildren = true;
  app.canvas.id = "scene-canvas";
  app.canvas.tabIndex = 0;
  app.canvas.setAttribute(
    "aria-label",
    "Playable original asset map. Arrows move and climb. Other actions follow your KeyConfig. Enter opens chat.",
  );
  viewport.prepend(app.canvas);
  resizeBrowserSurface(app, viewport);
}

/** Bound drawable dimensions and background repetition identically in both modes. */
export function resizeBrowserSurface(app, viewport) {
  app.renderer.resize(
    Math.max(1, Math.min(MAX_WIDTH, viewport.clientWidth)),
    Math.max(1, Math.min(MAX_HEIGHT, viewport.clientHeight)),
    displayDensity(),
  );
}
