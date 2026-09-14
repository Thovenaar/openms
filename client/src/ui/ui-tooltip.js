import { ACTION_PALETTE } from "../input/keymap.js";
import { UISurface } from "./ui-surface.js";
import { itemCount } from "../items/inventory-model.js";
import { renderQuestText } from "./quest-ui.js";
import { loadVisualBundle } from "../rendering/visual-resources.js";

const MAX_TOOLTIP_LINES = 64;
const MAX_TOOLTIP_TEXT = 8192;
const SKILL_TOOLTIP_WIDTH = 320; // 008f25d0: width0x140 passed to008e6e52.
const SKILL_TOOLTIP_WIDTH_STEP = 40; // Browser policy for unusually tall authored prose.
// 008e49b5 native font palette; 008e7028/008e7150 ordinary frame ARGB a0000040.
const COLORS = {
  normal: "#ffffff",
  heading: "#fdf514",
  muted: "#bcbcbc",
  error: "#f20303",
  detail: "#93e119",
  improved: "#ff8a18", // 008e52fb original tooltip orange palette entry.
  rankHeading: "#fae8cb", // 008e577d / font17 selected by008f25d0.
  rankDetail: "#ffffff", // 008e57f2 / font18.
};
const REQUIREMENTS = [
  ["reqLevel", "LEVEL", "level"],
  ["reqSTR", "STR", "str"],
  ["reqDEX", "DEX", "dex"],
  ["reqINT", "INT", "int"],
  ["reqLUK", "LUK", "luk"],
  ["reqPOP", "FAME", "fame"],
];
const STATS = [
  ["incSTR", "STR"],
  ["incDEX", "DEX"],
  ["incINT", "INT"],
  ["incLUK", "LUK"],
  ["incMHP", "HP"],
  ["incMMP", "MP"],
  ["incPAD", "WEAPON ATTACK"],
  ["incMAD", "MAGIC ATTACK"],
  ["incPDD", "WEAPON DEF."],
  ["incMDD", "MAGIC DEF."],
  ["incACC", "ACCURACY"],
  ["incEVA", "AVOIDABILITY"],
  ["incSpeed", "SPEED"],
  ["incJump", "JUMP"],
  ["tuc", "NUMBER OF UPGRADES AVAILABLE"],
];
const COSTS = [
  ["mpCon", "MP"],
  ["hpCon", "HP"],
  ["moneyCon", "Mesos"],
  ["itemConNo", "Items"],
  ["bulletConsume", "Ammunition"],
];

function line(text, tone = "normal") {
  return { text: String(text), tone };
}

/** Keep original prose separate from numeric rank metadata and browser-authored labels. */
function prose(text, tone = "normal") {
  return {
    text: String(text || "").slice(0, MAX_TOOLTIP_TEXT),
    tone,
    authored: true,
  };
}

function itemStat(info, upgrade, key) {
  if (key === "tuc") return upgrade?.slots ?? info[key];
  return upgrade?.stats[key] ?? info[key];
}

function appendItemStats(lines, info, upgrade) {
  for (const [key, label] of STATS) {
    const value = itemStat(info, upgrade, key);
    if (Number.isFinite(value) && (value !== 0 || key === "tuc")) {
      lines.push(itemStatLine(info, key, label, value));
    }
  }
  if (info.tradeBlock) lines.push(line("Untradeable", "heading"));
  if (info.quest) lines.push(line("Quest item", "heading"));
  if (info.only) lines.push(line("One-of-a-kind item", "heading"));
}

/** Native stat labels and signed base/bonus arithmetic; slots have no stat modifier. */
function itemStatLine(info, key, label, value) {
  const base = Number(info[key] ?? 0);
  const bonus = key === "tuc" ? 0 : value - base;
  const total = `${value > 0 && key !== "tuc" ? "+" : ""}${value}`;
  const difference = bonus
    ? ` (${base} ${bonus > 0 ? "+" : "−"} ${Math.abs(bonus)})`
    : "";
  return {
    ...line(`${label} : ${total}${difference}`, bonus ? "improved" : "normal"),
    stat: true,
  };
}

function upgradedTitle(template, id, instance) {
  const level = instance?.upgrade?.level ?? 0;
  return itemTitle(template, id) + (level > 0 ? ` (+${level})` : "");
}

