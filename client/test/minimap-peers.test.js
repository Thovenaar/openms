import { expect, test } from "bun:test";
import {
  createMinimapMarkers,
  minimapCoordinate,
  updateMinimap,
} from "../src/ui/ui-minimap.js";

function sprite() {
  return {
    x: 0,
    y: 0,
    container: { visible: false },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
    },
  };
}

function marker(half = 2) {
  return { sprite: sprite(), halfWidth: half, halfHeight: half };
}

function panel() {
  return {
    mapGeometry: {
      centerX: 0,
      centerY: 0,
      mag: 0,
      width: 2000,
      height: 2000,
      cropX: 0,
      cropY: 0,
      asset: { width: 2000, height: 2000, origin: { x: 0, y: 0 } },
    },
    mapViewport: { x: 10, y: 20, width: 260, height: 110 },
    mapMarkers: [],
    mapPeerMarkers: [marker(), marker(), marker()],
    mapPlayerMarker: marker(),
    mapAnimation: { setPosition() {} },
    mapPlayerX: 0,
    mapPlayerY: 0,
    minimapDisplayMode: 1,
  };
}

function layer(present = true) {
  const assets = {
    "MapHelper/minimap/user": { width: 6, height: 6 },
    "MapHelper/minimap/npc": { width: 4, height: 7 },
    "MapHelper/minimap/portal": { width: 8, height: 8 },
  };
  const entities = new Map(
    Object.keys(assets).map((path) => [path, { id: path, actions: {} }]),
  );
  if (present) {
    assets["MapHelper/minimap/another"] = { width: 5, height: 5 };
    entities.set("MapHelper/minimap/another", {
      id: "MapHelper/minimap/another",
      actions: {},
    });
  }
  const built = [];
  return {
    root: { visible: true },
    assets,
    entities,
    built,
    image(path) {
      const node = sprite();
      node.path = path;
      built.push(node);
      return node;
    },
    destroy() {},
  };
}

function manifest() {
  return {
    life: {
      placements: [
        {
          kind: "npc",
          template: "npc:1",
          authored: { x: 30, y: 40 },
        },
      ],
      templates: { "npc:1": { artworkStatus: "original-action-artwork" } },
    },
    physics: {
      portals: [
        { type: 2, x: 10, y: 20 },
        { type: 1, x: 0, y: 0 },
      ],
    },
  };
}

test("every other user in the field is drawn with the authored another marker", () => {
  const minimap = panel();
  updateMinimap(minimap, 0, 0, [
    { x: 5, y: 6 },
    { x: -100, y: 0 },
    { x: 4, y: 4 },
  ]);
  const [first, outside, third] = minimap.mapPeerMarkers;
  // 10 + (5 >> 0) - 2 and 20 + (6 >> 0) - 2.
  expect([first.sprite.x, first.sprite.y]).toEqual([13, 24]);
  expect(first.sprite.container.visible).toBe(true);
  expect(outside.sprite.container.visible).toBe(false);
  expect(third.sprite.container.visible).toBe(true);
  // The local player and the authored markers keep their own placement.
  expect(minimap.mapPlayerMarker.sprite.x).not.toBeNaN();
});

test("a peer list shorter than the pool hides the unused markers", () => {
  const minimap = panel();
  updateMinimap(minimap, 0, 0, [{ x: 5, y: 6 }]);
  expect(minimap.mapPeerMarkers[0].sprite.container.visible).toBe(true);
  expect(minimap.mapPeerMarkers[1].sprite.container.visible).toBe(false);
  expect(minimap.mapPeerMarkers[2].sprite.container.visible).toBe(false);
  updateMinimap(minimap, 0, 0);
  expect(
    minimap.mapPeerMarkers.every(
      (entry) => entry.sprite.container.visible === false,
    ),
  ).toBe(true);
});

test("marker coordinates use the authored signed shift", () => {
  expect(minimapCoordinate(1234, 100, 3)).toBe((1234 + 100) >> 3);
  expect(minimapCoordinate(-1234, 100, 0)).toBe(-1134);
});

test("a catalog without the another canvas draws no peers instead of failing", () => {
  const minimap = panel();
  minimap.layer = () => layer(false);
  const markers = createMinimapMarkers(minimap, manifest());
  expect(markers.peers.length).toBe(0);
  expect(markers.markers.length).toBe(3);
  expect(markers.player).toBe(markers.markers[2]);
});

test("a packaged another canvas builds one bounded pool of hidden markers", () => {
  const minimap = panel();
  const source = layer(true);
  minimap.layer = () => source;
  const markers = createMinimapMarkers(minimap, manifest());
  expect(markers.peers.length).toBe(64);
  expect(
    markers.peers.every((entry) => entry.sprite.container.visible === false),
  ).toBe(true);
  expect(
    source.built.filter((node) => node.path === "MapHelper/minimap/another")
      .length,
  ).toBe(64);
});
