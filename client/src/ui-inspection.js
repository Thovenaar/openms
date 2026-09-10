import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";
import { replaceIcons, itemIcon } from "./ui-icons.js";
import { inventoryType, slotItem } from "./inventory-model.js";
import { updateStatDetail, updateApControls } from "./ui-stat.js";
import { JOB_LABELS } from "./ui-job-labels.js";
import { skillBooks } from "./ui-skill-books.js";
import { updateSkillTabs } from "./ui-layout.js";
import { PROFILE_LIMITS } from "./profile-validation.js";
import { skillPointPool } from "./skill-system.js";
import { itemTooltip, skillTooltip } from "./ui-tooltip.js";
import {
  minimapGeometry,
  createMinimapMarkers,
  rebuildMinimap,
  updateMinimap,
} from "./ui-minimap.js";

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
    panel.basicStat.container.visible = false;
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

/** 008c6177..6314: beginner jobs through level10 draw basicStat then return before numeric rows. */
function updateStatMode(panel, profile) {
  const notice = profile.level <= 10 && BEGINNER_JOBS.has(profile.job);
  panel.basicStat.container.visible = notice;
  panel.statValues.get("remainingAp").hidden = notice;
  const disabled = statDisabledMask(profile.job);
  for (let i = 0; i < panel.statControls.length; i++) {
    panel.statControls[i].setVisible(i < 2 || !notice);
  }
  for (let i = 0; i < STAT_ATTRIBUTES.length; i++) {
    panel.statValues.get(STAT_ATTRIBUTES[i]).hidden = notice;
    panel.statOverlays[i].container.visible =
      !notice && Boolean(disabled & (1 << i));
  }
}

