const MAX_MAPS = 32;
const MAX_SPOTS = 256;
const MAX_LINKS = 64;
const MAP_LEFT = 13;
const MAP_TOP = 35;

/** 009ec149: opaque white inset; 009eb772..782: native content border at12,34,642×472. */
function mapBacking(panel) {
  const backing = document.createElement("canvas");
  backing.setAttribute("aria-hidden", "true");
  backing.width = panel.width;
  backing.height = panel.height;
  backing.style.cssText = "position:absolute;pointer-events:none;";
  const context = backing.getContext("2d");
  if (!context) throw new Error("World map backing requires Canvas2D");
  context.fillStyle = "#ffffff";
  context.fillRect(2, 2, panel.width - 4, panel.height - 4);
  // 009ecc4a draws the inset before BaseImg; retain its authored one-pixel bevel.
  context.fillStyle = "#d3dbe4";
  context.fillRect(13, 35, 640, 470);
  context.fillStyle = "#6a8594";
  context.fillRect(12, 34, 641, 1);
  context.fillStyle = "#7d98b3";
  context.fillRect(12, 34, 1, 470);
  context.fillStyle = "#bac8d2";
  context.fillRect(12, 505, 1, 1);
  context.fillRect(653, 34, 1, 1);
  context.fillStyle = "#eaeff2";
  context.fillRect(13, 505, 640, 1);
  context.fillRect(653, 35, 1, 470);
  panel.element.prepend(backing);
  panel.cleanups.push(() => backing.remove());
}
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

function matchingFields(map, fields) {
  const matched = new Set();
  for (const spot of map.spots) {
    for (const field of spot.maps) if (fields.has(field)) matched.add(field);
  }
  return matched;
}

/** 009ea1e1/009ea7da: descend only into a link covering all located target fields. */
function worldMapForNpc(maps, fields) {
  let name = "WorldMap";
  const visited = new Set();
  for (let depth = 0; depth < MAX_MAPS; depth++) {
    if (visited.has(name)) {
      throw new Error("Original NPC world-map hierarchy contains a cycle");
    }
    visited.add(name);
    const map = maps[name];
    if (!map) return null;
    const matches = [],
      combined = matchingFields(map, fields);
    for (const link of map.links) {
      if (!maps[link.target]) continue;
      const found = matchingFields(maps[link.target], fields);
      for (const field of found) combined.add(field);
      matches.push({ name: link.target, count: found.size });
    }
    if (!combined.size) return null;
    const child = matches.find((entry) => entry.count === combined.size);
    if (!child) return name;
    name = child.name;
  }
  throw new Error("Original NPC world-map hierarchy exceeds its bound");
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
  const right = panel.width - 7,
    bottom = panel.height - 18;
  panel.image(`${prefix}0`, 0, 0);
  scaled(panel, `${prefix}1`, {
    x: 7,
    y: 0,
    width: panel.width - 14,
    height: 33,
  });
  panel.image(`${prefix}2`, right, 0);
  scaled(panel, `${prefix}3`, { x: 0, y: 32, width: 7, height: bottom - 32 });
  scaled(panel, `${prefix}4`, {
    x: right,
    y: 32,
    width: 7,
    height: bottom - 32,
  });
  panel.image(`${prefix}5`, 0, bottom);
  scaled(panel, `${prefix}6`, {
    x: 7,
    y: bottom,
    width: panel.width - 14,
    height: 18,
  });
  panel.image(`${prefix}7`, right, bottom);
  panel.image("WorldMapUI/title", 15, 10);
}

function spotLabel(panel, spot) {
  const fields = [...new Set(spot.maps.map((id) => panel.owner.mapName(id)))];
  const parts = [];
  if (spot.title) parts.push(spot.title);
  if (spot.description) parts.push(spot.description);
  if (fields.length && (fields.length !== 1 || fields[0] !== spot.title)) {
    parts.push(fields.join("\n"));
  }
  return parts.join("\n");
}

