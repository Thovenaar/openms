import { EntityAnimation } from "../rendering/animation.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";
import { replaceIcons, itemIcon } from "./ui-icons.js";
import { inventoryType, slotItem } from "../items/inventory-model.js";
import { updateStatDetail, updateApControls } from "./ui-stat.js";
import { JOB_LABELS } from "./ui-job-labels.js";
import { skillBooks, updateSkillBookHeader } from "./ui-skill-books.js";
import { updateSkillTabs } from "./ui-layout.js";
import { PROFILE_LIMITS } from "../profile/profile-validation.js";
import {
  experienceRequired,
  PROGRESSION_POLICY,
} from "../character/offline-progression.js";
import { skillPointPool } from "../skills/skill-allocation-rules.js";
import { itemTooltip, skillTooltip } from "./ui-tooltip.js";
import {
  minimapGeometry,
  createMinimapMarkers,
  rebuildMinimap,
  updateMinimap,
} from "./ui-minimap.js";
import {
  developmentJobPresets,
  stageJobPreset,
} from "../development/character-presets.js";

const MAX_PROFILE_ITEMS = 4096;
const BEGINNER_JOBS = new Set([0, 1000, 2000, 2001]);
const STAT_ATTRIBUTES = ["str", "dex", "int", "luk"];
const MESO_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
//007fefea selects00be23f0;007fec81 excludes body part14 and21..48 from this owner.
export const EQUIP_COORDINATES = [
  [38, 35],
  [38, 68],
  [71, 101],
  [104, 101],
  [38, 134],
  [38, 167],
  [71, 200],
  [5, 167],
  [5, 134],
  [137, 134],
  [104, 134],
  [104, 167],
  [137, 167],
  null,
  [104, 68],
  [137, 68],
  [71, 134],
  [5, 233],
  [38, 233],
  [71, 233],
  ...new Array(28).fill(null),
  [5, 68],
  [71, 167],
];

/** Original 0081e2c8; index is the physical slot minus the first visible slot. */
export function inventoryRect(index, expanded) {
  const row = Math.floor(index / 4);
  const bank = expanded ? Math.floor(row / 6) : 0;
  return {
    x: 8 + 36 * ((index % 4) + 4 * bank) + 5 * bank,
    y: 50 + 34 * (expanded ? row % 6 : row),
    width: 32,
    height: 32,
  };
}

function updateInventory(panel, profile) {
  if (!panel.inventoryReady) return;
  updateCurrency(panel, profile);
  const items = profile?.inventory || [];
  if (items.length > MAX_PROFILE_ITEMS) {
    throw new Error("Inventory UI budget exceeded");
  }
  const tab = panel.selectedTab || 0;
  const expanded = Boolean(panel.fullSkin?.container.visible);
  const capacity = profile?.inventorySlots[tab] || 0;
  panel.inventoryCount = capacity;
  // Native ZArray includes slot zero: floor((length-22)/4)+1 positions.
  const positions = Math.max(1, Math.floor((capacity + 1 - 22) / 4) + 1);
  panel.inventoryScrollbar.setRange(positions, panel.inventoryStart / 4);
  panel.inventoryScrollbar.setVisible(!expanded);
  panel.inventoryStart = panel.inventoryScrollbar.position * 4;
  const start = expanded ? 0 : panel.inventoryStart;
  const visible = items.filter(
    (item) =>
      inventoryType(item.id) === tab + 1 &&
      item.slot > start &&
      item.slot <= start + (expanded ? 96 : 24),
  );
  updateInventorySlots(panel, tab + 1, start, expanded);
  const signature = JSON.stringify([tab, expanded, start, visible]);
  if (signature === panel.inventorySignature) return;
  panel.inventorySignature = signature;
  const records = visible.map((item) => ({
    ...item,
    template: panel.owner.index.items[item.id],
  }));
  replaceIcons(panel, records, (layer, entry) => {
    itemIcon(layer, entry, inventoryRect(entry.slot - start - 1, expanded));
    clipIconLayer(layer, expanded ? 604 : 148, 50, 204);
  }).catch((error) => panel.owner.report(error));
}

function updateInventorySlots(panel, type, start, expanded) {
  const signature = `${type}:${start}:${expanded}:${panel.inventoryCount}`;
  if (panel.inventorySlotsSignature === signature) return;
  panel.inventorySlotsSignature = signature;
  panel.inventorySlotLayer?.destroy();
  const layer = panel.layer("Physical inventory slots");
  panel.inventorySlotLayer = layer;
  const last = Math.min(panel.inventoryCount, start + (expanded ? 96 : 24));
  for (let slot = start + 1; slot <= last; slot++) {
    const rect = inventoryRect(slot - start - 1, expanded);
    const button = layer.hit(`Inventory slot ${slot}`, rect, {
      click: (event) => {
        if (!slotItem(panel.owner.store.profile, type, slot)) {
          panel.owner.hooks.inventorySlotClick?.(event, type, slot);
        }
      },
    });
    button.dataset.inventoryType = String(type);
    button.dataset.itemSlot = String(slot);
  }
}

function clipIconLayer(layer, width, y, height) {
  if (layer.root.rasterClip) return;
  layer.root.rasterClip = { x: 0, y, width, height };
  layer.element.style.clipPath = `inset(${y}px ${Math.max(0, layer.width - width)}px ${Math.max(0, layer.height - y - height)}px 0)`;
}

/** 0081dc84 passes grouping=1 to00988690, which inserts a comma every three digits. */
function updateCurrency(panel, profile) {
  const amount = profile?.meso;
  if (panel.currencyAmount === amount) return;
  panel.currencyAmount = amount;
  panel.currencyValue.textContent = profile ? MESO_FORMAT.format(amount) : "";
}

function updateEquipment(panel, profile) {
  if (!panel.equipmentReady) return;
  const items = profile?.equipment || [];
  const signature = JSON.stringify(items);
  if (signature === panel.equipmentSignature) return;
  panel.equipmentSignature = signature;
  const covered = new Set(
    items.filter((item) => item.slot < -100).map((item) => item.slot + 100),
  );
  const records = items
    .filter((item) => !covered.has(item.slot))
    .map((item) => ({
      ...item,
      template: panel.owner.index.items[item.id],
    }));
  replaceIcons(panel, records, (layer, entry) => {
    const slot = entry.slot < -100 ? -entry.slot - 100 : -entry.slot;
    const point = EQUIP_COORDINATES[slot - 1];
    if (!point) {
      panel.owner.status(
        `Equipment slot unavailable for template ${entry.id}.`,
      );
      return;
    }
    const rect = { x: point[0], y: point[1], width: 32, height: 32 };
    const path = entry.template.iconPath;
    layer.image(path, rect.x, rect.y + 32, true);
    const button = layer.hit(
      entry.template.name,
      rect,
      {
        pointerdown: (event) =>
          panel.owner.hooks.inventoryItemPointerDown?.(
            event,
            entry,
            "equipment",
          ),
        dblclick: () =>
          panel.owner.hooks.inventoryItemDoubleClick?.(entry, "equipment"),
      },
      {
        tooltip: () => ({
          ...itemTooltip(panel.owner, entry.template, entry.id, {
            equipped: true,
            uid: entry.uid,
          }),
          source: { surface: layer, path },
        }),
      },
    );
    button.dataset.itemUid = entry.uid;
    button.dataset.itemSlot = String(entry.slot);
  }).catch((error) => panel.owner.report(error));
}

