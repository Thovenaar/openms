import { Application } from "pixi.js";
import { Network, check, aborted } from "./stream-network.js";
import { AtlasStore } from "./stream-atlas.js";
import { StreamScene } from "./stream-scene.js";
import {
  catalog as validateCatalog,
  manifest as validateManifest,
  finite,
  LIMITS,
} from "./stream-validation.js";
import { createPlayerInput } from "./player-input.js";
import { createControls } from "./scene-controls.js";
import { createDebugOverlay } from "./debug-overlay.js";
import { advanceSimulation, snapshotSimulation } from "./physics/simulation.js";
import { HitboxInspector } from "./hitbox-inspector.js";

const app = new Application();
const viewport = document.querySelector("#viewport");
const network = new Network();
const hitboxInspector = new HitboxInspector(network);
const services = { network, atlases: null };
const metrics = {
  frames: 0,
  loadAttempts: 0,
  loadCommits: 0,
  cancelledLoads: 0,
  frameDeltas: new Float64Array(240),
  drawCpuMs: new Float64Array(240),
  frameCpuMs: new Float64Array(240),
  sampleIndex: 0,
};
let current = null,
  catalog = null,
  input = null,
  controls = null,
  overlay = null,
  observer = null;
let paused = false,
  debug = false,
  follow = true,
  destroyed = false,
  initialized = false;
let transition = null,
  neighbors = null,
  generation = 0,
  loading = false,
  lastError = null;
let lastNow = 0,
  frameHandle = 0,
  demandTimer = null,
  inspectionTimer = null;