function drawSpots(panel, layer, map, anchor) {
  // All authored points precede every overlay, regardless of MapList order.
  for (const spot of map.spots) {
    const x = anchor.x + spot.x,
      y = anchor.y + spot.y;
    const path = `WorldMapHelper/mapImage/${spot.type}`;
    const asset = layer.assets[path];
    if (!asset) {
      throw new Error(
        `Unsupported original world map marker type ${spot.type}`,
      );
    }
    layer.image(path, x, y, true);
    const label = spotLabel(panel, spot);
    // 009edd67 admits both axes within one third of the original marker width.
    const radius = Math.trunc(asset.width / 3);
    layer.hit(
      label,
      {
        x: x - radius,
        y: y - radius,
        width: radius * 2 + 1,
        height: radius * 2 + 1,
      },
      {},
      { tooltip: label },
    );
  }
  for (const spot of map.spots) {
    const x = anchor.x + spot.x,
      y = anchor.y + spot.y;
    if (
      panel.worldNpcFields &&
      spot.maps.some((field) => panel.worldNpcFields.has(field))
    ) {
      layer.stateImage(`WorldMapHelper/npcPos${spot.type}/0`, x, y, 7000);
    }
  }
  const current = Number(panel.owner.scene?.manifest.id);
  for (const spot of map.spots) {
    if (spot.maps.includes(current)) {
      layer.stateImage(
        "WorldMapHelper/curPos/0",
        anchor.x + spot.x,
        anchor.y + spot.y,
      );
    }
  }
}

function drawLinks(layer, map, anchor) {
  const links = [];
  for (const link of map.links) {
    const asset = layer.assets[link.path];
    const mask = layer.alphaMask(link.path);
    const image = layer.image(link.path, anchor.x, anchor.y, true);
    image.container.visible = false;
    links.push({
      target: link.target,
      title: link.title,
      x: anchor.x - asset.origin.x,
      y: anchor.y - asset.origin.y,
      image,
      mask,
    });
  }
  return links;
}

/** 009ee00e: first authored MapLink whose actual canvas pixel has nonzero alpha wins. */
function linkAt(panel, x, y) {
  for (const link of panel.worldLinks) {
    const px = Math.floor(x - link.x),
      py = Math.floor(y - link.y);
    const mask = link.mask;
    if (
      px >= 0 &&
      py >= 0 &&
      px < mask.width &&
      py < mask.height &&
      mask.alpha[py * mask.width + px] !== 0
    ) {
      return link;
    }
  }
  return null;
}

function hoverLink(panel, link) {
  if (link === panel.worldHovered) return;
  if (panel.worldHovered) panel.worldHovered.image.container.visible = false;
  panel.worldHovered = link;
  if (link) link.image.container.visible = true;
  panel.element.dataset.cursorState = link ? "5" : "0";
  panel.renderArtwork();
}

function pointerLink(panel, event) {
  const point = panel.owner.logicalPointer(event);
  return linkAt(panel, point.x - panel.x, point.y - panel.y);
}

function moveWorldMap(panel, event) {
  const link = pointerLink(panel, event);
  hoverLink(panel, link);
  // Spot controls own their richer title/description/field tooltip when overlapped.
  if (event.target !== panel.element) return;
  if (link?.title) {
    const point = panel.owner.logicalPointer(event);
    panel.owner.showTooltip(link.title, point.x, point.y, panel.element);
  } else if (panel.owner.tooltipAnchor === panel.element) {
    panel.owner.hideTooltip();
  }
}

/** 009ee6e5: child on left-button UP, parentMap on right-button UP; never a field teleport. */
function releaseWorldMap(panel, event) {
  if (event.button === 0) {
    const link = pointerLink(panel, event);
    if (link?.target) {
      event.preventDefault();
      showMap(panel, link.target);
    }
  } else if (event.button === 2) {
    event.preventDefault();
    const map = panel.resource.manifest.metadata.worldMaps[panel.worldName];
    if (map?.parent) showMap(panel, map.parent);
  }
}

