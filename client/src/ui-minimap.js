import { Container } from "pixi.js";

const MAX_MARKERS = 4096;
const COMPACT_WIDTH = 260;
const COMPACT_HEIGHT = 153;
const MAX_WINDOW_WIDTH = 600;
const MAX_WINDOW_HEIGHT = 450;

/** 008594a7..c8: signed world coordinate plus center, arithmetic-shifted by mag. */
export function minimapCoordinate(value, center, mag) {
  return (Math.trunc(value) + center) >> mag;
}

/** Metadata comes from Map.wz miniMap, not bounds inferred from visible geometry. */
export function minimapGeometry(metadata) {
  const { centerX, centerY, mag, width, height } = metadata.properties;
  const asset = metadata.assets["miniMap/canvas"];
  if (
    ![centerX, centerY, mag, width, height].every(Number.isSafeInteger) ||
    mag < 0 ||
    mag > 30 ||
    width <= 0 ||
    height <= 0 ||
    Math.abs(centerX) > 0x7fffffff ||
    Math.abs(centerY) > 0x7fffffff ||
    !asset ||
    asset.width <= 0 ||
    asset.height <= 0
  ) {
    throw new Error("Invalid original minimap coordinate metadata");
  }
  return { centerX, centerY, mag, width, height, asset, cropX: 0, cropY: 0 };
}

function framePart(layer, path, rect) {
  const sprite = layer.image(path, rect.x, rect.y);
  const asset = layer.assets[path];
  sprite.container.scale.set(
    rect.width / asset.width,
    rect.height / asset.height,
  );
}

function drawFrame(panel, layer) {
  const width = panel.width,
    height = panel.height;
  if (panel.minimapMode === 2) {
    framePart(layer, "MiniMap/Min/w", { x: 0, y: 0, width: 8, height: 20 });
    framePart(layer, "MiniMap/Min/c", {
      x: 8,
      y: 0,
      width: width - 12,
      height: 20,
    });
    framePart(layer, "MiniMap/Min/e", {
      x: width - 4,
      y: 0,
      width: 4,
      height: 20,
    });
    return;
  }
  const prefix =
    panel.minimapMode === 0 ? "MiniMap/MaxMap/" : "MiniMap/MinMap/";
  const top = layer.assets[prefix + "nw"].height;
  const bottom = layer.assets[prefix + "sw"].height;
  const widths = [6, width - 12, 6],
    heights = [top, height - top - bottom, bottom];
  const parts = ["nw", "n", "ne", "w", "c", "e", "sw", "s", "se"];
  const rect = { x: 0, y: 0, width: 0, height: 0 };
  let y = 0;
  for (let row = 0; row < 3; row++) {
    let x = 0;
    for (let col = 0; col < 3; col++) {
      rect.x = x;
      rect.y = y;
      rect.width = widths[col];
      rect.height = heights[row];
      framePart(layer, prefix + parts[row * 3 + col], rect);
      x += widths[col];
    }
    y += heights[row];
  }
}

/** 008590f9: M cycles compact → expanded → title-only; no canvas means no cycle. */
export function cycleMinimap(panel) {
  if (!panel.mapGeometry) return false;
  changeMode(panel, (panel.minimapMode + 2) % 3);
  return true;
}

function changeMode(panel, mode) {
  panel.minimapMode = mode;
  rebuildMinimap(panel);
  panel.owner.positionWindow(panel, panel.x, panel.y);
  panel.renderArtwork();
}

/** 00858344 uses modes0/1/2, Basic BtMin/BtMax and MiniMap BtMap. */
function windowControls(panel, layer) {
  const minimized = panel.minimapMode === 2;
  const x = panel.width - (minimized ? 44 : 42),
    y = minimized ? 4 : 6;
  layer.button("MiniMap/BtMap", x, y, {
    label: "World map",
    action: () =>
      panel.owner.notice("World-map routing is unavailable offline."),
  });
  layer.button("BtMax", x - 14, y, {
    label: "Expand minimap",
    disabled: panel.minimapMode === 0,
    action: () => changeMode(panel, panel.minimapMode - 1),
  });
  layer.button("BtMin", x - 27, y, {
    label: "Minimize minimap",
    disabled: minimized,
    action: () => changeMode(panel, panel.minimapMode + 1),
  });
}

/** Window size is bounded browser policy; original pixels are cropped, never rescaled. */
export function rebuildMinimap(panel) {
  panel.minimapFrame?.destroy();
  sizeMinimap(panel);
  const frame = panel.layer("minimap-frame");
  panel.minimapFrame = frame;
  frame.root.zIndex = -1;
  drawFrame(panel, frame);
  windowControls(panel, frame);
  frame.image("MiniMap/title", 8, 8);
  const top = panel.minimapMode === 0 ? 72 : 29;
  panel.mapViewport = {
    x: 6,
    y: top,
    width: panel.width - 12,
    height: panel.height - top - (panel.minimapMode === 0 ? 15 : 14),
  };
  panel.mapViewport.height = Math.max(0, panel.mapViewport.height);
  panel.mapContent.rasterClip = panel.mapViewport;
  panel.mapContent.visible = panel.minimapMode !== 2;
  panel.mapLabel.hidden = panel.minimapMode !== 0;
  panel.mapStatus.hidden = panel.minimapMode === 2;
  panel.mapStatus.style.top = `${top + 4}px`;
  if (panel.dragStrip) panel.dragStrip.style.width = `${panel.width - 76}px`;
  // Close is browser window chrome, outside the original right-hand control group.
  panel.closeControl?.position(60, panel.minimapMode === 2 ? 4 : 6);
  if (Number.isFinite(panel.mapPlayerX)) {
    updateMinimap(panel, panel.mapPlayerX, panel.mapPlayerY);
  }
}

