import { PROGRESSION_POLICY } from "../character/offline-progression.js";
import {
  PROFILE_LIMITS,
  validateKeyBindings,
} from "../profile/profile-validation.js";
import {
  isAssignableKey,
  keyIndexForCode,
  KEY_COUNT,
} from "../input/keymap.js";
import { JOB_LABELS } from "../ui/ui-job-labels.js";
import { requiresSkillMastery, skillBooks } from "../ui/ui-skill-books.js";
import { AP_POLICY } from "../character/character-development.js";
import { recalculateVitals } from "../character/character-stats.js";
import {
  equipInventory,
  unequipInventory,
  wearRequirements,
} from "../items/inventory-action-rules.js";
import {
  effectiveItemStackLimit,
  grantItem,
} from "../items/inventory-model.js";
import {
  compatibleAmmunition,
  validateWeaponCombat,
} from "../combat/weapon-usage.js";

const MAX_PRESET_ITEMS = 65536;
const PRESET_ATTRIBUTES = ["str", "dex", "int", "luk"];
const PRESET_ARMOR_SLOTS = [-1, -5, -6, -7, -8, -9];
const PRESET_WEAPONS = new Map([
  [10, 1402000],
  [11, 1402000],
  [12, 1402000],
  [13, 1432000],
  [20, 1372000],
  [21, 1372000],
  [22, 1372000],
  [23, 1372000],
  [30, 1452002],
  [31, 1452002],
  [32, 1462001],
  [40, 1472000],
  [41, 1472000],
  [42, 1332000],
  [50, 1482000],
  [51, 1482000],
  [52, 1492000],
]);
const PRESET_EXCLUDED_FLAGS = [
  "cash",
  "timeLimited",
  "quest",
  "only",
  "tradeBlock",
];
const PRESET_WEAR_ERRORS = new Set([
  "item-metadata",
  "equipment-gender",
  "equipment-job",
  "equipment-level",
  "equipment-fame",
  "equipment-stat",
]);
// Deliberate development starter weapons, not a claim about original job grants.
// IDs resolve Character.wz:Weapon/<eight-digit ID>.img; native families00460aa0.
function presetWeapon(job) {
  if (job === 2000) return 1442012;
  if (Math.trunc(job / 100) === 21) return 1442000;
  if (job === 2001) return 1372005;
  return PRESET_WEAPONS.get(Math.trunc((job % 1000) / 10)) ?? 1302000;
}

function presetEquipmentAvailable(template, avatar) {
  if (!template.info || !avatar) return false;
  if (!avatar.visual || !avatar.descriptor) return false;
  return !PRESET_EXCLUDED_FLAGS.some((flag) => template.info[flag]);
}

/** Selection policy only; equipInventory remains the native/server-reference admission. */
function presetWearable(profile, items, template) {
  try {
    wearRequirements(profile, items, template);
    return true;
  } catch (error) {
    if (PRESET_WEAR_ERRORS.has(error.code)) return false;
    throw error;
  }
}

function presetArmorSlot(index, profile, template) {
  if (Math.trunc(template.id / 1000000) !== 1) return null;
  const avatar = index.avatar?.entries[template.id];
  if (!presetEquipmentAvailable(template, avatar)) return null;
  const slot = avatar.equippedSlots?.[0];
  if (
    !PRESET_ARMOR_SLOTS.includes(slot) ||
    !presetWearable(profile, index.items, template)
  ) {
    return null;
  }
  return slot;
}

function choosePresetArmor(selected, template, slot) {
  const previous = selected.get(slot);
  const score =
    (template.info.reqJob > 0 ? 1000 : 0) + (template.info.reqLevel ?? 0);
  if (
    !previous ||
    score > previous.score ||
    (score === previous.score && template.id < previous.item.id)
  ) {
    selected.set(slot, { item: template, score });
  }
}

function presetArmor(index, profile) {
  const templates = Object.values(index.items);
  if (templates.length > MAX_PRESET_ITEMS) {
    throw new Error("Preset item catalog exceeds its bound.");
  }
  const selected = new Map();
  for (const template of templates) {
    const slot = presetArmorSlot(index, profile, template);
    if (slot !== null) choosePresetArmor(selected, template, slot);
  }
  // An overall owns the pants region; never stage mutually exclusive outfits.
  const coat = selected.get(-5);
  if (coat && Math.trunc(coat.item.id / 10000) === 105) selected.delete(-6);
  return selected;
}

