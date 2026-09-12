import { itemCount } from "../../src/items/inventory-model.js";
import {
  clickNpc,
  dialogueStep,
  focusCanvas,
  groundAt,
  mapManifest,
  npcPlacement,
  PANEL,
  player,
  seededProfile,
  settled,
  TIMEOUT,
} from "./native.js";
import { attackIdle, attackSnapshot, moveToRange } from "./combat-input.js";

const MAP = "000040000";
const QUEST = 1035;
const MOB = 9300018;
const ITEM = 4031802;
const DIALOG = `${PANEL}[aria-label="UtilDlgEx"]`;
const MAX_ATTACKS = 12;

/** Original tutorial floor only; the quest, kill and inventory credit must be earned natively. */
async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const mob = manifest.life.placements.find(
    (entry) => entry.kind === "mob" && entry.authored.x === 322,
  );
  if (Number(mob?.authored.id) !== MOB) {
    throw new Error("Original tutorial Sentinel placement is unavailable");
  }
  const profile = seededProfile(catalog, {
    mapId: MAP,
    x: mob.authored.x,
    y: groundAt(manifest, mob.authored.fh, mob.authored.x),
    facing: 1,
  });
  return {
    profile,
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      locationSource: mob.source,
      quest: "Quest.wz:Check.img/1035, Say.img/1035, Act.img/1035",
      drop: "Cosmic src/main/resources/db/data/152-drop-data.sql row11179; quest1035, item4031802, chance999999, quantity1",
      grants:
        "Only production beginner profile and authored location; no active quest, inventory reward, mob or RNG mutation",
    },
  };
}

async function acceptTodd(context) {
  const { page, catalog, loadJSON, assert, checkpoint } = context;
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  await clickNpc(page, npcPlacement(manifest, 2004));
  await dialogueStep(page, `[data-quest-id="${QUEST}"]`);
  await dialogueStep(page, '[aria-label="Next"]');
  await dialogueStep(page, '[aria-label="Accept"]');
  await page.waitForFunction(
    () =>
      window.maple.snapshot().field.gameplay.player.quests[1035]?.state === 1,
    { timeout: TIMEOUT },
  );
  await dialogueStep(page, '[aria-label="Next"]');
  await dialogueStep(page, '[aria-label="OK"]');
  await page.waitForSelector(DIALOG, { hidden: true, timeout: TIMEOUT });
  const state = await context.snapshot();
  assert(
    player(state).quests[QUEST]?.state === 1 &&
      itemCount(player(state), ITEM) === 0,
    "Todd's ordinary quest acceptance unlocks eligibility without awarding a shellpiece",
  );
  await checkpoint("tutorial-quest-accepted-no-seeded-drop");
}

/** Walk from the authored reload spawn and jump the original 60px tutorial ledge. */
async function approachSentinels(page) {
  await focusCanvas(page);
  await page.waitForFunction(
    () => window.maple.snapshot().simulation.state === "ground",
    { timeout: TIMEOUT },
  );
  await page.keyboard.down("ArrowRight");
  try {
    await page.waitForFunction(
      () => window.maple.snapshot().simulation.x >= 180,
      { timeout: TIMEOUT },
    );
    await page.keyboard.press("Alt");
    await page.waitForFunction(
      () => window.maple.snapshot().simulation.x >= 275,
      { timeout: TIMEOUT },
    );
  } finally {
    await page.keyboard.up("ArrowRight");
  }
  await page.waitForFunction(
    () => window.maple.snapshot().simulation.state === "ground",
    { timeout: TIMEOUT },
  );
}

/** Real beginner attacks may MISS; bounded native attempts never debit mob HP directly. */
async function killSentinel(context) {
  const { page, snapshot, assert } = context;
  await approachSentinels(page);
  for (let attempt = 0; attempt < MAX_ATTACKS; attempt++) {
    const targetId = await moveToRange(page, 25, 60);
    await attackIdle(page);
    const before = await snapshot();
    await page.keyboard.down("Control");
    try {
      await attackSnapshot(page, true);
    } finally {
      await page.keyboard.up("Control");
    }
    const after = await snapshot();
    const target = after.field.gameplay.mobs.find(
      (entry) => entry.id === targetId,
    );
    if (!target?.alive) {
      assert(
        player(after).exp > player(before).exp ||
          player(after).level > player(before).level,
        "A real tutorial lethal transition awards source EXP through ordinary combat",
      );
      await attackIdle(page);
      return { targetId, attacks: attempt + 1 };
    }
    await attackIdle(page);
  }
  throw new Error("Tutorial kill exceeded12native attack attempts");
}