function showError(error) {
  lastError = error.message;
  document.querySelector("#error").textContent = lastError;
  document.querySelector("#error").hidden = false;
}
function clearError() {
  lastError = null;
  document.querySelector("#error").hidden = true;
}
function entityById(id) {
  const entity = current?.byId.get(id);
  if (!entity) throw new Error(`Entity is not resident: ${id}`);
  return entity;
}
/** Actor-centered, unclamped camera follow is explicitly a browser inspection policy. */
function updatePlayer(ms) {
  if (!current) return;
  advanceSimulation(current.simulation, input.state, ms);
  const sim = current.simulation;
  if (sim.diagnostics.fault) {
    throw new Error(`Physics stopped: ${sim.diagnostics.fault}`);
  }
  updatePresentation(current);
  current.updateActor(current.presentation);
  if (follow) {
    current.camera.x = current.presentation.x - app.screen.width / 2;
    current.camera.y = current.presentation.y - app.screen.height * 0.65;
  }
  for (const entity of current.entities) entity.advance(ms);
}
/** Browser presentation interpolation; raw original 30ms physics remains untouched. */
function updatePresentation(scene) {
  const sim = scene.simulation;
  const pose = scene.presentation;
  const alpha = Math.min(
    1,
    sim.accumulatorMs / sim.effectiveSettings.quantumMs,
  );
  pose.x = sim.previousX + (sim.x - sim.previousX) * alpha;
  pose.y = sim.previousY + (sim.y - sim.previousY) * alpha;
  pose.facing = sim.facing;
  pose.state = sim.state;
  pose.crouching = sim.crouching;
  scene.hitboxPreview = hitboxInspector.context;
}
function render() {
  if (!initialized || destroyed) return;
  const start = performance.now();
  if (current) {
    current.container.position.set(-current.camera.x, -current.camera.y);
    for (const entity of current.backgrounds) {
      entity.updateBackground(
        current.camera,
        current.manifest.camera,
        app.screen,
      );
    }
  }
  overlay.update(current, debug);
  app.renderer.render(app.stage);
  metrics.drawCpuMs[metrics.sampleIndex] = performance.now() - start;
  metrics.frames++;
}
function tick() {
  if (destroyed) return;
  // rAF's frame-start timestamp can precede a pause/focus reset in that frame.
  const now = performance.now();
  const elapsed = now - lastNow;
  lastNow = now;
  metrics.sampleIndex = (metrics.sampleIndex + 1) % 240;
  metrics.frameDeltas[metrics.sampleIndex] = elapsed;
  const started = now;
  try {
    if (!paused && !document.hidden) updatePlayer(elapsed);
    render();
  } catch (error) {
    paused = true;
    showError(error);
  }
  metrics.frameCpuMs[metrics.sampleIndex] = performance.now() - started;
  frameHandle = requestAnimationFrame(tick);
}
function resize() {
  if (destroyed) return;
  // A bounded drawable surface also bounds background repetition pools.
  app.renderer.resize(
    Math.max(1, Math.min(2560, viewport.clientWidth)),
    Math.max(1, Math.min(1440, viewport.clientHeight)),
  );
  if (current) {
    for (const entity of current.backgrounds) {
      entity.prepareBackground(app.screen);
    }
  }
  render();
}
function visibilityChanged() {
  input?.clear();
  lastNow = performance.now();
}
function demand() {
  current?.updateDemand();
}
function inspect() {
  if (current?.lastError && current.lastError !== lastError) {
    showError(new Error(current.lastError));
  }
  controls.refresh(snapshot());
}
async function initialize() {
  await app.init({
    preference: "webgl",
    preferWebGLVersion: 2,
    width: 1,
    height: 1,
    resolution: 1,
    antialias: false,
    background: "#101820",
    autoStart: false,
    sharedTicker: false,
    preserveDrawingBuffer: true,
  });
  if (destroyed) {
    app.destroy(true);
    throw aborted();
  }
  initialized = true;
  app.stage.sortableChildren = true;
  app.canvas.id = "scene-canvas";
  app.canvas.tabIndex = 0;
  app.canvas.setAttribute(
    "aria-label",
    "Playable original asset map. Arrows or WASD move; Space jumps; X attacks.",
  );
  viewport.prepend(app.canvas);
  services.atlases = new AtlasStore(app.renderer, network);
  input = createPlayerInput(app.canvas);
  controls = createControls(api);
  overlay = createDebugOverlay(app);
  observer = new ResizeObserver(resize);
  observer.observe(viewport);
  resize();
  document.addEventListener("visibilitychange", visibilityChanged);
  demandTimer = setInterval(demand, 200);
  inspectionTimer = setInterval(inspect, 500);
  lastNow = performance.now();
  frameHandle = requestAnimationFrame(tick);
}
async function prefetchNeighbors(id) {
  neighbors?.abort();
  neighbors = new AbortController();
  const signal = neighbors.signal;
  const ids = catalog.maps[id].neighbors;
  try {
    for (let index = 0; index < Math.min(ids.length, 2); index++) {
      const info = catalog.maps[ids[index]];
      if (!info) continue;
      validateManifest(await network.json(info, signal));
      check(signal);
    }
  } catch (error) {
    if (error.name !== "AbortError") showError(error);
  }
}
async function prepareCandidate(id, signal) {
  const info = catalog.maps[id];
  if (!info) {
    throw new Error(`Map ${id} is not packaged; traversal unavailable`);
  }
  const manifest = validateManifest(await network.json(info, signal));
  check(signal);
  if (manifest.id !== id) throw new Error("Catalog/map identity mismatch");
  const scene = new StreamScene(manifest, services, app.screen);
  await scene.prepare(signal);
  scene.presentation = {
    x: scene.simulation.x,
    y: scene.simulation.y,
    facing: scene.simulation.facing,
    state: scene.simulation.state,
    crouching: false,
  };
  scene.hitboxPreview = hitboxInspector.context;
  return scene;
}
function commitCandidate(candidate) {
  const previous = current;
  current = candidate;
  app.stage.addChild(candidate.container);
  if (previous) previous.container.visible = false;
  try {
    render();
  } catch (error) {
    current = previous;
    candidate.container.visible = false;
    if (previous) previous.container.visible = true;
    render();
    throw error;
  }
  previous?.destroy();
  input.clear();
  metrics.loadCommits++;
  clearError();
}
/** Resolve the authoritative catalog before constructing a replacement world. */
async function resolveMapId(id, refreshCatalog, signal) {
  await rendererReady;
  check(signal);
  if (!catalog || refreshCatalog) {
    catalog = validateCatalog(await network.catalog(signal));
  }
  check(signal);
  return id || current?.manifest.id || catalog.defaultMap;
}