function itemPossessionLine(profile, id, equipped, uid) {
  if (equipped) return line("Equipped", "muted");
  const count = !profile
    ? 0
    : uid
      ? profile.inventory.find((entry) => entry.uid === uid && entry.id === id)
          ?.count || 0
      : itemCount(profile, id);
  return line(`Quantity: ${count}`, "muted");
}

/** Callers control possession semantically; numeric/stat rows never carry ownership metadata. */
function appendItemPossession(lines, item, options) {
  if (options.quantity !== undefined && options.quantity !== null) {
    lines.push(line(`Quantity: ${options.quantity}`, "muted"));
  } else if (options.possession !== false && !item.equipment) {
    lines.push(
      itemPossessionLine(item.profile, item.id, options.equipped, options.uid),
    );
  }
}

/** Item.wz:Consume/0204.img info/success is independent of String.wz's bare name. */
function itemTitle(template, id) {
  const name = template.name || `Item ${id}`;
  if (Math.floor(id / 10000) !== 204 || /\d+\s*%/.test(name)) return name;
  const raw = template.info?.success;
  if (raw === undefined) return name;
  const rate =
    typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw))
      ? Number(raw)
      : NaN;
  if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
    throw new Error(`Invalid original scroll success percentage for ${id}`);
  }
  return `${name} ${rate}%`;
}

/** Current-profile UID statistics override templates; unowned previews remain original. */
export function itemTooltip(owner, template, id, options = {}) {
  if (!template) {
    return {
      title: `Item ${id}`,
      lines: [line("Original item details are not packaged.", "error")],
    };
  }
  const profile = owner.store?.profile;
  const info = template.info || {};
  const equipment = Math.floor(id / 1000000) === 1;
  const instance = options.uid
    ? profile?.equipment.find((entry) => entry.uid === options.uid) ||
      profile?.inventory.find((entry) => entry.uid === options.uid)
    : null;
  const lines = [];
  const item = {
    id,
    info,
    equipment,
    profile,
    iconPath: template.iconRawPath || template.iconPath,
    descriptor: template.descriptor,
  };
  appendItemPossession(lines, item, options);
  appendItemStats(lines, info, instance?.upgrade);
  if (template.description) lines.push(prose(template.description));
  return {
    title: upgradedTitle(template, id, instance),
    lines,
    item,
  };
}

function rankLines(lines, template, rank, heading) {
  const level = template.levels?.[rank];
  if (!level) return;
  lines.push(line(`${heading}: ${rank}`, "rankHeading"));
  const description = template.strings?.[`h${rank}`];
  if (description) lines.push(prose(description, "rankDetail"));
  for (const [key, label] of COSTS) {
    if (Number.isFinite(level[key]) && level[key] !== 0) {
      lines.push(line(`${label} cost: ${level[key]}`));
    }
  }
  if (Number.isInteger(level.itemCon)) {
    lines.push(line(`Required item: ${level.itemCon}`, "muted"));
  }
  if (Number.isFinite(level.cooltime) && level.cooltime > 0) {
    lines.push(line(`Cooldown: ${level.cooltime} sec`, "muted"));
  }
}

function appendSkillStatus(lines, template, learned) {
  const cost = template.allocationCost;
  if (cost?.amount) {
    lines.push(
      line(
        `Learning cost: ${cost.amount} ${cost.kind === "sp" ? "SP" : "beginner entitlement"}`,
        "muted",
      ),
    );
  }
  if (!template.classification?.supported) {
    lines.push(
      line(
        template.classification?.reason || "Local execution unavailable",
        "error",
      ),
    );
  }
  const expiresAt = learned?.expiresAt;
  if (expiresAt !== null && expiresAt !== undefined) {
    lines.push(line(`Expires: ${new Date(expiresAt).toISOString()}`, "muted"));
  }
}