async function approachDrop(page) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const target = await page.evaluate(() => {
      const state = window.maple.snapshot();
      const drop = state.field.drops.drops.find(
        (entry) => entry.itemId === 4031802 && entry.state === "grounded",
      );
      if (!drop) {
        throw new Error("Expected grounded tutorial shellpiece is absent");
      }
      return { x: drop.groundX, dx: drop.groundX - state.simulation.x };
    });
    if (Math.abs(target.dx) <= 25) return;
    const key = target.dx < 0 ? "ArrowLeft" : "ArrowRight";
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        (x) => Math.abs(window.maple.snapshot().simulation.x - x) <= 25,
        { timeout: TIMEOUT },
        target.x,
      );
    } finally {
      await page.keyboard.up(key);
    }
  }
  throw new Error(
    "Tutorial pickup approach exceeded8native steering decisions",
  );
}

async function pickupShell(context) {
  const { page, assert, snapshot, checkpoint } = context;
  await page.waitForFunction(
    () =>
      window.maple
        .snapshot()
        .field.drops.drops.some(
          (drop) =>
            drop.itemId === 4031802 &&
            drop.questId === 1035 &&
            drop.state === "grounded",
        ),
    { timeout: TIMEOUT },
  );
  await checkpoint("source-backed-tutorial-shellpiece-on-ground");
  await approachDrop(page);
  await page.keyboard.press("z");
  await page.waitForFunction(
    () =>
      window.maple
        .snapshot()
        .field.gameplay.player.inventory.some(
          (item) => item.id === 4031802 && item.count === 1,
        ) && !window.maple.snapshot().save.profileTransactionPending,
    { timeout: TIMEOUT },
  );
  const credited = await snapshot();
  assert(
    itemCount(player(credited), ITEM) === 1,
    "Native Z credits one quest shellpiece durably",
  );
  await checkpoint("native-tutorial-pickup-credited");
  await page.reload({ waitUntil: "domcontentloaded" });
  await settled(page, MAP);
  const restored = await snapshot();
  assert(
    itemCount(player(restored), ITEM) === 1 &&
      player(restored).quests[QUEST]?.state === 1,
    "Reload preserves the accepted quest and picked-up shellpiece without duplicating credit",
  );
  return { itemId: ITEM, quantity: 1, durableAfterReload: true };
}

async function run(context) {
  const { page, assert, snapshot, checkpoint, inputs } = context;
  await settled(page, MAP);
  await checkpoint("tutorial-before-quest");
  const inactiveKill = await killSentinel(context);
  const inactive = await snapshot();
  assert(
    !player(inactive).quests[QUEST] && inactive.field.drops.count === 0,
    "Unstarted quest correctly produces neither quest shellpieces nor invented mesos",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await settled(page, MAP);
  await acceptTodd(context);
  const activeKill = await killSentinel(context);
  const pickup = await pickupShell(context);
  return {
    provenance: inputs.fixture.provenance,
    inactiveKill,
    activeKill,
    pickup,
    proof:
      "Native Todd quest acceptance, ordinary Control attacks, grounded drop approach and Z pickup; detached fixture does not grant quest state or loot",
  };
}

export default {
  name: "tutorial-drops",
  recipe: 1,
  mapIds: [MAP],
  dependencies: [
    "client/tools/scenarios/{native,combat-input,tutorial-drops}.js",
    "client/src/{combat,quests,profile,items,world}/**/*.js",
    "client/src/ui/{quest-ui,ui-dialog-*}.js",
    "client/tools/{drop-data,quest-data}.js",
  ],
  fixture,
  run,
};