function statValue(panel, key, value, y) {
  let element = panel.statValues.get(key);
  if (!element) {
    element = panel.text("", 61, y, 91);
    element.style.lineHeight = "13px";
    panel.statValues.set(key, element);
  }
  const text = value === undefined || value === null ? "" : String(value);
  if (element.textContent !== text) element.textContent = text;
}

function updateStats(panel, profile) {
  if (!panel.statValues) return;
  if (!profile) {
    for (const control of panel.statControls) control.setVisible(false);
    for (const element of panel.statValues.values()) element.textContent = "";
    for (const sprite of panel.statOverlays) sprite.container.visible = false;
    return;
  }
  // 008c59ff: name, job/class, level, guild, HP, MP, EXP, fame.
  statValue(panel, "name", profile.name, 33);
  statValue(panel, "level", profile.level, 79);
  statValue(panel, "job", JOB_LABELS[profile.job], 55);
  statValue(panel, "guild", profile.guild, 96);
  statValue(panel, "hp", `${profile.hp} / ${profile.maxHP}`, 115);
  statValue(panel, "mp", `${profile.mp} / ${profile.maxMP}`, 133);
  statValue(panel, "exp", profile.exp, 151);
  statValue(panel, "fame", profile.fame, 169);
  statValue(panel, "str", profile.str, 244);
  statValue(panel, "dex", profile.dex, 262);
  statValue(panel, "int", profile.int, 280);
  statValue(panel, "luk", profile.luk, 298);
  statValue(panel, "remainingAp", profile.remainingAp, 215);
  updateStatMode(panel, profile);
  updateApControls(panel, profile);
  updateStatDetail(panel);
}

/** Offline manual-AP policy keeps the primary rows visible for every job.
 * Native 008c6177..6314 hides them for automatic-growth beginners through level10;
 * Cosmic Character.levelUp gates that growth on USE_AUTOASSIGN_STARTERS_AP.
 * Our authority instead admits explicit atomic AP spends, including for beginners.
 */
function updateStatMode(panel, profile) {
  const disabled = BEGINNER_JOBS.has(profile.job)
    ? 0
    : statDisabledMask(profile.job);
  for (const control of panel.statControls) control.setVisible(true);
  for (let i = 0; i < STAT_ATTRIBUTES.length; i++) {
    panel.statOverlays[i].container.visible = Boolean(disabled & (1 << i));
  }
}

/** 008c6328: job selects disabled labels, not numeric order. */
function statDisabledMask(job) {
  const family = Math.floor((job % 1000) / 100);
  if (family === 1 || family === 3 || family === 5) return 12;
  if (family === 2) return 3;
  if (family === 4) return 5;
  return 0;
}

function skillLearningDisabled(panel, template) {
  return Boolean(
    panel.skillLearning ||
    panel.owner.store?.profileTransactionPending ||
    typeof panel.owner.hooks.onLearnSkill !== "function" ||
    typeof panel.owner.hooks.skillAllocationError !== "function" ||
    panel.owner.hooks.skillAllocationError(template.id),
  );
}

function skillRow(panel, layer, entry, row) {
  const { template, learned } = entry;
  const rank = learned?.level || 0;
  const path =
    rank > 0
      ? template.iconPath
      : template.iconDisabledPath || template.iconPath;
  if (path) layer.image(path, 10, 102 + 40 * row);
  const name = layer.text(template.name, 46, 103 + 40 * row, 111);
  name.style.whiteSpace = "nowrap";
  name.style.overflow = "hidden";
  name.style.textOverflow = "ellipsis";
  layer.text(
    `Lv. ${rank}/${template.maxLevel} M${learned?.masterLevel || 0}`,
    46,
    120 + 40 * row,
    88,
  );
  const hit = layer.hit(
    template.name,
    { x: 7, y: 99 + 40 * row, width: 126, height: 38 },
    {
      pointerdown: (event) => {
        if (event.button !== 0) return;
        panel.skillSelectedId = template.id;
        for (const button of layer.element.querySelectorAll(
          "[data-skill-id]",
        )) {
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.skillId === String(template.id)),
          );
        }
        if (rank <= 0 || panel.owner.store?.profileTransactionPending) return;
        panel.owner.beginBindingDrag(
          event,
          { type: 1, id: template.id },
          null,
          { source: layer, path: template.iconPath },
        );
      },
    },
    {
      tooltip: () => ({
        ...skillTooltip(panel.owner, template),
        source: { surface: layer, path },
      }),
    },
  );
  hit.dataset.skillId = String(template.id);
  hit.setAttribute(
    "aria-pressed",
    String(panel.skillSelectedId === template.id),
  );
  // 008aad45..b3: original BtSpUp, x131/y119, four rows spaced40 pixels.
  layer.button("Skill/BtSpUp", 131, 119 + 40 * row, {
    label: `Learn ${template.name}`,
    action: () => learnSkill(panel, template.id),
    disabled: skillLearningDisabled(panel, template),
  });
}

/** Only the captured store and owner epoch may receive asynchronous skill feedback. */
function ownsSkillRequest(panel, request) {
  return (
    !panel.disposed && panel.owner.ownsProfile(request.store, request.epoch)
  );
}

async function learnSkill(panel, id) {
  const owner = panel.owner;
  if (panel.skillLearning || owner.store?.profileTransactionPending) return;
  const store = owner.store;
  const epoch = owner.epoch;
  panel.skillLearning = true;
  const request = { store, epoch };
  panel.skillRequest = request;
  panel.skillFeedback = "Saving skill…";
  updateSkills(panel, store.profile);
  try {
    const result = await owner.hooks.onLearnSkill(id);
    if (!ownsSkillRequest(panel, request)) return;
    if (result?.ok === false) {
      throw new Error(result.reason || "Skill learning rejected");
    }
    panel.skillFeedback = "Skill saved.";
  } catch (error) {
    if (!ownsSkillRequest(panel, request)) return;
    panel.skillFeedback = error.message;
    owner.report(error);
  } finally {
    if (ownsSkillRequest(panel, request)) {
      panel.skillLearning = false;
      panel.skillRequest = null;
      updateSkills(panel, store.profile);
      owner.status(panel.skillFeedback);
    }
  }
}

function cancelStaleSkillRequest(panel) {
  if (
    panel.skillRequest &&
    !panel.owner.ownsProfile(panel.skillRequest.store, panel.skillRequest.epoch)
  ) {
    panel.skillRequest = null;
    panel.skillLearning = false;
    panel.skillFeedback = "Skill learning cancelled: ownership changed.";
  }
}

/** Normal book entries retain native exclusions and the current four-row viewport. */
function skillPage(panel, profile, job) {
  // 007619b0 includes unlearned normal entries; hidden/time-limited books are separate.
  const skills = Object.values(panel.owner.index.skills).filter(
    (skill) => skill.bookId === job && visibleSkillEntry(skill, profile),
  );
  panel.skillCount = skills.length;
  panel.skillScrollbar.setRange(
    Math.max(1, skills.length - 3),
    panel.skillStart,
  );
  panel.skillStart = panel.skillScrollbar.position;
  const start = panel.skillStart;
  const records = skills.slice(start, start + 4).map((template) => ({
    template,
    learned: profile?.skills[template.id],
  }));
  return { start, records };
}