export function skillTooltip(owner, template) {
  if (!template) {
    return {
      title: "Skill unavailable",
      lines: [line("Original skill details are not packaged.", "error")],
    };
  }
  const learned = owner.store?.profile.skills[template.id];
  const rank = learned?.level || 0;
  const lines = [line(`Level ${rank} / ${template.maxLevel}`, "muted")];
  if (learned?.masterLevel) {
    lines.push(line(`Master level: ${learned.masterLevel}`, "muted"));
  }
  if (template.description) lines.push(prose(template.description));
  rankLines(lines, template, rank, "Current level");
  if (rank < template.maxLevel) {
    rankLines(lines, template, rank + 1, "Next level");
  }
  appendSkillStatus(lines, template, learned);
  return {
    title: template.name || `Skill ${template.id}`,
    lines,
    skill: { iconPath: template.iconPath },
  };
}

export function bindingTooltip(owner, binding, label) {
  let content;
  if (binding.type === 1) {
    content = skillTooltip(owner, owner.index.skills[binding.id]);
  } else if (binding.type === 8) {
    content = macroTooltip(owner, binding.id);
  } else if (binding.type === 2 || binding.type === 3 || binding.type === 7) {
    content = itemTooltip(owner, owner.index.items[binding.id], binding.id);
  } else {
    const action = ACTION_PALETTE.find(
      (entry) => entry.type === binding.type && entry.id === binding.id,
    );
    content = {
      title:
        action?.name ||
        (binding.type ? "Unavailable action" : "Unassigned key"),
      lines: [],
    };
  }
  if (label) content.lines.unshift(line(label, "muted"));
  return content;
}

function macroTooltip(owner, id) {
  const macro = owner.store.profile.skillMacros[id];
  return {
    title: macro?.name || `Skill macro ${id + 1}`,
    lines: macro
      ? macro.skills
          .filter((skillId) => skillId > 0)
          .map((skillId) =>
            line(owner.index.skills[skillId]?.name || `Skill ${skillId}`),
          )
      : [],
  };
}

/** 008e8252/008edfc7 use separate equipment and ordinary-item compositions. */
function renderItemTooltip(owner, content, source) {
  const element = owner.tooltip;
  const hidden = element.hidden;
  element.hidden = false;
  const equipment = content.item.equipment;
  element.style.padding = "0";
  let width = equipment ? 236 : 290;
  element.style.width = `${width}px`;
  const body = document.createElement("div");
  body.style.cssText = `position:relative;width:${equipment ? 234 : 288}px;max-width:100%;box-sizing:border-box;padding:10px 9px;font:12px/16px Arial,sans-serif;white-space:normal;overflow-wrap:break-word;`;
  element.append(body);
  const title = document.createElement("div");
  title.textContent = content.title;
  title.style.cssText =
    "text-align:center;color:white;font:bold 12px/16px Arial,sans-serif;min-height:16px;";
  body.append(title);
  for (const entry of content.lines) {
    if (entry.tone !== "heading") continue;
    const flag = itemTextRow(owner, entry);
    flag.style.textAlign = "center";
    flag.style.lineHeight = "19px";
    body.append(flag);
  }
  const headerOffset = Math.max(0, body.offsetHeight - 36);
  const detail = document.createElement("div");
  // Native equipment jobs end at y146; ordinary items have a 68px icon beside prose.
  detail.style.cssText = equipment
    ? "padding-top:126px;"
    : "min-height:76px;padding:12px 0 0 82px;";
  body.append(detail);
  for (const entry of content.lines) {
    if (entry.tone === "heading") continue;
    const row = itemTextRow(owner, entry);
    detail.append(row);
    if (entry.stat) {
      row.style.whiteSpace = "nowrap";
      width = Math.max(width, row.scrollWidth + 20);
    }
  }
  // 008f39e1 grows the native frame to measured label + value width + 20px.
  width = Math.min(width, 290);
  element.style.width = `${width}px`;
  body.style.width = `${width - 2}px`;
  renderItemArtwork(owner, content.item, source, headerOffset);
  element.hidden = hidden;
}

function renderItemArtwork(owner, item, source, offset) {
  let art = null;
  try {
    art = itemArtworkSurface(owner, source, owner.tooltip.firstElementChild);
    if (!art) throw new Error("Original item tooltip artwork is not prepared");
    drawItemIcon(art, item.iconPath, offset);
    if (item.equipment) {
      drawItemRequirements(art, item, offset);
      drawItemJobs(art, item.info.reqJob ?? 0, offset);
    }
    art.renderArtwork();
    owner.tooltipIcon = art;
  } catch (error) {
    art?.destroy();
    throw error;
  }
}

