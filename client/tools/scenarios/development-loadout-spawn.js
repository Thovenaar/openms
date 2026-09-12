import { join } from "node:path";
import {
  mapManifest,
  seededProfile,
  settled,
  player,
  TIMEOUT,
} from "./native.js";
import { attackIdle, attackSnapshot } from "./combat-input.js";

const MAP = "100010000";
const MONSTER = 100101;

async function fixture({ catalog, loadJSON }) {
  const manifest = await mapManifest(catalog, loadJSON, MAP);
  const actor = manifest.actors.find((entry) => entry.kind === "character");
  if (!actor) throw new Error("Original fixture field has no character spawn.");
  return {
    profile: seededProfile(catalog, {
      mapId: MAP,
      x: actor.x,
      y: actor.y,
      facing: 1,
    }),
    provenance: {
      kind: "seeded-not-earned",
      recipe: 1,
      source: actor.source,
      policy:
        "Only canonical beginner creation and original field entry are setup. Native development controls must stage, discard, apply gear and spawn the combat target; no live profile or mob mutation is injected.",
    },
  };
}

function inventory(profile) {
  return JSON.stringify({
    inventory: profile.inventory,
    equipment: profile.equipment,
    job: profile.job,
    str: profile.str,
    hp: profile.hp,
    mp: profile.mp,
  });
}

async function presetControls(context) {
  const { page, snapshot, assert, checkpoint } = context;
  if (!(await snapshot()).paused) await page.click("#pause");
  await page.click("#console-tab-character");
  const before = player(await snapshot());
  await page.select('[aria-label="Character preset"]', "job:520");
  await page.click("text/Stage preset");
  await page.waitForSelector(".profile-preset-preview:not([hidden])", {
    timeout: TIMEOUT,
  });
  assert(
    inventory(player(await snapshot())) === inventory(before),
    "Staging does not grant or equip anything in the live character",
  );
  await page.$eval(".profile-preset-preview", (element) =>
    element.scrollIntoView({ block: "start" }),
  );
  await checkpoint("staged-original-job-loadout-at-800x600");
  await page.screenshot({
    path: join(context.output, "staged-job-preset-800x600.png"),
  });
  await page.click('[aria-label="Discard unsaved edits"]');
  assert(
    inventory(player(await snapshot())) === inventory(before),
    "Discard leaves live inventory, equipment and stats unchanged",
  );
  await page.click("text/Stage preset");
  await page.click('[aria-label="Apply character changes"]');
  await page.waitForFunction(
    () => {
      const state = window.maple.snapshot();
      return (
        state.field.gameplay.player.job === 520 &&
        state.field.gameplay.player.equipment.some(
          (item) => item.id === 1492000 && item.slot === -11,
        ) &&
        !state.save.profileTransactionPending &&
        state.field.gameplay.prepared
      );
    },
    { timeout: TIMEOUT },
  );
  assertPresetApplied(context, before, player(await snapshot()));
  await checkpoint("applied-original-job-loadout-at-800x600");
}

function assertPresetApplied({ assert }, before, after) {
  assert(
    after.str === 32767 &&
      after.dex === 32767 &&
      after.int === 32767 &&
      after.luk === 32767,
    "Apply publishes the capped primary stats together",
  );
  assert(
    after.hp === 30000 &&
      after.mp === 30000 &&
      after.maxHP === 30000 &&
      after.maxMP === 30000,
    "Apply publishes full capped HP and MP",
  );
  assert(
    after.inventory.some((item) => item.id === 2330000 && item.count > 0),
    "Gun preset grants original compatible bullets",
  );
  for (const item of [...before.inventory, ...before.equipment]) {
    assert(
      [...after.inventory, ...after.equipment].some(
        (entry) =>
          entry.uid === item.uid &&
          entry.id === item.id &&
          entry.count === item.count,
      ),
      "Every previously owned instance survives the loadout replacement",
      { actual: item.uid },
    );
  }
}