function sizeMinimap(panel) {
  const geometry = panel.mapGeometry;
  panel.width =
    panel.minimapMode === 0 && geometry
      ? Math.max(
          COMPACT_WIDTH,
          Math.min(MAX_WINDOW_WIDTH, geometry.asset.width + 12),
        )
      : COMPACT_WIDTH;
  panel.height = panel.minimapMode === 2 ? 20 : COMPACT_HEIGHT;
  if (panel.minimapMode === 0 && geometry) {
    panel.height = Math.min(MAX_WINDOW_HEIGHT, geometry.asset.height + 87);
  }
  panel.element.style.width = `${panel.width}px`;
  panel.element.style.height = `${panel.height}px`;
}

export function layoutMinimap(panel) {
  panel.root.sortableChildren = true;
  panel.minimapMode = 1;
  panel.mapMarkers = [];
  panel.mapContent = new Container({ label: "minimap-content" });
  panel.root.addChild(panel.mapContent);
  panel.mapLabel = panel.text("", 12, 32, 235);
  panel.mapStatus = panel.text("Loading map…", 12, 33, 235);
  rebuildMinimap(panel);
}

function addMarker(markers, layer, kind, { x, y }) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Invalid minimap marker position");
  }
  const sprite = layer.image(`MapHelper/minimap/${kind}`, 0, 0);
  const asset = layer.assets[`MapHelper/minimap/${kind}`];
  markers.push({
    sprite,
    x,
    y,
    halfWidth: Math.floor(asset.width / 2),
    halfHeight: Math.floor(asset.height / 2),
  });
}

/** NPCs are authored map-wide positions; hidden NPCs and invisible portal types are excluded. */
export function createMinimapMarkers(panel, manifest) {
  const layer = panel.layer("minimap-markers");
  layer.root.visible = false;
  const markers = [];
  const placements = manifest.life.placements,
    portals = manifest.physics.portals;
  try {
    if (placements.length + portals.length + 1 > MAX_MARKERS) {
      throw new Error("Minimap marker budget exceeded");
    }
    for (const record of placements) {
      if (
        record.kind === "npc" &&
        !record.authored.hide &&
        manifest.life.templates[record.template]?.artworkStatus ===
          "original-action-artwork"
      ) {
        addMarker(markers, layer, "npc", record.authored);
      }
    }
    // 0085a172..7a: only portal types2 and7 receive the minimap portal icon.
    for (const portal of portals) {
      if (portal.type === 2 || portal.type === 7) {
        addMarker(markers, layer, "portal", portal);
      }
    }
    addMarker(markers, layer, "user", { x: 0, y: 0 });
    return { layer, markers, player: markers[markers.length - 1] };
  } catch (error) {
    layer.destroy();
    throw error;
  }
}

/** 0085abbd crop origin follows the player and clamps within authored minimap extents. */
function cropCoordinate(value, axis, geometry, viewport) {
  const center = axis === "x" ? geometry.centerX : geometry.centerY;
  const extent = axis === "x" ? geometry.width : geometry.height;
  const mag = geometry.mag;
  const pixels = viewport * 2 ** mag;
  const world = Math.min(
    Math.max(Math.trunc(value) - Math.trunc(pixels / 2), -center),
    extent - center - pixels,
  );
  return Math.max(0, (world + center) >> mag);
}

/** Called with live feet coordinates; no allocations or DOM changes in the frame loop. */
export function updateMinimap(panel, x, y) {
  panel.mapPlayerX = x;
  panel.mapPlayerY = y;
  const geometry = panel.mapGeometry;
  if (
    !geometry ||
    !panel.mapPlayerMarker ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return;
  }
  panel.mapPlayerMarker.x = x;
  panel.mapPlayerMarker.y = y;
  if (panel.minimapMode === 2) return;
  const viewport = panel.mapViewport;
  geometry.cropX = cropCoordinate(x, "x", geometry, viewport.width);
  geometry.cropY = cropCoordinate(y, "y", geometry, viewport.height);
  panel.mapAnimation.setPosition(
    viewport.x - geometry.cropX + geometry.asset.origin.x,
    viewport.y - geometry.cropY + geometry.asset.origin.y,
  );
  for (const marker of panel.mapMarkers) {
    const mx =
      minimapCoordinate(marker.x, geometry.centerX, geometry.mag) -
      geometry.cropX;
    const my =
      minimapCoordinate(marker.y, geometry.centerY, geometry.mag) -
      geometry.cropY;
    marker.sprite.setPosition(
      viewport.x + mx - marker.halfWidth,
      viewport.y + my - marker.halfHeight,
    );
    marker.sprite.container.visible =
      mx >= 0 && my >= 0 && mx < viewport.width && my < viewport.height;
  }
}
