import { Application } from "pixi.js";
import { Network, check, aborted } from "./rendering/stream-network.js";
import { AtlasStore } from "./rendering/stream-atlas.js";
import { StreamScene } from "./rendering/stream-scene.js";
import {
  catalog as validateCatalog,
  manifest as validateManifest,
  finite,
  LIMITS,
} from "./rendering/stream-validation.js";
import { createPlayerInput } from "./input/player-input.js";
import { createControls } from "./development/scene-controls.js";
import { initializeInspectionTheme } from "./development/inspection-theme.js";
import { createDebugOverlay } from "./development/debug-overlay.js";
import {
  advanceSimulation,
  relocateSimulation,
  snapshotSimulation,
} from "./physics/simulation.js";
import { HitboxInspector } from "./development/hitbox-inspector.js";
import { InGameSystems } from "./ingame.js";
import { ProfileStore } from "./profile/profile-store.js";
import {
  createCameraFilter,
  evaluateCameraFilter,
  followCamera,
} from "./rendering/camera.js";
import { initializeOfflineDelivery } from "./delivery/offline-delivery.js";
import { RuntimeCache } from "./delivery/runtime-cache.js";
import { createAgentInterface } from "./development/agent-integration.js";
import {
  AgentDevelopment,
  scenarioProfile,
} from "./development/agent-development.js";
import {
  REVIVAL_POLICY,
  revivalMap,
  revivalArrival,
} from "./character/revival.js";
import { FieldTransition } from "./world/field-transition.js";
import { prepareFieldAvatar } from "./character/field-avatar.js";
import { prepareFamilyTravel } from "./social/family-travel.js";
import {
  resolveMarketTravel,
  selectMarketReturnPortal,
} from "./world/portal-system.js";
import { arrivalPosition, fieldArrival } from "./world/field-arrival.js";
import { GameDiagnostics } from "./development/game-diagnostics.js";
import {
  diagnosticContext,
  compareDiagnosticState,
} from "./development/diagnostic-context.js";

const sourceBuildId = import.meta.MAPLE_SOURCE_ID ?? null;
let agentSurface = null;
let development = null;
let diagnostics = null;

const app = new Application();
const viewport = document.querySelector("#viewport");
const fieldTransition = new FieldTransition();
const fieldFade = document.createElement("div");
fieldFade.style.cssText =
  "position:absolute;inset:0;background:#000;pointer-events:none;z-index:2147483646";
fieldFade.hidden = true;
fieldFade.setAttribute("aria-hidden", "true");
viewport.append(fieldFade);
let displayedFade = 0;
const network = new Network();
const consoleEvents = new AbortController();
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
const runtimeCache = new RuntimeCache({
  delivery: () => offlineDelivery,
  scene: () => current,
  store: () => profileStore,
  catalog: () => catalog,
  signal: () => consoleEvents.signal,
  report: reportCacheError,
});
let paused = false,
  debug = false,
  follow = true,
  destroyed = false,
  initialized = false,
  presentationVisible = true;
let transition = null,
  generation = 0,
  loading = false,
  lastError = null;
let lastNow = 0,
  frameHandle = 0,
  demandTimer = null,
  inspectionTimer = null;
// Browser policy: retain startup failures until the native log surface can own them.
const MAX_STARTUP_ERRORS = 32;
const startupErrors = [];

function showError(error) {
  if (error?.name === "AbortError") return;
  const failure = error instanceof Error ? error : new Error(String(error));
  lastError = failure.message;
  if (inGame) inGame.ui.recordError(failure);
  else {
    if (startupErrors.length === MAX_STARTUP_ERRORS) startupErrors.shift();
    startupErrors.push(failure);
    document.querySelector("#error").value = startupErrors
      .map((entry) => entry.stack || entry.message)
      .join("\n\n");
  }
}
function clearError() {
  lastError = null;
}

function refreshErrorLog() {
  inGame?.ui.logs.refresh();
}

/** Capture uncaught runtime failures without suppressing the browser's own diagnostics. */
function browserError(event) {
  if (event.error) showError(event.error);
  else if (event.message) showError(new Error(event.message));
  else {
    const resource = event.target?.src ?? event.target?.href;
    if (resource) showError(new Error(`Resource failed to load: ${resource}`));
  }
}

function browserRejection(event) {
  showError(event.reason);
}

