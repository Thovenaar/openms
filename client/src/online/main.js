import { Application } from "pixi.js";
import { Network } from "../rendering/stream-network.js";
import { AtlasStore } from "../rendering/stream-atlas.js";
import {
  catalog as validateCatalog,
  manifest as validateManifest,
} from "../rendering/stream-validation.js";
import { resourceByteLimit } from "../../public/offline-manifest.js";
import { createSimulation } from "../physics/simulation.js";
import { OnlineTransport } from "./transport.js";
import { OnlinePrediction } from "./prediction.js";
import { OnlineScene } from "./scene.js";
import { OnlineUI } from "./ui.js";

const app = new Application();
const controller = new AbortController();
const network = new Network();
const services = { network, atlases: null };
const held = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  attack: false,
};
const keys = new Set();
let catalog = null;
let current = null;
let ui = null;
let previousTime = 0;
let frame = 0;
let clock = null;
let demand = null;
let generation = 0;
const transport = new OnlineTransport({
  onSnapshot: install,
  onState: state,
  onMotion: motion,
  onTiming: timing,
  onEvent: event,
  onTransition: transition,
  onStatus: status,
});
const prediction = new OnlinePrediction({
  onInput: sendInput,
  onResync: resync,
});

function report(error) {
  if (ui) ui.report(error);
  else document.querySelector("#notice").textContent = String(error);
}
function sendInput(sample) {
  return transport.sendInput(sample);
}
function resync(reason) {
  transport.resync(reason);
}
function intent(action) {
  ui.command(action);
}
function status(value) {
  ui?.status(value);
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
  ui.event(message).catch(report);
}
function transition(message) {
  clearInput();
  ui.report(`Transition ${message.phase}: ${message.code}`);
}
function state(message) {
  if (current) current.changes(message).catch(failedScene);
}
function failedScene(error) {
  report(error);
  transport.disconnect();
  prediction.clear();
}

