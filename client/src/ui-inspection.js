import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";
import { replaceIcons, itemIcon } from "./ui-icons.js";
import { JOB_LABELS } from "./ui-job-labels.js";
import { skillBooks } from "./ui-skill-books.js";
import { updateSkillTabs } from "./ui-layout.js";

const MAX_PROFILE_ITEMS = 4096;
const BEGINNER_JOBS = new Set([0, 1000, 2000, 2001]);
const STAT_ATTRIBUTES = ["str", "dex", "int", "luk"];
const MESO_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
// 00be2260 equipment position table, indexed by original body part minus one.
const EQUIP_COORDINATES = [
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
  [112, 77],
  [104, 68],
  [137, 68],
  [71, 134],
];
const EQUIP_SLOTS = {
  Cap: 1,
  Accessory: 2,
  Coat: 5,
  Longcoat: 5,
  Pants: 6,
  Shoes: 7,
  Glove: 8,
  Cape: 9,
  Shield: 10,
  Weapon: 11,
};

/** Original 0081e2c8; local inventory ordering is the persisted stack order, not invented slots. */
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
  const filtered = items.filter(
    (item) => Math.floor(item.id / 1000000) === tab + 1,
  );
  panel.inventoryCount = filtered.length;
  const start = expanded ? 0 : panel.inventoryStart;
  const visible = filtered.slice(start, start + (expanded ? 96 : 24));
  const signature = JSON.stringify([tab, expanded, start, visible]);
  if (signature === panel.inventorySignature) return;
  panel.inventorySignature = signature;
  const records = visible.map((item) => ({
    ...item,
    template: panel.owner.index.items[item.id],
  }));
  replaceIcons(panel, records, (layer, entry, index) => {
    itemIcon(layer, entry, inventoryRect(index, expanded));
  }).catch((error) => panel.owner.report(error));
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
  const records = items.map((id) => ({
    id,
    count: 1,
    template: panel.owner.index.items[id],
  }));
  replaceIcons(panel, records, (layer, entry) => {
    const slot = EQUIP_SLOTS[entry.template?.category];
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
    layer.hit(entry.template.name, rect, {
      click: () =>
        panel.owner.showTooltip(
          `${entry.template.name}\n${entry.template.description}`,
          panel.x + rect.x,
          panel.y + rect.y,
        ),
    });
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
  updateStatMode(panel, profile);
}

/** 008c6177..6314: beginner jobs through level10 draw basicStat then return before numeric rows. */
function updateStatMode(panel, profile) {
  const notice = profile.level <= 10 && BEGINNER_JOBS.has(profile.job);
  panel.basicStat.container.visible = notice;
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

function updateSkills(panel, profile) {
  if (!panel.skillsReady) return;
  const books = skillBooks(profile?.job);
  updateSkillTabs(panel, books);
  const tab = panel.selectedTab || 0;
  const job = books[tab];
  // 007619b0 keeps normal entries with no learned record; 0075cd52 types +28=invisible, +38=timeLimited.
  const skills = Object.values(panel.owner.index.skills).filter(
    (skill) =>
      Math.floor(skill.id / 10000) === job &&
      skill.id !== 1014 &&
      skill.id !== 10001015 &&
      !skill.properties.invisible &&
      !skill.properties.timeLimited,
  );
  panel.skillCount = skills.length;
  const start = panel.skillStart || 0;
  const signature = `${job}:${start}`;
  if (panel.skillSignature === signature) return;
  panel.skillSignature = signature;
  const records = skills
    .slice(start, start + 4)
    .map((template) => ({ template }));
  replaceIcons(panel, records, (layer, entry, row) => {
    const template = entry.template;
    const path = template.iconDisabledPath || template.iconPath;
    layer.image(path, 10, 102 + 40 * row);
    const rect = { x: 7, y: 99 + 40 * row, width: 154, height: 38 };
    layer.text(template.name, 46, 103 + 40 * row, 111);
    layer.hit(`${template.name}\n${template.description}\nNot learned`, rect);
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
  const id = owner.scene?.manifest.id;
  if (!id) return;
  const entry = owner.index.minimaps[id];
  if (!entry?.available) {
    panel.mapLabel.textContent = `Map ${id}`;
    releaseMap(panel);
    owner.status(entry?.reason || "Map not in packaged UI index");
    return;
  }
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
    panel.mapLabel.textContent = owner.scene.manifest.name || `Map ${id}`;
    panel.mapStatus.textContent = "";
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

function inspectionElement(tag, text, parent) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

/** Local policy controls stay outside the original raster gameplay plane. */
export class ProfileControls {
  constructor(owner) {
    this.owner = owner;
    this.root = document.createElement("details");
    inspectionElement("summary", "Local offline profile", this.root);
    this.status = inspectionElement("p", "", this.root);
    this.save = inspectionElement("button", "Save locally", this.root);
    this.reset = inspectionElement("button", "Reset local profile", this.root);
    this.recover = inspectionElement("button", "Recover", this.root);
    const label = inspectionElement(
      "label",
      "Local class policy — no job-advancement scripts or skill grants",
      this.root,
    );
    this.job = inspectionElement("select", "", label);
    this.job.setAttribute("aria-label", "Local class policy");
    for (const id of owner.knownJobs) {
      const option = inspectionElement(
        "option",
        `${JOB_LABELS[id] || "Job"} [${id}]`,
        this.job,
      );
      option.value = String(id);
    }
    this.items = inspectionElement("select", "", this.root);
    this.items.setAttribute("aria-label", "Local reactor offering item");
    this.offer = inspectionElement("button", "Offer nearby", this.root);
    this.feedback = inspectionElement("p", "", this.root);
    this.feedback.setAttribute("role", "status");
    this.listeners = [
      [this.save, "click", owner.saveProfile.bind(owner)],
      [this.reset, "click", owner.requestReset.bind(owner)],
      [this.recover, "click", owner.recoverProfile.bind(owner)],
      [this.job, "change", this.changeJob.bind(this)],
      [this.offer, "click", this.offerItem.bind(this)],
    ];
    for (const [node, type, handler] of this.listeners) {
      node.addEventListener(type, handler);
    }
    document.querySelector("#inspection-controls").append(this.root);
    this.refresh();
  }

  refresh() {
    const owner = this.owner,
      store = owner.store,
      profile = store.profile;
    this.status.textContent = store.error?.message || store.status;
    const busy = Boolean(owner.saving || owner.resetting);
    this.save.disabled = !profile || busy;
    this.reset.disabled = busy;
    this.recover.disabled = !profile || profile.hp !== 0 || busy;
    this.job.disabled = !profile || busy;
    this.job.value = profile ? String(profile.job) : "";
    this.refreshItems(profile);
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
    this.items.disabled = inventory.length === 0;
    this.offer.disabled = inventory.length === 0 || Boolean(this.offering);
  }

  changeJob() {
    const job = Number(this.job.value),
      store = this.owner.store;
    if (!store.profile || !this.owner.knownJobs.includes(job)) {
      this.owner.report(
        new Error("Local class must be an original retained quest job ID"),
      );
      return;
    }
    store.profile.job = job;
    store.markDirty();
  }

  async offerItem() {
    const id = Number(this.items.value);
    if (this.offering || !Number.isSafeInteger(id) || id <= 0) return;
    this.offering = true;
    this.offer.disabled = true;
    try {
      const result = await this.owner.hooks.onOfferItem(id);
      if (!result || typeof result.accepted !== "boolean") {
        throw new Error("Invalid local offering result");
      }
      this.feedback.textContent =
        result.reason ||
        (result.accepted
          ? "Local offer accepted."
          : "No matching nearby reactor requirement.");
    } catch (error) {
      this.feedback.textContent = `Local offer failed: ${error.message}`;
      this.owner.report(error);
    } finally {
      this.offering = false;
      this.refresh();
    }
  }

  destroy() {
    for (const [node, type, handler] of this.listeners) {
      node.removeEventListener(type, handler);
    }
    this.root.remove();
  }
}
