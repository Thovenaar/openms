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
import {
  advanceSimulation,
  relocateSimulation,
  snapshotSimulation,
} from "./physics/simulation.js";
import { HitboxInspector } from "./hitbox-inspector.js";
import { InGameSystems } from "./ingame.js";
import { ProfileStore } from "./profile-store.js";
import { followCamera } from "./camera.js";
import { initializeOfflineDelivery } from "./offline-delivery.js";
import { createAgentInterface } from "./agent-integration.js";
import { AgentDevelopment, scenarioProfile } from "./agent-development.js";
import { REVIVAL_POLICY, revivalMap, revivalArrival } from "./revival.js";

const sourceBuildId = import.meta.MAPLE_SOURCE_ID ?? null;
let agentSurface = null;
let development = null;

const app = new Application();
const viewport = document.querySelector("#viewport");
const network = new Network();
const hitboxInspector = new HitboxInspector(network);
const services = { network, atlases: null };
const MAX_DISPLAY_DENSITY = 4;
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
  observer = null,
  inGame = null;
let profileStore = null,
  initialManifest = null,
  offlineDelivery = null;
let paused = false,
  debug = false,
  follow = true,
  destroyed = false,
  initialized = false,
  presentationVisible = true;
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
/** Player/gameplay artwork advances on the one recovered physics clock. */
function advancePlayerTick(ms) {
  const scene = current;
  development?.tick(ms);
  agentSurface?.tick(ms);
  scene.fieldSystems.step(ms, input.state);
  input.afterTick();
  scene.simulation.movementLocked =
    scene.fieldSystems.gameplay.blocksMovement ||
    scene.fieldSystems.portals.blocksMovement;
  scene.presentation.action =
    scene.fieldSystems.gameplay.action ?? scene.simulation.action;
  scene.presentation.playback = scene.fieldSystems.gameplay.playback ?? "loop";
  scene.presentation.tint = scene.fieldSystems.gameplay.blinkTint;
  scene.updateActor(scene.presentation);
  scene.actor.advance(ms);
}
function fieldInputBlocked() {
  return (
    loading || destroyed || Boolean(profileStore?.profileTransactionPending)
  );
}
function updatePlayer(ms) {
  const scene = current;
  if (!scene || fieldInputBlocked()) return;
  scene.fieldSystems.beforePhysics(input.state);
  if (loading || current !== scene) return;
  scene.simulation.movementLocked =
    scene.fieldSystems.gameplay.blocksMovement ||
    scene.fieldSystems.portals.blocksMovement;
  const jumpSequence = current.simulation.groundJumpSequence;
  advanceSimulation(current.simulation, input.state, ms, advancePlayerTick);
  const sim = current.simulation;
  if (sim.diagnostics.fault) {
    throw new Error(`Physics stopped: ${sim.diagnostics.fault}`);
  }
  updatePresentation(current);
  current.updateActor(current.presentation);
  if (follow) {
    followCamera(
      current.camera,
      current.presentation,
      current.manifest.physics,
      app.screen,
    );
  }
  for (const entity of current.entities) {
    if (entity !== current.actor && !entity.gameplayOwned) entity.advance(ms);
  }
  if (sim.groundJumpSequence !== jumpSequence) inGame.playSound("Game", "Jump");
  current.fieldSystems.update(ms, input.state);
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
    // Density-only changes need not dispatch resize or media-query events.
    if (app.renderer.resolution !== window.devicePixelRatio) resize();
    if (!document.hidden) inGame.updateInterface(elapsed);
    // Freeze offline authority during the atomic scene swap, not rendering or UI.
    if (!paused && !document.hidden && !loading) updatePlayer(elapsed);
    render();
  } catch (error) {
    paused = true;
    showError(error);
  }
  metrics.frameCpuMs[metrics.sampleIndex] = performance.now() - started;
  frameHandle = requestAnimationFrame(tick);
}
/** Output density changes backing pixels, never logical gameplay/UI coordinates. */
function displayDensity() {
  const density = window.devicePixelRatio;
  if (
    !Number.isFinite(density) ||
    density <= 0 ||
    density > MAX_DISPLAY_DENSITY
  ) {
    throw new RangeError("Display density must be positive and at most 4.");
  }
  return density;
}