function equipPresetItem(profile, index, template, slot) {
  const cash = profile.equipment.find((item) => item.slot === slot - 100);
  if (cash) unequipInventory(profile, index.items, { uid: cash.uid });
  const worn = profile.equipment.find((item) => item.slot === slot);
  if (worn?.id === template.id && worn.expiresAt === null) return;
  let item = profile.inventory.find(
    (entry) => entry.id === template.id && entry.expiresAt === null,
  );
  if (!item) {
    grantItem(profile, template, 1);
    item = profile.inventory.find(
      (entry) => entry.id === template.id && entry.expiresAt === null,
    );
  }
  if (!item) {
    throw new Error(
      `Original preset equipment ${template.id} could not be staged.`,
    );
  }
  equipInventory(profile, index.items, { uid: item.uid, slot });
}

/** Job mastery may shrink rechargeable capacity; split excess without losing owned rounds. */
function preservePresetAmmunition(profile, items) {
  const entries = profile.inventory.slice();
  for (const entry of entries) {
    const template = items[entry.id];
    if (!template) {
      throw new Error(`Original owned item ${entry.id} is unavailable.`);
    }
    const maximum = effectiveItemStackLimit(profile, template);
    if (entry.count <= maximum) continue;
    const excess = entry.count - maximum;
    entry.count = maximum;
    grantItem(profile, template, excess, {
      owner: entry.owner,
      flags: entry.flags,
      expiresAt: entry.expiresAt,
    });
  }
}

function presetAmmunition(profile, index, weapon) {
  const id = [2060000, 2061000, 2070000, 2330000].find((value) =>
    compatibleAmmunition(weapon, value),
  );
  if (!id) return null;
  const template = index.items[id];
  if (!template || (template.info.reqLevel ?? 0) > profile.level) {
    throw new Error(`Original preset ammunition ${id} is unavailable.`);
  }
  let available = 0;
  for (const item of profile.inventory) {
    if (item.id === id && item.expiresAt === null) available += item.count;
  }
  const count = effectiveItemStackLimit(profile, template);
  const granted = Math.max(0, count - available);
  if (granted) grantItem(profile, template, granted);
  return {
    id,
    name: template.name,
    count: available + granted,
    granted,
    source: template.source,
  };
}

/** Mutates only the caller's detached/locked development draft; never the live profile. */
export function applyJobPresetLoadout(profile, index, job) {
  if (profile.job !== job || !catalogBooks(index).includes(job)) {
    throw new Error("The staged preset job no longer matches the character.");
  }
  if (
    profile.inventory.length > PROFILE_LIMITS.inventory ||
    profile.equipment.length > PROFILE_LIMITS.equipment
  ) {
    throw new Error("Preset inventory exceeds its bound.");
  }
  const weapon = presetWeapon(job);
  const template = index.items[weapon];
  const combat = index.avatar?.entries[weapon]?.combat;
  if (!template || !combat) {
    throw new Error(`Original preset weapon ${weapon} is unavailable.`);
  }
  validateWeaponCombat(combat);
  preservePresetAmmunition(profile, index.items);
  equipPresetItem(profile, index, template, -11);
  const equipment = [
    { id: weapon, name: template.name, slot: -11, source: template.source },
  ];
  for (const [slot, { item }] of presetArmor(index, profile)) {
    equipPresetItem(profile, index, item, slot);
    equipment.push({ id: item.id, name: item.name, slot, source: item.source });
  }
  const ammunition = presetAmmunition(profile, index, weapon);
  recalculateVitals(profile, index.items);
  return { equipment, ammunition };
}