function itemTextRow(owner, entry) {
  const row = document.createElement("div");
  const color = COLORS[entry.tone] || COLORS.normal;
  // 008f36a1 row indices 0xe/0x10 select the 9px Arial label/value slots.
  const font = entry.stat ? "9px/13px" : "12px/16px";
  row.style.cssText = `color:${color};font:${font} Arial,sans-serif;`;
  if (entry.authored) {
    renderQuestText(row, entry.text, owner.quests, { color, tooltip: true });
  } else row.textContent = entry.text.slice(0, MAX_TOOLTIP_TEXT);
  return row;
}

/** A hover may borrow a live icon layer, but never its retired atlas. */
export function itemTooltipSource(content) {
  const source = content?.source;
  const path = content?.item?.iconPath;
  if (!path || !source?.surface || source.surface.disposed) return null;
  return source.surface.assets[path] ? { surface: source.surface, path } : null;
}

/** Source-less item hovers own one demand lease until GameUI.hideTooltip releases it. */
export async function prepareItemTooltipSource(owner, content, signal) {
  const source = itemTooltipSource(content);
  if (source) return source;
  if (!content.item?.descriptor) {
    throw new Error(
      `Original item tooltip descriptor is unavailable: ${content.item?.id}`,
    );
  }
  const resource = await loadVisualBundle(
    content.item.descriptor,
    owner.services,
    signal,
  );
  try {
    signal.throwIfAborted();
    const path = content.item.iconPath;
    if (!resource.manifest.metadata.assets[path]) {
      throw new Error(`Missing original tooltip icon ${path}`);
    }
    return { resource, path };
  } catch (error) {
    resource.destroy();
    throw error;
  }
}

/** Borrow both original chrome/glyphs and the current hovered item's already decoded icon. */
function itemArtworkSurface(owner, source, host) {
  if (!source || source.surface?.disposed) return null;
  const resource =
    source.resource ||
    source.surface?.sources.get(source.path) ||
    source.surface?.resource;
  if (!resource) return null;
  const surface = new UISurface(
    { root: owner.root, host, app: owner.app },
    "Item information artwork",
    resource,
    [234, host.offsetHeight],
  );
  surface.owner = owner;
  surface.ownsResource = false;
  surface.borrow(resource);
  const tooltipResource = owner.hud?.sources.get("ToolTip/Equip/Can/reqLEV");
  if (tooltipResource) surface.borrow(tooltipResource);
  surface.position(0, 0);
  surface.element.style.pointerEvents = "none";
  return surface;
}

/** 008f421e: 68x68 ARGB a0ffffff panel; original icon at (x+2,y+66), doubled. */
function drawItemIcon(surface, path, offset) {
  if (!surface.assets[path]) {
    throw new Error(`Missing original tooltip icon ${path}`);
  }
  const backing = document.createElement("div");
  backing.style.cssText = `position:absolute;left:10px;top:${32 + offset}px;width:68px;height:68px;background:rgba(255,255,255,.62745);`;
  surface.element.prepend(backing);
  const icon = surface.image(path, 12, 98 + offset, true);
  icon.container.scale.set(2);
}

/** 008f5056/008f5310: authored Can/Cannot labels at94, digits at144; 12px rows. */
function drawItemRequirements(surface, item, offset) {
  for (let index = 0; index < REQUIREMENTS.length; index++) {
    const [key, label, stat] = REQUIREMENTS[index];
    const required = item.info[key] ?? 0;
    const current = item.profile?.[stat];
    const state =
      Number.isFinite(current) && current < required ? "Cannot" : "Can";
    const prefix = `ToolTip/Equip/${state}`;
    const y = 32 + offset + index * 12;
    const labelPath = `${prefix}/${key === "reqLevel" ? "reqLEV" : key}`;
    surface.image(labelPath, 94, y);
    const text = required === 0 && key === "reqPOP" ? "-" : String(required);
    let x = 144;
    for (const digit of text) {
      const path = `${prefix}/${digit === "-" ? "none" : digit}`;
      surface.image(path, x, y, digit === "-");
      x += surface.assets[path].width + 1;
    }
    const accessible = surface.text(`REQ ${label}: ${required}`, 94, y, 130);
    accessible.style.cssText +=
      ";height:12px;color:transparent;overflow:hidden;";
  }
}

