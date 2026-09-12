import {
  assertWindow,
  clickLabel,
  clickNpc,
  dragWindow,
  focusCanvas,
  mapManifest,
  npcPlacement,
  openWindow,
  player,
  retainWindow,
  seededProfile,
  settled,
  TIMEOUT,
} from "./native.js";
import {
  durableRecords,
  exportDump,
  importDump,
  logStatus,
} from "./diagnostic-io.js";

const MAP = "101000000";
const DRAFT = "한글 native diagnostic draft";

async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const npc = npcPlacement(manifest, 1032003);
  if (npc.authored.x !== 168 || npc.authored.y !== -2882) {
    throw new Error(
      "Shane fixture no longer matches original authored placement",
    );
  }
  const shops = await loadJSON(catalog.serverData.datasets.shops);
  const route = shops.npcRoutes.find((entry) => entry.npcId === 1032003);
  if (route?.status !== "blocked" || !route.blockers?.[0]?.reason) {
    throw new Error(
      "Shane no longer supplies the required genuine deterministic blocked native route",
    );
  }
  return {
    profile: seededProfile(catalog, {
      mapId: MAP,
      x: 200,
      y: -2889,
      facing: -1,
    }),
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      locationSource: npc.source,
      blockedReason: route.blockers[0].reason,
      scriptSource: route.source,
      level: 1,
      policy:
        "Production beginner profile beside real blocked Shane1032003; no injected error or gameplay owner.",
    },
  };
}

async function nativeJournalPaths(context) {
  const { page, checkpoint, assert } = context;
  await openWindow(page, "i", "Item");
  const inventorySelector = '.maple-ui-panel[aria-label="Item"]';
  await page.waitForSelector(`${inventorySelector} [data-item-slot]`, {
    timeout: TIMEOUT,
  });
  const first = await page.$eval(
    `${inventorySelector} [data-item-slot]`,
    (element) => element.dataset.itemSlot,
  );
  const panel = await page.$(inventorySelector);
  const bounds = await panel.boundingBox();
  await page.mouse.move(bounds.x + 65, bounds.y + 160);
  await page.mouse.wheel({ deltaY: 100 });
  await page.waitForFunction(
    (selector, id) =>
      document.querySelector(`${selector} [data-item-slot]`)?.dataset
        .itemSlot !== id,
    { timeout: TIMEOUT },
    inventorySelector,
    first,
  );
  await page.mouse.click(bounds.x + 60, bounds.y + 70, { count: 2 });
  await page.keyboard.press("i");
  await page.waitForSelector(inventorySelector, {
    hidden: true,
    timeout: TIMEOUT,
  });
  await panel.dispose();
  await page.keyboard.press("Enter");
  const ime = await page.createCDPSession();
  try {
    await ime.send("Input.imeSetComposition", {
      text: "한글",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await ime.send("Input.insertText", { text: "한글" });
    await page.keyboard.type(" native diagnostic draft");
  } finally {
    await ime.detach();
  }
  const draft = await page.$eval(
    '[aria-label="Chat message"]',
    (element) => element.value,
  );
  assert(
    draft === DRAFT,
    "Trusted CDP IME commits into the real native chat edit",
    { actual: draft, expected: DRAFT },
  );
  await focusCanvas(page);
  await checkpoint("after-native-scroll-doubleclick-and-ime");
}

function restoreProjection(state) {
  const simulation = state.simulation;
  return {
    map: state.currentMap,
    profile: player(state),
    input: state.input,
    paused: state.paused,
    simulation: {
      x: simulation.x,
      y: simulation.y,
      vx: simulation.vx,
      vy: simulation.vy,
      state: simulation.state,
      facing: simulation.facing,
    },
    bindings: state.inGame.ui.keyBindings,
    accountStorage: state.inGame.accountStorage,
  };
}

async function assertRestored(context, before, records, windows) {
  const { page, snapshot, assert } = context;
  const actual = restoreProjection(await snapshot());
  assert(
    JSON.stringify(actual) === JSON.stringify(before),
    "Replay restores the original live map, feet, profile, account, input, pause state and native bindings",
    { actual, expected: before },
  );
  const durable = await durableRecords(page);
  assert(
    JSON.stringify(durable) === JSON.stringify(records),
    "Replay does not publish temporary profile/account state into durable IDB",
    { actual: durable, expected: records },
  );
  for (const retained of windows) await assertWindow(context, retained);
  const draft = await page.$eval(
    '[aria-label="Chat message"]',
    (element) => element.value,
  );
  assert(draft === DRAFT, "Replay restores the unsent native IME draft");
}

async function waitReplayEnd(page) {
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("#viewport button")).some(
        (button) => button.textContent === "Local replay · Cancel / Escape",
      ),
    { timeout: 150000 },
  );
}

