import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";
import { replaceIcons, itemIcon } from "./ui-icons.js";
import { JOB_LABELS } from "./ui-job-labels.js";
import { skillBooks } from "./ui-skill-books.js";
import { updateSkillTabs } from "./ui-layout.js";
import { PROFILE_LIMITS } from "./profile-validation.js";
import { skillPointPool } from "./skill-system.js";

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

function skillTooltip(template, learned, rank) {
  const classification = template.classification;
  const runtime = classification?.supported
    ? classification.reason || classification.activation
    : classification?.reason || "Runtime unavailable";
  const expiration =
    learned && learned.expiresAt !== null
      ? `\nExpires at epoch ms ${learned.expiresAt}`
      : "";
  return `${template.name}\n${template.description}\nRank ${rank}; master ${learned?.masterLevel || 0}\n${runtime}${expiration}`;
}

function skillLearningDisabled(panel, template, rank) {
  return (
    panel.skillLearning ||
    panel.owner.store?.profileTransactionPending ||
    rank >= template.maxLevel ||
    typeof panel.owner.hooks.onLearnSkill !== "function"
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
  const tooltip = skillTooltip(template, learned, rank);
  layer.hit(
    tooltip,
    { x: 7, y: 99 + 40 * row, width: 126, height: 38 },
    {
      pointerdown: (event) => {
        if (rank <= 0 || panel.owner.store?.profileTransactionPending) return;
        panel.owner.beginBindingDrag(
          event,
          { type: 1, id: template.id },
          null,
          { source: layer, path: template.iconPath },
        );
      },
    },
  );
  const button = layer.localButton("+", 136, 118 + 40 * row, () =>
    learnSkill(panel, template.id),
  );
  button.setAttribute("aria-label", `Learn ${template.name}`);
  button.disabled = skillLearningDisabled(panel, template, rank);
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
  const start = panel.skillStart || 0;
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

function updateSkillSummary(panel, profile, job, points) {
  if (!panel.skillPoints) {
    panel.skillPoints = panel.text("", 84, 265, 27);
    panel.skillPoints.style.whiteSpace = "nowrap";
    panel.skillPoints.style.overflow = "hidden";
    panel.skillPoints.style.textAlign = "right";
  }
  const pointSummary = `SP pools 1–10: ${points.join(" / ")}`;
  const pool = skillPointPool(job);
  panel.skillPoints.textContent = profile ? String(points[pool]) : "";
  panel.skillPoints.title = pointSummary;
  panel.element.setAttribute("aria-busy", String(Boolean(panel.skillLearning)));
}

function updateSkills(panel, profile) {
  if (!panel.skillsReady) return;
  cancelStaleSkillRequest(panel);
  const books = skillBooks(profile?.job);
  updateSkillTabs(panel, books);
  const job = books[panel.selectedTab || 0];
  const { start, records } = skillPage(panel, profile, job);
  const points = profile?.remainingSp || [];
  const signature = JSON.stringify([
    job,
    start,
    records.map((entry) => entry.learned),
    points,
    Boolean(panel.skillLearning),
    Boolean(panel.owner.store?.profileTransactionPending),
    panel.skillFeedback,
  ]);
  if (panel.skillSignature === signature) return;
  panel.skillSignature = signature;
  updateSkillSummary(panel, profile, job, points);
  replaceIcons(panel, records, (layer, entry, row) =>
    skillRow(panel, layer, entry, row),
  ).catch((error) => panel.owner.report(error));
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

const PROFILE_FIELDS = [
  ["name", "Name", null],
  ["level", "Level", 1],
  ["exp", "EXP", 0],
  ["hp", "HP", 0],
  ["maxHP", "Maximum HP", 1],
  ["mp", "MP", 0],
  ["maxMP", "Maximum MP", 0],
  ["str", "STR", 1],
  ["dex", "DEX", 1],
  ["int", "INT", 1],
  ["luk", "LUK", 1],
  ["meso", "Meso", 0],
  ["fame", "Fame", Number.MIN_SAFE_INTEGER],
];

function profileInput(parent, label, minimum) {
  const wrapper = inspectionElement("label", `${label} `, parent);
  wrapper.style.display = "block";
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
    this.root = document.createElement("details");
    inspectionElement("summary", "Local offline profile", this.root);
    this.status = inspectionElement("p", "", this.root);
    this.save = profileButton(this.root, "Save locally");
    this.reset = profileButton(this.root, "Reset local profile");
    this.recover = profileButton(this.root, "Recover");
    this.buildEditor();
    this.items = inspectionElement("select", "", this.root);
    this.items.setAttribute("aria-label", "Local reactor offering item");
    this.offer = profileButton(this.root, "Offer nearby");
    this.feedback = inspectionElement("p", "", this.root);
    this.feedback.setAttribute("role", "status");
    this.listeners = [
      [this.save, "click", owner.saveProfile.bind(owner)],
      [this.reset, "click", owner.requestReset.bind(owner)],
      [this.recover, "click", owner.recoverProfile.bind(owner)],
      [this.form, "submit", this.submit.bind(this)],
      [this.form, "input", this.markEdited.bind(this)],
      [this.form, "click", this.removeSkill.bind(this)],
      [this.revert, "click", this.revertEdits.bind(this)],
      [this.add, "click", this.addSkill.bind(this)],
      [this.offer, "click", this.offerItem.bind(this)],
    ];
    for (const [node, type, handler] of this.listeners) {
      node.addEventListener(type, handler);
    }
    document.querySelector("#inspection-controls").append(this.root);
    this.refresh();
  }

  buildEditor() {
    this.form = inspectionElement("form", "", this.root);
    this.editor = inspectionElement("fieldset", "", this.form);
    inspectionElement("legend", "Persistent character editor", this.editor);
    inspectionElement(
      "p",
      "Local edits do not run advancement scripts or grant stats, SP, or skills. Changes save together.",
      this.editor,
    );
    for (const [key, label, minimum] of PROFILE_FIELDS) {
      const input = profileInput(this.editor, label, minimum);
      input.name = key;
      if (key === "name") input.maxLength = PROFILE_LIMITS.name;
      this.fields.set(key, input);
    }
    const label = inspectionElement("label", "Job ", this.editor);
    label.style.display = "block";
    this.job = inspectionElement("select", "", label);
    this.job.setAttribute("aria-label", "Job");
    this.job.required = true;
    this.fields.set("job", this.job);
    const jobs = this.owner.index.coverage.skillCoverage.playerBooks;
    for (const id of jobs) {
      const option = inspectionElement(
        "option",
        `${JOB_LABELS[id] || "Job"} [${id}]`,
        this.job,
      );
      option.value = String(id);
    }
    const pools = inspectionElement("fieldset", "", this.editor);
    inspectionElement("legend", "Remaining SP — pools 1–10", pools);
    this.spFields = [];
    for (let i = 0; i < 10; i++) {
      this.spFields.push(profileInput(pools, `SP pool ${i + 1}`, 0));
    }
    this.buildSkillEditor();
    this.apply = inspectionElement("button", "Save profile edits", this.editor);
    this.apply.type = "submit";
    this.revert = profileButton(this.editor, "Discard unsaved edits");
    this.editStatus = inspectionElement("p", "", this.form);
    this.editStatus.setAttribute("role", "status");
    this.editStatus.setAttribute("aria-live", "polite");
  }

  buildSkillEditor() {
    const section = inspectionElement("fieldset", "", this.editor);
    inspectionElement("legend", "Learned skills", section);
    inspectionElement(
      "p",
      "Edit rank and master rank directly, or remove a record. Expiry is Unix milliseconds; blank means permanent. Normal learning uses the Skill window.",
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
    this.add = profileButton(section, "Add skill record");
  }

  appendSkill(id, record) {
    const row = inspectionElement("fieldset", "", this.skillList);
    const template = this.owner.index.skills[id];
    inspectionElement("legend", `${template?.name || "Skill"} [${id}]`, row);
    const fields = new Map();
    for (const [key, label] of [
      ["level", "Rank"],
      ["masterLevel", "Master rank"],
      ["expiresAt", "Expiry"],
    ]) {
      const input = profileInput(row, `${label} for skill ${id}`, 0);
      input.value = record[key] === null ? "" : String(record[key]);
      if (key === "expiresAt") input.required = false;
      else if (template) input.max = String(template.maxLevel);
      fields.set(key, input);
    }
    const remove = profileButton(row, "Remove skill record");
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
    if (event?.target === this.skillChoice || this.isBusy()) return;
    this.dirty = true;
    this.editStatus.textContent = "Unsaved profile edits.";
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
    this.cancelStaleRequests();
    this.status.textContent =
      store.error?.message || store.error || store.status;
    const busy = this.isBusy();
    this.save.disabled = !profile || busy;
    this.reset.disabled = busy;
    this.recover.disabled = !profile || profile.hp !== 0 || busy;
    this.editor.disabled = !profile || busy;
    this.form.setAttribute("aria-busy", String(Boolean(this.request)));
    this.apply.disabled = typeof owner.hooks.onProfileEdit !== "function";
    if (!this.dirty && !this.request) this.refreshEditor(profile);
    this.refreshItems(profile);
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
    for (const [node, type, handler] of this.listeners) {
      node.removeEventListener(type, handler);
    }
    this.root.remove();
  }
}
