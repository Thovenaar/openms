import { expect, test } from "bun:test";
import {
  collectMapResources,
  sha256,
  verifyBytes,
} from "../public/offline-manifest.js";

function scopeCatalog(map, bundle, audio, sharedSound) {
  const unavailable = {
    url: "/generated/maps/unavailable.json",
    sha256: "0".repeat(64),
    bytes: 100,
  };
  return {
    maps: {
      100000000: { ...map, neighbors: ["100000001"] },
      100000001: unavailable,
    },
    ui: {
      bundles: { StatusBar: bundle, WorldMap: unavailable },
      minimaps: { 100000000: bundle, 100000001: unavailable },
      items: { unavailable },
    },
    audiovisual: {
      maps: { 100000000: { bgm: audio }, 100000001: unavailable },
      effects: {
        Teleport: { bundle },
        LevelUp: { bundle },
        QuestClear: { bundle },
      },
      combat: { digits: bundle },
      sounds: {
        UI: { click: sharedSound },
        Game: {
          LevelUp: sharedSound,
          QuestClear: sharedSound,
          Tombstone: sharedSound,
          DropItem: sharedSound,
          PickUpItem: sharedSound,
        },
      },
    },
    quests: { unavailable },
    serverData: { unavailable },
    hitboxes: { unavailable },
  };
}

function verifiedFixtureReader(bodies, requested) {
  return async function loadJSON(info) {
    requested.push(info.url);
    const bytes = bodies.get(info.url);
    if (!bytes) throw new Error(`Unavailable asset: ${info.url}`);
    await verifyBytes(bytes, info);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
}

async function fixtureAsset(bodies, url, value) {
  const bytes = new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  );
  bodies.set(url, bytes);
  return { url, sha256: await sha256(bytes), bytes: bytes.byteLength };
}

// Synthetic verified resources exercise selection without the generated release tree.
async function fixture(options = {}) {
  const bodies = new Map();
  const requested = [];
  const asset = (url, value) => fixtureAsset(bodies, url, value);
  const texture = await asset("/generated/textures/shared.png", "pixels");
  const bundle = await asset("/generated/bundles/shared.json", { texture });
  const region = await asset("/generated/regions/selected.json", {
    artwork: bundle,
    texture: options.conflict
      ? { ...texture, sha256: "f".repeat(64) }
      : texture,
  });
  const map = await asset("/generated/maps/selected.json", {
    id: options.wrongIdentity ? "100000001" : "100000000",
    regions: [region],
    actors: [{ visual: bundle }],
    portalPresentation: { visual: bundle },
    life: {
      renderables: [bundle],
      placements: [
        { kind: "npc", authored: { id: "0000042" } },
        { kind: "mob", authored: { id: "43" } },
      ],
    },
    reactors: { visual: bundle },
  });
  return fixtureResources({
    bodies,
    requested,
    asset,
    texture,
    bundle,
    region,
    map,
  });
}

async function fixtureResources({
  bodies,
  requested,
  asset,
  texture,
  bundle,
  region,
  map,
}) {
  const audio = await asset("/generated/audio/selected.mp3", "map music");
  const sharedSound = await asset("/generated/audio/shared.mp3", "UI sound");
  const portrait = await asset("/generated/bundles/portrait.json", { texture });
  const mobSound = await asset("/generated/audio/mob.mp3", "mob damage");
  const projectiles = await asset("/generated/bundles/projectiles.json", {
    texture,
  });
  const npcMarkers = await asset("/generated/bundles/npc-markers.json", {
    texture,
  });
  const npcSpeech = await asset("/generated/bundles/npc-speech.json", {
    texture,
  });
  const catalog = scopeCatalog(map, bundle, audio, sharedSound);
  const unavailable = catalog.maps["100000001"];
  catalog.ui.avatar = { projectiles };
  catalog.ui.npcWorld = {
    markers: npcMarkers,
    speech: { bundle: npcSpeech, color: 0 },
  };
  catalog.ui.npcPortraits = { 42: portrait, 99: unavailable };
  catalog.audiovisual.combat.sounds = {
    Mob: { 43: mobSound, 99: unavailable },
  };
  const loadJSON = verifiedFixtureReader(bodies, requested);
  return {
    catalog,
    loadJSON,
    requested,
    bodies,
    map,
    region,
    bundle,
    texture,
    audio,
    sharedSound,
    portrait,
    mobSound,
    projectiles,
    npcMarkers,
    npcSpeech,
  };
}

test("map admission ignores unavailable neighbors and optional catalogs while deduplicating its transitive graph", async () => {
  const data = await fixture();
  const resources = await collectMapResources(
    data.catalog,
    "100000000",
    data.loadJSON,
  );
  const expected = [
    data.map,
    data.region,
    data.bundle,
    data.texture,
    data.audio,
    data.sharedSound,
    data.portrait,
    data.mobSound,
    data.projectiles,
    data.npcMarkers,
    data.npcSpeech,
  ];
  expect([...resources.keys()].sort()).toEqual(
    expected.map((info) => info.url).sort(),
  );
  expect(data.requested.sort()).toEqual(
    [
      data.map.url,
      data.region.url,
      data.bundle.url,
      data.portrait.url,
      data.projectiles.url,
      data.npcMarkers.url,
      data.npcSpeech.url,
    ].sort(),
  );
});

test("selected-map verification failure is not treated as a ready sparse cache", async () => {
  const data = await fixture();
  const bytes = data.bodies.get(data.map.url);
  bytes[bytes.length - 2] ^= 1;
  await expect(
    collectMapResources(data.catalog, "100000000", data.loadJSON),
  ).rejects.toThrow("SHA-256 mismatch");
});

test("transitive descriptor conflicts fail even when the shared resource was already discovered", async () => {
  const data = await fixture({ conflict: true });
  await expect(
    collectMapResources(data.catalog, "100000000", data.loadJSON),
  ).rejects.toThrow("Conflicting offline descriptor");
});

test("a packaged descriptor cannot admit a different map identity or an unpackaged map", async () => {
  const data = await fixture({ wrongIdentity: true });
  await expect(
    collectMapResources(data.catalog, "100000000", data.loadJSON),
  ).rejects.toThrow("map identity mismatch");
  await expect(
    collectMapResources(data.catalog, "999999999", data.loadJSON),
  ).rejects.toThrow("Map is not packaged");
});
