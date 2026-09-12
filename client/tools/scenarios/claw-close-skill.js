import { grantItem, itemCount } from "../../src/items/inventory-model.js";
import { validateProfile } from "../../src/profile/profile-validation.js";
import {
  groundAt,
  mapManifest,
  openWindow,
  player,
  seededProfile,
  settled,
  TIMEOUT,
} from "./native.js";
import {
  attackIdle,
  attackSnapshot,
  bindClawSkills,
  moveToRange,
} from "./combat-input.js";

const MAP = "100010000";
const CLAW = 1472000;
const STARS = 2070000;
const LUCKY_SEVEN = 4001344;
const BOOSTER = 4101003;

async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const mob = manifest.life.placements.find(
    (entry) => entry.kind === "mob" && entry.id === "life:3",
  );
  if (!mob || Number(mob.authored.id) !== 100101) {
    throw new Error("Required original100101mob placement changed");
  }
  const x = mob.authored.x - 30;
  const profile = seededProfile(catalog, {
    mapId: MAP,
    x,
    y: groundAt(manifest, mob.authored.fh, x),
    facing: 1,
  });
  grantClawLoadout(profile, catalog);
  validateProfile(profile, catalog.ui.items);
  return {
    profile,
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      locationSource: mob.source,
      grants: {
        job: 410,
        level: 30,
        hp: 5000,
        mp: 1000,
        items: [
          [CLAW, 1],
          [STARS, 500],
        ],
        learnedSkills: [
          [LUCKY_SEVEN, 1],
          [4100000, 5],
          [BOOSTER, 20],
        ],
      },
      policy:
        "Production createProfile, grantItem and validator; native UI must equip and bind. No seeded combat, mobs, buffs or held inputs.",
    },
  };
}

function grantClawLoadout(profile, catalog) {
  Object.assign(profile, {
    job: 410,
    level: 30,
    hp: 5000,
    maxHP: 5000,
    baseMaxHP: 5000,
    mp: 1000,
    maxMP: 1000,
    baseMaxMP: 1000,
  });
  for (const [id, level] of [
    [LUCKY_SEVEN, 1],
    [4100000, 5],
    [BOOSTER, 20],
  ]) {
    const skill = catalog.ui.skills[id];
    if (!skill || skill.maxLevel < level) {
      throw new Error(`Required original skill ${id} is unavailable`);
    }
    profile.skills[id] = {
      level,
      masterLevel: skill.masterLevel ?? 0,
      expiresAt: null,
    };
  }
  for (const [id, count] of [
    [CLAW, 1],
    [STARS, 500],
  ]) {
    const template = catalog.ui.items[id];
    if (!template) {
      throw new Error(`Required original item ${id} is unavailable`);
    }
    grantItem(profile, template, count);
  }
}

async function equipClaw(context) {
  const { page, assert, snapshot, checkpoint } = context;
  await checkpoint("before-native-claw-equip-and-binding");
  await openWindow(page, "i", "Item");
  const selector =
    '.maple-ui-panel[aria-label="Item"] [data-item-id="1472000"]';
  await page.waitForSelector(selector, { visible: true, timeout: TIMEOUT });
  await page.click(selector, { count: 2 });
  await page.waitForFunction(
    () => {
      const state = window.maple.snapshot();
      return (
        state.field.gameplay.player.equipment.some(
          (item) => item.id === 1472000 && item.slot === -11,
        ) &&
        !state.save.profileTransactionPending &&
        state.field.gameplay.prepared
      );
    },
    { timeout: TIMEOUT },
  );
  await page.keyboard.press("i");
  await bindClawSkills(context);
  const state = await snapshot();
  assert(
    player(state).equipment.some(
      (item) => item.id === CLAW && item.slot === -11,
    ),
    "Native inventory double-click equips the source-supported claw",
  );
  await checkpoint("after-native-claw-equip-and-binding");
}

