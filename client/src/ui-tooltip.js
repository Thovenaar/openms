import { ACTION_PALETTE } from "./keymap.js";
import { UISurface } from "./ui-surface.js";

const MAX_TOOLTIP_LINES = 64;
const MAX_TOOLTIP_TEXT = 8192;
// 008e49b5 native font palette; 008e7028/008e7150 ordinary frame ARGB a0000040.
const COLORS = {
  normal: "#ffffff",
  heading: "#fdf514",
  muted: "#bcbcbc",
  error: "#f20303",
  detail: "#93e119",
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
  ["incMHP", "Max HP"],
  ["incMMP", "Max MP"],
  ["incPAD", "Weapon attack"],
  ["incMAD", "Magic attack"],
  ["incPDD", "Weapon defense"],
  ["incMDD", "Magic defense"],
  ["incACC", "Accuracy"],
  ["incEVA", "Avoidability"],
  ["incSpeed", "Speed"],
  ["incJump", "Jump"],
  ["tuc", "Upgrade slots"],
];
const COSTS = [
  ["mpCon", "MP"],
  ["hpCon", "HP"],
  ["moneyCon", "Mesos"],
  ["itemConNo", "Items"],
  ["bulletConsume", "Ammunition"],
];
const JOB_REQUIREMENTS = [
  [1, "Warrior"],
  [2, "Magician"],
  [4, "Bowman"],
  [8, "Thief"],
  [16, "Pirate"],
];

function line(text, tone = "normal") {
  return { text: String(text), tone };
}

/** Authored String.wz markup is plain text here; never interpreted as HTML. */
function prose(text) {
  return String(text || "")
    .slice(0, MAX_TOOLTIP_TEXT)
    .replace(/\\r\\n|\\n|\\r/g, "\n")
    .replace(/#[bkrnd]/g, "");
}

function matchesRequiredJob(mask, job) {
  if (mask === -1) return job % 1000 === 0;
  const family = Math.floor((job % 1000) / 100);
  return family >= 1 && family <= 5 && Boolean(mask & (1 << (family - 1)));
}

function requiredJobs(info, profile) {
  const mask = info.reqJob;
  if (!Number.isInteger(mask) || mask === 0) return null;
  const labels = [];
  if (mask === -1) labels.push("Beginner");
  else {
    for (const [bit, name] of JOB_REQUIREMENTS) {
      if (mask & bit) labels.push(name);
    }
  }
  return line(
    `REQ JOB: ${labels.join(", ") || mask}`,
    matchesRequiredJob(mask, profile?.job) ? "muted" : "error",
  );
}
function appendItemRequirements(lines, info, profile) {
  for (const [key, label, stat] of REQUIREMENTS) {
    if (Number.isFinite(info[key]) && info[key] > 0) {
      lines.push(
        line(
          `REQ ${label}: ${info[key]}`,
          profile && profile[stat] < info[key] ? "error" : "muted",
        ),
      );
    }
  }
  const jobs = requiredJobs(info, profile);
  if (jobs) lines.push(jobs);
}

function appendItemStats(lines, info) {
  for (const [key, label] of STATS) {
    if (Number.isFinite(info[key]) && info[key] !== 0) {
      lines.push(
        line(
          `${label}: ${info[key] > 0 && key !== "tuc" ? "+" : ""}${info[key]}`,
        ),
      );
    }
  }
  if (info.tradeBlock) lines.push(line("Untradeable", "heading"));
  if (info.quest) lines.push(line("Quest item", "heading"));
  if (info.only) lines.push(line("One-of-a-kind item", "heading"));
}

function itemPossessionLine(profile, id, equipped) {
  if (equipped) return line("Equipped", "muted");
  const stack = profile?.inventory.find((entry) => entry.id === id);
  return line(`Quantity: ${stack?.count || 0}`, "muted");
}

/** Template statistics are not rolled equipment-instance values. */
export function itemTooltip(owner, template, id, equipped = false) {
  if (!template) {
    return {
      title: `Item ${id}`,
      lines: [line("Original item details are not packaged.", "error")],
    };
  }
  const profile = owner.store?.profile;
  const info = template.info || {};
  const lines = [itemPossessionLine(profile, id, equipped)];
  appendItemRequirements(lines, info, profile);
  appendItemStats(lines, info);
  if (template.description) lines.push(line(prose(template.description)));
  if (template.category && Math.floor(id / 1000000) === 1) {
    lines.push(line(`${template.category} · Original template stats`, "muted"));
  }
  return { title: template.name || `Item ${id}`, lines };
}

function rankLines(lines, template, rank, heading) {
  const level = template.levels?.[rank];
  if (!level) return;
  lines.push(line(`${heading}: ${rank}`, "heading"));
  const description = template.strings?.[`h${rank}`];
  if (description) lines.push(line(prose(description), "detail"));
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
  if (template.description) lines.push(line(prose(template.description)));
  rankLines(lines, template, rank, "Current level");
  if (rank < template.maxLevel) {
    rankLines(lines, template, rank + 1, "Next level");
  }
  appendSkillStatus(lines, template, learned);
  return { title: template.name || `Skill ${template.id}`, lines };
}

export function bindingTooltip(owner, binding, label) {
  let content;
  if (binding.type === 1) {
    content = skillTooltip(owner, owner.index.skills[binding.id]);
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

/** Event-only composition; borrows the hovered icon's existing lease until hide/retirement. */
export function renderTooltip(owner, content, source) {
  owner.tooltipIcon?.destroy();
  owner.tooltipIcon = null;
  const element = owner.tooltip;
  element.replaceChildren();
  element.style.paddingLeft = "8px";
  if (typeof content === "string") {
    content = { title: "", lines: [line(prose(content))] };
  }
  if (content.lines.length > MAX_TOOLTIP_LINES) {
    throw new Error("Tooltip line budget exceeded");
  }
  const title = document.createElement("div");
  title.textContent = content.title;
  title.style.cssText = "color:#fdf514;font-weight:bold;margin-bottom:5px;";
  element.append(title);
  for (const entry of content.lines) {
    const row = document.createElement("div");
    row.textContent = entry.text.slice(0, MAX_TOOLTIP_TEXT);
    row.style.color = COLORS[entry.tone] || COLORS.normal;
    element.append(row);
  }
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