const MAX_JOB_BOOKS = 1024;
const MAX_AUTHORED_RANKS = 4096;
const MAX_PRESET_BINDINGS = 8;
const RESOURCE_COSTS = [
  ["hpCon", "HP"],
  ["mpCon", "MP"],
  ["moneyCon", "mesos"],
];
// Local ergonomic policy, not an original default map. Never replace non-skill bindings.
const PRESET_CODES = [
  "KeyA",
  "KeyD",
  "KeyV",
  "KeyT",
  "KeyY",
  "KeyU",
  "KeyJ",
  "KeyN",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
  "Insert",
  "Home",
  "PageUp",
  "Delete",
];
const ATTACK_ACTIVATIONS = new Set([
  "combat",
  "channel",
  "rush",
  "assault",
  "recoil",
]);
const MOVEMENT_ACTIVATIONS = new Set(["teleport", "impulse", "dash", "wings"]);

function catalogBooks(index) {
  const books = index.coverage?.skillCoverage?.playerBooks;
  if (!Array.isArray(books) || !books.length || books.length > MAX_JOB_BOOKS) {
    throw new Error(
      "Original player/job book inventory is unavailable or exceeds its bound.",
    );
  }
  const unique = new Set();
  for (const id of books) {
    if (!Number.isSafeInteger(id) || id < 0 || unique.has(id)) {
      throw new Error(
        "Original player/job book inventory contains an invalid identity.",
      );
    }
    unique.add(id);
  }
  return books;
}

function jobFamily(id) {
  if (id >= 800 && id < 1000) return "Original special / GM books";
  if (Math.trunc(id / 1000) === 1) return "Cygnus Knights";
  if (Math.trunc(id / 100) === 22 || id === 2001) return "Evan";
  if (Math.trunc(id / 1000) === 2) return "Aran / Legend";
  return "Explorers";
}

function jobStage(id) {
  if (id >= 800 && id < 1000) return "special book";
  const books = skillBooks(id);
  if (!books.includes(id)) return "ancestry unavailable";
  return books.length === 1 ? "beginner book" : `stage ${books.length - 1}`;
}

/** Cosmic Character.getMaxClassLevel; config USE_ENFORCE_JOB_LEVEL_RANGE=false.
 * Class caps are server-reference preset policy; local progression remains the hard ceiling.
 */
function presetLevel(job) {
  return Math.min(
    Math.trunc(job / 1000) === 1 ? 120 : 200,
    PROGRESSION_POLICY.maxLevel,
  );
}

/** Every original player IMG gets an option, including empty and special books. */
export function developmentJobPresets(index) {
  return catalogBooks(index).map((id) => ({
    id,
    family: jobFamily(id),
    label: `${JOB_LABELS[id] || "Unnamed original job"} [${id}] · ${jobStage(id)} — max Lv.${presetLevel(id)}`,
  }));
}

function resolvedRank(skill, key) {
  const rank = Number(key);
  const row = skill.levels[key];
  if (
    /^[1-9]\d*$/.test(key) &&
    Number.isSafeInteger(rank) &&
    rank <= skill.maxLevel &&
    row &&
    typeof row === "object" &&
    !Array.isArray(row) &&
    !Object.hasOwn(row, "$uol")
  ) {
    return rank;
  }
  return 0;
}

function authoredRank(skill) {
  if (!Number.isSafeInteger(skill.maxLevel) || skill.maxLevel < 0) {
    throw new Error(`Skill ${skill.id}: original maximum rank is invalid.`);
  }
  const levels = Object.keys(skill.levels ?? {});
  if (levels.length > MAX_AUTHORED_RANKS) {
    throw new Error(
      `Skill ${skill.id}: authored rank inventory exceeds its bound.`,
    );
  }
  let rank = 0;
  for (const key of levels) {
    rank = Math.max(rank, resolvedRank(skill, key));
  }
  return rank;
}

function runtimeStatus(skill, rank) {
  if (!rank) return "Not learned: no resolved positive original rank record.";
  if (skill.flags.disabled) {
    return "Learned, unavailable: original skill is disabled.";
  }
  if (skill.flags.timeLimited) {
    return "Learned, unavailable: original timed/event authority is required.";
  }
  if (skill.bookId >= 800 && skill.bookId < 1000) {
    return "Learned, unavailable: original GM/server authority is not supplied by a preset.";
  }
  if (!skill.classification.supported) {
    return `Learned, runtime unavailable: ${skill.classification.reason || "no catalogued controller"}.`;
  }
  if (skill.classification.activation === "passive") {
    return "Learned passive; no active shortcut.";
  }
  const family = Math.trunc(skill.id / 1000) % 10;
  if (family === 0 || family === 9) {
    return "Learned; native skill-key carry excludes this skill ID family.";
  }
  return "Runtime-capable active skill; actual cast admission still applies.";
}

