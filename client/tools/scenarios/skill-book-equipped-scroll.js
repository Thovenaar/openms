import { join } from "node:path";
import { grantItem, itemCount } from "../../src/items/inventory-model.js";
import { validateProfile } from "../../src/profile/profile-validation.js";
import {
  clickLabel,
  dragWindow,
  mapManifest,
  openWindow,
  player,
  retainWindow,
  seededProfile,
  settled,
  TIMEOUT,
} from "./native.js";

const MAP = "000010000";
const SWORD = 1302000;
const SCROLL = 2043000;
const ITEM_PANEL = '.maple-ui-panel[aria-label="Item"]';
const EQUIP_PANEL = '.maple-ui-panel[aria-label="Equip"]';

async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const actor = manifest.actors.find((entry) => entry.kind === "character");
  if (!actor) throw new Error("Original map character spawn is unavailable");
  const profile = seededProfile(catalog, {
    mapId: MAP,
    x: actor.x,
    y: actor.y,
    facing: 1,
  });
  profile.job = 100;
  profile.level = 10;
  const scroll = catalog.ui.items[SCROLL];
  const sword = catalog.ui.items[SWORD];
  if (scroll?.info.success !== 100 || !sword) {
    throw new Error("Required original sword and 100% scroll are unavailable");
  }
  grantItem(profile, scroll, 1);
  validateProfile(profile, catalog.ui.items);
  return {
    profile,
    expected: {
      pad: sword.info.incPAD + scroll.info.incPAD,
      slots: sword.info.tuc - 1,
    },
    provenance: {
      kind: "seeded-not-earned",
      grants: { job: 100, level: 10, items: [[SCROLL, 1]] },
      policy:
        "Original starter sword remains worn. No Legendary Spirit rank, upgraded instance, RNG override or live mutation is seeded. The native Item-to-Equip carry performs the scroll.",
    },
  };
}

async function bookHeader(context) {
  const { page, assert, checkpoint } = context;
  await openWindow(page, "k", "Skill");
  await clickLabel(page, "Skill tab 2", '.maple-ui-panel[aria-label="Skill"]');
  const header = await page.waitForSelector('[data-skill-book-id="100"]', {
    visible: true,
    timeout: TIMEOUT,
  });
  const name = await header.evaluate((element) => element.textContent);
  assert(
    name === "Warrior Basics",
    "The selected original job book title is visible",
  );
  await checkpoint("original-warrior-book-icon-and-title");
  await page.screenshot({
    path: join(context.output, "skill-book-header.png"),
  });
  await header.dispose();
  await page.keyboard.press("k");
}

async function scrollWornSword(context) {
  const { page, snapshot, assert, checkpoint } = context;
  await openWindow(page, "i", "Item");
  const inventory = await retainWindow(page, "Item");
  await dragWindow(page, inventory, -140, 0);
  await openWindow(page, "e", "Equip");
  const equipment = await retainWindow(page, "Equip");
  await dragWindow(page, equipment, 140, 0);
  await clickLabel(page, "Item tab 2", ITEM_PANEL);
  const scroll = `${ITEM_PANEL} [data-item-id="${SCROLL}"]`;
  const sword = `${EQUIP_PANEL} [data-item-slot="-11"]`;
  await page.waitForSelector(scroll, { visible: true, timeout: TIMEOUT });
  await page.waitForSelector(sword, { visible: true, timeout: TIMEOUT });
  const before = player(await snapshot()).equipment.find(
    (entry) => entry.id === SWORD,
  );
  await checkpoint("before-native-scroll-on-worn-sword");
  await page.click(scroll);
  await page.click(sword);
  await page.waitForFunction(
    (uid) => {
      const state = window.maple.snapshot();
      const item = state.field.gameplay.player.equipment.find(
        (entry) => entry.uid === uid,
      );
      return (
        item?.upgrade?.level === 1 && !state.save.profileTransactionPending
      );
    },
    { timeout: TIMEOUT },
    before.uid,
  );
  const after = player(await snapshot());
  assert(
    itemCount(after, SCROLL) === 0,
    "Native carry consumes the real scroll",
  );
  assert(
    !after.skills[1003],
    "Equipped scrolling does not grant Legendary Spirit",
  );
  await page.mouse.move(0, 0);
  await page.waitForNetworkIdle({ idleTime: 200, timeout: TIMEOUT });
  await page.hover(sword);
  await page.waitForSelector('[role="tooltip"]:not([hidden])', {
    visible: true,
    timeout: TIMEOUT,
  });
  await assertVisibleStats(context);
  await checkpoint("after-native-scroll-worn-stats-tooltip");
  await page.screenshot({
    path: join(context.output, "equipped-scroll-result.png"),
  });
  await inventory.handle.dispose();
  await equipment.handle.dispose();
  return before.uid;
}

async function assertVisibleStats({ page, assert, inputs }) {
  const text = await page.$eval(
    '[role="tooltip"]:not([hidden])',
    (element) => element.innerText,
  );
  const shown = {
    pad: Number(text.match(/Weapon attack:\s*\+?(-?\d+)/)?.[1]),
    slots: Number(text.match(/Upgrade slots:\s*(\d+)/)?.[1]),
  };
  const expected = inputs.fixture.expected;
  assert(
    shown.pad === expected.pad && shown.slots === expected.slots,
    "The worn-item tooltip displays the committed attack and remaining slots",
    { actual: shown, expected },
  );
}

function assertWornResult(context, profile, uid) {
  const sword = profile.equipment.find((entry) => entry.uid === uid);
  const expected = context.inputs.fixture.expected;
  context.assert(
    sword?.slot === -11 &&
      sword.upgrade?.level === 1 &&
      sword.upgrade.slots === expected.slots &&
      sword.upgrade.stats.incPAD === expected.pad,
    "The same sword stays equipped with its original scroll slot and attack increments",
    { actual: sword, expected },
  );
  context.assert(
    !profile.inventory.some((entry) => entry.uid === uid),
    "Scrolling never transfers the worn instance into the bag",
  );
}

async function run(context) {
  const { page, snapshot, checkpoint } = context;
  await settled(page, MAP);
  await bookHeader(context);
  const uid = await scrollWornSword(context);
  assertWornResult(context, player(await snapshot()), uid);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settled(page, MAP);
  const restored = player(await snapshot());
  assertWornResult(context, restored, uid);
  context.assert(
    itemCount(restored, SCROLL) === 0,
    "Scroll debit persists after reload",
  );
  await checkpoint("reloaded-worn-scroll-result");
  return {
    uid,
    equipment: restored.equipment,
    provenance: context.inputs.fixture.provenance,
  };
}

export default {
  name: "skill-book-equipped-scroll",
  recipe: 1,
  mapIds: [MAP],
  dependencies: [
    "client/tools/scenarios/{native,skill-book-equipped-scroll}.js",
    "client/tools/ui-data.js",
    "client/src/ui/**/*.js",
    "client/src/items/**/*.js",
    "client/src/character/character-stats.js",
    "client/src/ingame*.js",
  ],
  fixture,
  run,
};
