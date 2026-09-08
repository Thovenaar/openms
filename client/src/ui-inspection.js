import { Graphics } from "pixi.js";
import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";

/** Browser inspection backdrop lives below raster glyphs, never over them in the DOM plane. */
function inspectionBackground(panel, color = 0xf7f3df) {
  const background = new Graphics()
    .rect(0, 0, panel.width, panel.height)
    .fill(color)
    .stroke({ color: 0x8b7e67, width: 1 });
  panel.root.addChildAt(background, 0);
}

/** Exact selected avatar icons are an inspection list, never an inventory grid. */
export function populateEquipment(panel) {
  inspectionBackground(panel);
  panel.text(
    "RECONSTRUCTION ARTWORK SELECTION\nNot live equipment or server inventory",
    12,
    24,
    { width: 306, className: "maple-ui-unavailable" },
  );
  const equipment = panel.resource.manifest.metadata.equipment;
  if (!Array.isArray(equipment) || equipment.length > 16) {
    throw new Error("Invalid reconstruction equipment metadata");
  }
  for (let i = 0; i < equipment.length; i++) {
    const record = equipment[i];
    panel.image(record.asset.id, 15, 80 + i * 48);
    panel.localButton(record.name, 60, 82 + i * 48, () =>
      panel.owner.inspectEquipment(record),
    );
  }
}

/** Requirement glyphs encode static template values only. Can glyph styling is not an eligibility assertion. */
export function populateEquipmentTooltip(panel, record) {
  inspectionBackground(panel, 0x20252a);
  if (!record) {
    panel.text(
      "Select reconstruction artwork to inspect its static metadata.",
      12,
      35,
      { width: 304, className: "maple-ui-unavailable" },
    );
    return;
  }
  panel.text(
    `${record.name}\nTemplate ${record.id}; no instance or eligibility data`,
    12,
    24,
    { width: 304, className: "maple-ui-unavailable" },
  );
  const requirements = [
    ["reqLEV", "reqLevel"],
    ["reqSTR", "reqSTR"],
    ["reqDEX", "reqDEX"],
    ["reqINT", "reqINT"],
    ["reqLUK", "reqLUK"],
    ["reqPOP", "reqPOP"],
  ];
  let y = 80;
  for (const [label, field] of requirements) {
    const path = `ToolTip/Equip/Can/${label}`;
    if (panel.assets[path]) panel.image(path, 14, y);
    const value = record.fields[field];
    if (value === undefined) {
      panel.text("not authored", 135, y, {
        width: 130,
        className: "maple-ui-status",
      });
    } else drawDigits(panel, String(value), 135, y);
    y += 22;
  }
  const fields = Object.entries(record.fields).filter(
    ([key]) => !key.startsWith("req"),
  );
  panel.text(
    `Static template properties: ${fields.map(([key, value]) => `${key}=${value}`).join(", ")}\nOriginal eligibility/instance comparisons unavailable.`,
    12,
    224,
    { width: 304, className: "maple-ui-unavailable" },
  );
}

function drawDigits(panel, text, x, y) {
  if (!/^\d{1,9}$/.test(text)) {
    panel.text(text, x, y, { width: 120, className: "maple-ui-status" });
    return;
  }
  for (const digit of text) {
    const path = `ToolTip/Equip/Can/${digit}`;
    if (!panel.assets[path]) {
      throw new Error(`Missing original tooltip digit ${digit}`);
    }
    panel.image(path, x, y);
    x += panel.assets[path].width;
  }
}

/** Atomically replace a separately leased map image; no stale scene callback can attach artwork. */
export async function replaceMinimap(owner, panel, signal) {
  const id = owner.scene?.manifest.id;
  if (!id) {
    panel.mapStatus.textContent = "No map scene";
    return;
  }
  const entry = owner.index.minimaps[id];
  if (!entry?.available) {
    panel.mapLabel.textContent = `Map ${id}`;
    releaseMap(panel);
    panel.mapStatus.textContent =
      entry?.reason || "Map not in packaged UI index";
    return;
  }
  panel.mapStatus.textContent = `Loading original minimap ${id}…`;
  let resource = await loadVisualBundle(
    entry.descriptor,
    owner.services,
    signal,
  );
  let animation = null;
  try {
    signal.throwIfAborted();
    const asset = resource.manifest.metadata.assets["miniMap/canvas"];
    animation = new EntityAnimation(
      resource.manifest.entities[0],
      resource.textures,
    );
    animation.container.zIndex = 0;
    const scale = Math.min(1, 230 / asset.width, 110 / asset.height);
    animation.container.scale.set(scale);
    animation.setPosition(
      12 + asset.origin.x * scale,
      53 + asset.origin.y * scale,
    );
    signal.throwIfAborted();
    releaseMap(panel);
    panel.root.addChild(animation.container);
    panel.mapAnimation = animation;
    panel.mapResource = resource;
    panel.dependencies.push(resource);
    panel.mapId = id;
    panel.mapLabel.textContent = `Map ${id} — original minimap canvas`;
    panel.mapStatus.textContent =
      "Artwork only; markers / live tracking unsupported";
    resource = null;
    animation = null;
  } finally {
    animation?.container.destroy({ children: true });
    resource?.destroy();
  }
}

function releaseMap(panel) {
  panel.mapAnimation?.container.destroy({ children: true });
  if (panel.mapResource) {
    const index = panel.dependencies.indexOf(panel.mapResource);
    if (index >= 0) panel.dependencies.splice(index, 1);
    panel.mapResource.destroy();
  }
  panel.mapAnimation = null;
  panel.mapResource = null;
  panel.mapId = null;
}
