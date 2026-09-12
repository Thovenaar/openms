import { join } from "node:path";
import { validateProfile } from "../../src/profile/profile-validation.js";
import {
  clickNpc,
  dialogueStep,
  groundAt,
  mapManifest,
  npcPlacement,
  PANEL,
  seededProfile,
  settled,
  TIMEOUT,
} from "./native.js";

const MAP = "000050000";
const DIALOG = `${PANEL}[aria-label="UtilDlgEx"]`;

/** Seed only the quiz's active state; completion and subsequent talk use native input. */
async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const npc = npcPlacement(manifest, 2003);
  const profile = seededProfile(catalog, {
    mapId: MAP,
    x: npc.authored.x,
    y: groundAt(manifest, npc.authored.fh, npc.authored.x),
    facing: -1,
  });
  profile.quests[1036] = { state: 1, kills: {} };
  validateProfile(profile, catalog.ui.items);
  return {
    profile,
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      grants: { quest1036: "active; completion not seeded" },
      locationSource: npc.source,
      policy:
        "Detached validated beginner; original quest quiz and default talk exercised through native input only.",
    },
  };
}

async function assertDefaultTopics(context) {
  const { page, assert } = context;
  await page.waitForSelector(`${DIALOG} [data-quest-choice="0"]`, {
    visible: true,
    timeout: TIMEOUT,
  });
  const menu = await page.$eval(DIALOG, (node) => ({
    text: node.textContent,
    routes: node.querySelectorAll("[data-npc-talk]").length,
    quests: node.querySelectorAll("[data-quest-id]").length,
  }));
  assert(
    menu.text.includes("How do I move?") &&
      menu.routes === 0 &&
      menu.quests === 0,
    "An NPC with no remaining quest choices enters authored topics without an ETC/name detour",
    { actual: menu },
  );
}

async function run(context) {
  const { page, catalog, loadJSON, assert, checkpoint, output, inputs } =
    context;
  await settled(page, MAP);
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const npc = npcPlacement(manifest, 2003);
  await clickNpc(page, npc);
  await page.waitForSelector(`${DIALOG} [data-quest-id="1036"]`, {
    visible: true,
    timeout: TIMEOUT,
  });
  assert(
    (await page.$(`${DIALOG} [data-npc-talk]`)) !== null,
    "A real active quest retains both the quest and other-talk choices",
  );
  await checkpoint("robin-real-quest-and-talk-choices");
  await dialogueStep(page, '[data-quest-id="1036"]');
  for (const choice of [1, 1, 3]) {
    await dialogueStep(page, `[data-quest-choice="${choice}"]`);
  }
  await dialogueStep(page, '[aria-label="Accept"]');
  await dialogueStep(page, '[aria-label="OK"]');
  await assertDefaultTopics(context);
  await checkpoint("last-quest-completed-direct-authored-talk");
  await page.keyboard.press("Escape");
  await page.waitForSelector(DIALOG, { hidden: true, timeout: TIMEOUT });
  await clickNpc(page, npc);
  await assertDefaultTopics(context);
  await checkpoint("default-only-native-reopen");
  await page.screenshot({
    path: join(output, "npc-default-direct-topics.png"),
  });
  return {
    provenance: inputs.fixture.provenance,
    map: MAP,
    npcId: 2003,
    captures: ["npc-default-direct-topics.png"],
  };
}

export default {
  name: "npc-default-dialogue",
  recipe: 1,
  mapIds: [MAP],
  dependencies: [
    "client/tools/scenarios/{native,npc-default-dialogue}.js",
    "client/src/npc/**/*.js",
    "client/src/quests/**/*.js",
    "client/src/ui/{quest-ui,ui-dialog-*,game-ui}.js",
    "client/src/profile/**/*.js",
  ],
  fixture,
  run,
};