/** Prepare a candidate from the committed observation, retaining the previous field on failure. */
async function install(snapshot) {
  const token = ++generation;
  if (current?.fieldEpoch === snapshot.fieldEpoch) {
    await current.queue;
    await current.replace(snapshot);
    prediction.install(
      createSimulation(
        current.scene.manifest.physics,
        snapshot.self.entity.position,
      ),
      snapshot.serverTick,
    );
    ui.update(snapshot);
    return;
  }
  clearInput();
  const descriptor =
    catalog.maps[String(snapshot.field.mapId).padStart(9, "0")];
  if (!descriptor) throw new Error("Server field is not in this asset catalog");
  const manifest = validateManifest(
    await network.json(descriptor, controller.signal),
  );
  if (token !== generation) throw new Error("Scene replacement superseded");
  const candidate = new OnlineScene({
    manifest,
    services,
    catalog,
    viewport: app.screen,
    intent,
  });
  try {
    await candidate.prepare(snapshot);
    if (token !== generation) throw new Error("Scene replacement superseded");
    const simulation = createSimulation(
      manifest.physics,
      snapshot.self.entity.position,
    );
    prediction.install(simulation, snapshot.serverTick);
    const previous = current;
    current = candidate;
    app.stage.addChildAt(candidate.scene.container, 0);
    previous?.destroy();
    ui.update(snapshot);
    app.canvas.focus();
  } catch (error) {
    candidate.destroy();
    throw error;
  }
}
function sampleInput() {
  held.jump = keys.has("AltLeft") || keys.has("AltRight") || keys.has("Space");
  held.left = keys.has("ArrowLeft");
  held.right = keys.has("ArrowRight");
  held.up = keys.has("ArrowUp");
  held.down = keys.has("ArrowDown");
  held.attack = keys.has("ControlLeft") || keys.has("ControlRight");
}
function clearInput() {
  keys.clear();
  sampleInput();
}
function keydown(event) {
  if (event.target !== app.canvas || event.metaKey) return;
  const movement = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "AltLeft",
    "AltRight",
    "Space",
    "ControlLeft",
    "ControlRight",
  ];
  if (movement.includes(event.code)) {
    event.preventDefault();
    keys.add(event.code);
    sampleInput();
  }
  if (event.repeat || transport.status !== "active") return;
  if (event.code === "KeyZ") {
    event.preventDefault();
    pickup();
  }
  if (event.code === "ArrowUp") portal();
  if (event.code === "KeyN") interact();
}
function keyup(event) {
  keys.delete(event.code);
  sampleInput();
}
function nearest(kind) {
  if (!current) return null;
  const self = current.views.get(current.selfId)?.entity;
  if (!self) return null;
  let nearestEntity = null,
    distance = Infinity;
  for (const view of current.views.values()) {
    if (view.entity.kind !== kind) continue;
    const dx = view.entity.position.x - self.position.x;
    const dy = view.entity.position.y - self.position.y;
    const next = dx * dx + dy * dy;
    if (next < distance) {
      distance = next;
      nearestEntity = view.entity;
    }
  }
  return nearestEntity;
}
function pickup() {
  const drop = nearest("drop");
  if (drop) intent({ kind: "drop.pickup", dropId: drop.id });
}
function interact() {
  const npc = nearest("npc");
  if (npc) intent({ kind: "npc.open", npcId: npc.id });
}
function portal() {
  if (!current) return;
  const self = current.views.get(current.selfId)?.entity;
  let selected = null,
    distance = Infinity;
  for (const portal of current.scene.manifest.physics.portals ?? []) {
    if (![1, 2, 4, 5, 7, 8, 10, 11].includes(portal.type)) continue;
    const dx = portal.x - self.position.x,
      dy = portal.y - self.position.y;
    // Original manual portal contact rectangle; server independently checks it.
    if (dx <= -20 || dx > 20 || dy <= -50 || dy > 50) continue;
    const next = dx * dx + dy * dy;
    if (next < distance) {
      selected = portal;
      distance = next;
    }
  }
  if (selected) intent({ kind: "portal.enter", portalId: Number(selected.id) });
}
/** Timer follows the server tick schedule; RAF never advances simulation. */
function advance() {
  if (transport.status !== "active" || document.hidden) return;
  try {
    prediction.advance(performance.now(), held);
  } catch (error) {
    failedScene(error);
  }
}
function draw(now) {
  const elapsed = previousTime ? Math.min(now - previousTime, 100) : 0;
  previousTime = now;
  try {
    current?.draw(now, elapsed, prediction, transport.status === "active");
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
function visibility() {
  if (document.hidden) clearInput();
}
function shutdown() {
  controller.abort();
  cancelAnimationFrame(frame);
  clearInterval(clock);
  clearInterval(demand);
  transport.close();
  prediction.clear();
  current?.destroy();
  ui?.destroy();
  app.destroy(true, { children: true });
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
async function initialize() {
  await app.init({
    width: 800,
    height: 600,
    background: 0x151923,
    antialias: false,
    resolution: devicePixelRatio,
    autoDensity: true,
    autoStart: false,
  });
  app.canvas.tabIndex = 0;
  app.canvas.setAttribute(
    "aria-label",
    "Online MapleStory field. Arrows move, Alt jumps, Control attacks, Z picks up, N talks.",
  );
  document.querySelector("#viewport").prepend(app.canvas);
  services.atlases = new AtlasStore(app.renderer, network);
  ui = new OnlineUI(app, services, transport, {
    scene: () => current,
    prediction,
  });
  await transport.initialize();
  catalog = await loadCatalog();
  await ui.prepare(catalog, controller.signal);
  ui.status({ status: transport.status });
  window.addEventListener("keydown", keydown, { signal: controller.signal });
  window.addEventListener("keyup", keyup, { signal: controller.signal });
  window.addEventListener("blur", clearInput, { signal: controller.signal });
  document.addEventListener("visibilitychange", visibility, {
    signal: controller.signal,
  });
  window.addEventListener("pagehide", shutdown, { once: true });
  clock = setInterval(advance, 10);
  demand = setInterval(updateDemand, 100);
  frame = requestAnimationFrame(draw);
}
/** Observation/request API only. No local grant, save, profile import, or field mutation. */
window.mapleOnline = Object.freeze({
  snapshot: () =>
    Object.freeze({
      ...transport.snapshot(),
      prediction: prediction.snapshot(),
    }),
  observation: () => transport.model,
  command: (action) => transport.command(action),
  reconnect: () => transport.reconnect(),
  project: (x, y) => current?.project(x, y) ?? null,
});
initialize().catch(report);
