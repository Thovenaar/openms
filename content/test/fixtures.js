import { loadContent } from "../../server/src/content.js";
import { AssetRegistry } from "../src/index.js";

const source = loadContent();

export async function originalFixture() {
  const original = await source;
  return {
    original,
    registry: new AssetRegistry({
      catalog: original.catalog,
      readJson: original.json.bind(original),
    }),
  };
}

export function originalRef(kind, id, mapId) {
  return {
    source: "original",
    kind,
    id: String(id),
    ...(mapId ? { mapId } : {}),
  };
}

export function mobInput(buildId, patch = {}) {
  return {
    projectId: "forest",
    id: "mossback",
    kind: "mob",
    name: "Mossback",
    baseAssetBuildId: buildId,
    expectedRevision: 0,
    operationId: crypto.randomUUID(),
    definition: {
      base: originalRef("mob", 100101),
      stats: { maxHP: 120, exp: 15 },
    },
    ...patch,
  };
}

export function questDefinition(target = originalRef("mob", 100101)) {
  return {
    startNpc: originalRef("npc", 1012108, "100000000"),
    endNpc: originalRef("npc", 1012108, "100000000"),
    minLevel: 1,
    maxLevel: 200,
    prerequisites: [],
    objectives: [{ kind: "kill", target, count: 5 }],
    rewards: {
      exp: 10,
      meso: 25,
      items: [{ item: originalRef("item", 2000000), count: 2 }],
    },
    dialogue: {
      offer: "Please help clear the trail.",
      accepted: "Defeat five snails.",
      progress: "Return after five kills.",
      complete: "Thank you!",
    },
  };
}

export function draftRow(input, runtimeId = 800000000) {
  return {
    ...input,
    runtimeId,
    revision: input.expectedRevision + 1,
    schemaVersion: 1,
    status: "draft",
  };
}