async function closePunch(context) {
  const { page, snapshot, assert, checkpoint } = context;
  await checkpoint("before-learned-claw-skill-at-melee-range");
  const targetId = await moveToRange(page, 18, 35);
  await attackIdle(page);
  const before = await snapshot();
  await page.keyboard.press("a");
  const attack = await attackSnapshot(page, false);
  const field = attack.field.gameplay;
  assert(
    ["stabO1", "stabO2"].includes(field.action) &&
      field.status === "local melee attack",
    "Real learned Lucky Seven routes to the claw's native close punch",
    { actual: { action: field.action, status: field.status } },
  );
  assert(
    itemCount(player(attack), STARS) === itemCount(player(before), STARS),
    "Close fallback does not consume throwing stars",
  );
  assert(
    player(attack).mp === player(before).mp,
    "Close fallback precedes the skill MP debit",
  );
  assert(
    field.projectiles.length === 0,
    "Close fallback has no ordinary projectile owner",
  );
  const impact = await attackSnapshot(page, true);
  await attackIdle(page);
  const after = await snapshot();
  assert(
    after.field.combatPresentation.emitted >
      before.field.combatPresentation.emitted,
    "The close punch reaches actual native mob hit/miss presentation",
  );
  assert(
    itemCount(player(after), STARS) === itemCount(player(before), STARS),
    "No delayed star debit follows the punch",
  );
  await checkpoint("after-native-close-punch-impact");
  return {
    targetId,
    action: field.action,
    timing: impact.field.gameplay.attackTiming,
    starsBefore: itemCount(player(before), STARS),
    starsAfter: itemCount(player(after), STARS),
    targetBefore: before.field.gameplay.mobs.find((mob) => mob.id === targetId),
    targetAfter: after.field.gameplay.mobs.find((mob) => mob.id === targetId),
  };
}

async function rangedSkill(context, label) {
  const { page, snapshot, assert, checkpoint } = context;
  const targetId = await moveToRange(page, 150, 190);
  await attackIdle(page);
  await checkpoint(`before-${label}-ranged-release`);
  const before = await snapshot();
  await page.keyboard.press("a");
  const started = await attackSnapshot(page, false);
  assert(
    started.field.gameplay.action === "swingO1",
    "Ranged Lucky Seven uses its authored claw release pose",
  );
  assert(
    itemCount(player(started), STARS) === itemCount(player(before), STARS) - 2,
    "Real ranged Lucky Seven consumes its two authored stars",
  );
  const released = await attackSnapshot(page, true);
  const timing = released.field.gameplay.attackTiming;
  assert(
    timing.phaseMs >= timing.releaseMs &&
      !started.field.gameplay.attackTiming.fired,
    "Native fixed ticks cross the admitted release point before firing",
    { actual: timing },
  );
  await attackIdle(page);
  await checkpoint(`after-${label}-ranged-release`);
  return {
    targetId,
    action: started.field.gameplay.action,
    timing,
    starsBefore: itemCount(player(before), STARS),
    starsAfter: itemCount(player(released), STARS),
  };
}

async function run(context) {
  const { page, assert, checkpoint, inputs } = context;
  await settled(page, MAP);
  await equipClaw(context);
  const close = await closePunch(context);
  const ordinary = await rangedSkill(context, "unboosted");
  await checkpoint("before-native-claw-booster");
  await page.keyboard.press("d");
  await page.waitForFunction(
    () =>
      window.maple
        .snapshot()
        .field.skills.activeBuffs.some((buff) => buff.id === 4101003),
    { timeout: TIMEOUT },
  );
  await attackIdle(page);
  const boosted = await rangedSkill(context, "boosted");
  assert(
    boosted.timing.speed === Math.max(2, ordinary.timing.speed - 2),
    "Source-backed Claw Booster reduces the admitted weapon speed by two",
    { actual: boosted.timing, expected: ordinary.timing },
  );
  assert(
    boosted.timing.durationMs < ordinary.timing.durationMs &&
      boosted.timing.releaseMs < ordinary.timing.releaseMs,
    "The same ranged skill pose releases and completes earlier under the actual native booster buff",
    { actual: boosted.timing, expected: ordinary.timing },
  );
  await checkpoint("after-native-boosted-claw-release");
  return {
    provenance: inputs.fixture.provenance,
    close,
    ordinary,
    boosted,
    proof:
      "Native inventory double-click, skill carry/save, movement and key activation; actual mob/punch/ammunition and admitted release observations.",
  };
}

export default {
  name: "claw-close-skill",
  recipe: 1,
  mapIds: [MAP],
  dependencies: [
    "client/tools/scenarios/{native,combat-input,claw-close-skill}.js",
    "client/src/combat/**/*.js",
    "client/src/skills/**/*.js",
    "client/src/character/**/*.js",
    "client/src/items/**/*.js",
    "client/src/input/**/*.js",
    "client/src/profile/**/*.js",
    "client/src/ui/{game-ui,ui-inspection,ui-icons,ui-keyconfig,ui-layout,ui-carry,ui-scrollbar}.js",
    "client/src/main.js",
    "client/src/ingame*.js",
    "client/tools/{combat-data,skill-data,avatar-data}.js",
  ],
  fixture,
  run,
};