function canBind(skill, rank) {
  const family = Math.trunc(skill.id / 1000) % 10;
  return (
    rank > 0 &&
    skill.classification.supported &&
    skill.classification.activation !== "passive" &&
    family !== 0 &&
    family !== 9 &&
    !skill.flags.disabled &&
    !skill.flags.timeLimited &&
    !(skill.bookId >= 800 && skill.bookId < 1000)
  );
}

function resourceRequirements(skill, rank) {
  const result = [];
  const info = skill.levels?.[rank] ?? {};
  for (const [key, label] of RESOURCE_COSTS) {
    if (Number(info[key]) > 0) {
      result.push(`Authored cost ${info[key]} ${label}`);
    }
  }
  if (info.itemCon || info.itemConNo) {
    result.push(
      `Item ${info.itemCon ?? "unknown"} × ${info.itemConNo ?? "unknown"}`,
    );
  }
  if (skill.classification.hooks?.includes("ammunition")) {
    result.push("Compatible equipped weapon and ammunition");
  }
  return result;
}

function requirements(skill, rank) {
  const result = resourceRequirements(skill, rank);
  if (skill.properties.reqLev) {
    result.push(`Requires character Lv.${skill.properties.reqLev}`);
  }
  if (skill.flags.invisible) {
    result.push(
      "Hidden original skill; this explicit development grant is not normal allocation",
    );
  }
  if (skill.allocationCost?.kind === "unknown") {
    result.push(
      "Original SP allocation cost unavailable; development grant only",
    );
  }
  if (skill.prerequisites.length > PROFILE_LIMITS.skills) {
    throw new Error(`Skill ${skill.id}: prerequisite bound exceeded.`);
  }
  for (const requirement of skill.prerequisites) {
    result.push(`Prerequisite ${requirement.skillId} rank ${requirement.rank}`);
  }
  if (rank < skill.maxLevel) {
    result.push(
      `Declared maximum ${skill.maxLevel} has no resolved rank row; using highest resolved rank ${rank}`,
    );
  }
  return result;
}

function presetSkills(index, books) {
  const catalog = Object.values(index.skills);
  if (catalog.length > PROFILE_LIMITS.skills) {
    throw new Error("Original skill inventory exceeds the profile bound.");
  }
  const rows = [];
  const learned = {};
  for (const skill of catalog) {
    if (!books.includes(skill.bookId)) continue;
    const rank = authoredRank(skill);
    if (rank > 0) {
      learned[skill.id] = {
        level: rank,
        masterLevel: skill.maxLevel,
        expiresAt: null,
      };
    }
    rows.push({
      id: skill.id,
      name: skill.name,
      book: skill.bookId,
      rank,
      mastery: skill.maxLevel,
      masteryRequired: requiresSkillMastery(skill.bookId),
      status: runtimeStatus(skill, rank),
      requirements: requirements(skill, rank),
      bindable: canBind(skill, rank),
      activation: skill.classification.activation,
      binding: null,
    });
  }
  rows.sort((a, b) => a.book - b.book || a.id - b.id);
  return { rows, learned };
}

function bindingPriority(row) {
  if (ATTACK_ACTIVATIONS.has(row.activation)) return 0;
  if (MOVEMENT_ACTIVATIONS.has(row.activation)) return 1;
  if (row.activation === "self-buff") return 2;
  return 3;
}

