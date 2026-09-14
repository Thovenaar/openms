import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { createProfile } from "../../client/src/profile/profile-validation.js";
import { captureKillDropRates, prepareKillDrops } from "../src/field-drops.js";

const content = await loadContent();
const MOB_ID = 100100;
const [FIRST, SECOND, THIRD] = content.catalog.drops.mobs[MOB_ID].rows;

/** Real admitted originals; only the authored condition varies between cases. */
function row(source, condition) {
  const value = { ...source, chance: 999999, minimum: 1, maximum: 1 };
  if (condition) value.condition = condition;
  return value;
}

function fixture(rows, { job = 100, level = 50, now = 0 } = {}) {
  const field = {
    epoch: "drops-conditions",
    drops: new Map(),
    dropReservations: 0,
    characters: new Map(),
    geometry: { segments: [{ x1: -100, x2: 100, y1: 0, y2: 0 }] },
  };
  const actor = {
    id: "drops-actor",
    field,
    profile: createProfile({ mapId: "100000000", x: 0, y: 0, facing: 1 }),
    simulation: { x: 0, y: 0 },
  };
  actor.profile.job = job;
  actor.profile.level = level;
  field.characters.set(actor.id, actor);
  const catalog = {
    ...content.catalog,
    drops: { mobs: { [MOB_ID]: { mode: "merge", rows } } },
  };
  return {
    actor,
    mob: { templateId: MOB_ID, x: 0, y: 0 },
    world: { content: { ...content, catalog }, now, random: () => 0 },
  };
}

function capturedItemIds(rows, options) {
  const { actor, mob, world } = fixture(rows, options);
  return captureKillDropRates(world, actor, mob).killDropRows.map(
    (value) => value.itemId,
  );
}

function failure(run) {
  try {
    run();
    return null;
  } catch (error) {
    return error.code ?? error.message;
  }
}

test("rows without a condition are always captured, conditioned rows only when they apply", () => {
  const rows = [
    row(FIRST),
    row(SECOND, { jobs: [100] }),
    row(THIRD, { jobs: [200] }),
  ];
  expect(capturedItemIds(rows)).toEqual([FIRST.itemId, SECOND.itemId]);
});

test("level and window conditions gate the captured set at their exact boundaries", () => {
  const rows = [
    row(FIRST, { minLevel: 50 }),
    row(SECOND, { minLevel: 51 }),
    row(THIRD, { maxLevel: 49 }),
    row(FIRST, { maxLevel: 50 }),
    row(SECOND, { window: { start: 1000, end: 2000 } }),
  ];
  expect(capturedItemIds(rows, { now: 1000 })).toEqual([
    FIRST.itemId,
    FIRST.itemId,
    SECOND.itemId,
  ]);
  expect(capturedItemIds(rows, { now: 2000 })).toEqual([
    FIRST.itemId,
    FIRST.itemId,
  ]);
  expect(capturedItemIds(rows, { now: 999 })).toEqual([
    FIRST.itemId,
    FIRST.itemId,
  ]);
});

test("every dimension of a combined condition must hold", () => {
  const rows = [
    row(FIRST, { jobs: [100], minLevel: 50, window: { start: 0, end: 10 } }),
    row(SECOND, { jobs: [100], minLevel: 51, window: { start: 0, end: 10 } }),
    row(THIRD, { jobs: [200], minLevel: 50, window: { start: 0, end: 10 } }),
  ];
  expect(capturedItemIds(rows, { now: 5 })).toEqual([FIRST.itemId]);
});

test("a kill rolls exactly the captured rows and never a conditioned-out one", () => {
  const rows = [row(FIRST), row(SECOND, { jobs: [200] }), row(THIRD)];
  const { actor, mob, world } = fixture(rows);
  const defeated = { ...mob, ...captureKillDropRates(world, actor, mob) };
  const plan = prepareKillDrops(world, actor, defeated);
  expect(plan.refusal).toBeNull();
  expect(plan.requests.map((drop) => drop.itemId)).toEqual([
    FIRST.itemId,
    THIRD.itemId,
  ]);
});

test("the admitted row bound still refuses an over-limit table", () => {
  const rows = new Array(257).fill(row(FIRST));
  expect(failure(() => capturedItemIds(rows))).toBe("CONTENT_MISMATCH");
});
