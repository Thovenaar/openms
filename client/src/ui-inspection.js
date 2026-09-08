import { Graphics } from "pixi.js";
import { EntityAnimation } from "./animation.js";
import { loadVisualBundle } from "./visual-resources.js";
import { experienceRequired } from "./offline-progression.js";

const MAX_PROFILE_ITEMS = 4096;
const HUD_FIELDS = [
  "name",
  "level",
  "hp",
  "maxHP",
  "mp",
  "maxMP",
  "exp",
  "meso",
];
const STAT_FIELDS = [
  "name",
  "level",
  "job",
  "exp",
  "meso",
  "fame",
  "hp",
  "maxHP",
  "mp",
  "maxMP",
  "str",
  "dex",
  "int",
  "luk",
];
const INVENTORY_TABS = ["Equipment", "Use", "Setup", "Etc", "Cash"];

function projectionChanged(panel, profile, fields) {
  const previous =
    panel.profileValues || (panel.profileValues = Object.create(null));
  let changed = panel.profileAvailable !== Boolean(profile);
  panel.profileAvailable = Boolean(profile);
  for (const field of fields) {
    const value = profile?.[field];
    if (previous[field] !== value) changed = true;
    previous[field] = value;
  }
  return changed;
}

/** Read only local authority. No values are painted into unrecovered original gauge slots. */
export function updateProfileHud(panel, store) {
  if (!panel?.profileText) return;
  const profile = store?.profile;
  updateProfileText(panel, profile);
  const status = profileSaveStatus(store);
  if (panel.saveStatus.textContent !== status) {
    panel.saveStatus.textContent = status;
  }
  updateProfileControls(panel, store, profile);
}

function updateProfileText(panel, profile) {
  if (
    projectionChanged(panel, profile, HUD_FIELDS) ||
    !panel.profileText.textContent
  ) {
    panel.profileText.textContent = profile
      ? `LOCAL POLICY · ${profile.name} · Lv ${profile.level} · HP ${profile.hp}/${profile.maxHP} · MP ${profile.mp}/${profile.maxMP}\nEXP ${profile.exp}/${experienceRequired(profile.level)} (local) · Mesos ${profile.meso} · browser text`
      : "LOCAL PROFILE UNAVAILABLE · Save/reset status above";
  }
}

function profileSaveStatus(store) {
  const snapshot = store?.snapshot();
  const error = snapshot?.error?.message || store?.error?.message || "";
  return (
    error ||
    (snapshot
      ? `${snapshot.status}${snapshot.dirty ? " · changes pending" : ""}`
      : "not connected")
  );
}

function updateProfileControls(panel, store, profile) {
  panel.saveControl.disabled =
    !profile || panel.owner.saving || panel.owner.resetting;
  panel.resetControl.disabled =
    !store || panel.owner.saving || panel.owner.resetting;
  panel.recoverControl.disabled =
    !profile ||
    profile.hp !== 0 ||
    panel.owner.resetting ||
    !panel.owner.hooks.onRecover;
}

function itemLabel(panel, id) {
  const name = panel.owner.index?.itemLabels?.[id];
  return name ? `${name} [${id}]` : `Item ${id} (name not authored)`;
}

function changedItems(panel, items, equipment) {
  if (!Array.isArray(items) || items.length > MAX_PROFILE_ITEMS) {
    throw new Error("Local inventory exceeds UI item budget");
  }
  const previous = panel.profileItems;
  let changed = !previous || previous.length !== items.length;
  for (let i = 0; !changed && i < items.length; i++) {
    changed = equipment
      ? previous[i] !== items[i]
      : previous[i].id !== items[i].id || previous[i].count !== items[i].count;
  }
  if (changed) {
    panel.profileItems = equipment
      ? items.slice()
      : items.map((item) => ({ id: item.id, count: item.count }));
  }
  return changed;
}

/** Native list inside original chrome. Tabs classify original item IDs, not guessed slot coordinates. */
function updateInventory(panel, profile) {
  const equipped = panel.name === "Equip";
  const items = profile
    ? equipped
      ? profile.equipment
      : profile.inventory
    : [];
  const changed = changedItems(panel, items, equipped);
  const tab = panel.selectedTab ?? 0;
  if (
    !changed &&
    panel.profileTab === tab &&
    panel.profileAvailable === Boolean(profile)
  ) {
    return;
  }
  panel.profileTab = tab;
  panel.profileAvailable = Boolean(profile);
  prepareInventoryContent(panel);
  const rows = panel.profileRows;
  rows.replaceChildren();
  rows.textContent =
    "LOCAL PROFILE · provisional\nText list; original slot layout unrecovered.\n\n";
  if (!profile) {
    rows.append("Profile unavailable.");
    return;
  }
  rows.append(
    equipped
      ? "Equipped templates:\n\n"
      : `${INVENTORY_TABS[tab]} inventory:\n\n`,
  );
  appendInventoryItems(panel, items, equipped, tab);
}

