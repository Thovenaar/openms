import { expect, test } from "bun:test";
import {
  DROP_OWNER_MS,
  ownsDrop,
  prepareFieldDrop,
  publishFieldDrop,
} from "../src/field-drops.js";

function actor(id, field) {
  return {
    id,
    field,
    profile: { social: { party: null } },
    simulation: { x: 10, y: 20 },
  };
}

function prepared(playerDrop) {
  const field = { drops: new Map() };
  const owner = actor("owner", field);
  const drop = prepareFieldDrop({ now: 1000 }, owner, {
    id: playerDrop ? "player-drop" : "monster-drop",
    item: { id: 2000000, count: 1 },
    durableEntitlement: true,
    playerDrop,
    source: owner.simulation,
    ground: { x: 10, y: 20, foothold: null },
  });
  publishFieldDrop(field, drop, 2000);
  return { drop, other: actor("other", field) };
}

test("player-created drops are public immediately while awarded loot keeps its owner window", () => {
  const player = prepared(true);
  expect(player.drop.ownerUntil).toBe(2000);
  expect(ownsDrop(player.other, player.drop, 2000)).toBe(true);

  const awarded = prepared(false);
  expect(awarded.drop.ownerUntil).toBe(2000 + DROP_OWNER_MS);
  expect(ownsDrop(awarded.other, awarded.drop, 2000)).toBe(false);
  expect(ownsDrop(awarded.other, awarded.drop, 2000 + DROP_OWNER_MS)).toBe(
    true,
  );
});