function presetBindings(original, rows) {
  validateKeyBindings(original);
  const keyBindings = structuredClone(original);
  for (let index = 0; index < KEY_COUNT; index++) {
    if (keyBindings.keys[index].type === 1) {
      keyBindings.keys[index] = { type: 0, id: 0 };
    }
  }
  const candidates = rows.filter((row) => row.bindable);
  candidates.sort(
    (a, b) =>
      bindingPriority(a) - bindingPriority(b) || b.book - a.book || a.id - b.id,
  );
  const ordered = [];
  // Give attack, movement and buff/utility a first slot before filling by advancement.
  for (let priority = 0; priority < 4; priority++) {
    const row = candidates.find((entry) => bindingPriority(entry) === priority);
    if (row) ordered.push(row);
  }
  for (const row of candidates) if (!ordered.includes(row)) ordered.push(row);
  const bindings = [];
  for (const code of PRESET_CODES) {
    if (
      bindings.length >= MAX_PRESET_BINDINGS ||
      bindings.length >= ordered.length
    ) {
      break;
    }
    const index = keyIndexForCode(code);
    if (!isAssignableKey(index) || keyBindings.keys[index].type !== 0) continue;
    const row = ordered[bindings.length];
    const key = code.replace(/^Key|^Digit/, "");
    keyBindings.keys[index] = { type: 1, id: row.id };
    row.binding = key;
    bindings.push({ key, id: row.id, name: row.name });
  }
  return { keyBindings, bindings };
}

function annotateMissingPrerequisites(index, rows, learned) {
  for (const row of rows) {
    for (const requirement of index.skills[row.id].prerequisites) {
      if ((learned[requirement.skillId]?.level ?? 0) < requirement.rank) {
        row.requirements.push(
          `Unavailable prerequisite: ${requirement.skillId} rank ${requirement.rank}; no unrelated-job rank was added`,
        );
      }
    }
  }
}

/** Detached development draft only. Caller owns preview and the existing atomic edit authority. */
export function stageJobPreset(index, profile, job) {
  const available = catalogBooks(index);
  if (!available.includes(job)) {
    throw new Error(
      `Job ${job} is absent from the original player-book catalog.`,
    );
  }
  const books = skillBooks(job);
  if (!books.includes(job)) {
    throw new Error(
      `Job ${job} has no recovered ancestry policy; no values were staged.`,
    );
  }
  const { rows, learned } = presetSkills(index, books);
  const { keyBindings, bindings } = presetBindings(profile.keyBindings, rows);
  const level = presetLevel(job);
  const notes = [
    "Explicit development grant, not earned advancement: replaces the learned-skill dictionary with this job and its ancestors; grants maximum authored mastery without spending AP/SP. Beginner ranks are maxed independently of normal shared entitlement.",
    "Level uses Cosmic's class cap (Cygnus 120, others 200), bounded by local progression. Source job-stage level enforcement is disabled; EXP is reset to 0.",
    "Replaces all previous skill shortcuts. Up to eight active skills use free assignable keys; every non-skill binding and the quick-slot layout are preserved. Unbound skills remain in the learned editor and native Skill window where visible.",
    "Stages original job-family weapons, eligible original armor, compatible ammunition, all four primary stats at the offline AP cap, and full HP/MP at the visible vital cap. Existing displaced equipment goes to inventory; insufficient space rejects the whole preset.",
    "Runtime-capable is not universally cast-ready: special item costs, cooldowns, combo/form/map state and original prepared resources are still checked. No mesos, summon items, mounts, or server authority are fabricated.",
  ];
  for (const book of books) {
    if (!available.includes(book)) {
      notes.push(
        `Ancestor book ${book} is absent from the packaged original inventory.`,
      );
    } else if (!rows.some((row) => row.book === book)) {
      notes.push(
        `Book ${book} (${JOB_LABELS[book] || "unnamed"}) contains no authored skills; its ancestor skills are retained.`,
      );
    }
  }
  annotateMissingPrerequisites(index, rows, learned);
  const patch = { job, level, exp: 0, skills: learned, keyBindings };
  for (const stat of PRESET_ATTRIBUTES) patch[stat] = AP_POLICY.statMaximum;
  patch.baseMaxHP = patch.hp = AP_POLICY.vitalMaximum;
  patch.baseMaxMP = patch.mp = AP_POLICY.vitalMaximum;
  const draft = structuredClone(profile);
  Object.assign(draft, patch);
  const loadout = applyJobPresetLoadout(draft, index, job);
  return {
    patch,
    loadout,
    label: `${JOB_LABELS[job] || "Unnamed original job"} [${job}]`,
    books,
    rows,
    bindings,
    notes,
  };
}
