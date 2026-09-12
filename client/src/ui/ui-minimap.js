import { Container } from "pixi.js";

const MAX_MARKERS = 4096;
const COMPACT_WIDTH = 260;
const COMPACT_HEIGHT = 153;
const MAX_WINDOW_WIDTH = 600;
const MAX_WINDOW_HEIGHT = 450;
const NAME_FONT = "12px Arial,sans-serif";
// Browser Close is additional to native00858344's three-control group.
const CLOSE_RESERVE = 13;
const CHROME_WIDTH = 76 + CLOSE_RESERVE;

/** 008594a7..c8: signed world coordinate plus center, arithmetic-shifted by mag. */
export function minimapCoordinate(value, center, mag) {
  return (Math.trunc(value) + center) >> mag;
}

/** Metadata comes from Map.wz miniMap, not bounds inferred from visible geometry. */
export function minimapGeometry(metadata) {
  const { centerX, centerY, mag, width, height } = metadata.properties;
  const asset = metadata.assets["miniMap/canvas"];
  validateMinimapGeometry(metadata.properties, asset);
  return {
    centerX,
    centerY,
    mag,
    width,
    height,
    asset,
    streetName: metadata.streetName || "",
    mapName: metadata.mapName || "",
    mark: metadata.assets["miniMap/mark"] || null,
    cropX: 0,
    cropY: 0,
  };
}

/** Reject malformed original coordinate metadata independently of window presentation. */
function validateMinimapGeometry(properties, asset) {
  const { centerX, centerY, mag, width, height } = properties;
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
}

function framePart(layer, path, rect) {
  const sprite = layer.image(path, rect.x, rect.y);
  // 00856871/008569ec copy the title-only frame with alpha180, not opaque255.
  if (path.startsWith("MiniMap/Min/")) sprite.container.alpha = 180 / 255;
  const asset = layer.assets[path];
  const scaleX = rect.width / asset.width;
  const scaleY = rect.height / asset.height;
  sprite.container.scale.set(scaleX, scaleY);
  sprite.setPosition(
    rect.x + asset.origin.x * scaleX,
    rect.y + asset.origin.y * scaleY,
  );
}