async function replayAndCancel(context, baseline, records, windows) {
  const { page, assert, checkpoint } = context;
  await checkpoint("before-native-local-replay");
  await clickLabel(
    page,
    "Replay locally",
    '.maple-ui-panel[aria-label="Game Logs"]',
  );
  await waitReplayEnd(page);
  const replay = await logStatus(page);
  assert(
    replay.includes("Recorded error reproduced") &&
      replay.includes("Original state restored"),
    "Native handled error reproduced with explicit restoration",
    { actual: replay },
  );
  await assertRestored(context, baseline, records, windows);
  await checkpoint("after-native-local-replay-restoration");
  await clickLabel(
    page,
    "Replay locally",
    '.maple-ui-panel[aria-label="Game Logs"]',
  );
  await clickLabel(page, "Local replay · Cancel / Escape");
  await waitReplayEnd(page);
  const cancelled = await logStatus(page);
  assert(
    cancelled.startsWith("Replay cancelled;"),
    "Native cancellation reports its completed restoration",
    { actual: cancelled },
  );
  await assertRestored(context, baseline, records, windows);
  await checkpoint("after-native-replay-cancel-restoration");
  return { replay, cancelled };
}

/** Observe the ordinary paused checkpoint, not a transient gap before its next inspection tick. */
function pausedCheckpointReady() {
  const state = window.maple.snapshot();
  if (
    !state.paused ||
    state.save.dirty ||
    state.save.profileTransactionPending
  ) {
    return false;
  }
  const profile = state.field.gameplay.player;
  const location = profile.location;
  const simulation = state.simulation;
  const chat = state.inGame.ui.chat;
  return (
    location.x === simulation.x &&
    location.y === simulation.y &&
    location.facing === simulation.facing &&
    profile.settings.chat.state === chat.state &&
    profile.settings.chat.height === chat.height
  );
}

async function run(context) {
  const { page, catalog, loadJSON, snapshot, checkpoint, output, inputs } =
    context;
  await settled(page, MAP);
  await nativeJournalPaths(context);
  await openWindow(page, "s", "Stat");
  const stats = await retainWindow(page, "Stat");
  await dragWindow(page, stats, -180, -80);
  await checkpoint("before-genuine-blocked-shane-interaction");
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  await clickNpc(page, npcPlacement(manifest, 1032003));
  await clickLabel(page, "Open Game Logs");
  await page.waitForSelector('[aria-label="Game error records"]', {
    visible: true,
    timeout: TIMEOUT,
  });
  const exported = await exportDump(page, output);
  const dump = exported.dump;
  const events = assertNativeRecording(context, dump);
  await importDump(page, exported.path);
  await page.click("#pause");
  await page.waitForFunction(pausedCheckpointReady, { timeout: TIMEOUT });
  const logs = await retainWindow(page, "Game Logs");
  const baseline = restoreProjection(await snapshot());
  const records = await durableRecords(page);
  const result = await replayAndCancel(context, baseline, records, [
    stats,
    logs,
  ]);
  for (const retained of [stats, logs]) await retained.handle.dispose();
  return {
    ...result,
    provenance: inputs.fixture.provenance,
    exportPath: exported.path,
    error: dump.errors[0],
    recordedTicks: dump.recording.totalTicks,
    eventTypes: [...new Set(events.map((event) => event.type))],
    accountProof:
      "Live account owner and readonly durable account/profile records remain unchanged after replay and cancellation.",
    parity:
      "Native handler/state evidence only; no original-source or pixel-parity claim.",
  };
}

function assertNativeRecording(context, dump) {
  const { assert, inputs } = context;
  assert(
    dump.replayable,
    "Genuine native error has a replayable stable-viewport recording",
    { actual: dump.limitation },
  );
  assert(
    dump.context.mapId === MAP && dump.errors.length > 0,
    "Export retains the actual Shane error context",
  );
  assert(
    dump.errors.some((error) =>
      error.includes(inputs.fixture.provenance.blockedReason),
    ),
    "The exported failure is Shane's actual source-backed route blocker, not an unrelated runtime error",
    { actual: dump.errors, expected: inputs.fixture.provenance.blockedReason },
  );
  const events = dump.recording.actions
    .filter((entry) => entry.native)
    .map((entry) => entry.native);
  for (const type of [
    "wheel",
    "compositionstart",
    "compositionend",
    "input",
    "dblclick",
  ]) {
    assert(
      events.some((event) => event.type === type),
      `Native recording includes consumed ${type} events`,
    );
  }
  assert(
    events.some((event) => event.detail === 2),
    "Native multi-click detail is retained",
  );
  return events;
}

export default {
  name: "diagnostic-replay",
  recipe: 1,
  mapIds: [MAP],
  dependencies: [
    "client/tools/scenarios/{native,diagnostic-io,diagnostic-replay}.js",
    "client/src/main.js",
    "client/src/development/{game-diagnostics,diagnostic-*,agent-*}.js",
    "client/src/ui/**/*.js",
    "client/src/input/**/*.js",
    "client/src/profile/**/*.js",
    "client/src/npc/**/*.js",
    "client/src/ingame*.js",
  ],
  fixture,
  run,
};
