import { validateProfile } from "../../src/profile/profile-validation.js";
import {
  clickLabel,
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

const MAP = "103000003";
const NPC = 1052001;
const SKILL = 4000000;
const DIALOG = `${PANEL}[aria-label="UtilDlgEx"]`;

/** Detached qualification is explicitly seeded; only the NPC/skill buttons earn the resulting changes. */
async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const npc = npcPlacement(manifest, NPC);
  const profile = seededProfile(catalog, {
    mapId: MAP,
    x: npc.authored.x,
    y: groundAt(manifest, npc.authored.fh, npc.authored.x),
    facing: -1,
  });
  profile.level = 10;
  profile.dex = 25;
  profile.remainingAp = 25;
  profile.inventorySlots = [24, 24, 24, 24, 24];
  profile.skills[1001] = { level: 1, masterLevel: 0, expiresAt: null };
  const shops = await loadJSON(catalog.serverData.datasets.shops);
  const route = shops.npcRoutes.find((entry) => entry.npcId === NPC);
  if (route?.status !== "supported") {
    throw new Error(
      `Dark Lord route unavailable: ${route?.blockers?.[0]?.reason}`,
    );
  }
  for (const id of [2070000, 2070015, 1472061, 1332063]) {
    if (!catalog.ui.items[id]) {
      throw new Error(`Original advancement item ${id} is absent`);
    }
  }
  if (!catalog.ui.skills[SKILL]) {
    throw new Error("Original thief skill book is absent");
  }
  validateProfile(profile, catalog.ui.items);
  return {
    profile,
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      grants: {
        level: 10,
        dex: 25,
        remainingAp: 25,
        skill1001: 1,
        inventorySlots: 24,
      },
      locationSource: npc.source,
      scripts: [route.source],
      policy:
        "Qualification is seeded; real authored Dark Lord dialogue advances job and grants items, then native SP allocation learns Nimble Body.",
    },
  };
}
function quantity(profile, id) {
  return profile.inventory
    .filter((item) => item.id === id)
    .reduce((total, item) => total + item.count, 0);
}

function advancementState(profile) {
  return {
    job: profile.job,
    str: profile.str,
    dex: profile.dex,
    int: profile.int,
    luk: profile.luk,
    baseMaxHP: profile.baseMaxHP,
    baseMaxMP: profile.baseMaxMP,
    remainingAp: profile.remainingAp,
    remainingSp: profile.remainingSp,
    skills: profile.skills,
    inventorySlots: profile.inventorySlots,
    rewards: [2070015, 1472061, 1332063].map((id) => [
      id,
      quantity(profile, id),
    ]),
  };
}

async function advance(context) {
  const { page, catalog, loadJSON, checkpoint } = context;
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  await clickNpc(page, npcPlacement(manifest, NPC));
  await page.waitForFunction(
    (selector) => {
      const root = document.querySelector(selector);
      return root?.querySelector('[data-npc-talk="true"], [aria-label="Next"]');
    },
    { timeout: TIMEOUT },
    DIALOG,
  );
  if (await page.$(`${DIALOG} [data-npc-talk="true"]`)) {
    await dialogueStep(page, '[data-npc-talk="true"]');
  }
  await dialogueStep(page, '[aria-label="Next"]');
  await checkpoint("dark-lord-real-first-job-offer");
  await dialogueStep(page, '[aria-label="Yes"]');
  await page.waitForFunction(
    () => window.maple.snapshot().field.gameplay.player.job === 400,
    { timeout: TIMEOUT },
  );
  await checkpoint("dark-lord-first-job-transaction");
  for (let step = 0; step < 3; step++) {
    await dialogueStep(page, '[aria-label="Next"]');
  }
  await page.waitForSelector(DIALOG, { hidden: true, timeout: TIMEOUT });
}

async function learn(context) {
  const { page, catalog, checkpoint } = context;
  await page.keyboard.press("k");
  const root = `${PANEL}[aria-label="Skill"]`;
  await page.waitForSelector(root, { visible: true, timeout: TIMEOUT });
  await clickLabel(page, "Skill tab 2", root);
  await clickLabel(page, `Learn ${catalog.ui.skills[SKILL].name}`, root);
  await page.waitForFunction(
    (id) =>
      window.maple.snapshot().field.gameplay.player.skills[id]?.level === 1,
    { timeout: TIMEOUT },
    SKILL,
  );
  await checkpoint("first-thief-sp-learned-through-native-button");
  await page.keyboard.press("k");
}

async function run(context) {
  const { page, assert, snapshot, checkpoint, inputs } = context;
  await settled(page, MAP);
  const before = player(await snapshot());
  await advance(context);
  const advanced = player(await snapshot());
  assertAdvancement(context, before, advanced);
  await learn(context);
  const learned = advancementState(player(await snapshot()));
  assert(
    learned.skills[1001]?.level === 1 &&
      learned.skills[SKILL]?.level === 1 &&
      learned.remainingSp[0] === 0,
    "Advancement preserves the beginner skill and the new thief skill consumes its earned SP",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await settled(page, MAP);
  const restored = advancementState(player(await snapshot()));
  assert(
    JSON.stringify(restored) === JSON.stringify(learned),
    "Job, stats, items, point pools and learned skills survive reload",
  );
  await checkpoint("thief-advancement-and-native-skill-durable");
  return {
    provenance: inputs.fixture.provenance,
    before: advancementState(before),
    learned,
    restored,
    unexercised:
      "Ineligible and capacity/commit-failure refusals are covered by focused VM regressions; no original Windows-runtime or advanced-job parity claimed.",
  };
}

function assertAdvancement(context, before, advanced) {
  const { assert } = context;
  assert(
    advanced.job === 400 && advanced.remainingSp[0] === 1,
    "The real Dark Lord callback advances a qualifying beginner and grants one SP",
  );
  assert(
    quantity(advanced, 2070015) === 500 &&
      quantity(advanced, 1472061) === 1 &&
      quantity(advanced, 1332063) === 1,
    "The same transaction grants all three authored thief rewards",
  );
  assert(
    advanced.dex === 25 &&
      advanced.str === 4 &&
      advanced.int === 4 &&
      advanced.luk === 4 &&
      advanced.remainingAp + 37 ===
        before.remainingAp + before.str + before.dex + before.int + before.luk,
    "Starter redistribution conserves AP while retaining the thief prerequisite",
  );
  assert(
    advanced.baseMaxHP - before.baseMaxHP >= 100 &&
      advanced.baseMaxHP - before.baseMaxHP <= 150 &&
      advanced.baseMaxMP - before.baseMaxMP >= 25 &&
      advanced.baseMaxMP - before.baseMaxMP <= 50,
    "Reference advancement HP/MP rewards stay in their authored inclusive ranges",
  );
}

export default {
  name: "offline-thief-advancement",
  recipe: 1,
  mapIds: [MAP],
  dependencies: [
    "client/tools/scenarios/{native,offline-thief-advancement}.js",
    "client/tools/npc-script-*.js",
    "client/tools/server-data.js",
    "client/src/npc/**/*.js",
    "client/src/skills/**/*.js",
    "client/src/profile/**/*.js",
    "client/src/ui/ui-inspection.js",
  ],
  fixture,
  run,
};
