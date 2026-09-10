const MAX_MAPS = 32;
const MAX_SPOTS = 256;
const MAP_LEFT = 7;
const MAP_TOP = 33;

/** Select the narrowest authored map containing the field; never infer a spot from field coordinates. */
export function worldMapForField(maps, fieldId) {
  const names = Object.keys(maps);
  if (names.length > MAX_MAPS) {
    throw new Error("World map inventory exceeds bound");
  }
  let selected = "WorldMap";
  let count = Infinity;
  for (const name of names) {
    const map = maps[name];
    if (map.spots.length > MAX_SPOTS) {
      throw new Error("World map spot count exceeds bound");
    }
    for (const spot of map.spots) {
      if (spot.maps.includes(Number(fieldId)) && spot.maps.length < count) {
        selected = name;
        count = spot.maps.length;
      }
    }
  }
  return selected;
}

function scaled(panel, path, { x, y, width, height }) {
  const asset = panel.assets[path];
  const image = panel.image(path, x, y);
  image.container.scale.set(width / asset.width, height / asset.height);
  image.setPosition(
    x + (asset.origin.x * width) / asset.width,
    y + (asset.origin.y * height) / asset.height,
  );
}

function border(panel) {
  const prefix = "WorldMapUI/Border/";
  panel.image(`${prefix}0`, 0, 0);
  scaled(panel, `${prefix}1`, { x: 7, y: 0, width: 640, height: 33 });
  panel.image(`${prefix}2`, 647, 0);
  scaled(panel, `${prefix}3`, { x: 0, y: 33, width: 7, height: 470 });
  scaled(panel, `${prefix}4`, { x: 647, y: 33, width: 7, height: 470 });
  panel.image(`${prefix}5`, 0, 503);
  scaled(panel, `${prefix}6`, { x: 7, y: 503, width: 640, height: 18 });
  panel.image(`${prefix}7`, 647, 503);
  panel.image("WorldMapUI/title", 15, 10);
}

function fieldName(panel, id) {
  const manifest = panel.owner.scene?.manifest;
  if (Number(manifest?.id) === id) {
    return `${manifest.mapName || manifest.name || "Current field"} (${id})`;
  }
  return `Field ${id}`;
}

function spotLabel(panel, spot) {
  const fields = spot.maps.map((id) => fieldName(panel, id)).join(", ");
  return `${spot.title || fields}${spot.description ? `\n${spot.description}` : ""}\n${fields}`;
}

function drawSpots(panel, layer, map, anchor) {
  const current = Number(panel.owner.scene?.manifest.id);
  for (const spot of map.spots) {
    const x = anchor.x + spot.x,
      y = anchor.y + spot.y;
    const path = `WorldMapHelper/mapImage/${spot.type}`;
    if (!layer.assets[path]) {
      throw new Error(
        `Unsupported original world map marker type ${spot.type}`,
      );
    }
    layer.image(path, x, y, true);
    const label = spotLabel(panel, spot);
    layer.hit(
      label,
      { x: x - 8, y: y - 8, width: 16, height: 16 },
      {
        click: () => {
          panel.worldStatus.textContent = label;
        },
      },
    );
    if (spot.maps.includes(current)) {
      layer.image("WorldMapHelper/curPos/0", x, y, true);
    }
  }
}

function drawLinks(panel, layer, map, anchor) {
  for (const link of map.links) {
    const asset = layer.assets[link.path];
    const x = anchor.x - asset.origin.x,
      y = anchor.y - asset.origin.y;
    // Native linkImg is a hover overlay; its transparent rectangle is not an always-visible painting.
    const image = layer.image(link.path, anchor.x, anchor.y, true);
    image.container.visible = false;
    layer.hit(
      link.title || link.target,
      { x, y, width: asset.width, height: asset.height },
      {
        pointerenter: () => {
          image.container.visible = true;
          panel.renderArtwork();
        },
        pointerleave: () => {
          image.container.visible = false;
          panel.renderArtwork();
        },
        focus: () => {
          image.container.visible = true;
          panel.renderArtwork();
        },
        blur: () => {
          image.container.visible = false;
          panel.renderArtwork();
        },
        click: () => showMap(panel, link.target),
      },
    );
  }
}

function showMap(panel, name) {
  const map = panel.resource.manifest.metadata.worldMaps[name];
  if (!map) {
    panel.worldStatus.textContent = `Original map ${name} is absent from Map.wz.`;
    return;
  }
  panel.worldLayer?.destroy();
  panel.worldName = name;
  panel.worldSelect.value = name;
  const layer = panel.layer("WorldMapContents");
  panel.worldLayer = layer;
  const asset = panel.assets[`${name}/BaseImg/0`];
  layer.image(`${name}/BaseImg/0`, MAP_LEFT, MAP_TOP);
  const anchor = { x: MAP_LEFT + asset.origin.x, y: MAP_TOP + asset.origin.y };
  drawSpots(panel, layer, map, anchor);
  drawLinks(panel, layer, map, anchor);
  const field = Number(panel.owner.scene?.manifest.id);
  const marked = map.spots.some((spot) => spot.maps.includes(field));
  panel.worldStatus.textContent = `${fieldName(panel, field)} — ${marked ? "current position marked" : "not represented on this original map"}`;
  panel.worldParent.disabled = !map.parent;
  panel.renderArtwork();
}

/** Surface owns all controls, borrowed resources and replacement layers. Navigation never teleports. */
export function layoutWorldMap(panel) {
  border(panel);
  const maps = panel.resource.manifest.metadata.worldMaps;
  if (!maps?.WorldMap) {
    throw new Error("Original world map bundle is missing; regenerate assets");
  }
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Original world map region");
  select.style.cssText = "position:absolute;left:100px;top:5px;width:210px;";
  for (const name of Object.keys(maps)) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  panel.element.append(select);
  panel.worldSelect = select;
  panel.listen(select, "change", () => showMap(panel, select.value));
  panel.worldStatus = panel.text("", 12, 505, 630);
  panel.worldStatus.style.cssText +=
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px;";
  panel.worldParent = panel.localButton("Parent", 330, 4, () =>
    showMap(panel, maps[panel.worldName].parent),
  );
  panel.localButton("Current field", 390, 4, () =>
    showMap(panel, worldMapForField(maps, panel.owner.scene?.manifest.id)),
  );
  panel.worldField = panel.owner.scene?.manifest.id;
  panel.localRefresh = () => {
    const field = panel.owner.scene?.manifest.id;
    if (field === panel.worldField) return;
    panel.worldField = field;
    showMap(panel, worldMapForField(maps, field));
  };
  showMap(panel, worldMapForField(maps, panel.worldField));
}