function resize() {
  if (destroyed) return;
  // A bounded drawable surface also bounds background repetition pools.
  app.renderer.resize(
    Math.max(1, Math.min(2560, viewport.clientWidth)),
    Math.max(1, Math.min(1440, viewport.clientHeight)),
    displayDensity(),
  );
  if (current) {
    for (const entity of current.backgrounds) {
      entity.prepareBackground(app.screen);
    }
    if (follow) {
      followCamera(
        current.camera,
        current.presentation,
        current.manifest.physics,
        app.screen,
      );
    }
  }
  inGame?.resize(app.screen.width, app.screen.height);
  render();
}
function visibilityChanged() {
  input?.clear();
  lastNow = performance.now();
  checkpointProfile();
  if (document.hidden) profileStore?.flush().catch(showError);
}
function demand() {
  current?.updateDemand();
}
/** Persist durable values only; no physics graph or render state enters a save. */
function checkpointProfile() {
  if (
    !current ||
    !profileStore?.profile ||
    loading ||
    profileStore.profileTransactionPending
  ) {
    return;
  }
  const location = profileStore.profile.location;
  const sim = current.simulation;
  if (
    location.mapId !== current.manifest.id ||
    location.x !== sim.x ||
    location.y !== sim.y ||
    location.facing !== sim.facing
  ) {
    location.mapId = current.manifest.id;
    location.x = sim.x;
    location.y = sim.y;
    location.facing = sim.facing;
    profileStore.markDirty();
  }
  inGame.checkpointSettings();
}
function pageLeaving() {
  checkpointProfile();
  profileStore?.flush().catch(showError);
}
function inspect() {
  if (current?.lastError && current.lastError !== lastError) {
    showError(new Error(current.lastError));
  }
  checkpointProfile();
  if (profileStore?.error) showError(new Error(profileStore.error));
  controls.refresh(snapshot());
}
async function resetSaveAndReload() {
  await profileStore.reset();
  document.querySelector("#save-recovery")?.remove();
  await reloadAfterReset();
}
function requireProfile() {
  if (profileStore.profile) return;
  if (!document.querySelector("#save-recovery")) {
    const button = document.createElement("button");
    button.id = "save-recovery";
    button.type = "button";
    button.textContent = "Reset corrupt offline save";
    button.addEventListener("click", () =>
      resetSaveAndReload().catch(showError),
    );
    document.querySelector("#inspection-controls").append(button);
  }
  throw new Error(profileStore.error ?? "Offline character save unavailable");
}
async function reloadAfterReset(store = profileStore) {
  if (store !== profileStore) return;
  const epoch = inGame?.ui.epoch;
  const wasPaused = paused;
  paused = true;
  try {
    const promise = loadMap(store.profile.location.mapId, true, null);
    api.ready = promise;
    await promise;
    if (store === profileStore && epoch === inGame?.ui.epoch) {
      inGame.restoreSettings();
    }
  } finally {
    if (store === profileStore && epoch === inGame?.ui.epoch) {
      paused = wasPaused;
      lastNow = performance.now();
    }
  }
}
async function initialize() {
  offlineDelivery = await initializeOfflineDelivery(
    document.querySelector("#inspection-controls"),
  );
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
    "Playable original asset map. Arrows move and climb. Other actions follow your KeyConfig. Enter opens chat.",
  );
  viewport.prepend(app.canvas);
  initializeInterface();
  observer = new ResizeObserver(resize);
  observer.observe(viewport);
  resize();
  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("pagehide", pageLeaving);
  demandTimer = setInterval(demand, 200);
  inspectionTimer = setInterval(inspect, 500);
  lastNow = performance.now();
  frameHandle = requestAnimationFrame(tick);
}