window.addEventListener("error", browserError, {
  capture: true,
  signal: consoleEvents.signal,
});
window.addEventListener("unhandledrejection", browserRejection, {
  signal: consoleEvents.signal,
});
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
  if (!development?.session) diagnostics?.tick();
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
  const gameplay = scene.fieldSystems.gameplay;
  if (gameplay.phase === "attack" || gameplay.phase === "cast") {
    scene.actor.seek(gameplay.attackAnimationMs);
  }
}
function fieldInputBlocked() {
  return (
    loading ||
    destroyed ||
    fieldTransition.blocksInput ||
    Boolean(profileStore?.profileTransactionPending) ||
    Boolean(
      inGame?.isOperationPending() || inGame?.cashStage || inGame?.ui.resetting,
    )
  );
}
/** Retain a failed quantum attempt as well as completed ticks in the native diagnostic journal. */
function updatePlayer(ms) {
  const before = diagnostics?.ticks ?? 0;
  const simulation = current?.simulation;
  const physicsTicks = simulation?.diagnostics.ticks ?? 0;
  try {
    advanceWorld(ms);
  } catch (error) {
    diagnostics?.simulationFailure(
      before,
      (simulation?.diagnostics.ticks ?? physicsTicks) - physicsTicks,
    );
    throw error;
  }
}
function advanceWorld(ms) {
  const scene = current;
  if (!scene || fieldInputBlocked()) return;
  scene.fieldSystems.beforePhysics(input.state);
  if (current !== scene || fieldInputBlocked()) return;
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
/** Each retained scene owns its renderer timeline; temporary scenarios never advance the baseline clock. */
function presentCamera(scene, initial = false) {
  const filter = scene.cameraFilter;
  // Shape2D's vector cache evaluates at most once at the same signed millisecond.
  if (
    !filter.initialized ||
    filter.committedTime !== (Math.trunc(scene.cameraTimeMs) | 0)
  ) {
    evaluateCameraFilter(filter, scene.presentation, scene.cameraTimeMs);
  }
  if (follow || initial) {
    followCamera(
      scene.camera,
      scene.cameraFilter,
      scene.manifest.physics,
      app.screen,
    );
  }
}

/** Render time is independent of portal/physics admission and advances only from its explicit owner. */
function advanceCamera(ms) {
  if (!current) return;
  current.cameraTimeMs += ms;
  presentCamera(current);
}

/** Original global brightness covers world and UI; unchanged frames do no DOM work. */
function paintFieldFade() {
  const opacity = fieldTransition.opacity;
  if (displayedFade === opacity) return;
  displayedFade = opacity;
  fieldFade.style.opacity = String(opacity);
  fieldFade.hidden = opacity === 0;
}
function render() {
  if (!initialized || destroyed) return;
  const start = performance.now();
  paintFieldFade();
  if (current) {
    presentCamera(current);
    current.container.position.set(-current.camera.x, -current.camera.y);
    for (const entity of current.backgrounds) {
      entity.updateBackground(current.camera, app.screen);
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
    advanceLiveFrame(elapsed);
    render();
  } catch (error) {
    paused = true;
    showError(error);
  }
  metrics.frameCpuMs[metrics.sampleIndex] = performance.now() - started;
  frameHandle = requestAnimationFrame(tick);
}

function advanceLiveFrame(elapsed) {
  // Density-only changes need not dispatch resize or media-query events.
  if (app.renderer.resolution !== window.devicePixelRatio) resize();
  if (document.hidden) return;
  fieldTransition.update(elapsed);
  // The retained owner stays frozen through every asynchronous replay teardown.
  if (diagnostics?.replaying) return;
  inGame.updateInterface(elapsed);
  if (!paused && !loading) updatePlayer(elapsed);
  if (!paused) advanceCamera(elapsed);
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
  diagnostics?.viewportChanged(app.screen.width, app.screen.height);
  if (current) {
    for (const entity of current.backgrounds) {
      entity.prepareBackground(app.screen);
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
  if (!profileCheckpointReady()) return;
  const locationChanged = checkpointLocation();
  const settingsChanged = inGame.checkpointSettings();
  if (locationChanged || settingsChanged) diagnostics?.checkpoint();
}

function profileCheckpointReady() {
  return Boolean(
    current &&
    profileStore?.profile &&
    !loading &&
    !profileStore.profileTransactionPending &&
    (!diagnostics?.replaying || profileStore.temporary),
  );
}

function checkpointLocation() {
  const location = profileStore.profile.location;
  const sim = current.simulation;
  if (
    location.mapId === current.manifest.id &&
    location.x === sim.x &&
    location.y === sim.y &&
    location.facing === sim.facing
  ) {
    return false;
  }
  location.mapId = current.manifest.id;
  location.x = sim.x;
  location.y = sim.y;
  location.facing = sim.facing;
  profileStore.markDirty();
  return true;
}
function pageLeaving() {
  checkpointProfile();
  profileStore?.flush().catch(showError);
}
function inspect() {
  if (diagnostics?.replaying) return;
  if (current?.lastError && current.lastError !== lastError) {
    showError(new Error(current.lastError));
  }
  checkpointProfile();
  if (profileStore?.error) showError(new Error(profileStore.error));
  controls.refresh(snapshot());
}
async function resetSaveAndReload() {
  if (inGame?.native && profileStore.profile) {
    const result = await inGame.native.social.resetParticipant();
    if (!result.ok) throw new Error(result.reason);
  } else await profileStore.reset();
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
async function resetActiveProfile(store) {
  if (store !== profileStore) {
    throw new Error("The reset character is no longer active");
  }
  const result = await inGame.native.social.resetParticipant();
  if (!result.ok) throw new Error(result.reason);
  inGame.useProfile(store);
  input.setBindings(inGame.bindings);
  await reloadAfterReset(store);
}

async function reloadAfterReset(store = profileStore) {
  if (store !== profileStore) return;
  const epoch = inGame?.ui.epoch;
  const wasPaused = paused;
  paused = true;
  try {
    const promise = loadMap(store.profile.location.mapId, false, null, {
      inheritState: false,
    });
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
  initializeInspectionTheme(consoleEvents.signal);
  offlineDelivery = await initializeOfflineDelivery(
    document.querySelector("#offline-controls"),
    prepareInitialMap,
  );
  await offlineDelivery.ready;
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

/** Resolve the durable character first; only new characters need the default map. */
async function prepareInitialMap() {
  const signal = consoleEvents.signal;
  catalog = validateCatalog(await network.catalog(signal));
  if (profileStore && !profileStore.profile) {
    await profileStore.destroy();
    profileStore = null;
  }
  if (!profileStore) {
    profileStore = await ProfileStore.open({
      bootstrapLocation,
      items: catalog.ui.items,
      prepareResources: runtimeCache.prepareProfile,
    });
  }
  requireProfile();
  await profileStore.readStorage();
  document.querySelector("#save-recovery")?.remove();
  return runtimeCache.bootstrap(profileStore);
}

async function bootstrapLocation() {
  initialManifest = validateManifest(
    await network.json(catalog.maps[catalog.defaultMap], consoleEvents.signal),
  );
  const actor = initialManifest.actors.find(
    (entry) => entry.kind === "character",
  );
  return { mapId: initialManifest.id, x: actor.x, y: actor.y, facing: 1 };
}

/** Agent observations carry both source and extracted-data identity. */
function agentStatus() {
  return {
    buildId:
      sourceBuildId && catalog ? `${sourceBuildId}:${catalog.buildId}` : null,
    sourceBuildId,
    assetBuildId: catalog?.buildId ?? null,
    loading,
    fieldTransition: fieldTransition.snapshot(),
    paused,
    lastError,
  };
}

function initializeAgentInterface() {
  development = new AgentDevelopment(developmentHooks());
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
      localReplay: () => diagnostics?.replaying,
      assertLocalReplay: () => diagnostics.assertActive(),
      localReplaySignal: () => diagnostics.replayController.signal,
      settleNative: settleNativeReplay,
      prepareNative: prepareNativeReplay,
      beginDiagnosticCommand: (command) => diagnostics?.command(command),
    },
  });
  api.agent = agentSurface.agent;
  api.dev = agentSurface.dev;
  initializeDiagnostics();
}

function developmentHooks() {
  return {
    state: () => ({
      scene: current,
      store: profileStore,
      gate: inGame.travelGate,
      paused,
      loading,
      follow,
      debug,
      presentationVisible,
      sceneVisible: current?.container.visible,
      systems: inGame,
      input: input.checkpoint(),
      lastError,
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
    assertControl: () =>
      diagnostics?.replaying
        ? diagnostics.assertActive()
        : agentSurface.controller.assertActive(),
    resetObservation: () => agentSurface.observation.reset(),
    notify: () => agentSurface.refreshDevelopment(),
    report: showError,
    localReplay: () => diagnostics?.replaying,
    suspend: suspendDiagnosticSystems,
    restoreIsolation: restoreDiagnosticSystems,
    releaseIsolation: releaseDiagnosticSystems,
    releaseBaseline: () => runtimeCache.releaseBaseline(),
    cancelReplayOperations,
  };
}

function diagnosticIdentity() {
  const status = agentStatus();
  return {
    buildId: status.buildId,
    sourceBuildId,
    assetBuildId: catalog?.buildId ?? null,
    releaseId: offlineDelivery?.state?.pinnedReleaseId ?? null,
  };
}

function captureDiagnosticContext() {
  return diagnosticContext({
    systems: () => inGame,
    scene: () => current,
    input,
    random: () => {
      const scenario = agentSurface.scenarios.snapshot(false);
      return {
        state: diagnostics.replaying
          ? scenario.rng.gameplayState
          : diagnostics.randomState,
        scenario,
      };
    },
    status: agentStatus,
    streaming: () => ({
      network: network.snapshot(),
      atlas: services.atlases.snapshot(),
    }),
    offline: () => offlineDelivery?.snapshot() ?? null,
  });
}

function initializeDiagnostics() {
  diagnostics = new GameDiagnostics({
    canvas: app.canvas,
    systems: () => inGame,
    scene: () => current,
    context: captureDiagnosticContext,
    identity: diagnosticIdentity,
    admit: (recording) => {
      if (
        development.session ||
        development.pending ||
        agentSurface.scenarios.pending
      ) {
        throw new Error(
          "Finish the existing experiment before activating a local diagnostic replay",
        );
      }
      if (loading || !current) {
        throw new Error(
          "Finish field loading before activating a local diagnostic replay",
        );
      }
      inGame.ui.assertReplayReady();
      const expected = recording.initialUI.viewport;
      if (
        expected.width !== app.screen.width ||
        expected.height !== app.screen.height
      ) {
        throw new Error(
          `Replay requires its recorded ${expected.width}×${expected.height} gameplay viewport; current viewport is ${app.screen.width}×${app.screen.height}`,
        );
      }
    },
    run: (recording) => agentSurface.scenarios.run(recording),
    restore: () => agentSurface.scenarios.end(),
    cancel: () => {
      if (!diagnostics?.replaying) return;
      development.interrupt();
      cancelExperimentLoading();
    },
    compare: (expected) =>
      compareDiagnosticState(expected, captureDiagnosticContext()),
  });
}

/** Retain the actual owners, including all ordinary windows and uncommitted option/key drafts. */
async function suspendDiagnosticSystems(baseline, store, signal) {
  input.setBindings(null, true);
  baseline.inputDetached = true;
  baseline.uiState = baseline.systems.ui.suspendForReplay([
    baseline.systems.native.controls.root,
    baseline.systems.audio.controls.root,
    baseline.scene.fieldSystems.life.controls.root,
  ]);
  baseline.audioRunning =
    baseline.systems.audio.audio.context?.state === "running";
  baseline.systems.audio.listenForGesture(false);
  baseline.audioSuspended = true;
  input.clear();
  if (baseline.audioRunning) {
    await baseline.systems.audio.audio.context.suspend();
  }
  check(signal);
  const temporary = createGameSystems();
  baseline.temporarySystems = temporary;
  temporary.ui.stopListeningForInput();
  temporary.ui.replayingNativeInput = true;
  temporary.ui.logs.diagnostics = diagnostics;
  await temporary.prepare(catalog, signal, store);
  check(signal);
  inGame = temporary;
  temporary.ui.listenForInput();
}

/** This path never calls useProfile on the retained owner or reconstructs its windows. */
function restoreDiagnosticSystems(baseline) {
  if (!baseline.inputDetached) return;
  inGame = baseline.systems;
  current = baseline.scene;
  profileStore = baseline.store;
  paused = true;
  follow = baseline.follow;
  debug = baseline.debug;
  presentationVisible = baseline.presentationVisible;
  lastError = baseline.lastError;
  inGame.ui.logs.refresh();
}

async function releaseDiagnosticSystems(baseline) {
  if (!baseline.inputDetached) return;
  input.setBindings(null, true);
  try {
    await retireDiagnosticSystems(baseline.temporarySystems);
  } finally {
    try {
      if (baseline.audioSuspended) {
        if (baseline.audioRunning) {
          await baseline.systems.audio.audio.context.resume();
        } else baseline.systems.audio.listenForGesture(true);
      }
    } finally {
      restoreRetainedPresentation(baseline);
    }
  }
}

async function retireDiagnosticSystems(temporary) {
  if (!temporary) return;
  try {
    await temporary.destroy();
  } finally {
    retireDiagnosticPresentation(temporary);
  }
}

function retireDiagnosticPresentation(temporary) {
  try {
    temporary.ui.discardForReplay();
  } finally {
    try {
      if (temporary.bindings && !temporary.bindings.destroyed) {
        temporary.bindings.destroy();
      }
    } finally {
      try {
        temporary.audio.destroy();
      } finally {
        temporary.audio.audio.destroy();
        for (const native of temporary.nativeByStore.values()) {
          native.controls?.root.remove();
        }
        temporary.audio.controls.root.remove();
        temporary.scene?.fieldSystems.life.controls.root.remove();
      }
    }
  }
}

function restoreRetainedPresentation(baseline) {
  paused = baseline.paused;
  follow = baseline.follow;
  debug = baseline.debug;
  presentationVisible = baseline.presentationVisible;
  current.container.visible = baseline.sceneVisible;
  try {
    if (baseline.uiState) {
      inGame.ui.restoreAfterReplay(baseline.uiState);
      inGame.ui.cursor?.setVisible(inGame.ui.visible);
    }
  } finally {
    input.setBindings(inGame.bindings, true);
    input.restore(baseline.input);
    lastNow = performance.now();
  }
  render();
}

async function cancelReplayOperations(baseline) {
  const temporary = baseline.temporarySystems;
  if (!temporary) return;
  input.setBindings(null, true);
  for (const native of temporary.nativeByStore.values()) {
    native.npc.controller.abort();
  }
  await temporary.ui.cancelForReplay();
  for (let turn = 0; turn < 512; turn++) {
    await browserTurn();
    if (
      !temporary.ui.pending.size &&
      !temporary.ui.chat?.pending &&
      !temporary.isOperationPending()
    ) {
      return;
    }
  }
  throw new Error(
    "Temporary replay operations did not retire within 512 browser turns",
  );
}

function browserTurn() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Wait only for existing owner work; no mutation shortcut or arbitrary callback from imports. */
async function settleNativeReplay() {
  for (let turn = 0; turn < 512; turn++) {
    if (loading) await api.ready;
    await browserTurn();
    if (
      !inGame.ui.pending.size &&
      !inGame.ui.chat.pending &&
      (!inGame.isOperationPending() || nativePromptReady())
    ) {
      return;
    }
  }
  throw new Error("Native replay did not settle within 512 browser turns");
}

function nativePromptReady() {
  const prompt = inGame.ui.windows.get("NativePrompt");
  return Boolean(
    prompt?.element.isConnected &&
    inGame.ui.promptRequest &&
    !inGame.ui.pending.has("NativePrompt"),
  );
}

async function prepareNativeReplay(initialUI) {
  inGame.ui.windowPositions.clear();
  for (const position of initialUI.positions) {
    inGame.ui.windowPositions.set(position.name, {
      x: position.x,
      y: position.y,
    });
  }
  for (const name of initialUI.windows) {
    if (!inGame.ui.windows.has(name)) await inGame.ui.open(name);
    const panel = inGame.ui.windows.get(name);
    const position = inGame.ui.windowPositions.get(name);
    if (position) inGame.ui.positionWindow(panel, position.x, position.y);
  }
  await settleNativeReplay();
  app.canvas.focus({ preventScroll: true });
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
  if (!diagnostics?.replaying) await prepareWindowTransition(true);
  session.store.prepareResources = runtimeCache.prepareProfile;
  const request = ++generation;
  if (!diagnostics?.replaying) {
    diagnostics?.invalidate(
      "An explicit agent experiment replaced the native recording baseline",
    );
  }
  transition?.abort();
  fieldTransition.cancel();
  transition = new AbortController();
  const signal = AbortSignal.any([externalSignal, transition.signal]);
  loading = true;
  try {
    await current?.fieldSystems.drops.waitForIdle();
    check(signal);
    await runtimeCache.retainBaseline();
    check(signal);
    const candidate = await prepareCandidate(session.spec.mapId, signal, null, {
      store: session.store,
      travelGate: session.gate,
      physics: session.spec.physics,
      manifest: session.manifest,
      // A scenario fixture is an explicit placement, not a persisted reload.
      arrival: session.store.profile.location,
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
  store.prepareResources = runtimeCache.prepareProfile;
  inGame.useProfile(store, gate);
  input.setBindings(inGame.bindings, Boolean(diagnostics?.replaying));
  current = scene;
  current.container.visible = true;
  current.fieldSystems.life.controls.root.hidden = false;
  if (!current.container.parent) app.stage.addChild(current.container);
  follow = true;
  debug = false;
  presentationVisible = true;
  current.setPresentationVisible(true);
  inGame.ui.setVisible(true);
  inGame.setScene(scene);
  inGame.restoreSettings();
  input.clear();
  resize();
  clearError();
  runtimeCache.adoptScene(scene, store);
}

function restoreExperimentView(baseline) {
  paused = baseline.paused;
  follow = baseline.follow;
  debug = baseline.debug;
  presentationVisible = baseline.presentationVisible;
  current.setPresentationVisible(presentationVisible);
  current.container.visible = baseline.sceneVisible ?? presentationVisible;
  inGame.ui.setVisible(presentationVisible);
  lastNow = performance.now();
  render();
}

function cancelExperimentLoading() {
  generation++;
  transition?.abort();
  fieldTransition.cancel();
  loading = false;
}

/** At most eight ordinary 30-ms integrations; portal loading may suspend progress. */
function stepExperiment(ticks) {
  if (!paused || !development.session) {
    throw new Error("Pause the temporary scenario before stepping");
  }
  for (let index = 0; index < ticks && !loading; index++) {
    if (diagnostics?.replaying) inGame.updateInterface(30);
    updatePlayer(30);
    advanceCamera(30);
  }
  render();
}

function createGameSystems() {
  return new InGameSystems(app, services, {
    onSceneReleased: runtimeCache.releaseScene,
    now: () =>
      development.session?.clockMs ??
      (diagnostics?.replaying ? 0 : (diagnostics?.clockTicks ?? 0) * 30),
    random: () =>
      development.session || diagnostics?.replaying
        ? agentSurface.scenarios.gameplayRandom()
        : diagnostics.random(),
    temporaryPeers: () => diagnostics?.activeRecording?.spec.peers ?? [],
    onEvent: agentSurface.observation.record.bind(agentSurface.observation),
    clearInput: input.clear,
    keyDown: input.keyDown,
    inputGeneration: () => input.generation,
    focusGame: () => app.canvas.focus(),
    tap: input.tap,
    isBlocked: fieldInputBlocked,
    isTransitioning: () => loading || destroyed || fieldTransition.blocksInput,
    prepareFamilyTravel: prepareLocalFamilyTravel,
    prepareNpcTravel,
    onStatus: (message) => {
      document.querySelector("#ui-status").textContent = message;
    },
    onError: showError,
    travel: travelPortal,
    travelMarket,
    travelDoor,
    onReset: resetActiveProfile,
    onSave: checkpointProfile,
    onRevive: revivePlayer,
  });
}

function initializeInterface() {
  services.atlases = new AtlasStore(app.renderer, network);
  input = createPlayerInput(app.canvas);
  initializeAgentInterface();
  inGame = createGameSystems();
  inGame.ui.logs.diagnostics = diagnostics;
  for (const error of startupErrors) inGame.ui.recordError(error);
  startupErrors.length = 0;
  document.querySelector("#error").addEventListener("blur", refreshErrorLog, {
    signal: consoleEvents.signal,
  });
  controls = createControls({
    ...api,
    onError: showError,
    mapName: (id) =>
      catalog?.mapNames[Number(id)] || "Original map name unavailable",
    onKeyConfig: () => inGame.activateBinding("KeyConfig"),
  });
  overlay = createDebugOverlay(
    app,
    document.querySelector("#geometry-readout"),
  );
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

async function familyManifest(id) {
  const descriptor = catalog.maps[id];
  if (!descriptor) throw new Error(`Family destination ${id} is not packaged`);
  return validateManifest(
    await network.json(descriptor, inGame.ui.controller.signal),
  );
}

async function prepareLocalFamilyTravel(request, social) {
  const state = {
    source: current,
    store: profileStore,
    request: generation,
    ownsLoad: false,
  };
  return prepareFamilyTravel(request, social, {
    activeStore: state.store,
    manifest: familyManifest,
    isCurrent: () =>
      !destroyed &&
      current === state.source &&
      profileStore === state.store &&
      generation === state.request &&
      (!loading || state.ownsLoad),
    prepareScene: (manifest, id) => prepareFamilyScene(manifest, id, state),
    refreshParticipant: (id, invitation) => {
      inGame.ui.refreshProfile();
      agentSurface.observation.record(
        invitation ? "family-summon-request" : "family-travel",
        id,
        null,
      );
    },
  });
}

async function prepareFamilyScene(manifest, portalId, state) {
  const load = beginMapLoad();
  state.request = load.request;
  state.ownsLoad = true;
  const fade = fieldTransition.begin(load.request);
  let candidate = null;
  try {
    candidate = await prepareCandidate(manifest.id, load.signal, portalId, {
      manifest,
    });
    await awaitCandidateCommit(load.request, {}, fade, load.signal);
  } catch (error) {
    candidate?.destroy();
    fieldTransition.fail(load.request);
    if (generation === load.request) loading = false;
    throw error;
  }
  return {
    isCurrent: () =>
      generation === load.request && !load.signal.aborted && !destroyed,
    publish() {
      try {
        commitCandidate(candidate);
        candidate = null;
        fieldTransition.reveal(load.request);
      } finally {
        candidate?.destroy();
        if (generation === load.request) loading = false;
      }
    },
    release() {
      candidate?.destroy();
      candidate = null;
      fieldTransition.fail(load.request);
      if (generation === load.request) loading = false;
    },
  };
}

/** Prepare before the NPC's durable fare/item turn; no field publication before commit. */
async function prepareNpcTravel(travel) {
  const source = current,
    store = profileStore,
    request = generation,
    signal = transition?.signal ?? new AbortController().signal;
  let candidate = null;
  const isCurrent = () =>
    !destroyed &&
    !signal.aborted &&
    current === source &&
    profileStore === store &&
    generation === request;
  if (!source || loading || !isCurrent()) throw aborted();
  try {
    await source.fieldSystems.drops.waitForIdle();
    candidate = await prepareCandidate(
      String(travel.mapId).padStart(9, "0"),
      signal,
      null,
      { npcTravel: travel },
    );
    if (!isCurrent()) throw aborted();
  } catch (error) {
    candidate?.destroy();
    throw error;
  }
  return {
    isCurrent,
    apply(draft) {
      if (!candidate || !isCurrent()) throw aborted();
      draft.location = {
        mapId: candidate.manifest.id,
        x: candidate.simulation.x,
        y: candidate.simulation.y,
        facing: candidate.simulation.facing,
      };
    },
    publish() {
      const prepared = candidate;
      candidate = null;
      commitCandidate(prepared);
      inspect();
    },
    release() {
      candidate?.destroy();
      candidate = null;
    },
  };
}

async function prepareCandidate(id, signal, portalName, context = {}) {
  const info = catalog.maps[id];
  if (!info) {
    throw new Error(`Map ${id} is not packaged; traversal unavailable`);
  }
  const store = context.store ?? profileStore;
  const preparation = await runtimeCache.prepareMap(id, signal, store);
  let scene = null;
  try {
    check(signal);
    let manifest =
      context.manifest ?? (await candidateManifest(id, info, signal));
    check(signal);
    manifest = applyScenarioPhysics(manifest, context.physics);
    if (manifest.id !== id) throw new Error("Catalog/map identity mismatch");
    const saved = store.profile.location;
    const arrival = candidateArrival(manifest, portalName, saved, context);
    scene = new StreamScene(manifest, services, app.screen);
    runtimeCache.trackScene(scene, preparation);
    const source = manifest.actors.find((entry) => entry.kind === "character");
    const avatar = await prepareFieldAvatar(
      inGame.avatars,
      store.profile,
      source,
      signal,
    );
    await scene.prepare(signal, arrival, avatar);
    if (arrival?.facing !== undefined) {
      scene.simulation.facing = arrival.facing;
    }
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
    scene.cameraTimeMs = 0;
    scene.cameraFilter = createCameraFilter();
    presentCamera(scene, true);
    await inGame.prepareScene(scene, signal, context);
    return scene;
  } catch (error) {
    if (scene) {
      runtimeCache.releaseScene(scene);
      scene.destroy();
    } else {
      await runtimeCache.discardMap(preparation).catch(reportCacheError);
    }
    throw error;
  }
}

/** Resolve explicit, saved and authored arrivals before constructing any scene resources. */
function candidateArrival(manifest, portalName, saved, context) {
  if (context.npcTravel) return npcArrival(manifest, context.npcTravel);
  if (context.market?.route.portal?.marketReturn) {
    portalName = selectMarketReturnPortal(manifest.physics);
  }
  if (context.revivalSource && !context.arrival) {
    return revivalArrival(manifest);
  }
  return fieldArrival(manifest, portalName, saved, context.arrival);
}

/** Authorized Character.changeMap falls back to portal zero, unlike ordinary portal links. */
function npcArrival(manifest, travel) {
  const portals = manifest.physics.portals;
  const portal = travel.randomSpawn
    ? randomNpcSpawn(portals)
    : (findNpcPortal(portals, travel.portal) ?? findNpcPortal(portals, 0));
  if (!portal) {
    throw new Error("NPC destination has no authored arrival portal");
  }
  return { x: portal.x, y: portal.y - 10 };
}

function findNpcPortal(portals, selector) {
  for (const portal of portals) {
    if (
      Number.isInteger(selector)
        ? portal.id === selector
        : portal.name === selector
    ) {
      return portal;
    }
  }
  return null;
}

function eligibleNpcSpawn(portal) {
  return portal.type >= 0 && portal.type <= 1 && portal.targetMap === 999999999;
}

/** MapleMap.getRandomPlayerSpawnpoint admits only unlinked type-zero/one spawnpoints. */
function randomNpcSpawn(portals) {
  let count = 0;
  for (const portal of portals) {
    if (eligibleNpcSpawn(portal)) count++;
  }
  if (!count) {
    throw new Error("NPC destination has no eligible random spawnpoint");
  }
  let selected = Math.floor(inGame.hooks.random() * count);
  for (const portal of portals) {
    if (eligibleNpcSpawn(portal) && selected-- === 0) return portal;
  }
  throw new Error("NPC spawn selection exceeded its authored candidates");
}

async function relocatePlayer(name, signal, onCommit, effect) {
  if (!current || destroyed) throw aborted();
  if (profileStore.profileTransactionPending) {
    throw new Error("Character update is still committing");
  }
  if (inGame.isOperationPending()) {
    throw new Error("A native character operation is still pending");
  }
  check(signal);
  const arrival = arrivalPosition(current.manifest, name);
  const path = await prepareRelocation(arrival, signal);
  const departure = { x: current.simulation.x, y: current.simulation.y };
  generation++;
  transition?.abort();
  fieldTransition.cancel();
  loading = false;
  relocateSimulation(current.simulation, arrival);
  path.committed = true;
  if (effect === "Teleport") inGame.audio.playTeleport(departure, arrival);
  updatePresentation(current);
  current.updateActor(current.presentation);
  input.clear();
  checkpointProfile();
  render();
  onCommit?.();
  return snapshot();
}

/** Stage the retained camera corridor while preserving generation ownership. */
async function prepareRelocation(arrival, signal) {
  const scene = current;
  const ownerGeneration = generation;
  const destination = { ...scene.camera };
  if (follow) {
    // 00437b32 attaches the camera target fifty pixels above local-user feet.
    followCamera(
      destination,
      { x: arrival.x, y: arrival.y - 50 },
      scene.manifest.physics,
      app.screen,
    );
  }
  const path = await scene.prepareCameraPath(destination, signal);
  if (
    signal?.aborted ||
    current !== scene ||
    generation !== ownerGeneration ||
    destroyed
  ) {
    scene.cameraPath = null;
    throw aborted();
  }
  return path;
}
/** Dynamic Door feet share staged field publication and the existing travel gate. */
async function travelDoor(endpoint) {
  const gate = inGame.travelGate;
  const token = gate.tryBegin(true);
  if (!token) throw new Error("Another field request is pending or recovering");
  const arrival =
    endpoint.portalName === null ? { x: endpoint.x, y: endpoint.y } : null;
  let outcome = "failed";
  try {
    const promise = loadMap(
      String(endpoint.mapId),
      false,
      endpoint.portalName,
      {
        signal: token.signal,
        fieldTransition: true,
        arrival,
      },
    );
    api.ready = promise;
    const result = await promise;
    outcome = token.signal.aborted ? "cancelled" : "committed";
    if (outcome === "committed") inGame.playSound("Game", "Portal");
    return result;
  } finally {
    gate.complete(token, token.signal.aborted ? "cancelled" : outcome);
  }
}

function travelPortal(id, portalName, options = {}) {
  let request = null;
  const onCommit = () => {
    request = generation;
  };
  const sameMapMotion =
    options.sameMapMotion && String(id) === current?.manifest.id;
  const loading = sameMapMotion
    ? relocatePlayer(portalName, options.signal, onCommit, options.effect)
    : loadMap(String(id), false, portalName, {
        signal: options.signal,
        fieldTransition: options.transition === "field",
        onCommit,
      });
  const promise = loading.then((result) => {
    if (!destroyed && request === generation) {
      if (options.sound !== false) inGame.playSound("Game", "Portal");
      if (options.effect && !sameMapMotion) inGame.playEffect(options.effect);
    }
    return result;
  });
  api.ready = promise;
  return promise;
}
/** Server-reference Free Market memory and destination publish in one local profile transaction. */
function travelMarket(request, options) {
  if (!current || destroyed) throw aborted();
  const route = resolveMarketTravel(request, profileStore.profile);
  const market = {
    route,
    store: profileStore,
    source: current,
    previousLocation: { ...profileStore.profile.location },
    previousReturn: profileStore.profile.savedLocations.FREE_MARKET,
    committed: false,
  };
  const portal = route.portal?.marketReturn ? null : route.portal;
  const promise = loadMap(route.mapId, false, portal, {
    signal: options.signal,
    fieldTransition: true,
    market,
  }).then((result) => {
    if (!destroyed) inGame.playSound("Game", "Portal");
    return result;
  });
  api.ready = promise;
  return promise;
}

async function commitMarketArrival(candidate, market, request, signal) {
  await market.store.commitProfile((draft) => {
    check(signal);
    if (
      destroyed ||
      request !== generation ||
      current !== market.source ||
      profileStore !== market.store
    ) {
      throw aborted();
    }
    draft.savedLocations.FREE_MARKET = market.route.savedLocation;
    draft.location = {
      mapId: candidate.manifest.id,
      x: candidate.simulation.x,
      y: candidate.simulation.y,
      facing: candidate.simulation.facing,
    };
  });
  market.committed = true;
}

/** A failed renderer publication must not consume the saved return field. */
async function rollbackMarketArrival(market, failure) {
  if (!market?.committed) return failure;
  try {
    await market.store.commitProfile((draft) => {
      draft.location = market.previousLocation;
      draft.savedLocations.FREE_MARKET = market.previousReturn;
    });
    return failure;
  } catch (error) {
    return new AggregateError(
      [failure, error],
      "Free Market travel failed and its saved location could not be restored",
    );
  }
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
    fieldTransition: true,
  });
  api.ready = promise;
  return promise;
}
function commitCandidate(candidate, revival = false, inheritState = true) {
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
    inGame.setScene(candidate, inheritState);
    candidate.setPresentationVisible(presentationVisible);
    render();
  } catch (error) {
    rollbackCandidate(candidate, previous, revival, oldHP);
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
  runtimeCache.adoptScene(candidate, profileStore);
  if (!previous && !development.session) diagnostics?.begin();
}

function rollbackCandidate(candidate, previous, revival, oldHP) {
  if (revival) profileStore.profile.hp = oldHP;
  current = previous;
  candidate.container.visible = false;
  if (previous) {
    previous.container.visible = true;
    inGame.setScene(previous);
  }
  render();
}
/** Resolve the authoritative catalog before constructing a replacement world. */
async function resolveMapId(id, refreshCatalog, signal) {
  await rendererReady;
  check(signal);
  if (!catalog || (refreshCatalog && inGame.catalog)) {
    catalog = validateCatalog(await network.catalog(signal));
  }
  if (!inGame.catalog || refreshCatalog) {
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
  fieldTransition.cancel();
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

async function awaitCandidateCommit(request, context, fade, signal) {
  if (fade && !(await fade.covered)) throw aborted();
  check(signal);
  assertCurrentLoad(request, context);
}

async function prepareWindowTransition(closeAll = false) {
  if (!inGame?.native) return;
  await inGame.ui.chat.waitForIdle();
  if (inGame.isOperationPending()) {
    throw new Error("A native character operation is still pending");
  }
  if (
    !(await (closeAll
      ? inGame.ui.requestCloseAll()
      : inGame.ui.requestFieldTransition()))
  ) {
    throw new Error(
      "Close the current native operation before changing fields",
    );
  }
  inGame.native.macros.interrupt("Field transition");
}

/** Publish the prepared field only after any durable location transaction has succeeded. */
function publishCandidate(candidate, context) {
  commitCandidate(
    candidate,
    Boolean(context.revivalSource),
    context.inheritState !== false,
  );
  if (context.market) context.market.committed = false;
  context.onCommit?.();
}

/** Cache ownership follows world ownership; failure cannot undo an adopted field. */
function reportCacheError(error) {
  const failure = error instanceof Error ? error : new Error(String(error));
  if (offlineDelivery) {
    offlineDelivery.error = failure.message;
    offlineDelivery.render();
  }
  showError(
    new Error(`Offline cache ownership update failed: ${failure.message}`, {
      cause: failure,
    }),
  );
}

async function loadMap(id, refreshCatalog, portalName, context = {}) {
  await prepareWindowTransition(Boolean(refreshCatalog));
  const { request, signal } = beginMapLoad(context.signal);
  const fade =
    context.fieldTransition && current ? fieldTransition.begin(request) : null;
  if (fade) input.clear();
  let candidate = null;
  try {
    check(signal);
    await current?.fieldSystems.drops.waitForIdle();
    check(signal);
    id = await resolveMapId(id, refreshCatalog, signal);
    candidate = await prepareCandidate(id, signal, portalName, context);
    await awaitCandidateCommit(request, context, fade, signal);
    if (context.market) {
      await commitMarketArrival(candidate, context.market, request, signal);
    }
    publishCandidate(candidate, context);
    candidate = null;
    await runtimeCache.mapPublication;
    if (fade) fieldTransition.reveal(request);
    inspect();
    return snapshot();
  } catch (error) {
    candidate?.destroy();
    if (fade) fieldTransition.fail(request);
    const failure = await rollbackMarketArrival(context.market, error);
    recordLoadFailure(failure, request);
    throw failure;
  } finally {
    finishMapLoad(request, context.revivalSource);
  }
}

function finishMapLoad(request, revivalSource) {
  if (request !== generation) return;
  loading = false;
  if (revivalSource) inGame.showRevival();
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
    cameraFilter: { ...current.cameraFilter, timeMs: current.cameraTimeMs },
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
    fieldTransition: fieldTransition.snapshot(),
    lastError,
    sourceBuildId,
    agent: agentSurface?.controller.status() ?? null,
    developmentSpawn: current?.fieldSystems.monsterSpawner.availability() ?? {
      available: false,
      reason: "No prepared current field.",
    },
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
async function closeDurableSystems() {
  offlineDelivery?.destroy();
  await profileStore?.destroy();
}

function destroyAgentSystems() {
  agentSurface?.destroy();
  diagnostics?.destroy();
  development?.destroy();
}

async function destroy() {
  if (destroyed) return;
  await prepareWindowTransition(true);
  destroyed = true;
  generation++;
  transition?.abort();
  fieldTransition.cancel();
  fieldFade.remove();
  clearInterval(demandTimer);
  clearInterval(inspectionTimer);
  cancelAnimationFrame(frameHandle);
  observer?.disconnect();
  document.removeEventListener("visibilitychange", visibilityChanged);
  window.removeEventListener("pagehide", pageLeaving);
  consoleEvents.abort();
  await api.ready?.catch((error) => {
    if (error.name !== "AbortError") showError(error);
  });
  await current?.fieldSystems.drops.waitForIdle();
  await retireSceneResources();
}

async function retireSceneResources() {
  destroyAgentSystems();
  input?.destroy();
  controls?.destroy();
  current?.destroy();
  current = null;
  await inGame?.destroy();
  overlay?.destroy();
  services.atlases?.destroy();
  hitboxInspector.destroy();
  await closeDurableSystems();
  if (initialized) app.destroy(true);
}
const api = {
  ready: null,
  snapshot,
  destroy,
  monsterCatalog() {
    return catalog ? Object.values(catalog.monsters ?? {}) : [];
  },
  async spawnMonster(id) {
    if (destroyed || loading || !current) {
      return { ok: false, reason: "No prepared current field." };
    }
    const result = await current.fieldSystems.monsterSpawner.spawn(id);
    render();
    return result;
  },
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
    if (current) current.setPresentationVisible(presentationVisible);
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
    advanceCamera(ms);
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