/** 008ec366 colors allowed template job families, not merely the hovered character's job. */
function drawItemJobs(surface, mask, offset) {
  const jobs = [
    ["beginner", 0, 10],
    ["warrior", 1, 52],
    ["magician", 2, 92],
    ["bowman", 4, 132],
    ["thief", 8, 171],
    ["pirate", 16, 197],
  ];
  for (const [name, bit, x] of jobs) {
    const allowed =
      mask === 0 || (bit === 0 ? mask === -1 : mask !== -1 && mask & bit);
    surface.image(
      `ToolTip/Equip/${allowed ? "Can" : "Cannot"}/${name}`,
      x,
      133 + offset,
    );
  }
}

/** Event-only composition; borrows the hovered icon's existing lease until hide/retirement. */
export function renderTooltip(owner, content, source) {
  owner.tooltipIcon?.destroy();
  owner.tooltipIcon = null;
  const element = owner.tooltip;
  element.replaceChildren();
  element.style.padding = "8px";
  element.style.width = "max-content";
  element.style.maxWidth = "none";
  element.style.maxHeight = "none";
  element.style.overflow = "visible";
  element.style.pointerEvents = "none";
  element.style.border = "1px solid white";
  element.style.borderRadius = "0";
  if (typeof content === "string") {
    content = { title: "", lines: [prose(content)] };
  }
  if (content.lines.length > MAX_TOOLTIP_LINES) {
    throw new Error("Tooltip line budget exceeded");
  }
  element.dataset.itemTooltip = content.item ? "true" : "false";
  element.dataset.skillTooltip = content.skill ? "true" : "false";
  if (content.item) {
    renderItemTooltip(owner, content, source);
    return;
  }
  if (content.skill) {
    renderSkillTooltip(owner, content, source);
    return;
  }
  const title = document.createElement("div");
  title.textContent = content.title;
  title.style.cssText = "color:#fdf514;font-weight:bold;margin-bottom:5px;";
  element.append(title);
  for (const entry of content.lines) {
    const row = document.createElement("div");
    const color = COLORS[entry.tone] || COLORS.normal;
    row.style.cssText = `color:${color};font:12px/16px Arial,sans-serif;`;
    if (entry.authored) {
      renderQuestText(row, entry.text, owner.quests, { color, tooltip: true });
    } else row.textContent = entry.text.slice(0, MAX_TOOLTIP_TEXT);
    element.append(row);
  }
  renderSkillIcon(owner, source);
}

/** 008f25d0: 320px frame, title at18/10, icon at10/32, prose at87/32.
 * Rank sections return to the full width below the icon/description block.
 */
function renderSkillTooltip(owner, content, source) {
  const element = owner.tooltip;
  element.style.padding = "10px";
  element.style.width = `${SKILL_TOOLTIP_WIDTH}px`;
  // 008f3141 uses transparent-white edge cutouts, not an opaque white outline.
  element.style.border = "0";
  element.style.borderRadius = "2px";
  const title = document.createElement("div");
  title.textContent = content.title;
  title.style.cssText =
    "margin:0 8px 6px;min-height:16px;color:white;font:bold 12px/16px Arial,sans-serif;white-space:pre-wrap;overflow-wrap:break-word;";
  element.append(title);
  const header = document.createElement("div");
  header.style.cssText =
    "position:relative;min-height:68px;padding-left:77px;font:12px/16px Arial,sans-serif;white-space:pre-wrap;overflow-wrap:break-word;";
  element.append(header);
  const details = document.createElement("div");
  details.style.cssText =
    "margin-top:14px;font:11px/15px Arial,sans-serif;white-space:pre-wrap;overflow-wrap:break-word;";
  element.append(details);
  let ranks = false;
  for (const entry of content.lines) {
    if (entry.tone === "rankHeading") ranks = true;
    const row = itemTextRow(owner, entry);
    if (entry.tone === "rankHeading") row.style.marginTop = "4px";
    (ranks ? details : header).append(row);
  }
  if (!details.childElementCount) details.remove();
  renderNativeSkillIcon(owner, content.skill, source, header);
}

