import { Application } from "pixi.js";
import { Network } from "../rendering/stream-network.js";
import { AtlasStore } from "../rendering/stream-atlas.js";
import {
  initializeBrowserSurface,
  resizeBrowserSurface,
} from "../rendering/browser-surface.js";
import {
  catalog as validateCatalog,
  manifest as validateManifest,
  finite,
  LIMITS,
} from "../rendering/stream-validation.js";
import { resourceByteLimit } from "../../public/offline-manifest.js";
import { createSimulation, snapshotSimulation } from "../physics/simulation.js";
import { createPlayerInput } from "../input/player-input.js";
import { createPlayerActions } from "../input/player-actions.js";
import { createDebugOverlay } from "../development/debug-overlay.js";
import { HitboxInspector } from "../development/hitbox-inspector.js";
import { OnlineTransport } from "./transport.js";
import { OnlinePrediction } from "./prediction.js";
import { OnlineScene } from "./scene.js";
import { OnlineUI } from "./ui.js";
import { OnlineInspection } from "./inspection.js";
import { OnlineLogin } from "./login.js";
import { portalEntryContains } from "../world/portal-presentation.js";

const app = new Application();
const controller = new AbortController();
const viewport = document.querySelector("#viewport");
const network = new Network();
const services = { network, atlases: null };
const hitboxInspector = new HitboxInspector(network);
const neutral = Object.freeze({
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  attack: false,
});
let catalog = null;
let current = null;
let ui = null;
let login = null;
let inspection = null;
let input = null;
let actions = null;
let overlay = null;
let observer = null;
let previousTime = 0;
let frame = 0;
let clock = null;
let demand = null;
let inspectionTimer = null;
let generation = 0;
let installing = false;
let destroyed = false;
let debug = false;
let lastError = null;
const transport = new OnlineTransport({
  onSnapshot: install,
  onState: state,
  onMotion: motion,
  onTiming: timing,
  onEvent: event,
  onTransition: transition,
  onStatus: status,
  onCommand: recordCommand,
});
const prediction = new OnlinePrediction({
  onInput: sendInput,
  onResync: resync,
});

function report(error) {
  if (error?.name === "AbortError" || destroyed) return;
  // The user-facing line stays sanitized; the underlying cause stays in the console log.
  if (error?.cause) {
    console.error("Online failure cause:", error.cause?.stack ?? error.cause);
  }
  lastError = error instanceof Error ? error.message : String(error);
  document.querySelector("#ui-status").textContent = lastError;
  if (ui) ui.ui.recordError(error);
  else document.querySelector("#error").value = lastError;
  inspection?.record("error", { message: lastError, code: error?.code });
}

function recordCommand(value) {
  inspection?.record("command", value);
}

function sendInput(sample) {
  return transport.sendInput(sample);
}
function resync(reason) {
  transport.resync(reason);
}
function intent(action) {
  const pending = transport.command(action);
  pending.catch(report);
  return pending;
}
function clearInput() {
  input?.clear();
}
function isBlocked() {
  return (
    destroyed ||
    installing ||
    transport.status !== "active" ||
    Boolean(ui?.ui.blocksGameplay())
  );
}

function status(value) {
  if (destroyed) return;
  login?.status(value);
  ui?.status(value);
  inspection?.status(value);
  if (value.status !== "active") clearInput();
}
function motion(message) {
  try {
    prediction.observe(message);
  } catch (error) {
    report(error);
    transport.resync("prediction-overflow");
  }
}
function timing(value) {
  prediction.timing(value);
}
function event(message) {
  inspection?.event(message);
  Promise.all([ui?.event(message), current?.event(message)]).catch(report);
}
function transition(message) {
  clearInput();
  inspection?.record("transition", message);
}
function state(message) {
  current?.changes(message).catch(failedScene);
}
function failedScene(error) {
  report(error);
  transport.disconnect();
  prediction.clear();
}

