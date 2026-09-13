export function original(kind, id, mapId) {
  return {
    source: "original",
    kind,
    id: String(id),
    ...(mapId ? { mapId } : {}),
  };
}

export function newDocument(kind, projectId, buildId) {
  if (!["map", "mob", "quest"].includes(kind)) {
    throw new Error("Unknown content type");
  }
  return {
    projectId,
    id: "",
    kind,
    name: "",
    baseAssetBuildId: buildId,
    expectedRevision: 0,
    operationId: crypto.randomUUID(),
    definition: definitions[kind](),
  };
}

const definitions = {
  map: () => ({ base: original("map", "100000000"), entities: [], spawns: [] }),
  mob: () => ({ base: original("mob", 100101), stats: {} }),
  quest: () => ({
    startNpc: original("npc", 1012108, "100000000"),
    endNpc: original("npc", 1012108, "100000000"),
    minLevel: 1,
    maxLevel: 200,
    prerequisites: [],
    objectives: [],
    rewards: { exp: 0, meso: 0, items: [] },
    dialogue: {
      offer: "Can you help me?",
      accepted: "Good luck!",
      progress: "Come back when you are ready.",
      complete: "Thank you for your help.",
    },
  }),
};

export function editDocument(row) {
  return {
    projectId: row.projectId,
    id: row.id,
    kind: row.kind,
    name: row.name,
    baseAssetBuildId: row.baseAssetBuildId,
    expectedRevision: row.revision,
    operationId: crypto.randomUUID(),
    definition: structuredClone(row.definition),
  };
}

/** Canvas coordinates are integers in the original map's coordinate system. */
export function addPlacement(
  definition,
  manifest,
  { mode, start, end, palette },
) {
  if (mode === "platform") {
    addPlatform(definition, manifest, { start, end });
  } else if (mode === "ladder") {
    addLadder(definition, manifest, { start, end });
  } else if (mode === "decoration") {
    addDecoration(definition, start, palette);
  } else if (mode === "spawn") {
    addSpawn(definition, manifest, { start, palette });
  } else throw new Error("Unknown placement tool");
}

function addPlatform(definition, manifest, { start, end }) {
  const floors = definition.footholds ?? manifest.physics.footholds;
  if (floors.length >= 4096) throw new Error("Platform limit reached");
  definition.footholds ??= floors.map(
    ({ id, layer, group, x1, y1, x2, y2, prev, next }) => ({
      id,
      layer,
      group,
      x1,
      y1,
      x2,
      y2,
      prev,
      next,
    }),
  );
  definition.footholds.push({
    id: Math.max(0, ...floors.map((row) => row.id)) + 1,
    layer: 0,
    group: 0,
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    prev: 0,
    next: 0,
  });
}

function addLadder(definition, manifest, { start, end }) {
  definition.ladders ??= (manifest.physics.ladders ?? []).map(
    ({ id, x, y1, y2, ladder, uf, page }) => ({
      id,
      x,
      y1,
      y2,
      ladder,
      uf,
      page,
    }),
  );
  if (definition.ladders.length >= 1024) {
    throw new Error("Ladder limit reached");
  }
  definition.ladders.push({
    id: Math.max(0, ...definition.ladders.map((row) => row.id)) + 1,
    x: start.x,
    y1: Math.min(start.y, end.y),
    y2: Math.max(start.y, end.y),
    ladder: 1,
    uf: 1,
    page: 0,
  });
}

function addDecoration(definition, start, palette) {
  if (!palette) throw new Error("Choose an asset in the browser first.");
  const id = `decoration-${crypto.randomUUID().slice(0, 8)}`;
  if (definition.entities.length >= 4096) {
    throw new Error("Decoration limit reached");
  }
  const appearance = palette.appearance ?? palette.ref;
  if (
    !appearance ||
    (appearance.source !== "upload" &&
      !["mob", "entity"].includes(appearance.kind))
  ) {
    throw new Error("Choose scenery, a mob appearance, or an uploaded sprite.");
  }
  definition.entities.push({
    id,
    appearance: structuredClone(appearance),
    ...start,
    z: 0,
    flip: false,
  });
}

function addSpawn(definition, manifest, { start, palette }) {
  const floors = definition.footholds ?? manifest.physics.footholds;
  const id = `spawn-${crypto.randomUUID().slice(0, 8)}`;
  if (palette?.ref?.kind !== "mob") {
    throw new Error("Choose an original or published custom mob to spawn.");
  }
  if (definition.spawns.length >= 4096) throw new Error("Spawn limit reached");
  const floor = floors
    .filter((row) => row.x1 < row.x2 && start.x >= row.x1 && start.x <= row.x2)
    .sort((a, b) => Math.abs(a.y1 - start.y) - Math.abs(b.y1 - start.y))[0];
  if (!floor) throw new Error("Place the mob above a walkable platform.");
  const y = Math.round(
    floor.y1 +
      ((start.x - floor.x1) * (floor.y2 - floor.y1)) / (floor.x2 - floor.x1),
  );
  definition.spawns.push({
    id,
    mob: structuredClone(palette.ref),
    x: start.x,
    y,
    foothold: floor.id,
    range: { left: floor.x1, right: floor.x2 },
    facing: 1,
  });
}
