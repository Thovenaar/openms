import { collectDescriptors } from "../../public/offline-manifest.js";
import { avatarResourceDescriptors } from "../character/avatar-visuals.js";
import { PROFILE_LIMITS } from "../profile/profile-validation.js";
import { canonicalKeyIndex } from "../input/keymap.js";
import { bindingTemplate } from "../ui/ui-icons.js";
import { profileSkillLevel } from "../skills/skill-system.js";
import { morphId } from "../skills/skill-forms.js";
import {
  MORPH_SKILLS,
  RIDING_SKILLS,
  TELEPORT_SKILLS,
} from "../skills/skill-world-rules.js";
import { utilityFamily } from "../skills/skill-utility-rules.js";
import { COMBAT_SKILLS } from "../skills/skill-combat-rules.js";

const PROFILE_ARRAY_LIMITS = Object.freeze([
  ["equipment", PROFILE_LIMITS.equipment],
  ["inventory", PROFILE_LIMITS.inventory],
  ["pets", PROFILE_LIMITS.inventory],
]);

/** Stable dependency-input key for validated profiles; excludes vitals, rewards and display text. */
export function profileResourceKey(profile) {
  const equipment = profile.equipment;
  const skills = Object.entries(profile.skills);
  const pets = profile.pets;
  const bindings = profile.keyBindings;
  boundProfileCollections(profile);
  boundBindings(bindings);
  if (skills.length > PROFILE_LIMITS.skills) {
    throw new Error("Selected profile dependency inputs exceed bounds");
  }
  const now = Date.now();
  const ranks = skills
    .map(([id, record]) => [
      Number(id),
      record.expiresAt === null || record.expiresAt > now ? record.level : 0,
      record.expiresAt,
    ])
    .sort((a, b) => a[0] - b[0]);
  const equipped = equipment
    .map((item) => [item.slot, item.id])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const icons = bindings.quickSlots
    .map((physical) => {
      const binding = bindings.keys[canonicalKeyIndex(physical)];
      if (!binding) throw new Error("Selected HUD binding is absent");
      return [1, 2, 3, 7, 8].includes(binding.type)
        ? [binding.type, binding.id]
        : [0, 0];
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const summoned = [];
  for (const pet of pets) {
    if (pet.summonedSlot === null) continue;
    const item = profile.inventory.find((entry) => entry.uid === pet.itemUid);
    if (!item) throw new Error("Selected summoned pet item is absent");
    summoned.push(item.id);
  }
  summoned.sort((a, b) => a - b);
  return JSON.stringify([
    profile.gender,
    profile.job,
    profile.appearance.skin,
    profile.appearance.hair,
    profile.appearance.face,
    equipped,
    ranks,
    icons,
    summoned,
  ]);
}

function boundProfileCollections(profile) {
  for (const [name, limit] of PROFILE_ARRAY_LIMITS) {
    if (!Array.isArray(profile[name]) || profile[name].length > limit) {
      throw new Error(`Selected profile ${name} exceeds its bound`);
    }
  }
}

function boundBindings(bindings) {
  if (
    !Array.isArray(bindings?.keys) ||
    bindings.keys.length > 256 ||
    !Array.isArray(bindings.quickSlots) ||
    bindings.quickSlots.length !== 8
  ) {
    throw new Error("Invalid selected HUD bindings");
  }
}

/** Called only at profile/world publication boundaries; never from a frame or physics tick. */
export function selectedProfileResources(catalog, profile) {
  if (!catalog?.ui?.skills || !profile?.skills || !profile.keyBindings) {
    throw new Error("Selected profile resource input is incomplete");
  }
  boundProfileCollections(profile);
  const found = new Map();
  const budget = { nodes: 0 };
  const add = (root) => {
    if (root) collectDescriptors(root, found, budget);
  };
  add(avatarResourceDescriptors(catalog, profile));
  addBoundIcons(catalog, profile, add);
  addWeaponSound(catalog, profile, add);
  const learned = selectedSkills(catalog, profile);
  for (const learnedSkill of learned) {
    addLearnedSkill(catalog, profile, learnedSkill, add);
  }
  addSharedSkillSources(catalog, learned, add);
  addSummonedPets(catalog, profile, add);
  return [...found.values()];
}

/** Ordinary attacks use the real equipped weapon's original sfx, never a cash overlay. */
function addWeaponSound(catalog, profile, add) {
  const weapon = profile.equipment.find((item) => item.slot === -11);
  if (!weapon) return;
  const sfx = catalog.ui.items[weapon.id]?.info.sfx;
  const family = catalog.audiovisual?.combat?.sounds?.Weapon[sfx];
  if (!family) {
    throw new Error(`Selected weapon sound family is unavailable: ${sfx}`);
  }
  add(family.Attack);
}

function addLearnedSkill(catalog, profile, learned, add) {
  const { skill } = learned;
  add(skill.visuals);
  add(skill.descriptor);
  const sounds = skill.sounds?.leaves;
  add(sounds?.Use);
  add(sounds?.Hit);
  const kind = COMBAT_SKILLS.get(skill.id)?.kind;
  if (["charge", "continuous", "magnet"].includes(kind)) add(sounds?.KeyDown);
  addWorldDependencies(catalog, profile, learned, add);
  if (utilityFamily(skill.id) === "enhancement") {
    add(catalog.ui.bundles.EnchantSkill);
  }
}

function selectedSkills(catalog, profile) {
  const skills = Object.values(catalog.ui.skills);
  if (skills.length > PROFILE_LIMITS.skills) {
    throw new Error("Skill catalog exceeds profile bound");
  }
  const now = Date.now();
  const selected = [];
  for (const skill of skills) {
    const rank = profileSkillLevel(catalog.ui.skills, profile, skill.id, now);
    if (rank > 0 && skill.classification.supported) {
      selected.push({ skill, rank });
    }
  }
  return selected;
}

/** Use the same canonical scan-code and macro/item/skill icon resolution as the HUD. */
function addBoundIcons(catalog, profile, add) {
  const bindings = profile.keyBindings;
  boundBindings(bindings);
  const owner = { index: catalog.ui, store: { profile } };
  for (const physical of bindings.quickSlots) {
    const binding = bindings.keys[canonicalKeyIndex(physical)];
    if (!binding) throw new Error("Selected HUD binding is absent");
    if ([1, 2, 3, 7, 8].includes(binding.type)) {
      add(bindingTemplate(owner, binding)?.descriptor);
    }
  }
}

/** These shared originals are acquired by combo, bomb-flight and Doom preparation. */
function addSharedSkillSources(catalog, learned, add) {
  const ids = new Set(learned.map(({ skill }) => skill.id));
  if (ids.has(14111006)) add(catalog.ui.skills[5201002]?.visuals);
  if (ids.has(1111002) || ids.has(11111001)) {
    add(catalog.ui.skills[1111002]?.visuals.state);
    if (ids.has(1120003) || ids.has(11110005)) {
      add(catalog.ui.skills[1120003]?.visuals.state);
    }
  }
  if (ids.has(2311005)) add(catalog.ui.skillCombat?.targets?.doom);
}

function addWorldDependencies(catalog, profile, { skill, rank }, add) {
  const world = catalog.ui.skillWorld;
  if (MORPH_SKILLS.has(skill.id)) {
    add(world?.forms?.[morphId(skill.levels[rank], profile.gender)]);
  }
  if (RIDING_SKILLS.has(skill.id)) addRiding(catalog, profile, skill.id, add);
  let effect = null;
  if (TELEPORT_SKILLS.has(skill.id)) effect = "Teleport";
  else if (skill.id === 4111006) effect = "Flying";
  else if (skill.id === 14101004) effect = "Flying1";
  else if (skill.id === 11101005) effect = "SoulRush";
  if (effect) add(world?.effects?.[effect]);
}

function addRiding(catalog, profile, skillId, add) {
  const mountId =
    skillId === 5221006
      ? 1932000
      : profile.equipment.find((item) => item.slot === -18)?.id;
  if (!mountId) return;
  const riding = catalog.ui.skillWorld?.riding;
  const mount = riding?.mounts[mountId];
  if (!mount || mount.templateId === null) return;
  if (mountId === 1932000) {
    add(mount.bundle);
    return;
  }
  const saddleId = profile.equipment.find((item) => item.slot === -19)?.id;
  const saddle = riding.saddles[saddleId]?.[mountId];
  if (!saddle) return;
  add(mount.bundle);
  add(saddle.bundle);
}

function addSummonedPets(catalog, profile, add) {
  for (const pet of profile.pets) {
    if (pet.summonedSlot === null) continue;
    const item = profile.inventory.find((entry) => entry.uid === pet.itemUid);
    const descriptor = catalog.ui.skillUtility?.pets[item?.id]?.bundle;
    if (!descriptor) {
      throw new Error("Selected summoned pet artwork is unavailable");
    }
    add(descriptor);
  }
}