/** 007619b0: learned rank and record presence are distinct native visibility gates. */
function visibleSkillEntry(skill, profile) {
  if (skill.id === 1014 || skill.id === 10001015) return false;
  const learned = profile?.skills[skill.id];
  return (
    (learned?.level > 0 || !skill.flags.invisible) &&
    (Boolean(learned) || !skill.flags.timeLimited)
  );
}

function updateSkillSummary(panel, profile, points, available) {
  if (!panel.skillPoints) {
    panel.skillPoints = panel.text("", 84, 265, 27);
    panel.skillPoints.style.whiteSpace = "nowrap";
    panel.skillPoints.style.overflow = "hidden";
    panel.skillPoints.style.textAlign = "right";
  }
  const pointSummary = `SP pools 1–10: ${points.join(" / ")}`;
  panel.skillPoints.textContent =
    profile && available !== null ? String(available) : "";
  panel.skillPoints.title = pointSummary;
  panel.element.setAttribute("aria-busy", String(Boolean(panel.skillLearning)));
}

/** Beginner books show native entitlement, not the durable ordinary SP pool. */
function availableSkillPoints(panel, profile, job) {
  if (!profile) return null;
  if (!BEGINNER_JOBS.has(job)) return profile.remainingSp[skillPointPool(job)];
  const id = job * 10000 + 1000;
  if (
    !panel.owner.index.skills[id] ||
    typeof panel.owner.hooks.skillAllocationPoints !== "function"
  ) {
    return null;
  }
  return panel.owner.hooks.skillAllocationPoints(id);
}

function updateSkills(panel, profile) {
  if (!panel.skillsReady) return;
  cancelStaleSkillRequest(panel);
  const books = skillBooks(profile?.job);
  updateSkillTabs(panel, books);
  const job = books[panel.selectedTab || 0];
  updateSkillBookHeader(panel, job);
  const { start, records } = skillPage(panel, profile, job);
  const points = profile?.remainingSp || [];
  const available = availableSkillPoints(panel, profile, job);
  const signature = JSON.stringify([
    job,
    start,
    records.map((entry) => entry.learned),
    points,
    available,
    Boolean(panel.skillLearning),
    Boolean(panel.owner.store?.profileTransactionPending),
    panel.skillFeedback,
  ]);
  if (panel.skillSignature === signature) return;
  panel.skillSignature = signature;
  updateSkillSummary(panel, profile, points, available);
  replaceIcons(panel, records, (layer, entry, row) => {
    skillRow(panel, layer, entry, row);
    clipIconLayer(layer, 152, 99, 155);
  }).catch((error) => panel.owner.report(error));
}

/** Profile notifications and tab/wheel events only; never builds display objects in RAF. */
export function updateProfilePanel(panel, store) {
  if (!panel) return;
  if (panel.name === "Item") updateInventory(panel, store?.profile);
  else if (panel.name === "Equip") updateEquipment(panel, store?.profile);
  else if (panel.name === "Stat") updateStats(panel, store?.profile);
  else if (panel.name === "Skill") updateSkills(panel, store?.profile);
}

function minimapMark(resource, geometry) {
  if (!geometry.mark) return null;
  const entity = resource.manifest.entities.find(
    (record) => record.id === geometry.mark.id,
  );
  if (!entity) throw new Error("Missing original minimap map-mark entity");
  const mark = new EntityAnimation(entity, resource.textures);
  mark.setPosition(6 + geometry.mark.origin.x, 23 + geometry.mark.origin.y);
  mark.container.zIndex = 1;
  return mark;
}

/** Field changes must not display the previous field's header or crop during a new lease. */
function beginMinimapLoad(owner, panel, entry, id) {
  if (panel.mapId === id) return;
  releaseMap(panel);
  panel.mapId = id;
  panel.mapNames = entry ?? null;
  panel.mapStatus.textContent = "Loading map…";
  rebuildMinimap(panel);
  owner.positionWindow(panel, panel.x, panel.y);
  panel.renderArtwork();
}

/** Transfer a fully prepared lease; frame reconstruction never owns the header or map image. */
function attachMinimap(
  panel,
  { resource, geometry, animation, markers, mark, id },
) {
  releaseMap(panel);
  panel.mapContent.addChild(animation.container, markers.layer.root);
  markers.layer.root.visible = true;
  panel.mapMarkerLayer = markers.layer;
  panel.mapMarkers = markers.markers;
  panel.mapPlayerMarker = markers.player;
  panel.mapGeometry = geometry;
  panel.mapNames = resource.manifest.metadata;
  panel.mapMarkAnimation = mark;
  if (mark) panel.root.addChild(mark.container);
  panel.mapAnimation = animation;
  panel.mapResource = resource;
  panel.dependencies.push(resource);
  panel.mapId = id;
  panel.mapStatus.textContent = "";
}

/** Atomically replace a separately leased map image; stale scene loads cannot attach artwork. */
export async function replaceMinimap(owner, panel, signal) {
  signal.throwIfAborted();
  if (panel.disposed) return;
  const generation = (panel.mapGeneration = (panel.mapGeneration ?? 0) + 1);
  const scene = owner.scene;
  const id = scene?.manifest.id;
  if (!id) return;
  const entry = owner.index.minimaps[id];
  beginMinimapLoad(owner, panel, entry, id);
  if (!entry?.available) {
    unavailableMinimap(owner, panel, entry, id);
    return;
  }
  let resource = await loadVisualBundle(
    entry.descriptor,
    owner.services,
    signal,
  );
  let animation = null;
  let markers = null;
  let mark = null;
  try {
    signal.throwIfAborted();
    const geometry = minimapGeometry(resource.manifest.metadata);
    animation = new EntityAnimation(
      resource.manifest.entities[0],
      resource.textures,
    );
    animation.container.zIndex = 0;
    mark = minimapMark(resource, geometry);
    markers = createMinimapMarkers(panel, scene.manifest);
    signal.throwIfAborted();
    assertMinimapOwner(owner, panel, scene, generation);
    attachMinimap(panel, { resource, geometry, animation, markers, mark, id });
    mark = null;
    markers = null;
    resource = null;
    animation = null;
    rebuildMinimap(panel);
    updateMinimap(panel, scene.simulation.x, scene.simulation.y);
    owner.positionWindow(panel, panel.x, panel.y);
    panel.renderArtwork();
  } finally {
    mark?.container.destroy({ children: true });
    markers?.layer.destroy();
    animation?.container.destroy({ children: true });
    resource?.destroy();
  }
}

function assertMinimapOwner(owner, panel, scene, generation) {
  if (
    panel.disposed ||
    owner.scene !== scene ||
    panel.mapGeneration !== generation
  ) {
    throw new Error("Minimap scene ownership changed");
  }
}

function unavailableMinimap(owner, panel, entry, id) {
  releaseMap(panel);
  panel.mapId = id;
  panel.mapNames = entry ?? null;
  const reason = entry?.reason || "Map not in packaged UI index";
  panel.mapStatus.textContent = reason;
  rebuildMinimap(panel);
  owner.positionWindow(panel, panel.x, panel.y);
  panel.renderArtwork();
  owner.status(reason);
}