function drawFrame(panel, layer) {
  const width = panel.width,
    height = panel.height;
  if (panel.minimapDisplayMode === 2) {
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
    panel.minimapDisplayMode === 0 ? "MiniMap/MaxMap/" : "MiniMap/MinMap/";
  const top = layer.assets[prefix + "nw"].height;
  const bottom = layer.assets[prefix + "sw"].height;
  const left = layer.assets[prefix + "nw"].width;
  const right = layer.assets[prefix + "ne"].width;
  const widths = [left, width - left - right, right],
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
  const minimized = panel.minimapDisplayMode === 2;
  const x = panel.width - (minimized ? 44 : 42) - CLOSE_RESERVE,
    y = minimized ? 4 : 6;
  layer.button("MiniMap/BtMap", x, y, {
    label: "World map",
    action: () =>
      panel.owner.open("WorldMap").catch((error) => panel.owner.report(error)),
  });
  layer.button("BtMax", x - 14, y, {
    label: "Expand minimap",
    disabled: !panel.mapGeometry || panel.minimapDisplayMode === 0,
    action: () => changeMode(panel, panel.minimapMode - 1),
  });
  layer.button("BtMin", x - 27, y, {
    label: "Minimize minimap",
    disabled: !panel.mapGeometry || minimized,
    action: () => changeMode(panel, panel.minimapMode + 1),
  });
}

/** Window size is bounded browser policy; original pixels are cropped, never rescaled. */
export function rebuildMinimap(panel) {
  //00855d02/00858344 display title-only without a canvas, retaining the saved mode.
  panel.minimapDisplayMode = panel.mapGeometry ? panel.minimapMode : 2;
  panel.minimapFrame?.destroy();
  sizeMinimap(panel);
  const frame = panel.layer("minimap-frame");
  panel.minimapFrame = frame;
  frame.root.zIndex = -1;
  drawFrame(panel, frame);
  windowControls(panel, frame);
  if (panel.minimapDisplayMode !== 2) frame.image("MiniMap/title", 8, 10);
  const top = panel.minimapDisplayMode === 0 ? 72 : 29;
  const mapWidth = Math.min(
    panel.width - 12,
    panel.mapGeometry?.asset.width ?? panel.width - 12,
  );
  panel.mapViewport = {
    x: Math.floor((panel.width - mapWidth) / 2),
    y: top,
    width: mapWidth,
    height: Math.max(
      0,
      panel.height - top - (panel.minimapDisplayMode === 0 ? 15 : 14),
    ),
  };
  panel.mapContent.rasterClip = panel.mapViewport;
  panel.mapContent.visible = panel.minimapDisplayMode !== 2;
  layoutNames(panel);
  panel.mapStatus.hidden = panel.minimapDisplayMode === 2;
  panel.mapStatus.style.top = `${top + 4}px`;
  if (panel.dragStrip) {
    panel.dragStrip.style.width = `${panel.width - CHROME_WIDTH}px`;
  }
  panel.closeControl?.position(
    panel.width - 17,
    panel.minimapDisplayMode === 2 ? 4 : 6,
  );
  if (Number.isFinite(panel.mapPlayerX)) {
    updateMinimap(panel, panel.mapPlayerX, panel.mapPlayerY);
  }
}

function sizeMinimap(panel) {
  const geometry = panel.mapGeometry;
  panel.width = COMPACT_WIDTH;
  if (panel.minimapDisplayMode === 0 && geometry) {
    const textWidth =
      Math.ceil(
        Math.max(
          panel.mapTextMeasure.measureText(geometry.streetName).width,
          panel.mapTextMeasure.measureText(geometry.mapName).width,
        ),
      ) + (geometry.mark ? 60 : 20);
    panel.width = Math.min(
      MAX_WINDOW_WIDTH,
      Math.max(COMPACT_WIDTH, geometry.asset.width + 12, textWidth),
    );
  } else if (panel.minimapDisplayMode === 2) {
    const width =
      Math.ceil(panel.mapTextMeasure.measureText(titleOnlyName(panel)).width) +
      88 +
      CLOSE_RESERVE;
    panel.width = Math.max(COMPACT_WIDTH, Math.min(MAX_WINDOW_WIDTH, width));
  }
  panel.height =
    panel.minimapDisplayMode === 2
      ? 20
      : Math.min(COMPACT_HEIGHT, (geometry?.asset.height ?? 110) + 43);
  if (panel.minimapDisplayMode === 0 && geometry) {
    panel.height = Math.min(MAX_WINDOW_HEIGHT, geometry.asset.height + 87);
  }
  panel.element.style.width = `${panel.width}px`;
  panel.element.style.height = `${panel.height}px`;
}

function titleOnlyName(panel) {
  const name = panel.mapNames?.mapName ?? "";
  const street = panel.mapNames?.streetName ?? "";
  return name && street ? `${name}  ${street}` : name || street;
}

/** 008576b9/00857bd3: names at y27/43, x8 (+40 with mark); 0085818f: mark(6,23). */
function layoutNames(panel) {
  const geometry = panel.mapGeometry;
  const minimized = panel.minimapDisplayMode === 2;
  setMinimapNames(panel);
  const x = geometry?.mark && !minimized ? 48 : minimized ? 6 : 8;
  panel.mapLabel.style.left = `${x}px`;
  panel.mapLabel.style.top = `${minimized ? 3 : 43}px`;
  panel.mapLabel.style.width = `${panel.width - x - (minimized ? CHROME_WIDTH : 8)}px`;
  panel.mapStreet.style.left = `${x}px`;
  panel.mapStreet.style.top = "27px";
  panel.mapStreet.style.width = `${panel.width - x - 8}px`;
}

/** Publish metadata text and visibility only when the map or display mode changes. */
function setMinimapNames(panel) {
  const minimized = panel.minimapDisplayMode === 2;
  const mapName = panel.mapNames?.mapName ?? "";
  const streetName = panel.mapNames?.streetName ?? "";
  panel.mapLabel.textContent = minimized ? titleOnlyName(panel) : mapName;
  panel.mapStreet.textContent = streetName;
  panel.mapLabel.hidden = panel.minimapDisplayMode === 1;
  panel.mapStreet.hidden = panel.minimapDisplayMode !== 0;
  if (panel.mapMarkAnimation) {
    panel.mapMarkAnimation.container.visible = panel.minimapDisplayMode === 0;
  }
}

export function layoutMinimap(panel) {
  panel.root.sortableChildren = true;
  panel.minimapMode = 1;
  panel.minimapChromeWidth = CHROME_WIDTH;
  panel.mapMarkers = [];
  panel.mapTextMeasure = document.createElement("canvas").getContext("2d");
  if (!panel.mapTextMeasure) {
    throw new Error("Minimap requires Canvas2D font metrics");
  }
  panel.mapTextMeasure.font = NAME_FONT;
  // UI.wz MiniMap/{MinMap,MaxMap}/c already supplies RGBA(255,255,255,119).
  // A DOM background here would make the authored translucent frame opaque.
  panel.mapContent = new Container({ label: "minimap-content" });
  panel.root.addChild(panel.mapContent);
  panel.mapStreet = panel.text("", 8, 27, 235);
  panel.mapLabel = panel.text("", 8, 43, 235);
  for (const label of [panel.mapStreet, panel.mapLabel]) {
    label.style.font = NAME_FONT;
    label.style.color = "#fff";
    label.style.textShadow =
      "-1px 0 #52759c,1px 0 #52759c,0 -1px #52759c,0 1px #52759c";
    label.style.whiteSpace = "nowrap";
    label.style.overflow = "hidden";
    label.style.textOverflow = "ellipsis";
    label.style.lineHeight = "14px";
  }
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
  const canvasExtent =
    axis === "x" ? geometry.asset.width : geometry.asset.height;
  return Math.max(
    0,
    Math.min((world + center) >> mag, canvasExtent - viewport),
  );
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
  if (panel.minimapDisplayMode === 2) return;
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