/** Stage the authoritative field before replacing any visible field or native-window owner. */
async function install(snapshot) {
  const token = ++generation;
  installing = true;
  try {
    if (current?.fieldEpoch === snapshot.fieldEpoch) {
      await current.queue;
      await current.replace(snapshot);
      installPrediction(current, snapshot);
      await publishNative(snapshot);
      return;
    }
    clearInput();
    const candidate = await prepareScene(snapshot);
    if (token !== generation || destroyed) {
      candidate.destroy();
      throw new DOMException("Scene replacement superseded", "AbortError");
    }
    const previous = current;
    current = candidate;
    installPrediction(candidate, snapshot);
    app.stage.addChildAt(candidate.scene.container, 0);
    try {
      await publishNative(snapshot);
      previous?.destroy();
    } catch (error) {
      current = previous;
      candidate.destroy();
      throw error;
    }
    resize();
    app.canvas.focus();
  } finally {
    if (token === generation) installing = false;
  }
}

async function prepareScene(snapshot) {
  const descriptor =
    catalog.maps[String(snapshot.field.mapId).padStart(9, "0")];
  if (!descriptor) throw new Error("Server field is not in this asset catalog");
  const manifest = validateManifest(
    await network.json(descriptor, controller.signal),
  );
  const candidate = new OnlineScene({
    app,
    manifest,
    services,
    catalog,
    viewport: app.screen,
    intent,
  });
  try {
    await candidate.prepare(snapshot);
    return candidate;
  } catch (error) {
    candidate.destroy();
    throw error;
  }
}

function installPrediction(candidate, snapshot) {
  prediction.install(
    createSimulation(
      candidate.scene.manifest.physics,
      snapshot.self.entity.position,
    ),
    snapshot.serverTick,
  );
  candidate.syncPrediction(prediction, false);
}

async function publishNative(snapshot) {
  login.status({ status: "active" });
  await ui.update(snapshot);
  input.setBindings(ui.bindings);
  inspection.update(snapshot);
  current?.setNativePresentation(ui.quests).catch(report);
}

/** Native portal intent uses the original contact rectangle; the server admits the transition. */
function portal() {
  if (!current || isBlocked()) return;
  const self = transport.model?.self.entity;
  if (!self) return;
  const selected = entryPortal(
    current.scene.manifest.physics.portals ?? [],
    self.position,
  );
  if (selected) intent({ kind: "portal.enter", portalId: Number(selected.id) });
}

const ENTRY_TYPES = [1, 2, 4, 5, 7, 8, 10, 11];

/** Nearest portal whose original contact rectangle contains the player's feet. */
function entryPortal(portals, position) {
  let selected = null;
  let distance = Infinity;
  for (const portal of portals) {
    if (!ENTRY_TYPES.includes(portal.type)) continue;
    if (!portalEntryContains(portal, position)) continue;
    const dx = portal.x - position.x;
    const dy = portal.y - position.y;
    const next = dx * dx + dy * dy;
    if (next < distance) {
      selected = portal;
      distance = next;
    }
  }
  return selected;
}

/** Only the authenticated predictor's fixed scheduler advances movement, never RAF. */
function advance() {
  if (destroyed || transport.status !== "active" || document.hidden) return;
  try {
    if (input.state.upPressed && !isBlocked()) portal();
    const steps = prediction.advance(
      performance.now(),
      isBlocked() ? neutral : input.state,
    );
    if (steps) input.afterTick();
  } catch (error) {
    failedScene(error);
  }
}
function draw(now) {
  if (destroyed) return;
  const elapsed = previousTime ? Math.min(now - previousTime, 100) : 0;
  previousTime = now;
  try {
    current?.draw(now, elapsed, prediction, transport.status === "active");
    ui?.draw(elapsed);
    login?.draw(elapsed);
    if (current) current.scene.hitboxPreview = hitboxInspector.context;
    overlay?.update(current?.scene, debug);
    app.renderer.render(app.stage);
  } catch (error) {
    failedScene(error);
  }
  frame = requestAnimationFrame(draw);
}
function updateDemand() {
  current?.scene.updateDemand();
  if (current?.scene.lastError) failedScene(new Error(current.scene.lastError));
}
function inspect() {
  inspection?.update(transport.model);
}
function resize() {
  if (destroyed) return;
  resizeBrowserSurface(app, viewport);
  current?.resize(app.screen.width, app.screen.height);
  ui?.resize(app.screen.width, app.screen.height);
  login?.resize(app.screen.width, app.screen.height);
}