/** Agent observations carry both source and extracted-data identity. */
function agentStatus() {
  return {
    buildId:
      sourceBuildId && catalog ? `${sourceBuildId}:${catalog.buildId}` : null,
    sourceBuildId,
    assetBuildId: catalog?.buildId ?? null,
    loading,
    paused,
    lastError,
  };
}

function initializeAgentInterface() {
  development = new AgentDevelopment({
    state: () => ({
      scene: current,
      store: profileStore,
      gate: inGame.travelGate,
      paused,
      loading,
      follow,
      debug,
      presentationVisible,
    }),
    systems: () => inGame,
    pause: (value) => {
      paused = value;
      lastNow = performance.now();
    },
    checkpoint: checkpointProfile,
    normalize: normalizeScenario,
    prepare: prepareExperiment,
    install: installExperiment,
    restoreView: restoreExperimentView,
    cancelLoading: cancelExperimentLoading,
    assertControl: () => agentSurface.controller.assertActive(),
    resetObservation: () => agentSurface.observation.reset(),
    notify: () => agentSurface.refreshDevelopment(),
    report: showError,
  });
  agentSurface = createAgentInterface({
    input,
    canvas: app.canvas,
    root: document.querySelector("#agent-controls"),
    hooks: {
      scene: () => current,
      systems: () => inGame,
      status: agentStatus,
      render,
      ready: () => Boolean(current && !loading && !destroyed),
      interrupt: () => development.interrupt(),
      experimental: () => Boolean(development.session),
      enter: (spec) => development.enter(spec),
      exit: () => development.exit(),
      step: stepExperiment,
      waitReady: () => api.ready,
      isLoading: () => loading,
      report: showError,
    },
  });
  api.agent = agentSurface.agent;
  api.dev = agentSurface.dev;
}

async function normalizeScenario(spec, signal) {
  const id = spec.mapId ?? spec.profile?.location.mapId ?? current.manifest.id;
  const descriptor = catalog.maps[id];
  if (!descriptor) throw new Error(`Scenario map ${id} is not packaged`);
  const manifest = validateManifest(await network.json(descriptor, signal));
  check(signal);
  return {
    manifest,
    spec: {
      ...spec,
      mapId: id,
      profile: scenarioProfile(spec, profileStore.profile, manifest),
    },
  };
}

async function prepareExperiment(session, externalSignal) {
  const request = ++generation;
  transition?.abort();
  neighbors?.abort();
  transition = new AbortController();
  const signal = AbortSignal.any([externalSignal, transition.signal]);
  loading = true;
  try {
    const candidate = await prepareCandidate(session.spec.mapId, signal, null, {
      store: session.store,
      travelGate: session.gate,
      physics: session.spec.physics,
      manifest: session.manifest,
    });
    candidate.fieldSystems.life.controls.root.hidden = true;
    return candidate;
  } finally {
    if (request === generation) loading = false;
  }
}

/** Synchronous ownership cutover; caller owns retained or discarded scene lifetimes. */
function installExperiment(scene, store, gate) {
  if (destroyed) throw aborted();
  if (current) current.container.visible = false;
  profileStore = store;
  inGame.useProfile(store, gate);
  input.setBindings(inGame.bindings);
  current = scene;
  current.container.visible = true;
  current.fieldSystems.life.controls.root.hidden = false;
  if (!current.container.parent) app.stage.addChild(current.container);
  follow = true;
  debug = false;
  presentationVisible = true;
  current.overlays.visible = true;
  inGame.ui.setVisible(true);
  inGame.setScene(scene);
  inGame.restoreSettings();
  input.clear();
  resize();
  clearError();
}

function restoreExperimentView(baseline) {
  paused = baseline.paused;
  follow = baseline.follow;
  debug = baseline.debug;
  presentationVisible = baseline.presentationVisible;
  current.overlays.visible = presentationVisible;
  inGame.ui.setVisible(presentationVisible);
  lastNow = performance.now();
  render();
}