/** Items already passed changedItems' collection bound; unknown IDs remain in the Etc tab. */
function appendInventoryItems(panel, items, equipped, tab) {
  let count = 0;
  for (const item of items) {
    const id = equipped ? item : item.id;
    const type = Math.floor(id / 1000000);
    const classified = type >= 1 && type <= 5;
    if (!equipped && (classified ? type : 4) !== tab + 1) {
      continue;
    }
    appendInventoryRow(panel, item, equipped, classified);
    count++;
  }
  if (count === 0) {
    panel.profileRows.append(
      equipped
        ? "No equipped items in this local save."
        : "No items in this local tab.",
    );
  }
}

function prepareInventoryContent(panel) {
  if (panel.profileRows) return;
  panel.profileRows = document.createElement("div");
  panel.inventoryFeedback = document.createElement("div");
  panel.inventoryFeedback.setAttribute("role", "status");
  panel.profileContent.append(panel.profileRows, panel.inventoryFeedback);
  panel.listen(panel.profileContent, "click", (event) =>
    offerInventoryItem(panel, event),
  );
}

function appendInventoryRow(panel, item, equipped, classified) {
  const id = equipped ? item : item.id;
  const row = document.createElement("div");
  row.style.marginBottom = "10px";
  const label = itemLabel(panel, id) + (classified ? "" : " · unclassified ID");
  row.textContent = equipped ? label : `${label} × ${item.count}\n`;
  if (!equipped && panel.owner.hooks.onOfferItem) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "maple-ui-local";
    button.textContent = "Offer nearby";
    button.title =
      "Local reactor offering policy; consumes only the authored requirement after acceptance";
    button.dataset.offerItem = String(id);
    row.append(button);
  }
  panel.profileRows.append(row);
}

async function offerInventoryItem(panel, event) {
  const button = event.target.closest?.("button[data-offer-item]");
  if (!button || panel.itemOfferPending) return;
  const id = Number(button.dataset.offerItem);
  if (!Number.isSafeInteger(id) || id <= 0) {
    panel.owner.report(new Error("Invalid local item offering ID"));
    return;
  }
  panel.itemOfferPending = true;
  button.disabled = true;
  try {
    const result = await panel.owner.hooks.onOfferItem(id);
    if (!result || typeof result.accepted !== "boolean") {
      throw new Error("Invalid local offering result");
    }
    panel.inventoryFeedback.textContent =
      result.reason ||
      (result.accepted
        ? "Local offer accepted."
        : "No matching nearby reactor requirement.");
  } catch (error) {
    panel.inventoryFeedback.textContent = `Local offer failed: ${error.message}`;
    panel.owner.report(error);
  } finally {
    button.disabled = false;
    panel.itemOfferPending = false;
  }
}

function updateStats(panel, profile) {
  prepareClassSelector(panel);
  if (panel.classSelect) {
    panel.classSelect.disabled = !profile || panel.owner.resetting;
    panel.classSelect.value =
      profile && panel.owner.knownJobs.includes(profile.job)
        ? String(profile.job)
        : "";
  }
  if (
    !projectionChanged(panel, profile, STAT_FIELDS) &&
    panel.statsText.textContent
  ) {
    return;
  }
  panel.statsText.textContent = profile
    ? `LOCAL PROFILE · provisional\nBrowser text, not original stat placement.\n\n${profile.name} · Level ${profile.level}\nJob ID ${profile.job}\nHP ${profile.hp} / ${profile.maxHP}\nMP ${profile.mp} / ${profile.maxMP}\nEXP ${profile.exp}\nMesos ${profile.meso}\nFame ${profile.fame}\n\nSTR ${profile.str} · DEX ${profile.dex}\nINT ${profile.int} · LUK ${profile.luk}\n\nAP/SP allocation and derived server formulas are unavailable.`
    : "LOCAL PROFILE UNAVAILABLE";
}

function prepareClassSelector(panel) {
  if (!panel.statsText) {
    panel.statsText = document.createElement("div");
    panel.profileContent.append(panel.statsText);
  }
  if (panel.classSelect || !panel.owner.knownJobs?.length) return;
  const label = document.createElement("label");
  label.textContent =
    "\n\nLocal class policy — original job-advancement scripts unavailable; skills are not granted\n";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Local class policy");
  const prompt = document.createElement("option");
  prompt.value = "";
  prompt.disabled = true;
  prompt.textContent = "Select a retained job ID";
  select.append(prompt);
  for (const id of panel.owner.knownJobs) {
    const option = document.createElement("option");
    option.value = String(id);
    option.textContent = `Job ${id}`;
    select.append(option);
  }
  panel.listen(select, "change", () => {
    const job = Number(select.value),
      store = panel.owner.store;
    if (!store?.profile || !panel.owner.knownJobs.includes(job)) {
      panel.owner.report(
        new Error("Local class must be an original retained quest job ID"),
      );
      return;
    }
    store.profile.job = job;
    store.markDirty();
  });
  label.append(select);
  panel.profileContent.append(label);
  panel.classSelect = select;
}

/** Event-driven projection; called on profile notifications and native tab selection, never by RAF. */
export function updateProfilePanel(panel, store) {
  if (!panel?.profileContent) return;
  if (panel.name === "Stat") updateStats(panel, store?.profile);
  else updateInventory(panel, store?.profile);
}
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