async function loadMap(id, refreshCatalog = false) {
  if (destroyed) throw aborted();
  const request = ++generation;
  transition?.abort();
  neighbors?.abort();
  transition = new AbortController();
  const signal = transition.signal;
  loading = true;
  metrics.loadAttempts++;
  let candidate = null;
  try {
    id = await resolveMapId(id, refreshCatalog, signal);
    candidate = await prepareCandidate(id, signal);
    check(signal);
    if (request !== generation || destroyed) throw aborted();
    commitCandidate(candidate);
    candidate = null;
    inspect();
    prefetchNeighbors(id);
    return snapshot();
  } catch (error) {
    candidate?.destroy();
    if (error.name === "AbortError") metrics.cancelledLoads++;
    else if (request === generation) showError(error);
    throw error;
  } finally {
    if (request === generation) loading = false;
  }
}
function sceneSnapshot() {
  if (!current) {
    return {
      currentMap: null,
      camera: null,
      simulation: null,
      entities: [],
      regions: [],
      pendingLoads: 0,
    };
  }
  return {
    currentMap: current.manifest.id,
    camera: { ...current.camera },
    simulation: snapshotSimulation(current.simulation),
    presentation: { ...current.presentation },
    actorArtworkUnsupported: !current.actor.actions.has(
      current.simulation.action,
    )
      ? current.simulation.action
      : null,
    entities: current.entities.map((entity) => entity.snapshot()),
    regions: [...current.regions].map(([id, region]) => ({
      id,
      ready: region.ready,
    })),
    pendingLoads: current.pendingLoads,
    residentSprites: current.spriteCount,
  };
}
function snapshot() {
  return {
    schemaVersion: 2,
    buildId: catalog?.buildId,
    maps: catalog ? Object.keys(catalog.maps) : [],
    paused,
    debug,
    follow,
    loading,
    lastError,
    ...sceneSnapshot(),
    input: input ? { ...input.state } : null,
    hitboxReference: hitboxInspector.selected,
    hitboxes: overlay?.snapshot() ?? null,
    streaming: {
      ...network.snapshot(),
      ...services.atlases?.snapshot(),
      limits: LIMITS,
    },
    metrics: {
      ...metrics,
      frameDeltas: Array.from(metrics.frameDeltas),
      drawCpuMs: Array.from(metrics.drawCpuMs),
      frameCpuMs: Array.from(metrics.frameCpuMs),
    },
  };
}
function destroy() {
  if (destroyed) return;
  destroyed = true;
  generation++;
  transition?.abort();
  neighbors?.abort();
  clearInterval(demandTimer);
  clearInterval(inspectionTimer);
  cancelAnimationFrame(frameHandle);
  observer?.disconnect();
  document.removeEventListener("visibilitychange", visibilityChanged);
  input?.destroy();
  controls?.destroy();
  current?.destroy();
  current = null;
  overlay?.destroy();
  services.atlases?.destroy();
  hitboxInspector.destroy();
  if (initialized) app.destroy(true);
}
const api = {
  ready: null,
  snapshot,
  destroy,
  switchMap(id) {
    const promise = loadMap(String(id));
    api.ready = promise;
    return promise;
  },
  reload() {
    const promise = loadMap(null, true);
    api.ready = promise;
    return promise;
  },
  pause(value) {
    paused = Boolean(value);
    lastNow = performance.now();
    return paused;
  },
  step(ms) {
    finite(ms);
    if (ms < 0 || ms > 10000) {
      throw new Error("Step must be 0–10000 milliseconds");
    }
    if (!paused) throw new Error("Pause before deterministic stepping");
    updatePlayer(ms);
    render();
    return snapshot();
  },
  async setDebug(value) {
    debug = Boolean(value);
    render();
    if (debug) await hitboxInspector.load(catalog?.hitboxes);
    else hitboxInspector.controller?.abort();
    render();
  },
  setGeometryReference(id) {
    hitboxInspector.select(id);
    if (current) current.hitboxPreview = hitboxInspector.context;
    render();
  },
  setFollow(value) {
    follow = Boolean(value);
  },
  setCamera(x, y) {
    finite(x);
    finite(y);
    if (!current) throw new Error("No map loaded");
    follow = false;
    current.camera.x = x;
    current.camera.y = y;
  },
  setAction(id, action) {
    entityById(id).setAction(action);
  },
  setVisible(id, value) {
    entityById(id).container.visible = Boolean(value);
  },
  setLayer(id, z) {
    finite(z);
    entityById(id).container.zIndex = z;
    current.refreshEntities();
  },
  setPosition(id, x, y) {
    finite(x);
    finite(y);
    const entity = entityById(id);
    if (entity === current.actor) {
      throw new Error(
        "Player position belongs to simulation; keyboard controls movement",
      );
    }
    entity.setPosition(x, y);
  },
};
window.maple = api;
const rendererReady = initialize();
api.reload().catch((error) => {
  if (error.name !== "AbortError") showError(error);
});