/** Inspection clones are sampled outside rendering; none can be committed as character state. */
function snapshot() {
  const scene = current?.scene;
  return {
    schemaVersion: 2,
    sourceBuildId: import.meta.MAPLE_SOURCE_ID,
    buildId: catalog?.buildId ?? null,
    maps: catalog ? Object.keys(catalog.maps) : [],
    ...snapshotField(scene),
    ...snapshotSession(),
    simulation: prediction.simulation
      ? snapshotSimulation(prediction.simulation)
      : null,
    ...snapshotUI(),
    streaming: {
      ...network.snapshot(),
      ...services.atlases?.snapshot(),
      limits: LIMITS,
    },
    online: transport.snapshot(),
    prediction: prediction.snapshot(),
  };
}

function snapshotField(scene) {
  return {
    currentMap: scene?.manifest.id ?? null,
    debug,
    follow: current?.follow ?? true,
    loading: installing || transport.status === "synchronizing",
    lastError,
    camera: scene ? { ...scene.camera } : null,
    pendingLoads: scene?.pendingLoads ?? 0,
    ...current?.inspectionSnapshot(),
    // Shared scene controls read the offline entity-id array contract; the count is entityCount.
    entities: entityIds(),
  };
}

function entityIds() {
  return (transport.model?.entities ?? []).map((entity) => entity.id);
}

function snapshotSession() {
  return {
    paused: transport.model?.presentation?.paused ?? prediction.paused,
    input: input ? { ...input.state } : null,
  };
}

function snapshotUI() {
  return {
    profile: ui?.store?.profile ?? null,
    ui: ui?.ui.snapshot() ?? null,
    hitboxReference: hitboxInspector.selected,
    hitboxes: overlay?.snapshot() ?? null,
  };
}

function entityById(id) {
  const entity = current?.scene.byId.get(id);
  if (!entity) throw new Error("Entity is not resident in the current field");
  return entity;
}
async function setDebug(value) {
  debug = Boolean(value);
  if (debug) await hitboxInspector.load(catalog?.hitboxes);
  else hitboxInspector.controller?.abort();
}
function setGeometryReference(id) {
  hitboxInspector.select(id);
}
function setAction(id, action) {
  const entity = entityById(id);
  if (entity.kind === "character" || entity.kind === "mob") {
    throw new Error("Online live actor poses belong to server observations");
  }
  entity.setAction(action);
}
function setVisible(id, value) {
  entityById(id).container.visible = Boolean(value);
}
function setLayer(id, z) {
  finite(z);
  entityById(id).container.zIndex = z;
  current.scene.refreshEntities();
}

