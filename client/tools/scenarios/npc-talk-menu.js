import { join } from "node:path";
import { validateProfile } from "../../src/profile/profile-validation.js";
import {
  clickNpc,
  dialogueStep,
  groundAt,
  mapManifest,
  npcPlacement,
  PANEL,
  player,
  seededProfile,
  settled,
  TIMEOUT,
} from "./native.js";

const ORIGIN = "000050000";
const DIALOG = `${PANEL}[aria-label="UtilDlgEx"]`;
const CHAT = '[aria-label="Chat message"]';
const DRAFT = "Robin native dialogue chat check";

/** Detached beginner setup; the runner validates and seeds it before gameplay exists. */
async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, ORIGIN);
  const npc = npcPlacement(manifest, 2003);
  const x = npc.authored.x;
  const profile = seededProfile(catalog, {
    mapId: ORIGIN,
    x,
    y: groundAt(manifest, npc.authored.fh, x),
    facing: -1,
  });
  if (
    profile.job !== 0 ||
    profile.level < 1 ||
    profile.level > 10 ||
    profile.quests[1036]
  ) {
    throw new Error(
      "Robin menu requires a beginner level1–10 with quest1036 unstarted",
    );
  }
  const shops = await loadJSON(catalog.serverData.datasets.shops);
  const route = shops.npcRoutes.find((entry) => entry.npcId === 2003);
  if (route?.status !== "supported") {
    throw new Error(
      `Robin authored route unavailable: ${route?.blockers?.[0]?.reason}`,
    );
  }
  validateProfile(profile, catalog.ui.items);
  return {
    profile,
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      grants: {
        job: profile.job,
        level: profile.level,
        quest1036: "unstarted",
      },
      locationSource: npc.source,
      scripts: [route.source],
      policy:
        "Production beginner profile and validation; seeded location only, no earned progression or live state mutation.",
    },
  };
}

async function openRobin(context) {
  const { page, catalog, loadJSON, assert, checkpoint } = context;
  const manifest = await mapManifest(catalog, loadJSON, ORIGIN);
  await clickNpc(page, npcPlacement(manifest, 2003));
  await page.waitForSelector(`${DIALOG} [data-quest-id="1036"]`, {
    visible: true,
    timeout: TIMEOUT,
  });
  await page.waitForSelector(`${DIALOG} [data-npc-talk="true"]`, {
    visible: true,
    timeout: TIMEOUT,
  });
  const label = await page.$eval(
    `${DIALOG} [data-npc-talk]`,
    (node) => node.textContent,
  );
  assert(label.includes("Robin"), "Quest menu offers Robin's other dialogue", {
    actual: label,
  });
  await checkpoint("robin-quest-menu-and-other-dialogue");
  await dialogueStep(page, '[data-npc-talk="true"]');
  await page.waitForSelector(`${DIALOG} [data-quest-choice="0"]`, {
    visible: true,
    timeout: TIMEOUT,
  });
  const choice = await page.$eval(
    `${DIALOG} [data-quest-choice="0"]`,
    (node) => node.textContent,
  );
  assert(
    choice.includes("How do I move?"),
    "Other dialogue hands off to Robin's authored topic menu",
    { actual: choice },
  );
  await checkpoint("robin-authored-topic-menu");
  await dialogueStep(page, '[data-quest-choice="0"]');
}

/** Exercise the real edit without claiming offline text was delivered to other players. */
async function checkChat(context) {
  const { page, assert } = context;
  await page.keyboard.press("Escape");
  await page.waitForSelector(DIALOG, { hidden: true, timeout: TIMEOUT });
  await page.waitForSelector(CHAT, { visible: true, timeout: TIMEOUT });
  await page.click(CHAT);
  await page.keyboard.type(DRAFT);
  const edited = await page.$eval(CHAT, (node) => ({
    value: node.value,
    focused: document.activeElement === node,
    disabled: node.disabled,
  }));
  assert(
    edited.value === DRAFT && edited.focused && !edited.disabled,
    "Chat accepts trusted text input after the quest-to-script handoff",
    { actual: edited },
  );
  await page.click(CHAT, { clickCount: 3 });
  await page.keyboard.press("Backspace");
  const cleared = await page.$eval(CHAT, (node) => node.value);
  assert(cleared === "", "Chat draft remains natively editable after dialogue");
  return { draft: DRAFT, inputAccepted: true, deliveryClaimed: false };
}

async function run(context) {
  const { page, assert, snapshot, checkpoint, inputs, output } = context;
  await settled(page, ORIGIN);
  const before = await snapshot();
  assert(
    player(before).job === 0 &&
      player(before).level >= 1 &&
      player(before).level <= 10,
    "Robin is exercised with the seeded eligible beginner",
  );
  await openRobin(context);
  await page.waitForFunction(
    (selector) => {
      const text = document.querySelector(selector)?.textContent ?? "";
      return (
        text.includes("Alright this is how you move.") &&
        text.includes("left, right arrow") &&
        text.includes("Alt")
      );
    },
    { timeout: TIMEOUT },
    DIALOG,
  );
  const response = await page.$eval(DIALOG, (node) => node.textContent);
  await checkpoint("robin-authored-movement-response");
  await page.screenshot({ path: join(output, "robin-movement-response.png") });
  const chat = await checkChat(context);
  await checkpoint("chat-usable-after-robin-dialogue");
  await page.screenshot({ path: join(output, "robin-chat-usable.png") });
  return {
    provenance: inputs.fixture.provenance,
    map: ORIGIN,
    npcId: 2003,
    questMenuId: 1036,
    response,
    chat,
    captures: ["robin-movement-response.png", "robin-chat-usable.png"],
    unexercised:
      "Map102000003 job100 refusal requires a separate fixture; no advancement or live profile mutation attempted.",
  };
}

export default {
  name: "npc-talk-menu",
  recipe: 1,
  mapIds: [ORIGIN],
  dependencies: [
    "client/tools/scenarios/{native,npc-talk-menu}.js",
    "client/src/npc/**/*.js",
    "client/src/quests/**/*.js",
    "client/src/ui/{quest-ui,ui-dialog-*,ui-chat,game-ui}.js",
    "client/src/profile/**/*.js",
    "client/src/world/life-system.js",
    "client/tools/npc-script-*.js",
    "client/tools/server-data.js",
  ],
  fixture,
  run,
};