function cancelExperimentLoading() {
  generation++;
  transition?.abort();
  neighbors?.abort();
  loading = false;
}

/** At most eight ordinary 30-ms integrations; portal loading may suspend progress. */
function stepExperiment(ticks) {
  if (!paused || !development.session) {
    throw new Error("Pause the temporary scenario before stepping");
  }
  for (let index = 0; index < ticks && !loading; index++) updatePlayer(30);
  render();
}

function initializeInterface() {
  services.atlases = new AtlasStore(app.renderer, network);
  input = createPlayerInput(app.canvas);
  initializeAgentInterface();
  inGame = new InGameSystems(app, services, {
    now: () => development.session?.clockMs ?? performance.now(),
    onEvent: agentSurface.observation.record.bind(agentSurface.observation),
    clearInput: input.clear,
    focusGame: () => app.canvas.focus(),
    tap: input.tap,
    isBlocked: fieldInputBlocked,
    onStatus: (message) => {
      document.querySelector("#ui-status").textContent = message;
    },
    onError: showError,
    travel: travelPortal,
    onReset: reloadAfterReset,
    onSave: checkpointProfile,
    onRevive: revivePlayer,
  });
  controls = createControls({
    ...api,
    onKeyConfig: () => inGame.activateBinding("KeyConfig"),
  });
  overlay = createDebugOverlay(
    app,
    document.querySelector("#geometry-readout"),
  );
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
/** Named arrival is explicit offline traversal, never server authorization. */
function arrivalPosition(manifest, name) {
  if (name === null) return null;
  if (typeof name !== "string" || !name || name.length > 128) {
    throw new Error("Invalid destination portal name");
  }
  let selected = null;
  for (const portal of manifest.physics.portals) {
    if (portal.name !== name) continue;
    if (selected) throw new Error(`Ambiguous destination portal ${name}`);
    selected = portal;
  }
  if (!selected) throw new Error(`Destination portal ${name} unavailable`);
  // Original field entry 0094969d subtracts ten pixels from portal feet y.
  finite(selected.x);
  finite(selected.y);
  return { x: selected.x, y: selected.y - 10 };
}

async function candidateManifest(id, info, signal) {
  const manifest =
    initialManifest?.id === id
      ? initialManifest
      : validateManifest(await network.json(info, signal));
  initialManifest = null;
  return manifest;
}

/** Temporary physics overlays never mutate the retained extracted manifest. */
function applyScenarioPhysics(manifest, physics) {
  const overrides = physics ?? development?.session?.spec.physics;
  if (!overrides) return manifest;
  return {
    ...manifest,
    physics: {
      ...manifest.physics,
      globals: { ...manifest.physics.globals, ...overrides.globals },
      map: { ...manifest.physics.map, ...overrides.map },
    },
  };
}

async function prepareCandidate(id, signal, portalName, context = {}) {
  const info = catalog.maps[id];
  if (!info) {
    throw new Error(`Map ${id} is not packaged; traversal unavailable`);
  }
  let manifest =
    context.manifest ?? (await candidateManifest(id, info, signal));
  check(signal);
  manifest = applyScenarioPhysics(manifest, context.physics);
  if (manifest.id !== id) throw new Error("Catalog/map identity mismatch");
  let arrival = context.revivalSource
    ? revivalArrival(manifest)
    : arrivalPosition(manifest, portalName);
  const saved = (context.store ?? profileStore).profile.location;
  if (!context.revivalSource && portalName === null && saved.mapId === id) {
    arrival = saved;
  }
  const scene = new StreamScene(manifest, services, app.screen);
  try {
    await scene.prepare(signal, arrival);
    if (arrival === saved) scene.simulation.facing = saved.facing;
    scene.presentation = {
      x: scene.simulation.x,
      y: scene.simulation.y,
      facing: scene.simulation.facing,
      state: scene.simulation.state,
      crouching: false,
      action: scene.simulation.action,
      tint: 0xffffff,
    };
    scene.hitboxPreview = hitboxInspector.context;
    followCamera(
      scene.camera,
      scene.presentation,
      manifest.physics,
      app.screen,
    );
    await inGame.prepareScene(scene, signal, context);
    return scene;
  } catch (error) {
    scene.destroy();
    throw error;
  }
}

async function relocatePlayer(name, signal) {
  if (!current || destroyed) throw aborted();
  if (profileStore.profileTransactionPending) {
    throw new Error("Character update is still committing");
  }
  check(signal);
  const arrival = arrivalPosition(current.manifest, name);
  generation++;
  transition?.abort();
  neighbors?.abort();
  loading = false;
  relocateSimulation(current.simulation, arrival);
  updatePresentation(current);
  current.updateActor(current.presentation);
  if (follow) {
    followCamera(
      current.camera,
      current.presentation,
      current.manifest.physics,
      app.screen,
    );
  }
  input.clear();
  checkpointProfile();
  render();
  return snapshot();
}
function travelPortal(id, portalName, options = {}) {
  const loading =
    options.sameMapMotion && String(id) === current?.manifest.id
      ? relocatePlayer(portalName, options.signal)
      : loadMap(String(id), false, portalName, { signal: options.signal });
  const request = generation;
  const promise = loading.then((result) => {
    if (!destroyed && request === generation) {
      if (options.sound !== false) inGame.playSound("Game", "Portal");
      if (options.effect) inGame.playEffect(options.effect);
    }
    return result;
  });
  api.ready = promise;
  return promise;
}
async function revivePlayer() {
  const source = current,
    store = profileStore;
  if (
    !source ||
    loading ||
    destroyed ||
    store.profileTransactionPending ||
    !source.fieldSystems.gameplay.dead ||
    store.profile.hp !== 0
  ) {
    throw new Error(
      "Ordinary revival is unavailable during this character/field state",
    );
  }
  const id = revivalMap(source.manifest);
  const promise = loadMap(id, false, null, {
    revivalSource: source,
    store,
  });
  api.ready = promise;
  return promise;
}
function commitCandidate(candidate, revival = false) {
  const previous = current;
  const oldHP = profileStore.profile.hp;
  current = candidate;
  app.stage.addChild(candidate.container);
  if (previous) previous.container.visible = false;
  try {
    if (revival) {
      profileStore.profile.hp = Math.min(
        REVIVAL_POLICY.restoredHP,
        profileStore.profile.maxHP,
      );
      candidate.fieldSystems.gameplay.synchronizeProfile();
    }
    inGame.setScene(candidate);
    candidate.overlays.visible = presentationVisible;
    render();
  } catch (error) {
    if (revival) profileStore.profile.hp = oldHP;
    current = previous;
    candidate.container.visible = false;
    if (previous) previous.container.visible = true;
    if (previous) inGame.setScene(previous);
    render();
    throw error;
  }
  previous?.destroy();
  input.clear();
  lastNow = performance.now();
  const location = profileStore.profile.location;
  location.mapId = candidate.manifest.id;
  location.x = candidate.simulation.x;
  location.y = candidate.simulation.y;
  location.facing = candidate.simulation.facing;
  profileStore.markDirty();
  metrics.loadCommits++;
  agentSurface?.observation.record("map-commit", candidate.manifest.id, null);
  clearError();
}
/** Resolve the authoritative catalog before constructing a replacement world. */
async function resolveMapId(id, refreshCatalog, signal) {
  await rendererReady;
  check(signal);
  if (!catalog || refreshCatalog) {
    catalog = validateCatalog(await network.catalog(signal));
    if (!profileStore) {
      initialManifest = validateManifest(
        await network.json(catalog.maps[catalog.defaultMap], signal),
      );
      const actor = initialManifest.actors.find(
        (entry) => entry.kind === "character",
      );
      profileStore = await ProfileStore.open({
        location: {
          mapId: initialManifest.id,
          x: actor.x,
          y: actor.y,
          facing: 1,
        },
      });
    }
    requireProfile();
    await inGame.prepare(catalog, signal, profileStore);
    input.setBindings(inGame.bindings);
  }
  check(signal);
  return id || current?.manifest.id || profileStore.profile.location.mapId;
}

function recordLoadFailure(error, request) {
  if (error.name === "AbortError") metrics.cancelledLoads++;
  else if (request === generation) showError(error);
}

function beginMapLoad(travelSignal) {
  if (destroyed) throw aborted();
  if (profileStore?.profileTransactionPending) {
    throw new Error("Character update is still committing");
  }
  const request = ++generation;
  transition?.abort();
  neighbors?.abort();
  transition = new AbortController();
  const signal = travelSignal
    ? AbortSignal.any([transition.signal, travelSignal])
    : transition.signal;
  loading = true;
  metrics.loadAttempts++;
  return { request, signal };
}

function assertCurrentLoad(request, context) {
  if (request !== generation || destroyed) throw aborted();
  if (
    context.revivalSource &&
    (current !== context.revivalSource ||
      profileStore !== context.store ||
      profileStore.profile.hp !== 0)
  ) {
    throw aborted();
  }
}

async function loadMap(id, refreshCatalog, portalName, context = {}) {
  const { request, signal } = beginMapLoad(context.signal);
  let candidate = null;
  try {
    check(signal);
    id = await resolveMapId(id, refreshCatalog, signal);
    candidate = await prepareCandidate(id, signal, portalName, context);
    check(signal);
    assertCurrentLoad(request, context);
    commitCandidate(candidate, Boolean(context.revivalSource));
    candidate = null;
    inspect();
    prefetchNeighbors(id);
    return snapshot();
  } catch (error) {
    candidate?.destroy();
    recordLoadFailure(error, request);
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
    field: current.fieldSystems.snapshot(),
  };
}
function durableSystemsSnapshot() {
  return {
    inGame: inGame?.snapshot() ?? null,
    save: profileStore?.snapshot() ?? null,
    offline: offlineDelivery?.snapshot() ?? null,
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
    presentationVisible,
    loading,
    lastError,
    sourceBuildId,
    agent: agentSurface?.controller.status() ?? null,
    ...sceneSnapshot(),
    input: input ? { ...input.state } : null,
    hitboxReference: hitboxInspector.selected,
    hitboxes: overlay?.snapshot() ?? null,
    ...durableSystemsSnapshot(),
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
function closeDurableSystems() {
  offlineDelivery?.destroy();
  profileStore?.destroy().catch(showError);
}

function destroyAgentSystems() {
  agentSurface?.destroy();
  development?.destroy();
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
  window.removeEventListener("pagehide", pageLeaving);
  destroyAgentSystems();
  input?.destroy();
  controls?.destroy();
  inGame?.destroy();
  current?.destroy();
  current = null;
  overlay?.destroy();
  services.atlases?.destroy();
  hitboxInspector.destroy();
  closeDurableSystems();
  if (initialized) app.destroy(true);
}
const api = {
  ready: null,
  snapshot,
  destroy,
  switchMap(id) {
    const promise = loadMap(String(id), false, null);
    api.ready = promise;
    return promise;
  },
  captureAudio(seconds) {
    return inGame.audio.capturePCM(seconds);
  },
  /** Isolate world artwork for the independent atlas oracle; not original UI behavior. */
  setPresentationVisible(value) {
    presentationVisible = Boolean(value);
    inGame.ui.setVisible(presentationVisible);
    if (current) current.overlays.visible = presentationVisible;
    render();
  },
  reload() {
    const promise = loadMap(null, true, null);
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
    if (loading) throw new Error("Cannot step during field replacement");
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
    if (follow && current) {
      followCamera(
        current.camera,
        current.presentation,
        current.manifest.physics,
        app.screen,
      );
    }
    render();
  },
  setCamera(x, y) {
    finite(x);
    finite(y);
    if (!current) throw new Error("No map loaded");
    follow = false;
    current.camera.x = Math.trunc(x);
    current.camera.y = Math.trunc(y);
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