async function loadCatalog() {
  const bytes = await network.fetchBytes(
    "/generated/catalog.json",
    controller.signal,
    resourceByteLimit("/generated/catalog.json"),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hash = "";
  for (const byte of digest) hash += byte.toString(16).padStart(2, "0");
  if (hash !== transport.config.catalogHash) {
    throw new Error("Server catalog identity mismatch");
  }
  const value = validateCatalog(JSON.parse(new TextDecoder().decode(bytes)));
  if (value.buildId !== transport.config.assetBuildId) {
    throw new Error("Server asset build mismatch");
  }
  return value;
}

function initializeInterfaces() {
  input = createPlayerInput(app.canvas);
  ui = new OnlineUI(app, services, transport, {
    scene: () => current,
    prediction,
    clearInput,
    keyDown: input.keyDown,
    inputGeneration: () => input.generation,
    focusGame: () => app.canvas.focus(),
    intent,
    report,
    isBlocked,
    tap: input.tap,
    portal,
  });
  actions = createPlayerActions({
    input,
    getSystems: () => ui,
    canvas: app.canvas,
  });
  login = new OnlineLogin({
    app,
    services,
    transport,
    audio: ui.audio,
    hooks: { report },
  });
  inspection = new OnlineInspection({
    transport,
    prediction,
    hooks: {
      scene: () => current,
      systems: () => ui,
      catalog: () => catalog,
      snapshot,
      api,
      report,
      input,
      canvas: app.canvas,
      clearInput,
      dispatch: actions.dispatch,
      actions,
    },
  });
  inspection.prepare();
  api.agent = inspection.agent.api;
  api.dev = inspection.dev;
  overlay = createDebugOverlay(
    app,
    document.querySelector("#geometry-readout"),
  );
}

async function initialize() {
  await initializeBrowserSurface(app, viewport);
  if (destroyed) throw new DOMException("Client closed", "AbortError");
  services.atlases = new AtlasStore(app.renderer, network);
  initializeInterfaces();
  await transport.initialize();
  catalog = await loadCatalog();
  await ui.prepare(catalog, controller.signal);
  startPresentation();
  await login.prepare(catalog, controller.signal);
  status(transport.snapshot());
}

function startPresentation() {
  observer = new ResizeObserver(resize);
  observer.observe(viewport);
  resize();
  window.addEventListener("pagehide", leaving, { signal: controller.signal });
  window.addEventListener("error", browserError, { signal: controller.signal });
  window.addEventListener("unhandledrejection", browserRejection, {
    signal: controller.signal,
  });
  // Poll well inside one 30ms quantum so each step lands close to its tick boundary;
  // presentation interpolation stretches one quantum per step, so a late step is the
  // remaining source of uneven presented speed. Still a fixed scheduler, never RAF.
  clock = setInterval(advance, 4);
  demand = setInterval(updateDemand, 200);
  inspectionTimer = setInterval(inspect, 500);
  frame = requestAnimationFrame(draw);
}
function browserError(event) {
  report(event.error ?? new Error(event.message));
}
function browserRejection(event) {
  report(event.reason);
}
function leaving() {
  shutdown().catch(report);
}
async function shutdown() {
  if (destroyed) return;
  destroyed = true;
  generation++;
  controller.abort();
  cancelAnimationFrame(frame);
  clearInterval(clock);
  clearInterval(demand);
  clearInterval(inspectionTimer);
  observer?.disconnect();
  transport.close();
  input?.destroy();
  inspection?.destroy();
  login?.destroy();
  current?.destroy();
  prediction.clear();
  hitboxInspector.destroy();
  overlay?.destroy();
  await ui?.destroy();
  services.atlases?.destroy();
  app.destroy(true, { children: true });
}

const api = {
  ready: null,
  snapshot,
  destroy: shutdown,
  setDebug,
  setGeometryReference,
  setAction,
  setVisible,
  setLayer,
  mapName: (id) =>
    catalog?.mapNames[Number(id)] ?? "Original map name unavailable",
  monsterCatalog: () => (catalog ? Object.values(catalog.monsters ?? {}) : []),
  onKeyConfig: () => ui.activateBinding("KeyConfig"),
  onError: report,
  setFollow: (value) => current?.setFollow(Boolean(value)),
  setCamera(x, y) {
    finite(x);
    finite(y);
    if (!current) throw new Error("No map loaded");
    current.setCamera(x, y);
  },
  captureAudio: (seconds) => ui.audio.capturePCM(seconds),
};
window.maple = api;
window.mapleOnline = Object.freeze({
  snapshot: () =>
    Object.freeze({
      ...transport.snapshot(),
      prediction: prediction.snapshot(),
    }),
  observation: () => transport.model,
  command: intent,
  reconnect: () => transport.reconnect(),
  project: (x, y) => current?.project(x, y) ?? null,
});
api.ready = initialize();
api.ready.catch(report);
