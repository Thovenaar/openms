import { Application, Container, ImageSource, Texture } from "pixi.js";
import { EntityAnimation } from "./animation.js";

const SAMPLE_LIMIT = 240;
const LOAD_BATCH = 4;
const UPLOAD_BUDGET_MS = 4;
const SCENE_URL = "/generated/scene.json";

/** Fixed storage on the hot path; chronological arrays are allocated only by snapshot(). */
class Samples {
  constructor() {
    this.values = new Float64Array(SAMPLE_LIMIT);
    this.count = 0;
    this.cursor = 0;
  }
  /** @param {number} value */
  add(value) {
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % SAMPLE_LIMIT;
    this.count = Math.min(this.count + 1, SAMPLE_LIMIT);
  }
  snapshot() {
    return Array.from(
      { length: this.count },
      (_, i) =>
        this.values[
          (this.cursor - this.count + i + SAMPLE_LIMIT) % SAMPLE_LIMIT
        ],
    );
  }
}

const frameDeltas = new Samples();
const drawCpuTimes = new Samples();
const loadingDurations = new Samples();
const loadingStalls = new Samples();
const app = new Application();
const viewport = document.querySelector("#viewport");
const status = document.querySelector("#status");
const errorBox = document.querySelector("#error");
const entitySelect = document.querySelector("#entity");
const actionSelect = document.querySelector("#action");
const visibleInput = document.querySelector("#visible");
const pauseButton = document.querySelector("#pause");
const cameraLabel = document.querySelector("#camera-position");
/** @type {ReturnType<typeof emptyScene> | null} */
let current = null;
let paused = false;
let initialized = false;
let loading = false;
let lastError = null;
let generation = 0;
let controller = null;
let pendingLoads = 0;
let lastNow = performance.now();
let renderedFrames = 0;
let loadAttempts = 0;
let loadCommits = 0;
let discardedLoads = 0;