/** 008f4347 doubles the original canvas inside a 68px ARGBa0ffffff well. */
function renderNativeSkillIcon(owner, skill, source, host) {
  const path = skill.iconPath;
  if (!path || !source?.surface?.assets[path]) return;
  const asset = source.surface.assets[path];
  const icon = new UISurface(
    { root: owner.root, host, app: owner.app },
    "Skill information artwork",
    source.surface.resource,
    [68, 68],
  );
  icon.owner = owner;
  icon.ownsResource = false;
  icon.borrow(source.surface.sources.get(path) || source.surface.resource);
  icon.position(0, 0);
  icon.element.style.pointerEvents = "none";
  icon.element.style.background = "rgba(255,255,255,.62745)";
  const sprite = icon.image(path, 0, 0);
  sprite.container.scale.set(2);
  sprite.setPosition(2 + asset.origin.x * 2, 2 + asset.origin.y * 2);
  const width = Math.max(68, asset.width * 2 + 4);
  const height = Math.max(68, asset.height * 2 + 4);
  icon.element.style.width = `${width}px`;
  icon.element.style.height = `${height}px`;
  host.style.paddingLeft = `${width + 9}px`;
  host.style.minHeight = `${height}px`;
  owner.tooltipIcon = icon;
  icon.renderArtwork();
}

function renderSkillIcon(owner, source) {
  const element = owner.tooltip;
  if (!source?.path || !source.surface.assets[source.path]) return;
  const icon = new UISurface(
    { root: owner.root, host: element, app: owner.app },
    "Tooltip icon",
    source.surface.resource,
    [40, 40],
  );
  icon.owner = owner;
  icon.ownsResource = false;
  icon.borrow(
    source.surface.sources.get(source.path) || source.surface.resource,
  );
  icon.element.style.pointerEvents = "none";
  icon.position(8, 8);
  const asset = icon.assets[source.path];
  icon.image(source.path, 0, 0);
  icon.width = Math.max(40, asset.width);
  element.style.paddingLeft = `${icon.width + 16}px`;
  icon.renderArtwork();
  owner.tooltipIcon = icon;
}

/** Measure current intrinsic content before clamping in the owner's logical viewport. */
export function positionTooltip(element, point, viewport) {
  const { left, top, right, bottom } = viewport;
  const style = element.style;
  // An old right-edge left inset otherwise constrains CSS shrink-to-fit measurement.
  style.inset = "auto";
  style.left = `${left}px`;
  style.top = `${top}px`;
  const skill = element.dataset.skillTooltip === "true";
  const item = element.dataset.itemTooltip === "true";
  if (!skill && !item) style.width = "max-content";
  style.boxSizing = "border-box";
  style.maxWidth = `${Math.min(skill ? SKILL_TOOLTIP_WIDTH : item ? 290 : 360, right - left)}px`;
  style.maxHeight = "none";
  style.overflow = "visible";
  if (skill) fitSkillTooltip(element, right - left, bottom - top);
  style.maxHeight = `${bottom - top}px`;
  style.overflow = "auto";
  if (skill && element.scrollHeight > bottom - top) {
    style.pointerEvents = "auto";
  }
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  style.left = `${Math.max(left, Math.min(right - width, point.x + 12))}px`;
  const targetY =
    point.y + 20 + height <= bottom ? point.y + 20 : point.y - height - 6;
  style.top = `${Math.max(top, Math.min(bottom - height, targetY))}px`;
}

/** Browser viewport adaptation: widen only when native-width prose cannot fit vertically.
 * The finite viewport bounds the measurement loop; no font shrinking or text truncation.
 */
function fitSkillTooltip(element, width, height) {
  const style = element.style;
  const maximum = Math.floor(width);
  for (
    let candidate = Math.min(SKILL_TOOLTIP_WIDTH, maximum);
    candidate <= maximum;
    candidate = Math.min(candidate + SKILL_TOOLTIP_WIDTH_STEP, maximum)
  ) {
    style.width = `${candidate}px`;
    style.maxWidth = `${candidate}px`;
    if (element.offsetHeight <= height || candidate === maximum) return;
  }
}
