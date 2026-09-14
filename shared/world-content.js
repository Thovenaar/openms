/** Apply an authenticated release overlay without altering the extracted catalog. */
function validateOverlay(base, overlay) {
  if (
    overlay?.schemaVersion !== 1 ||
    overlay.baseAssetBuildId !== base.buildId
  ) {
    throw new Error("World release asset build mismatch");
  }
  for (const key of [
    "maps",
    "baseMaps",
    "mapNames",
    "monsters",
    "quests",
    "mobNames",
  ]) {
    validateIndex(overlay[key]);
  }
  for (const key of ["drops", "dialogues"]) {
    validateTargetIndex(overlay[key] ?? {});
  }
  for (const [key, original] of [
    ["maps", base.maps],
    ["monsters", base.monsters],
    ["quests", base.quests.records],
  ]) {
    for (const id of Object.keys(overlay[key])) {
      if (Object.hasOwn(original, id)) {
        throw new Error("World release overrides an original identity");
      }
    }
  }
}

function validateIndex(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 128
  ) {
    throw new Error("World release index exceeds bounds");
  }
  for (const id of Object.keys(value)) {
    if (!/^8\d{8}$/.test(id)) {
      throw new Error("Invalid custom runtime identity");
    }
  }
}

/** Drop tables and conversations address original and custom runtime identities alike. */
function validateTargetIndex(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 128
  ) {
    throw new Error("World release index exceeds bounds");
  }
  for (const id of Object.keys(value)) {
    if (!/^[1-9]\d{1,8}$/.test(id)) {
      throw new Error("Invalid world content target identity");
    }
  }
}

export function applyWorldContent(base, overlay) {
  validateOverlay(base, overlay);
  const presentation = inheritedMapPresentation(base, overlay);
  return {
    ...base,
    ...presentation,
    maps: { ...base.maps, ...overlay.maps },
    mapNames: { ...base.mapNames, ...overlay.mapNames },
    monsters: { ...base.monsters, ...overlay.monsters },
    drops: mergedDrops(base, overlay.drops ?? {}),
    dialogues: { ...(base.dialogues ?? {}), ...overlay.dialogues },
    quests: {
      ...base.quests,
      records: { ...base.quests.records, ...overlay.quests },
      strings: {
        ...base.quests.strings,
        mob: { ...base.quests.strings.mob, ...overlay.mobNames },
      },
    },
    communityMaps: Object.keys(overlay.maps).map((id) => ({
      id: Number(id),
      name: overlay.mapNames[id],
    })),
  };
}

/** Authored rows extend the original table or replace it wholesale for that target. */
function mergedDrops(base, overlay) {
  const mobs = { ...base.drops?.mobs };
  for (const [id, entry] of Object.entries(overlay)) {
    const inherited = base.drops?.mobs?.[id];
    const rows =
      entry.mode === "replace"
        ? entry.rows
        : [...(inherited?.rows ?? []), ...entry.rows];
    mobs[id] = { ...inherited, rows };
  }
  return { schemaVersion: base.drops?.schemaVersion ?? 1, ...base.drops, mobs };
}

function inheritedMapPresentation(base, overlay) {
  const minimaps = { ...base.ui.minimaps };
  const audioMaps = { ...base.audiovisual.maps };
  for (const [id, baseId] of Object.entries(overlay.baseMaps)) {
    if (
      !/^\d{9}$/.test(baseId) ||
      !Object.hasOwn(base.maps, baseId) ||
      !Object.hasOwn(overlay.maps, id)
    ) {
      throw new Error("Invalid custom map base identity");
    }
    const minimap = base.ui.minimaps[baseId];
    if (minimap) {
      minimaps[id] = {
        ...minimap,
        mapName: overlay.mapNames[id],
        namesMapId: Number(id),
      };
    }
    audioMaps[id] = base.audiovisual.maps[baseId];
  }
  if (
    Object.keys(overlay.baseMaps).length !== Object.keys(overlay.maps).length
  ) {
    throw new Error("Missing custom map base identity");
  }
  return {
    ui: { ...base.ui, minimaps },
    audiovisual: { ...base.audiovisual, maps: audioMaps },
  };
}

/** Both handshake directions pin the selected world release independently of the base build. */
export function sameWorldIdentity(message, content) {
  return (
    message.rulesHash === content.rulesHash &&
    message.assetBuildId === content.assetBuildId &&
    message.worldContentHash === content.worldContent?.sha256
  );
}