async function assertSpawnLegible({ page, assert }) {
  await page.hover("#mob-spawn");
  const contrast = await page.$eval("#mob-spawn", (button) => {
    const style = getComputedStyle(button);
    const luminance = (color) => {
      const rgb = color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
      const linear = rgb.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (
      (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05)
    );
  });
  assert(contrast >= 4.5, "The hovered spawn action remains legible", {
    contrast,
  });
}

async function spawnControls(context) {
  const { page, snapshot, assert, checkpoint } = context;
  await page.click("#console-tab-play");
  await page.click("#map-selection summary");
  await page.click("#mob-spawn-section summary");
  await page.type("#mob-search", "Snail");
  const matches = await page.$$eval("#mob-template option", (options) =>
    options.map((option) => option.textContent),
  );
  assert(
    matches.some((text) => text.includes("100101") && /snail/i.test(text)),
    "Name search includes the original Blue Snail template",
  );
  await page.click("#mob-search-clear");
  await page.type("#mob-search", String(MONSTER));
  await page.select("#mob-template", String(MONSTER));
  assert(
    await page.$eval("#mob-spawn", (button) => button.disabled),
    "Paused gameplay refuses the development spawn action",
  );
  await page.click("#pause");
  await page.waitForFunction(
    () => !document.querySelector("#mob-spawn").disabled,
    { timeout: TIMEOUT },
  );
  const before = (await snapshot()).field.gameplay.mobs.map((mob) => mob.id);
  await page.click("#mob-spawn");
  await page.waitForFunction(
    (ids) =>
      window.maple
        .snapshot()
        .field.gameplay.mobs.some(
          (mob) => !ids.includes(mob.id) && mob.active && mob.alive,
        ),
    { timeout: TIMEOUT },
    before,
  );
  const state = await snapshot();
  const spawned = state.field.gameplay.mobs.find(
    (mob) => !before.includes(mob.id),
  );
  assert(
    spawned && spawned.active && spawned.alive && spawned.hp > 0,
    "Native spawn click creates an active combat mob, not a renderer-only entity",
    { actual: spawned },
  );
  await checkpoint("native-original-monster-spawn-at-800x600");
  await assertSpawnLegible(context);
  await page.screenshot({
    path: join(context.output, "monster-search-800x600.png"),
  });
  return spawned.id;
}

async function defeatSpawn(context, id) {
  const { page, snapshot, assert, checkpoint } = context;
  await page.click("#console-toggle");
  await page.click("#viewport canvas");
  await page.waitForFunction(
    (target) =>
      window.maple
        .snapshot()
        .field.gameplay.mobs.find((mob) => mob.id === target)?.spawnMs >= 800,
    { timeout: TIMEOUT },
    id,
  );
  let defeated = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await snapshot();
    const mob = state.field.gameplay.mobs.find((entry) => entry.id === id);
    if (!mob?.alive) {
      defeated = true;
      break;
    }
    const dx = mob.x - state.simulation.x;
    await page.keyboard.press(dx < 0 ? "ArrowLeft" : "ArrowRight");
    await attackIdle(page);
    await page.keyboard.down("Control");
    try {
      await attackSnapshot(page, true);
    } finally {
      await page.keyboard.up("Control");
    }
    await attackIdle(page);
  }
  const mob = (await snapshot()).field.gameplay.mobs.find(
    (entry) => entry.id === id,
  );
  assert(
    defeated || mob?.alive === false,
    "The spawned original mob receives ordinary player combat damage through its lethal transition",
    { actual: mob },
  );
  await checkpoint("native-spawned-monster-defeated");
}

async function run(context) {
  await context.page.setViewport({ width: 800, height: 600 });
  await settled(context.page, MAP);
  await presetControls(context);
  const id = await spawnControls(context);
  await defeatSpawn(context, id);
  return {
    mapId: MAP,
    job: 520,
    monster: MONSTER,
    spawnedId: id,
    viewport: { width: 800, height: 600 },
  };
}

export default {
  name: "development-loadout-spawn",
  recipe: 1,
  mapIds: [MAP],
  dependencies: [
    "client/tools/scenarios/{native,combat-input,development-loadout-spawn}.js",
    "client/src/development/{character-presets,scene-controls}.js",
    "client/src/character/**/*.js",
    "client/src/combat/**/*.js",
    "client/src/items/**/*.js",
    "client/src/ui/ui-inspection.js",
    "client/src/ingame*.js",
    "client/src/main.js",
    "client/{index.html,style.css}",
  ],
  fixture,
  run,
};