/** @param {string} message */
function showError(message) {
  lastError = message;
  errorBox.textContent = message;
  errorBox.hidden = false;
}
function clearError() {
  lastError = null;
  errorBox.hidden = true;
  errorBox.textContent = "";
}
/** @param {unknown} value @param {string} label */
function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be a finite number`);
  return value;
}
/** @param {unknown} value @param {string} label */
function opacity(value, label) {
  if (value === undefined) return;
  finite(value, label);
  if (value < 0 || value > 1)
    throw new Error(`${label} must be between 0 and 1`);
}
/** Validate the new interchange, never silently replace invalid source assets.
 * @param {any} scene
 */
function validateScene(scene) {
  if (
    !scene ||
    typeof scene.id !== "string" ||
    !Array.isArray(scene.entities) ||
    !scene.textures ||
    typeof scene.textures !== "object" ||
    Array.isArray(scene.textures)
  ) {
    throw new Error("Generated scene must contain id, entities and textures");
  }
  for (const key of ["left", "top", "right", "bottom"])
    finite(scene.bounds?.[key], `bounds.${key}`);
  if (
    scene.bounds.right <= scene.bounds.left ||
    scene.bounds.bottom <= scene.bounds.top
  )
    throw new Error("Invalid scene bounds");
  finite(scene.camera?.x, "camera.x");
  finite(scene.camera?.y, "camera.y");
  for (const [id, texture] of Object.entries(scene.textures)) {
    if (!texture || typeof texture.url !== "string" || !texture.url)
      throw new Error(`Texture ${id} has no URL`);
    for (const key of ["width", "height"]) {
      if (!Number.isInteger(texture[key]) || texture[key] <= 0)
        throw new Error(`Texture ${id} has invalid ${key}`);
    }
  }
  const ids = new Set();
  for (const entity of scene.entities) {
    if (!entity || typeof entity.id !== "string" || ids.has(entity.id))
      throw new Error("Missing or duplicate entity id");
    ids.add(entity.id);
    if (entity.kind !== "map" && entity.kind !== "character")
      throw new Error(`Invalid kind for ${entity.id}`);
    for (const key of ["x", "y", "z"])
      finite(entity[key], `${entity.id}.${key}`);
    opacity(entity.opacity, `${entity.id}.opacity`);
    if (entity.background) {
      const bg = entity.background;
      if (!Number.isInteger(bg.type) || bg.type < 0 || bg.type > 7)
        throw new Error(`Unsupported background type for ${entity.id}`);
      for (const key of ["rx", "ry", "cx", "cy"])
        finite(bg[key], `${entity.id}.background.${key}`);
      if (bg.cx < 0 || bg.cy < 0)
        throw new Error(`Invalid repeat spacing for ${entity.id}`);
    }
    if (
      !entity.actions ||
      typeof entity.actions !== "object" ||
      !Object.hasOwn(entity.actions, entity.action)
    ) {
      throw new Error(`Missing initial action for ${entity.id}`);
    }
    for (const [name, frames] of Object.entries(entity.actions)) {
      if (!Array.isArray(frames) || !frames.length)
        throw new Error(`Empty action ${entity.id}/${name}`);
      let duration = 0;
      for (const frame of frames) {
        finite(frame.delay, `${entity.id}/${name} delay`);
        if (frame.delay < 0 || (frames.length > 1 && frame.delay === 0))
          throw new Error(
            `Nonpositive animation delay in ${entity.id}/${name}`,
          );
        duration += frame.delay;
        if (!Number.isFinite(duration))
          throw new Error(
            `Animation duration overflow in ${entity.id}/${name}`,
          );
        if (!Array.isArray(frame.parts))
          throw new Error(`Missing parts in ${entity.id}/${name}`);
        if (frame.alphaEnd !== undefined) {
          opacity(frame.alphaEnd, `${entity.id}/${name} alphaEnd`);
          if (frame.delay === 0)
            throw new Error(
              `Alpha animation requires a positive delay for ${entity.id}`,
            );
        }
        if (entity.background && frame.parts.length !== 1)
          throw new Error(
            `Background ${entity.id} must have one canvas per frame`,
          );
        for (const part of frame.parts) {
          if (!Object.hasOwn(scene.textures, part.texture))
            throw new Error(`Missing texture ${part.texture}`);
          for (const key of ["x", "y", "z"])
            finite(part[key], `${entity.id} part.${key}`);
          opacity(part.opacity, `${entity.id} part.opacity`);
        }
      }
    }
  }
}

/** @param {any} manifest */
function emptyScene(manifest) {
  return {
    manifest,
    root: new Container({ label: manifest.id }),
    textures: new Map(),
    bitmaps: [],
    entities: [],
    backgrounds: [],
    byId: new Map(),
    camera: { x: manifest.camera.x, y: manifest.camera.y },
    bytes: 0,
  };
}
/** @param {ReturnType<typeof emptyScene>} scene */
function disposeScene(scene) {
  scene.root.destroy({ children: true, texture: false, textureSource: false });
  for (const texture of scene.textures.values()) texture.destroy(true);
  for (const bitmap of scene.bitmaps) bitmap.close();
  scene.textures.clear();
  scene.bitmaps.length = 0;
  scene.entities.length = 0;
  scene.byId.clear();
}
/** @param {AbortSignal} signal @param {number} request */
function assertCurrent(signal, request) {
  if (signal.aborted || request !== generation)
    throw new DOMException("Scene load superseded", "AbortError");
}
/** Let browser input and the currently visible scene render between preparation batches. */
function cooperate() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
/** @param {string} url @param {AbortSignal} signal */
async function fetchAsset(url, signal) {
  pendingLoads++;
  try {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return await response.blob();
  } finally {
    pendingLoads--;
  }
}
/** @param {any} manifest @param {AbortSignal} signal @param {number} request */
async function prepareScene(manifest, signal, request) {
  const candidate = emptyScene(manifest);
  const entries = Object.entries(manifest.textures);
  try {
    for (let start = 0; start < entries.length; start += LOAD_BATCH) {
      assertCurrent(signal, request);
      // A failed fetch must wait for its siblings before destroying shared candidate resources.
      const results = await Promise.allSettled(
        entries.slice(start, start + LOAD_BATCH).map(async ([id, info]) => {
          const blob = await fetchAsset(info.url, signal);
          assertCurrent(signal, request);
          pendingLoads++;
          let bitmap;
          try {
            bitmap = await createImageBitmap(blob, {
              premultiplyAlpha: "premultiply",
              colorSpaceConversion: "none",
            });
          } finally {
            pendingLoads--;
          }
          candidate.bitmaps.push(bitmap);
          assertCurrent(signal, request);
          if (bitmap.width !== info.width || bitmap.height !== info.height)
            throw new Error(
              `Texture ${id}: decoded dimensions differ from manifest`,
            );
          const source = new ImageSource({
            resource: bitmap,
            scaleMode: "nearest",
            alphaMode: "premultiplied-alpha",
            autoGenerateMipmaps: false,
          });
          candidate.textures.set(id, new Texture({ source }));
          candidate.bytes += bitmap.width * bitmap.height * 4;
        }),
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure) throw failure.reason;
      let uploadStart = performance.now();
      for (
        let i = start;
        i < Math.min(start + LOAD_BATCH, entries.length);
        i++
      ) {
        assertCurrent(signal, request);
        app.renderer.texture.initSource(
          candidate.textures.get(entries[i][0]).source,
        );
        if (performance.now() - uploadStart >= UPLOAD_BUDGET_MS) {
          await cooperate();
          uploadStart = performance.now();
        }
      }
      await cooperate();
    }
    for (let i = 0; i < manifest.entities.length; i++) {
      assertCurrent(signal, request);
      const entity = new EntityAnimation(
        manifest.entities[i],
        candidate.textures,
        i,
      );
      candidate.entities.push(entity);
      if (entity.background) candidate.backgrounds.push(entity);
      candidate.byId.set(entity.id, entity);
      candidate.root.addChild(entity.container);
      if ((i + 1) % 32 === 0) await cooperate();
    }
    sortEntities(candidate);
    candidate.root.position.set(-candidate.camera.x, -candidate.camera.y);
    for (const entity of candidate.backgrounds)
      entity.updateBackground(candidate.camera, manifest.camera, app.screen);
    return candidate;
  } catch (error) {
    disposeScene(candidate);
    throw error;
  }
}
/** @param {ReturnType<typeof emptyScene>} scene */
function sortEntities(scene) {
  const ordered = scene.entities
    .slice()
    .sort(
      (a, b) => a.container.zIndex - b.container.zIndex || a.order - b.order,
    );
  for (let i = 0; i < ordered.length; i++)
    scene.root.setChildIndex(ordered[i].container, i);
}
function render() {
  if (!initialized) return;
  const start = performance.now();
  if (current)
    for (const entity of current.backgrounds)
      entity.updateBackground(
        current.camera,
        current.manifest.camera,
        app.screen,
      );
  app.render();
  drawCpuTimes.add(performance.now() - start);
  renderedFrames++;
}
/** @param {number} ms */
function advance(ms) {
  if (current) for (const entity of current.entities) entity.advance(ms);
}
/** @param {number} now */
function tick(now) {
  const delta = Math.max(0, now - lastNow);
  lastNow = now;
  frameDeltas.add(delta);
  if (loading && delta > 50) loadingStalls.add(delta);
  if (!paused) {
    advance(delta);
    render();
  }
  requestAnimationFrame(tick);
}
/** @param {string} id */
function entityById(id) {
  const entity = current?.byId.get(id);
  if (!entity) throw new Error(`Unknown entity ${id}`);
  return entity;
}
function snapshot() {
  const heap = performance.memory;
  return {
    ready: !!current,
    loading,
    error: lastError,
    paused,
    renderer: initialized ? "webgl" : null,
    sceneId: current?.manifest.id ?? null,
    source: current?.manifest.source ?? null,
    bounds: current ? { ...current.manifest.bounds } : null,
    entities: current?.entities.map((entity) => entity.snapshot()) ?? [],
    camera: current ? { ...current.camera } : null,
    viewport: initialized
      ? {
          width: app.screen.width,
          height: app.screen.height,
          resolution: app.renderer.resolution,
        }
      : null,
    textureCount: current?.textures.size ?? 0,
    pendingLoads,
    metrics: {
      frameDeltas: frameDeltas.snapshot(),
      drawCpuTimes: drawCpuTimes.snapshot(),
      loadingDurations: loadingDurations.snapshot(),
      loadingStalls: loadingStalls.snapshot(),
      approximateTextureBytes: current?.bytes ?? 0,
      browserHeap: heap
        ? {
            usedJSHeapSize: heap.usedJSHeapSize,
            totalJSHeapSize: heap.totalJSHeapSize,
            jsHeapSizeLimit: heap.jsHeapSizeLimit,
          }
        : null,
      renderedFrames,
      loadAttempts,
      loadCommits,
      discardedLoads,
      sampleLimit: SAMPLE_LIMIT,
    },
  };
}
async function loadScene() {
  const request = ++generation;
  controller?.abort();
  const ownController = new AbortController();
  controller = ownController;
  const signal = ownController.signal;
  const started = performance.now();
  loading = true;
  loadAttempts++;
  clearError();
  status.textContent = current
    ? "Loading replacement — current scene stays live"
    : "Loading generated scene…";
  let candidate = null;
  try {
    await rendererReady;
    assertCurrent(signal, request);
    const blob = await fetchAsset(SCENE_URL, signal);
    const manifest = JSON.parse(await blob.text());
    validateScene(manifest);
    assertCurrent(signal, request);
    candidate = await prepareScene(manifest, signal, request);
    assertCurrent(signal, request);
    const previous = current;
    if (previous) app.stage.removeChild(previous.root);
    app.stage.addChild(candidate.root);
    try {
      render();
    } catch (error) {
      app.stage.removeChild(candidate.root);
      if (previous) app.stage.addChild(previous.root);
      throw error;
    }
    current = candidate;
    candidate = null;
    lastNow = performance.now();
    loadCommits++;
    if (previous) disposeScene(previous);
    refreshControls();
    status.textContent = `${manifest.id} · ${current.entities.length} entities · ${current.textures.size} textures`;
    loading = false;
    return snapshot();
  } catch (error) {
    if (candidate) disposeScene(candidate);
    if (signal.aborted || request !== generation) {
      discardedLoads++;
      throw new DOMException("Scene load superseded", "AbortError");
    }
    status.textContent = current
      ? "Replacement failed — previous scene retained"
      : "Generated scene unavailable";
    showError(
      `${error.message}. ${current ? "The current scene has not been replaced." : "Generate /generated/scene.json and its original texture assets, then Reload. No substitute scene is displayed."}`,
    );
    throw error;
  } finally {
    loadingDurations.add(performance.now() - started);
    if (request === generation) loading = false;
  }
}

const api = {
  ready: null,
  snapshot,
  /** @param {boolean} value */
  pause(value) {
    paused = !!value;
    lastNow = performance.now();
    pauseButton.textContent = paused ? "Resume" : "Pause";
    pauseButton.setAttribute("aria-pressed", String(paused));
  },
  /** @param {number} ms */
  step(ms) {
    finite(ms, "step milliseconds");
    if (ms < 0) throw new Error("step milliseconds must not be negative");
    advance(ms);
    lastNow = performance.now();
    render();
    return snapshot();
  },
  /** @param {string} id @param {string} action */
  setAction(id, action) {
    entityById(id).setAction(action);
    refreshEntityControls();
  },
  /** @param {string} id @param {boolean} value */
  setVisible(id, value) {
    entityById(id).container.visible = !!value;
    refreshEntityControls();
  },
  /** @param {string} id @param {number} z */
  setLayer(id, z) {
    finite(z, "layer");
    entityById(id).container.zIndex = z;
    sortEntities(current);
    refreshEntityControls();
  },
  /** @param {string} id @param {number} x @param {number} y */
  setPosition(id, x, y) {
    finite(x, "x");
    finite(y, "y");
    entityById(id).setPosition(x, y);
  },
  /** @param {number} x @param {number} y */
  setCamera(x, y) {
    finite(x, "camera x");
    finite(y, "camera y");
    if (!current) throw new Error("No scene loaded");
    current.camera.x = x;
    current.camera.y = y;
    current.root.position.set(-x, -y);
    cameraLabel.textContent = `${Math.round(x)}, ${Math.round(y)}`;
  },
  reload() {
    const promise = loadScene();
    api.ready = promise;
    // UI may deliberately ignore a reload, while programmatic callers still receive rejection.
    promise.catch(() => {});
    return promise;
  },
};
window.maple = api;

function refreshEntityControls() {
  const entity = current?.byId.get(entitySelect.value);
  const names = entity ? [...entity.actions.keys()] : [];
  actionSelect.replaceChildren(...names.map((name) => new Option(name, name)));
  actionSelect.disabled = !entity;
  visibleInput.disabled = !entity;
  if (entity) {
    actionSelect.value = entity.action;
    visibleInput.checked = entity.container.visible;
  }
  document.querySelector("#layer-value").textContent = entity
    ? String(entity.container.zIndex)
    : "—";
}
function refreshControls() {
  const selected = entitySelect.value;
  entitySelect.replaceChildren(
    ...current.entities.map(
      (entity) => new Option(`${entity.kind}: ${entity.id}`, entity.id),
    ),
  );
  if (current.byId.has(selected)) entitySelect.value = selected;
  else
    entitySelect.value =
      current.entities.find((entity) => entity.kind === "character")?.id ??
      current.entities[0]?.id ??
      "";
  entitySelect.disabled = current.entities.length === 0;
  document.querySelector("#scene-controls").disabled = false;
  refreshEntityControls();
  api.setCamera(current.camera.x, current.camera.y);
}
/** @param {() => void} change */
function uiChange(change) {
  try {
    change();
    api.step(0);
  } catch (error) {
    showError(error.message);
  }
}
entitySelect.addEventListener("change", refreshEntityControls);
actionSelect.addEventListener("change", () =>
  uiChange(() => api.setAction(entitySelect.value, actionSelect.value)),
);
visibleInput.addEventListener("change", () =>
  uiChange(() => api.setVisible(entitySelect.value, visibleInput.checked)),
);
pauseButton.addEventListener("click", () => api.pause(!paused));
document.querySelector("#step").addEventListener("click", () =>
  uiChange(() => {
    api.pause(true);
    api.step(Number(document.querySelector("#step-ms").value));
  }),
);
document.querySelector("#reload").addEventListener("click", () => {
  api.reload();
});
for (const button of document.querySelectorAll("[data-layer]")) {
  button.addEventListener("click", () =>
    uiChange(() => {
      if (!current?.entities.length) return;
      const front = button.dataset.layer === "front";
      let extreme = current.entities[0].container.zIndex;
      for (const entity of current.entities)
        extreme = front
          ? Math.max(extreme, entity.container.zIndex)
          : Math.min(extreme, entity.container.zIndex);
      api.setLayer(entitySelect.value, extreme + (front ? 1 : -1));
    }),
  );
}
for (const button of document.querySelectorAll("[data-camera]")) {
  button.addEventListener("click", () =>
    uiChange(() => {
      const [dx, dy] = button.dataset.camera.split(",").map(Number);
      api.setCamera(current.camera.x + dx, current.camera.y + dy);
    }),
  );
}
document
  .querySelector("#camera-reset")
  .addEventListener("click", () =>
    uiChange(() =>
      api.setCamera(current.manifest.camera.x, current.manifest.camera.y),
    ),
  );

const rendererReady = (async () => {
  await app.init({
    preference: "webgl",
    preferWebGLVersion: 2,
    width: Math.max(1, viewport.clientWidth),
    height: Math.max(1, viewport.clientHeight),
    resolution: 1,
    autoDensity: false,
    antialias: false,
    roundPixels: false,
    background: "#101820",
    backgroundAlpha: 1,
    clearBeforeRender: true,
    autoStart: false,
    sharedTicker: false,
    preserveDrawingBuffer: true,
  });
  initialized = true;
  app.canvas.id = "scene-canvas";
  app.canvas.setAttribute(
    "aria-label",
    "Original-asset scene. Drag to pan the camera.",
  );
  app.canvas.tabIndex = 0;
  viewport.prepend(app.canvas);
  const observer = new ResizeObserver(() => {
    app.renderer.resize(
      Math.max(1, viewport.clientWidth),
      Math.max(1, viewport.clientHeight),
    );
    render();
  });
  observer.observe(viewport);
  let drag = null;
  app.canvas.addEventListener("pointerdown", (event) => {
    if (!current || event.button !== 0) return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      cameraX: current.camera.x,
      cameraY: current.camera.y,
    };
    app.canvas.setPointerCapture(event.pointerId);
  });
  app.canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId || !current) return;
    api.setCamera(
      drag.cameraX - (event.clientX - drag.x),
      drag.cameraY - (event.clientY - drag.y),
    );
    if (paused) render();
  });
  const stopDrag = () => {
    drag = null;
  };
  app.canvas.addEventListener("pointerup", stopDrag);
  app.canvas.addEventListener("pointercancel", stopDrag);
  app.canvas.addEventListener("lostpointercapture", stopDrag);
  app.canvas.addEventListener("keydown", (event) => {
    const direction = {
      ArrowLeft: [-32, 0],
      ArrowRight: [32, 0],
      ArrowUp: [0, -32],
      ArrowDown: [0, 32],
    }[event.key];
    if (!direction || !current) return;
    event.preventDefault();
    api.setCamera(
      current.camera.x + direction[0],
      current.camera.y + direction[1],
    );
    if (paused) render();
  });
  render();
  lastNow = performance.now();
  requestAnimationFrame(tick);
})();
api.reload();