function releaseMap(panel) {
  panel.mapMarkerLayer?.destroy();
  panel.mapMarkerLayer = null;
  panel.mapMarkers = [];
  panel.mapPlayerMarker = null;
  panel.mapGeometry = null;
  panel.mapNames = null;
  panel.mapMarkAnimation?.container.destroy({ children: true });
  panel.mapMarkAnimation = null;
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

function inspectionElement(tag, text, parent) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

const PROFILE_FIELDS = [
  ["name", "Name", null, "identity"],
  ["level", "Level", 1, "identity"],
  ["hp", "HP", 0, "resources"],
  ["baseMaxHP", "Base maximum HP", 1, "resources"],
  ["mp", "MP", 0, "resources"],
  ["baseMaxMP", "Base maximum MP", 0, "resources"],
  ["str", "STR", 1, "attributes"],
  ["dex", "DEX", 1, "attributes"],
  ["int", "INT", 1, "attributes"],
  ["luk", "LUK", 1, "attributes"],
  ["remainingAp", "Ability points (AP)", 0, "progress"],
  ["exp", "EXP", 0, "progress"],
  ["meso", "Meso", 0, "progress"],
  ["fame", "Fame", Number.MIN_SAFE_INTEGER, "progress"],
];

function profileGroup(parent, title, open = false) {
  const section = inspectionElement("details", "", parent);
  section.className = "profile-group";
  section.open = open;
  inspectionElement("summary", title, section);
  const grid = inspectionElement("div", "", section);
  grid.className = "profile-grid";
  return grid;
}

function profileInput(parent, label, minimum) {
  const wrapper = inspectionElement("label", `${label} `, parent);
  const input = inspectionElement("input", "", wrapper);
  input.setAttribute("aria-label", label);
  input.type = minimum === null ? "text" : "number";
  input.required = true;
  if (minimum !== null) {
    input.min = String(minimum);
    input.max = String(Number.MAX_SAFE_INTEGER);
    input.step = "1";
  }
  return input;
}

function profileButton(parent, text) {
  const button = inspectionElement("button", text, parent);
  button.type = "button";
  return button;
}

const MAX_CATALOG_ITEMS = 65536;
const MAX_ITEM_OPTIONS = 200;

/** Packaged templates only; bounded DOM results never restrict the searchable catalog. */
export class ItemCatalogControls {
  constructor(parent, items, label) {
    this.entries = Object.values(items);
    if (this.entries.length > MAX_CATALOG_ITEMS) {
      throw new Error("Item catalog exceeds inspection budget");
    }
    const wrapper = inspectionElement("label", label, parent);
    this.search = inspectionElement("input", "", wrapper);
    this.search.type = "search";
    this.search.maxLength = 120;
    this.search.placeholder = "Item name or ID";
    this.select = inspectionElement("select", "", parent);
    this.select.setAttribute("aria-label", label);
    this.status = inspectionElement("p", "", parent);
    this.status.setAttribute("role", "status");
    this.onSearch = this.refresh.bind(this);
    this.search.addEventListener("input", this.onSearch);
    this.refresh();
  }

  refresh() {
    const previous = this.select.value;
    const query = this.search.value.trim().toLowerCase();
    this.select.replaceChildren();
    let count = 0;
    for (const item of this.entries) {
      if (!`${item.name ?? ""} ${item.id}`.toLowerCase().includes(query)) {
        continue;
      }
      count++;
      if (count > MAX_ITEM_OPTIONS) continue;
      const option = inspectionElement(
        "option",
        `${item.name || "Item"} [${item.id}]`,
        this.select,
      );
      option.value = String(item.id);
    }
    for (const option of this.select.options) {
      if (option.value === previous) this.select.value = previous;
    }
    this.select.disabled = count === 0;
    this.status.textContent =
      count > MAX_ITEM_OPTIONS
        ? `${count} matches; showing first ${MAX_ITEM_OPTIONS}. Refine the search.`
        : count
          ? `${count} matching catalog items.`
          : "No matching catalog items. Clear or refine the search.";
  }

  destroy() {
    this.search.removeEventListener("input", this.onSearch);
  }
}

/** Local policy controls stay outside the original raster gameplay plane. */
export class ProfileControls {
  constructor(owner) {
    this.owner = owner;
    this.destroyed = false;
    this.dirty = false;
    this.fields = new Map();
    this.skillRows = new Map();
    this.root = document.createElement("section");
    this.root.id = "character-controls";
    this.root.className = "profile-workspace";
    this.root.setAttribute("aria-label", "Character editor");
    this.scroll = inspectionElement("div", "", this.root);
    this.scroll.className = "profile-scroll";
    this.buildEditor();
    this.buildUtilities();
    this.buildSavebar();
    this.bindEditorListeners();
    document.querySelector("#inspection-controls").append(this.root);
    this.refresh();
  }

  bindEditorListeners() {
    const owner = this.owner;
    this.listeners = [
      [this.save, "click", owner.saveProfile.bind(owner)],
      [this.reset, "click", owner.requestReset.bind(owner)],
      [this.recover, "click", owner.recoverProfile.bind(owner)],
      [this.form, "submit", this.submit.bind(this)],
      [this.form, "input", this.markEdited.bind(this)],
      [this.form, "invalid", this.revealInvalid.bind(this), true],
      [this.form, "click", this.removeSkill.bind(this)],
      [
        this.fields.get("level"),
        "input",
        this.updateExperienceLimit.bind(this, true),
      ],
      [this.revert, "click", this.revertEdits.bind(this)],
      [this.add, "click", this.addSkill.bind(this)],
      [this.learnedChoice, "change", this.selectLearnedSkill.bind(this)],
      [this.job, "change", this.refreshPointPools.bind(this)],
      [this.offer, "click", this.offerItem.bind(this)],
      [this.stagePreset, "click", this.preparePreset.bind(this)],
      [this.conjure, "click", this.conjureItem.bind(this)],
      [this.offerCatalog.search, "input", this.refresh.bind(this)],
      [this.conjureCatalog.search, "input", this.refresh.bind(this)],
    ];
    for (const [node, type, handler, capture = false] of this.listeners) {
      node.addEventListener(type, handler, capture);
    }
  }

  buildUtilities() {
    const recovery = inspectionElement("details", "", this.scroll);
    inspectionElement("summary", "Save & recovery", recovery);
    inspectionElement(
      "p",
      this.owner.hooks.readOnlyProfile
        ? "Applied changes are saved by the server. Use Revive when your character has died."
        : "Checkpoint saves the live character, not unapplied edits.",
      recovery,
    ).className = "hint";
    const actions = inspectionElement("div", "", recovery);
    actions.className = "profile-actions";
    this.save = profileButton(actions, "Save checkpoint");
    this.save.hidden = Boolean(this.owner.hooks.readOnlyProfile);
    this.recover = profileButton(actions, "Revive character");
    this.status = inspectionElement("p", "", recovery);
    this.status.setAttribute("role", "status");
    this.status.className = "hint";
    const advanced = inspectionElement("details", "", this.scroll);
    inspectionElement("summary", "Destructive actions", advanced);
    advanced.hidden = Boolean(this.owner.hooks.readOnlyProfile);
    this.reset = profileButton(advanced, "Reset character…");
    const offering = inspectionElement("details", "", this.scroll);
    inspectionElement("summary", "Reactor testing", offering);
    this.offerCatalog = new ItemCatalogControls(
      offering,
      this.owner.index.items,
      "Reactor offering item",
    );
    this.items = this.offerCatalog.select;
    this.offer = profileButton(offering, "Offer nearby");
    this.feedback = inspectionElement("p", "", offering);
    this.feedback.setAttribute("role", "status");
    this.buildConjure();
  }

  buildConjure() {
    const section = inspectionElement("details", "", this.scroll);
    section.id = "conjure-world-item";
    inspectionElement("summary", "Conjure world item", section);
    this.conjureCatalog = new ItemCatalogControls(
      section,
      this.owner.index.items,
      "Item to drop in front of character",
    );
    this.quantity = profileInput(section, "Drop quantity", 1);
    this.quantity.value = "1";
    this.conjure = profileButton(section, "Drop chosen item in front");
    this.conjureStatus = inspectionElement(
      "p",
      "Items enter inventory only when picked up.",
      section,
    );
    this.conjureStatus.setAttribute("role", "status");
  }

  async conjureItem() {
    if (this.isBusy()) return;
    const selection = this.conjureSelection();
    if (!selection) return;
    const { itemId, quantity } = selection;
    const request = { store: this.owner.store, epoch: this.owner.epoch };
    this.conjuring = request;
    this.refresh();
    try {
      const result = await this.owner.hooks.onConjureItem({ itemId, quantity });
      if (!this.owns(request)) return;
      if (result?.ok !== true) {
        throw new Error(result?.reason || "World drop rejected");
      }
      this.conjureStatus.textContent = `Dropped item ${itemId} × ${quantity}. Pick it up in the field.`;
    } catch (error) {
      if (this.owns(request)) {
        this.conjureStatus.textContent = `Drop failed: ${error.message}`;
      }
    } finally {
      if (this.conjuring === request) this.conjuring = null;
      if (this.owns(request)) this.refresh();
    }
  }

  conjureSelection() {
    if (!this.quantity.reportValidity()) return null;
    const itemId = Number(this.conjureCatalog.select.value);
    const quantity = Number(this.quantity.value);
    if (
      !Number.isSafeInteger(itemId) ||
      itemId <= 0 ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1
    ) {
      return null;
    }
    return { itemId, quantity };
  }

  buildEditor() {
    this.form = inspectionElement("form", "", this.scroll);
    this.form.id = "character-profile-form";
    this.form.noValidate = true;
    this.editor = inspectionElement("fieldset", "", this.form);
    inspectionElement("legend", "Edit character", this.editor);
    this.buildPresets();
    this.buildFields();
    this.buildPointPools();
    this.buildSkillEditor();
  }

  buildSavebar() {
    const bar = inspectionElement("div", "", this.root);
    bar.className = "profile-savebar";
    const actions = inspectionElement("div", "", bar);
    actions.className = "profile-actions";
    this.apply = inspectionElement("button", "Apply changes", actions);
    this.apply.type = "submit";
    this.apply.setAttribute("form", this.form.id);
    this.apply.className = "primary";
    this.apply.setAttribute("aria-label", "Apply character changes");
    this.revert = profileButton(actions, "Discard");
    this.revert.setAttribute("aria-label", "Discard unsaved edits");
    this.editStatus = inspectionElement("p", "No unsaved changes.", bar);
    this.editStatus.setAttribute("role", "status");
    this.editStatus.setAttribute("aria-live", "polite");
  }

  buildFields() {
    const groups = {
      identity: profileGroup(this.editor, "Identity", true),
      resources: profileGroup(this.editor, "HP & MP", true),
      attributes: profileGroup(this.editor, "Attributes"),
      progress: profileGroup(this.editor, "Progress & wallet"),
    };
    for (const [key, label, minimum, group] of PROFILE_FIELDS) {
      const input = profileInput(groups[group], label, minimum);
      input.name = key;
      if (key === "name") {
        input.maxLength = PROFILE_LIMITS.name;
        input.parentElement.className = "profile-wide";
      }
      this.fields.set(key, input);
    }
    this.fields.get("level").max = String(PROGRESSION_POLICY.maxLevel);
    this.fields.get("level").title =
      "Changing level resets staged EXP to 0. You can then edit EXP.";
    this.currentMaxima = inspectionElement("output", "", groups.resources);
    this.currentMaxima.className = "profile-wide";
    const label = inspectionElement("label", "Job", groups.identity);
    label.className = "profile-wide";
    this.job = inspectionElement("select", "", label);
    this.job.setAttribute("aria-label", "Job");
    this.job.required = true;
    this.fields.set("job", this.job);
    for (const id of this.owner.index.coverage.skillCoverage.playerBooks) {
      const option = inspectionElement(
        "option",
        `${JOB_LABELS[id] || "Job"} [${id}]`,
        this.job,
      );
      option.value = String(id);
    }
  }

  updateExperienceLimit(reset = false) {
    const level = this.fields.get("level");
    if (!level.validity.valid) return;
    const exp = this.fields.get("exp");
    exp.max = String(Math.max(0, experienceRequired(Number(level.value)) - 1));
    if (reset) exp.value = "0";
  }

  revealInvalid(event) {
    const row = event.target.closest("[data-learned-skill]");
    if (row) {
      this.learnedChoice.value = row.dataset.learnedSkill;
      this.selectLearnedSkill();
    }
    let node = event.target.parentElement;
    for (let depth = 0; node && node !== this.form && depth < 8; depth++) {
      if (node.tagName === "DETAILS") node.open = true;
      node = node.parentElement;
    }
    this.editStatus.textContent =
      "Check the highlighted field before applying.";
  }
  buildPointPools() {
    const pointDetails = inspectionElement("details", "", this.editor);
    inspectionElement("summary", "Advanced: skill point pools", pointDetails);
    const pools = inspectionElement("fieldset", "", pointDetails);
    inspectionElement("legend", "Unused skill points (SP)", pools);
    this.spFields = [];
    this.spExplanation = inspectionElement("p", "", pools);
    for (let i = 0; i < 10; i++) {
      this.spFields.push(
        profileInput(
          pools,
          i === 0
            ? "SP — most jobs / Evan stage 1"
            : `SP — Evan stage ${i + 1}`,
          0,
        ),
      );
    }
  }

  refreshPointPools() {
    const books = skillBooks(Number(this.job.value));
    const relevant = new Set();
    for (const book of books) {
      if (!BEGINNER_JOBS.has(book)) relevant.add(skillPointPool(book));
    }
    for (let i = 0; i < this.spFields.length; i++) {
      const input = this.spFields[i];
      input.parentElement.hidden = !relevant.has(i) && input.validity.valid;
    }
    this.spExplanation.textContent = relevant.size
      ? "Pools used by the selected job's skill books and invalid staged pools are shown. Ordinary jobs share pool 1; Evan stages use separate pools. All ten stored pools are preserved; changing job does not grant or move SP."
      : "Beginner skills use level-based entitlement, not stored SP. Invalid staged pools remain visible for correction. All ten stored pools are preserved.";
  }
  buildPresets() {
    const section = inspectionElement("details", "", this.editor);
    section.open = true;
    inspectionElement("summary", "Job & utility presets", section);
    this.preset = inspectionElement("select", "", section);
    this.preset.setAttribute("aria-label", "Character preset");
    const placeholder = inspectionElement(
      "option",
      "Choose a job or utility preset…",
      this.preset,
    );
    placeholder.value = "";
    this.buildJobPresets();
    const utilities = inspectionElement("optgroup", "", this.preset);
    utilities.label = "Utility presets — change only the named values";
    for (const [id, label] of [
      ["restore", "Restore HP / MP to current maxima"],
      ["training", "Training budget: 20 AP + 10 SP (first pool)"],
      ["mesos", "Drop testing: set wallet to 100,000 mesos"],
    ]) {
      const option = inspectionElement("option", label, utilities);
      option.value = id;
    }
    this.stagePreset = profileButton(section, "Stage preset");
    this.applyPreset = profileButton(section, "Apply staged preset");
    this.applyPreset.type = "submit";
    this.applyPreset.setAttribute(
      "aria-label",
      "Apply staged character preset",
    );
    inspectionElement(
      "p",
      "Choose a preset, stage it, then review and Apply. Discard cancels; staging does not change your character.",
      section,
    );
    const coverage = inspectionElement("details", "", section);
    inspectionElement("summary", "Available job coverage", coverage);
    const books = this.owner.index.coverage.skillCoverage.playerBooks;
    inspectionElement(
      "p",
      `All ${books.length} original job books are included, including advancement stages and special jobs.`,
      coverage,
    );
    if (!books.includes(2001)) {
      inspectionElement(
        "p",
        "Evan has no beginner or advancement books in these original assets, so no Evan preset can be created.",
        coverage,
      );
    }
    this.presetPreview = inspectionElement("section", "", section);
    this.presetPreview.className = "profile-preset-preview";
    this.presetPreview.hidden = true;
  }

  buildJobPresets() {
    const groups = new Map();
    for (const preset of developmentJobPresets(this.owner.index)) {
      let group = groups.get(preset.family);
      if (!group) {
        group = inspectionElement("optgroup", "", this.preset);
        group.label = `${preset.family} — all original job stages`;
        groups.set(preset.family, group);
      }
      const option = inspectionElement("option", preset.label, group);
      option.value = `job:${preset.id}`;
    }
  }

  /** Stage detached form/binding values; only submit crosses the durable authority. */
  preparePreset() {
    if (this.isBusy() || !this.owner.store.profile) return;
    if (this.dirty) {
      this.editStatus.textContent =
        "Apply or discard your unsaved edits before staging another preset.";
      return;
    }
    this.refreshEditor(this.owner.store.profile);
    try {
      if (this.preset.value.startsWith("job:")) this.prepareJobPreset();
      else this.prepareUtilityPreset();
      this.updateExperienceLimit();
      this.markEdited();
      this.editStatus.textContent =
        "Preset staged only. Review the preview, then Apply changes or Discard.";
    } catch (error) {
      this.editStatus.textContent = `Preset not staged: ${error.message}`;
    }
  }

  prepareJobPreset() {
    this.requireBindingOwnership();
    const preview = stageJobPreset(
      this.owner.index,
      this.owner.store.profile,
      Number(this.preset.value.slice(4)),
    );
    for (const key of [
      "job",
      "level",
      "exp",
      "str",
      "dex",
      "int",
      "luk",
      "hp",
      "mp",
      "baseMaxHP",
      "baseMaxMP",
    ]) {
      this.fields.get(key).value = String(preview.patch[key]);
    }
    this.stagedJobId = preview.patch.job;
    this.stagedBindings = preview.patch.keyBindings;
    this.refreshSkillEditor(preview.patch.skills);
    this.refreshPointPools();
    this.renderPresetPreview(preview);
  }

  prepareUtilityPreset() {
    const profile = this.owner.store.profile;
    switch (this.preset.value) {
      case "restore":
        this.fields.get("hp").value = String(profile.maxHP);
        this.fields.get("mp").value = String(profile.maxMP);
        break;
      case "training":
        if (this.spFields[0].parentElement.hidden) {
          throw new Error(
            "The selected job does not use pool 1. No values were staged.",
          );
        }
        this.fields.get("remainingAp").value = "20";
        this.fields.get("remainingAp").closest("details").open = true;
        this.spFields[0].value = "10";
        this.spFields[0].closest("details").open = true;
        break;
      case "mesos":
        this.fields.get("meso").value = "100000";
        this.fields.get("meso").closest("details").open = true;
        break;
      default:
        throw new Error("Choose a job or utility preset first.");
    }
    this.presetPreview.replaceChildren();
    inspectionElement(
      "p",
      `Staged: ${this.preset.selectedOptions[0].textContent}. All other values and bindings are unchanged.`,
      this.presetPreview,
    );
    this.presetPreview.hidden = false;
  }

  renderPresetPreview(preview) {
    this.presetPreview.replaceChildren();
    this.presetPreview.hidden = false;
    inspectionElement(
      "h3",
      `${preview.label} · Lv.${preview.patch.level} · EXP 0`,
      this.presetPreview,
    );
    inspectionElement(
      "p",
      `${Object.keys(preview.patch.skills).length} maxed skills · ${preview.bindings.length} skill shortcuts · STR/DEX/INT/LUK ${preview.patch.str} · HP/MP ${preview.patch.hp}. Non-skill keys and unrelated inventory are preserved.`,
      this.presetPreview,
    );
    this.renderPresetLoadout(preview.loadout);
    this.renderPresetBindings(preview.bindings);
    const policy = inspectionElement("details", "", this.presetPreview);
    inspectionElement("summary", "What this preset replaces", policy);
    inspectionElement(
      "p",
      `Original job books: ${preview.books.join(" → ")}.`,
      policy,
    );
    for (const note of preview.notes) inspectionElement("p", note, policy);
    this.renderPresetSkills(preview.rows);
  }

  renderPresetLoadout(loadout) {
    inspectionElement("h4", "Staged original equipment", this.presetPreview);
    const list = inspectionElement("ul", "", this.presetPreview);
    list.className = "profile-preset-bindings";
    for (const item of loadout.equipment) {
      inspectionElement(
        "li",
        `${item.name} [${item.id}] · slot ${item.slot}`,
        list,
      );
    }
    if (loadout.ammunition) {
      const item = loadout.ammunition;
      inspectionElement(
        "li",
        `${item.name} [${item.id}] × ${item.count} ammunition (${item.granted} granted)`,
        list,
      );
    }
    inspectionElement(
      "p",
      "Replaced gear and covering cash equipment move to inventory; no owned item is deleted. Apply prepares the original appearance before committing. Make space first if capacity is insufficient.",
      this.presetPreview,
    );
  }

  renderPresetBindings(assignments) {
    inspectionElement("h4", "Staged skill shortcuts", this.presetPreview);
    const bindings = inspectionElement("ul", "", this.presetPreview);
    bindings.className = "profile-preset-bindings";
    for (const binding of assignments) {
      inspectionElement(
        "li",
        `${binding.key} → ${binding.name} [${binding.id}]`,
        bindings,
      );
    }
    if (!assignments.length) {
      inspectionElement(
        "p",
        "No active shortcut can be assigned: this preset has no natively bindable runtime-capable skills, or all preset keys hold preserved controls/items/macros.",
        this.presetPreview,
      );
    }
  }

  renderPresetSkills(rows) {
    const details = inspectionElement("details", "", this.presetPreview);
    inspectionElement(
      "summary",
      `All ${rows.length} authored skills: ranks, runtime availability & requirements`,
      details,
    );
    const skills = inspectionElement("ul", "", details);
    skills.className = "profile-preset-skills";
    for (const row of rows) {
      const binding = row.binding
        ? `Key ${row.binding}`
        : row.bindable
          ? "Learned, no preset shortcut (eight-key/free-key limit)"
          : "No active shortcut";
      const mastery = row.masteryRequired ? "mastery-gated" : "ordinary book";
      inspectionElement(
        "li",
        `${row.name} [${row.id}] · rank ${row.rank}, mastery ${row.mastery} (${mastery}). ${binding}. ${row.status} ${row.requirements.join("; ")}`,
        skills,
      );
    }
  }

  requireBindingOwnership() {
    if (
      this.owner.bindings?.editing ||
      this.owner.bindings?.saving ||
      this.owner.quickCaptureDraft ||
      this.owner.bindingDrag
    ) {
      throw new Error(
        "Finish or discard the native KeyConfig / quick-slot edit or carry first. Its bindings will not be overwritten.",
      );
    }
    if (
      JSON.stringify(this.owner.store.profile.keyBindings) !==
      this.baseline.keyBindings
    ) {
      throw new Error(
        "Bindings changed since this draft began. Discard and stage again; the current bindings were preserved.",
      );
    }
  }

  buildSkillEditor() {
    const details = inspectionElement("details", "", this.editor);
    inspectionElement("summary", "Advanced: edit learned skills", details);
    const section = inspectionElement("fieldset", "", details);
    inspectionElement("legend", "Learned skills", section);
    inspectionElement(
      "p",
      "Use the Skill window + buttons to spend SP normally. These advanced controls change skill levels directly. Expiration is milliseconds since 1 January 1970; leave blank for no expiration.",
      section,
    );
    this.learnedChoice = inspectionElement("select", "", section);
    this.learnedChoice.setAttribute("aria-label", "Learned skill to edit");
    this.skillList = inspectionElement("div", "", section);
    this.skillChoice = inspectionElement("select", "", section);
    this.skillChoice.setAttribute("aria-label", "Skill to add");
    const skills = Object.values(this.owner.index.skills);
    if (skills.length > PROFILE_LIMITS.skills) {
      throw new Error("Skill catalog exceeds profile editor budget");
    }
    skills.sort((a, b) => a.id - b.id);
    for (const skill of skills) {
      const option = inspectionElement(
        "option",
        `${skill.name} [${skill.id}]`,
        this.skillChoice,
      );
      option.value = String(skill.id);
    }
    this.add = profileButton(section, "Add learned skill");
  }

  appendSkill(id, record) {
    const row = inspectionElement("fieldset", "", this.skillList);
    row.dataset.learnedSkill = String(id);
    row.hidden = true;
    const template = this.owner.index.skills[id];
    inspectionElement("legend", `${template?.name || "Skill"} [${id}]`, row);
    const fields = new Map();
    for (const [key, label] of [
      ["level", "Skill level"],
      ["masterLevel", "Maximum trainable level"],
      ["expiresAt", "Expiration time"],
    ]) {
      const input = profileInput(row, `${label} for skill ${id}`, 0);
      input.value = record[key] === null ? "" : String(record[key]);
      if (key === "expiresAt") input.required = false;
      else if (template) input.max = String(template.maxLevel);
      fields.set(key, input);
    }
    const remove = profileButton(row, "Remove learned skill");
    remove.dataset.removeSkill = String(id);
    this.skillRows.set(String(id), { row, fields });
    const option = inspectionElement(
      "option",
      `${template?.name || "Skill"} [${id}]`,
      this.learnedChoice,
    );
    option.value = String(id);
  }

  selectLearnedSkill() {
    for (const [id, entry] of this.skillRows) {
      entry.row.hidden = id !== this.learnedChoice.value;
    }
    this.learnedChoice.disabled = this.skillRows.size === 0;
  }

  validateEditor() {
    this.updateExperienceLimit();
    for (const [id, entry] of this.skillRows) {
      for (const input of entry.fields.values()) {
        if (!input.validity.valid) {
          this.learnedChoice.value = id;
          this.selectLearnedSkill();
          input.reportValidity();
          return false;
        }
      }
    }
    return this.form.reportValidity();
  }

  addSkill() {
    const id = this.skillChoice.value;
    if (this.isBusy() || !id || this.skillRows.has(id)) return;
    if (this.skillRows.size >= PROFILE_LIMITS.skills) {
      this.editStatus.textContent = "Learned skill capacity reached.";
      return;
    }
    this.appendSkill(id, { level: 0, masterLevel: 0, expiresAt: null });
    this.learnedChoice.value = id;
    this.selectLearnedSkill();
    this.markEdited();
    this.skillRows.get(id).fields.get("level").focus();
  }

  removeSkill(event) {
    const id = event.target.dataset?.removeSkill;
    if (this.isBusy() || !id) return;
    const entry = this.skillRows.get(id);
    if (!entry) return;
    entry.row.remove();
    this.skillRows.delete(id);
    for (const option of this.learnedChoice.options) {
      if (option.value === id) {
        option.remove();
        break;
      }
    }
    this.selectLearnedSkill();
    this.markEdited();
  }

  markEdited(event) {
    if (
      event?.target === this.skillChoice ||
      event?.target === this.learnedChoice ||
      event?.target === this.preset ||
      this.isBusy()
    ) {
      return;
    }
    this.dirty = true;
    if (event && !this.presetPreview.hidden) {
      this.editStatus.textContent =
        "Unsaved edits include manual changes after the preset preview. Apply uses the current form values.";
    } else {
      this.editStatus.textContent = "Unsaved profile edits.";
    }
    this.updateEditActions();
  }

  revertEdits() {
    if (this.isBusy()) return;
    this.dirty = false;
    this.skillEditSignature = null;
    this.editStatus.textContent = "Unsaved edits discarded.";
    this.refresh();
  }

  isBusy() {
    return Boolean(
      this.request ||
      this.conjuring ||
      this.owner.saving ||
      this.owner.resetting ||
      this.owner.store.profileTransactionPending,
    );
  }

  owns(request) {
    return (
      request &&
      !this.destroyed &&
      !this.owner.disposed &&
      this.owner.ownsProfile(request.store, request.epoch)
    );
  }

  ownsEditRequest(request) {
    return this.owns(request) && this.request === request;
  }

  cancelStaleRequests() {
    if (this.request && !this.owns(this.request)) {
      this.request = null;
      this.editStatus.textContent =
        "Profile editing stopped: ownership changed. This draft cannot be applied to a different character.";
    }
    if (this.dirty && !this.owns(this.draftOwner)) {
      this.editStatus.textContent =
        "Draft ownership changed. Discard this draft before editing the current character.";
    }
    if (this.offering && !this.owns(this.offering)) this.offering = null;
    if (this.conjuring && !this.owns(this.conjuring)) this.conjuring = null;
  }

  refresh() {
    if (this.destroyed) return;
    const owner = this.owner,
      store = owner.store,
      profile = store.profile;
    this.currentMaxima.textContent = profile
      ? `Current maximum HP: ${profile.maxHP} · MP: ${profile.maxMP}`
      : "";
    this.cancelStaleRequests();
    this.status.textContent =
      store.error?.message || store.error || store.status;
    const busy = this.isBusy();
    this.refreshPersistenceControls(store, profile, busy);
    this.form.setAttribute("aria-busy", String(Boolean(this.request)));
    this.updateEditActions();
    if (!this.dirty && !this.request) this.refreshEditor(profile);
    this.refreshItems(profile);
  }
  refreshPersistenceControls(store, profile, busy) {
    this.save.disabled = !profile || busy || typeof store.flush !== "function";
    this.reset.disabled =
      busy || typeof this.owner.hooks.onReset !== "function";
    this.recover.disabled = !profile || profile.hp !== 0 || busy;
    this.editor.disabled = !profile || busy;
  }

  updateEditActions() {
    const busy = this.isBusy();
    this.apply.disabled =
      !this.dirty ||
      !this.owner.store.profile ||
      !this.owns(this.draftOwner) ||
      busy ||
      typeof this.owner.hooks.onProfileEdit !== "function";
    this.revert.disabled = !this.dirty || busy;
    this.apply.textContent = this.request ? "Saving…" : "Apply changes";
    this.applyPreset.disabled =
      this.apply.disabled || this.presetPreview.hidden;
    this.applyPreset.textContent = this.request
      ? "Saving…"
      : "Apply staged preset";
  }

  refreshEditor(profile) {
    this.baseline = {};
    this.draftOwner = { store: this.owner.store, epoch: this.owner.epoch };
    this.baseline.keyBindings = JSON.stringify(profile?.keyBindings);
    this.stagedBindings = null;
    this.stagedJobId = null;
    this.presetPreview.hidden = true;
    this.presetPreview.replaceChildren();
    for (const [key, input] of this.fields) {
      input.value = profile ? String(profile[key]) : "";
      this.baseline[key] = profile?.[key];
    }
    this.updateExperienceLimit();
    for (let i = 0; i < this.spFields.length; i++) {
      this.spFields[i].value = profile ? String(profile.remainingSp[i]) : "";
    }
    this.refreshPointPools();
    const skills = profile?.skills || {};
    this.refreshSkillEditor(skills);
    this.baseline.remainingSp = profile?.remainingSp.slice() || [];
    this.baseline.skills = structuredClone(skills);
  }

  refreshSkillEditor(skills) {
    const signature = JSON.stringify(skills);
    if (signature !== this.skillEditSignature) {
      const selected = this.learnedChoice.value;
      this.learnedChoice.replaceChildren();
      this.skillList.replaceChildren();
      this.skillRows.clear();
      for (const [id, record] of Object.entries(skills)) {
        this.appendSkill(id, record);
      }
      this.skillEditSignature = signature;
      if (this.skillRows.has(selected)) this.learnedChoice.value = selected;
      this.selectLearnedSkill();
    }
  }

  readPatch() {
    const patch = {};
    for (const [key, input] of this.fields) {
      const value = key === "name" ? input.value : Number(input.value);
      if (value !== this.baseline[key]) patch[key] = value;
    }
    // Level and staged EXP remain one edit even when the reset equals the old baseline.
    if (Object.hasOwn(patch, "level")) {
      patch.exp = Number(this.fields.get("exp").value);
    }
    const remainingSp = this.spFields.map((input) => Number(input.value));
    if (
      remainingSp.some(
        (value, index) => value !== this.baseline.remainingSp[index],
      )
    ) {
      patch.remainingSp = remainingSp;
    }
    const skills = {};
    for (const [id, { fields }] of this.skillRows) {
      skills[id] = {
        level: Number(fields.get("level").value),
        masterLevel: Number(fields.get("masterLevel").value),
        expiresAt:
          fields.get("expiresAt").value === ""
            ? null
            : Number(fields.get("expiresAt").value),
      };
    }
    if (JSON.stringify(skills) !== JSON.stringify(this.baseline.skills)) {
      patch.skills = skills;
    }
    if (this.stagedBindings) {
      patch.keyBindings = structuredClone(this.stagedBindings);
      for (const key of ["job", "level", "exp"]) {
        patch[key] = Number(this.fields.get(key).value);
      }
      patch.skills = skills;
    }
    return patch;
  }

  validateSubmission() {
    if (this.isBusy() || !this.owner.store.profile || !this.validateEditor()) {
      return false;
    }
    if (this.dirty && this.owns(this.draftOwner)) return true;
    this.editStatus.textContent =
      "No owned draft to apply. Discard stale edits and stage again.";
    return false;
  }

  async submit(event) {
    event.preventDefault();
    if (!this.validateSubmission()) return;
    const request = { store: this.owner.store, epoch: this.owner.epoch };
    this.request = request;
    this.editStatus.textContent = "Saving profile edits…";
    try {
      this.validateStagedJob();
      const patch = this.readPatch();
      if (this.stagedJobId === null && Object.keys(patch).length === 0) {
        this.dirty = false;
        this.editStatus.textContent =
          "The character already matches these values.";
        return;
      }
      this.refresh();
      const result = await this.owner.hooks.onProfileEdit(patch, {
        jobPreset: this.stagedJobId,
      });
      if (!this.ownsEditRequest(request)) return;
      if (result?.ok === false) {
        throw new Error(result.reason || "Profile edit rejected");
      }
      this.dirty = false;
      this.skillEditSignature = null;
      this.editStatus.textContent =
        this.owner.hooks.profileEditSuccess ?? "Profile edits saved locally.";
    } catch (error) {
      if (!this.ownsEditRequest(request)) return;
      this.editStatus.textContent = `Profile edits failed: ${error.message}`;
      this.owner.report(error);
    } finally {
      if (this.ownsEditRequest(request)) {
        this.request = null;
        this.refresh();
      }
    }
  }

  validateStagedJob() {
    if (!this.stagedBindings) return;
    this.requireBindingOwnership();
    if (Number(this.job.value) !== this.stagedJobId) {
      throw new Error(
        "The job changed after staging its skills and bindings. Discard and stage the desired job preset.",
      );
    }
  }

  refreshItems(profile) {
    const busy = !profile || this.isBusy();
    this.items.disabled = !this.items.options.length || busy;
    this.offer.disabled =
      this.items.disabled ||
      Boolean(this.offering) ||
      typeof this.owner.hooks.onOfferItem !== "function";
    this.conjure.disabled =
      busy ||
      !this.conjureCatalog.select.options.length ||
      typeof this.owner.hooks.onConjureItem !== "function";
  }

  showOfferingResult(result) {
    if (!result || typeof result.accepted !== "boolean") {
      throw new Error("Invalid local offering result");
    }
    this.feedback.textContent =
      result.reason ||
      (result.accepted
        ? "Offer accepted."
        : "No matching nearby reactor requirement.");
  }

  async offerItem() {
    const id = Number(this.items.value);
    if (
      this.isBusy() ||
      this.offering ||
      !Number.isSafeInteger(id) ||
      id <= 0
    ) {
      return;
    }
    const request = { store: this.owner.store, epoch: this.owner.epoch };
    this.offering = request;
    this.offer.disabled = true;
    try {
      const offer =
        this.owner.hooks.onOfferTemplate ?? this.owner.hooks.onOfferItem;
      const result = await offer(id);
      if (!this.owns(request)) return;
      this.showOfferingResult(result);
    } catch (error) {
      if (!this.owns(request)) return;
      this.feedback.textContent = `Offer failed: ${error.message}`;
      this.owner.report(error);
    } finally {
      if (this.owns(request)) {
        this.offering = false;
        this.refresh();
      }
    }
  }

  destroy() {
    this.destroyed = true;
    this.request = null;
    this.offerCatalog.destroy();
    this.conjureCatalog.destroy();
    for (const [node, type, handler, capture = false] of this.listeners) {
      node.removeEventListener(type, handler, capture);
    }
    this.root.remove();
  }
}