/** 008c6328: job selects disabled labels, not numeric order. */
function statDisabledMask(job) {
  const family = Math.floor((job % 1000) / 100);
  if (job === 0 || family === 1 || family === 3 || family === 5) return 12;
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

/** Atomically replace a separately leased map image; stale scene loads cannot attach artwork. */
export async function replaceMinimap(owner, panel, signal) {
  const scene = owner.scene;
  const id = scene?.manifest.id;
  if (!id) return;
  const entry = owner.index.minimaps[id];
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
  try {
    signal.throwIfAborted();
    const geometry = minimapGeometry(resource.manifest.metadata);
    animation = new EntityAnimation(
      resource.manifest.entities[0],
      resource.textures,
    );
    animation.container.zIndex = 0;
    markers = createMinimapMarkers(panel, scene.manifest);
    signal.throwIfAborted();
    if (panel.disposed || owner.scene !== scene) {
      throw new Error("Minimap scene ownership changed");
    }
    releaseMap(panel);
    panel.mapContent.addChild(animation.container, markers.layer.root);
    markers.layer.root.visible = true;
    panel.mapMarkerLayer = markers.layer;
    panel.mapMarkers = markers.markers;
    panel.mapPlayerMarker = markers.player;
    panel.mapGeometry = geometry;
    markers = null;
    panel.mapAnimation = animation;
    panel.mapResource = resource;
    panel.dependencies.push(resource);
    panel.mapId = id;
    panel.mapLabel.textContent = owner.mapName(id);
    panel.mapStatus.textContent = "";
    rebuildMinimap(panel);
    updateMinimap(panel, scene.simulation.x, scene.simulation.y);
    owner.positionWindow(panel, panel.x, panel.y);
    panel.renderArtwork();
    resource = null;
    animation = null;
  } finally {
    markers?.layer.destroy();
    animation?.container.destroy({ children: true });
    resource?.destroy();
  }
}

function unavailableMinimap(owner, panel, entry, id) {
  panel.mapLabel.textContent = owner.mapName(id);
  releaseMap(panel);
  const reason = entry?.reason || "Map not in packaged UI index";
  panel.mapStatus.textContent = reason;
  owner.status(reason);
}

function releaseMap(panel) {
  panel.mapMarkerLayer?.destroy();
  panel.mapMarkerLayer = null;
  panel.mapMarkers = [];
  panel.mapPlayerMarker = null;
  panel.mapGeometry = null;
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

function profileGroup(parent, title, collapsed = false) {
  const section = inspectionElement(
    collapsed ? "details" : "fieldset",
    "",
    parent,
  );
  section.className = "profile-group";
  inspectionElement(collapsed ? "summary" : "legend", title, section);
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
    this.root.setAttribute("aria-label", "Character editor");
    this.buildEditor();
    const actions = inspectionElement("div", "", this.root);
    actions.className = "profile-actions";
    this.save = profileButton(actions, "Save checkpoint");
    this.recover = profileButton(actions, "Revive character");
    this.status = inspectionElement("p", "", this.root);
    this.status.setAttribute("role", "status");
    this.status.className = "hint";
    const advanced = inspectionElement("details", "", this.root);
    inspectionElement("summary", "Destructive actions", advanced);
    this.reset = profileButton(advanced, "Reset character…");
    const offering = inspectionElement("details", "", this.root);
    inspectionElement("summary", "Reactor testing", offering);
    this.items = inspectionElement("select", "", offering);
    this.items.setAttribute("aria-label", "Local reactor offering item");
    this.offer = profileButton(offering, "Offer nearby");
    this.feedback = inspectionElement("p", "", offering);
    this.feedback.setAttribute("role", "status");
    this.listeners = [
      [this.save, "click", owner.saveProfile.bind(owner)],
      [this.reset, "click", owner.requestReset.bind(owner)],
      [this.recover, "click", owner.recoverProfile.bind(owner)],
      [this.form, "submit", this.submit.bind(this)],
      [this.form, "input", this.markEdited.bind(this)],
      [this.form, "invalid", this.revealInvalid.bind(this), true],
      [this.form, "click", this.removeSkill.bind(this)],
      [this.revert, "click", this.revertEdits.bind(this)],
      [this.add, "click", this.addSkill.bind(this)],
      [this.offer, "click", this.offerItem.bind(this)],
      [this.stagePreset, "click", this.preparePreset.bind(this)],
    ];
    for (const [node, type, handler, capture = false] of this.listeners) {
      node.addEventListener(type, handler, capture);
    }
    document.querySelector("#inspection-controls").append(this.root);
    this.refresh();
  }

  buildEditor() {
    this.form = inspectionElement("form", "", this.root);
    this.editor = inspectionElement("fieldset", "", this.form);
    inspectionElement("legend", "Edit character", this.editor);
    this.buildPresets();
    this.buildFields();
    this.buildPointPools();
    this.buildSkillEditor();
    const bar = inspectionElement("div", "", this.editor);
    bar.className = "profile-savebar";
    const actions = inspectionElement("div", "", bar);
    actions.className = "profile-actions";
    this.apply = inspectionElement("button", "Apply changes", actions);
    this.apply.type = "submit";
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
      identity: profileGroup(this.editor, "Identity"),
      resources: profileGroup(this.editor, "HP & MP"),
      attributes: profileGroup(this.editor, "Attributes", true),
      progress: profileGroup(this.editor, "Progress & wallet", true),
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

  revealInvalid(event) {
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
  buildPresets() {
    const section = inspectionElement("details", "", this.editor);
    inspectionElement("summary", "Presets", section);
    this.preset = inspectionElement("select", "", section);
    this.preset.setAttribute("aria-label", "Character preset");
    for (const [id, label] of [
      ["restore", "Restore HP / MP to current maxima"],
      ["training", "Training budget: 20 AP + 10 SP (first pool)"],
      ["mesos", "Drop testing: set wallet to 100,000 mesos"],
    ]) {
      const option = inspectionElement("option", label, this.preset);
      option.value = id;
    }
    this.stagePreset = profileButton(section, "Preview preset");
    inspectionElement(
      "p",
      "Preview stages only these values. Apply saves them; job and level changes do not grant points or skills.",
      section,
    );
  }

  /** Stage form values only; submit retains the validated authority transaction. */
  preparePreset() {
    if (this.isBusy() || !this.owner.store.profile) return;
    if (this.dirty) {
      this.editStatus.textContent =
        "Apply or discard your unsaved edits before previewing a preset.";
      return;
    }
    const profile = this.owner.store.profile;
    switch (this.preset.value) {
      case "restore":
        this.fields.get("hp").value = String(profile.maxHP);
        this.fields.get("mp").value = String(profile.maxMP);
        break;
      case "training":
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
        this.editStatus.textContent = "Choose a supported preset.";
        return;
    }
    this.markEdited();
    this.editStatus.textContent = `Preset staged: ${this.preset.selectedOptions[0].textContent}. Review and Apply character changes to save.`;
    this.apply.focus();
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
    this.skillList = inspectionElement("div", "", section);
    this.skillList.style.cssText = "max-height:24rem;overflow:auto";
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
  }

  addSkill() {
    const id = this.skillChoice.value;
    if (this.isBusy() || !id || this.skillRows.has(id)) return;
    if (this.skillRows.size >= PROFILE_LIMITS.skills) {
      this.editStatus.textContent = "Learned skill capacity reached.";
      return;
    }
    this.appendSkill(id, { level: 0, masterLevel: 0, expiresAt: null });
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
    this.markEdited();
  }

  markEdited(event) {
    if (
      event?.target === this.skillChoice ||
      event?.target === this.preset ||
      this.isBusy()
    ) {
      return;
    }
    this.dirty = true;
    this.editStatus.textContent = "Unsaved profile edits.";
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
      this.owner.saving ||
      this.owner.resetting ||
      this.owner.store.profileTransactionPending,
    );
  }

  owns(request) {
    return (
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
      this.dirty = false;
      this.skillEditSignature = null;
      this.editStatus.textContent =
        "Profile editing cancelled: ownership changed.";
    }
    if (this.offering && !this.owns(this.offering)) this.offering = null;
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
    this.save.disabled = !profile || busy;
    this.reset.disabled = busy;
    this.recover.disabled = !profile || profile.hp !== 0 || busy;
    this.editor.disabled = !profile || busy;
    this.form.setAttribute("aria-busy", String(Boolean(this.request)));
    this.updateEditActions();
    if (!this.dirty && !this.request) this.refreshEditor(profile);
    this.refreshItems(profile);
  }

  updateEditActions() {
    const busy = this.isBusy();
    this.apply.disabled =
      !this.dirty ||
      busy ||
      typeof this.owner.hooks.onProfileEdit !== "function";
    this.revert.disabled = !this.dirty || busy;
    this.apply.textContent = this.request ? "Saving…" : "Apply changes";
  }

  refreshEditor(profile) {
    this.baseline = {};
    for (const [key, input] of this.fields) {
      input.value = profile ? String(profile[key]) : "";
      this.baseline[key] = profile?.[key];
    }
    for (let i = 0; i < this.spFields.length; i++) {
      this.spFields[i].value = profile ? String(profile.remainingSp[i]) : "";
    }
    const skills = profile?.skills || {};
    const signature = JSON.stringify(skills);
    if (signature !== this.skillEditSignature) {
      this.skillList.replaceChildren();
      this.skillRows.clear();
      for (const [id, record] of Object.entries(skills)) {
        this.appendSkill(id, record);
      }
      this.skillEditSignature = signature;
    }
    this.baseline.remainingSp = profile?.remainingSp.slice() || [];
    this.baseline.skills = structuredClone(skills);
  }

  readPatch() {
    const patch = {};
    for (const [key, input] of this.fields) {
      const value = key === "name" ? input.value : Number(input.value);
      if (value !== this.baseline[key]) patch[key] = value;
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
    return patch;
  }

  async submit(event) {
    event.preventDefault();
    if (
      this.isBusy() ||
      !this.owner.store.profile ||
      !this.form.reportValidity()
    ) {
      return;
    }
    const request = { store: this.owner.store, epoch: this.owner.epoch };
    this.request = request;
    this.editStatus.textContent = "Saving profile edits…";
    try {
      const patch = this.readPatch();
      this.refresh();
      const result = await this.owner.hooks.onProfileEdit(patch);
      if (!this.ownsEditRequest(request)) return;
      if (result?.ok === false) {
        throw new Error(result.reason || "Profile edit rejected");
      }
      this.dirty = false;
      this.skillEditSignature = null;
      this.editStatus.textContent = "Profile edits saved locally.";
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

  refreshItems(profile) {
    const inventory = profile?.inventory || [];
    if (inventory.length > MAX_PROFILE_ITEMS) {
      throw new Error("Local inventory exceeds UI item budget");
    }
    const signature = JSON.stringify(inventory);
    if (signature !== this.inventorySignature) {
      const selected = this.items.value;
      this.items.replaceChildren();
      for (const item of inventory) {
        const name = this.owner.index.itemLabels[item.id] || "Item";
        const option = inspectionElement(
          "option",
          `${name} [${item.id}] × ${item.count}`,
          this.items,
        );
        option.value = String(item.id);
      }
      if (inventory.some((item) => String(item.id) === selected)) {
        this.items.value = selected;
      }
      this.inventorySignature = signature;
    }
    this.items.disabled = inventory.length === 0 || this.isBusy();
    this.offer.disabled =
      inventory.length === 0 || Boolean(this.offering) || this.isBusy();
  }

  showOfferingResult(result) {
    if (!result || typeof result.accepted !== "boolean") {
      throw new Error("Invalid local offering result");
    }
    this.feedback.textContent =
      result.reason ||
      (result.accepted
        ? "Local offer accepted."
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
      const result = await this.owner.hooks.onOfferItem(id);
      if (!this.owns(request)) return;
      this.showOfferingResult(result);
    } catch (error) {
      if (!this.owns(request)) return;
      this.feedback.textContent = `Local offer failed: ${error.message}`;
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
    for (const [node, type, handler, capture = false] of this.listeners) {
      node.removeEventListener(type, handler, capture);
    }
    this.root.remove();
  }
}