function prepareMap(panel, map, name) {
  if (map.spots.length > MAX_SPOTS || map.links.length > MAX_LINKS) {
    throw new Error("World map content exceeds its authored budget");
  }
  const layer = panel.layer("WorldMapContents");
  layer.root.visible = false;
  layer.element.hidden = true;
  try {
    const asset = panel.assets[`${name}/BaseImg/0`];
    layer.image(`${name}/BaseImg/0`, MAP_LEFT, MAP_TOP);
    const anchor = {
      x: MAP_LEFT + asset.origin.x,
      y: MAP_TOP + asset.origin.y,
    };
    const links = drawLinks(layer, map, anchor);
    drawSpots(panel, layer, map, anchor);
    return { layer, links };
  } catch (error) {
    layer.destroy();
    throw error;
  }
}

/** Prepare every canvas, mask and control before replacing the last complete visible region. */
function showMap(panel, name) {
  const maps = panel.resource.manifest.metadata.worldMaps;
  const map = maps[name];
  if (!map) {
    panel.owner.status("Original region artwork is unavailable.");
    return false;
  }
  let candidate = null;
  const previous = panel.worldLayer;
  try {
    candidate = prepareMap(panel, map, name);
    if (previous) previous.root.visible = false;
    candidate.layer.root.visible = true;
    panel.renderArtwork();
  } catch (error) {
    candidate?.layer.destroy();
    if (!previous) throw error;
    previous.root.visible = true;
    panel.renderArtwork();
    panel.owner.report(error);
    return false;
  }
  panel.owner.hideTooltip();
  previous?.destroy();
  panel.worldLayer = candidate.layer;
  panel.worldLayer.element.hidden = false;
  panel.worldLinks = candidate.links;
  panel.worldHovered = null;
  panel.worldName = name;
  panel.element.dataset.cursorState = "0";
  return true;
}

function markNpc(panel, npcId) {
  const { npcLocations, worldMaps } = panel.resource.manifest.metadata;
  const locations = npcLocations[npcId];
  if (!locations || locations[0] === -1) {
    return { ok: false, code: "npc-location" };
  }
  if (locations.length > 1024) {
    throw new Error("Original NPC field inventory exceeds its bound");
  }
  const fields = new Set(locations);
  const region = worldMapForNpc(worldMaps, fields);
  if (!region) return { ok: false, code: "npc-location" };
  const previous = panel.worldNpcFields;
  panel.worldNpcFields = fields;
  if (!showMap(panel, region)) {
    panel.worldNpcFields = previous;
    return { ok: false, code: "world-map" };
  }
  panel.worldNpcId = npcId;
  return { ok: true, npcId, region };
}

/** Surface owns borrowed artwork and event listeners. No developer hierarchy controls or remote markers. */
export function layoutWorldMap(panel) {
  const maps = panel.resource.manifest.metadata.worldMaps;
  if (!maps?.WorldMap || Object.keys(maps).length > MAX_MAPS) {
    throw new Error(
      "Original world map bundle is missing or exceeds its budget",
    );
  }
  for (const map of Object.values(maps)) {
    if (map.spots.length > MAX_SPOTS || map.links.length > MAX_LINKS) {
      throw new Error("World map content exceeds its authored budget");
    }
  }
  mapBacking(panel);
  border(panel);
  panel.worldLinks = [];
  panel.listen(panel.element, "pointermove", (event) =>
    moveWorldMap(panel, event),
  );
  panel.listen(panel.element, "pointerup", (event) =>
    releaseWorldMap(panel, event),
  );
  panel.listen(panel.element, "contextmenu", (event) => event.preventDefault());
  panel.listen(panel.element, "pointerleave", () => {
    hoverLink(panel, null);
    panel.owner.hideTooltip();
  });
  panel.cleanups.push(() => {
    if (panel.owner.tooltipAnchor === panel.element) panel.owner.hideTooltip();
  });
  panel.markNpc = (id) => markNpc(panel, id);
  panel.cleanups.push(() => {
    delete panel.markNpc;
    panel.worldNpcFields = null;
  });
  panel.worldField = panel.owner.scene?.manifest.id;
  panel.localRefresh = () => {
    const field = panel.owner.scene?.manifest.id;
    if (field === panel.worldField) return;
    panel.worldField = field;
    showMap(panel, worldMapForField(maps, field));
  };
  showMap(panel, worldMapForField(maps, panel.worldField));
}
