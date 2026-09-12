import { at, resolveNode } from "../src/assets/image.js";

/** Original MakeCharInfo.img category order: 0 face, 1 base hair, 2 hair colour,
 * 3 skin, 4 top, 5 bottom, 6 shoes, 7 weapon. Recovered from the reference
 * validator client/creator/MakeCharInfo.java, which maps those exact indices and
 * splits a submitted hair id into base plus its last decimal digit colour. */
const CATEGORIES = Object.freeze([
  "face",
  "hairBase",
  "hairColor",
  "skin",
  "top",
  "bottom",
  "shoes",
  "weapon",
]);
/** Adventurer branches; the Cygnus branches carry the same option sets and Aran
 * is a different job this server does not create. */
const GENDERS = Object.freeze([
  ["0", "CharMale"],
  ["1", "CharFemale"],
]);
const MAX_OPTIONS = 64;
const MAX_NAMES = 64;
/** Hair colour suffixes and skin tones are zero-based; ids are positive. */
const MIN_OPTION = 0;
const MAX_OPTION = 99999999;
/** Categories the original names in MakeCharInfo.img/Name; faces and gear have no
 * entry there and use the catalog's own names instead. */
const NAMED_CATEGORIES = Object.freeze(["hairBase", "hairColor", "skin"]);

/** Authored display names keyed by the option id the original used. */
function optionNames(branch, index, category) {
  const list = resolveNode(branch).children[String(index)];
  if (!list) return undefined;
  const names = {};
  let count = 0;
  for (const child of Object.values(resolveNode(list).children)) {
    if (++count > MAX_NAMES) {
      throw new Error(`Original ${category} names exceeded their bound`);
    }
    const label = resolveNode(child).value;
    if (typeof label !== "string" || !label.trim()) {
      throw new Error(`Unsupported original ${category} name`);
    }
    names[String(child.name)] = label;
  }
  return count ? names : undefined;
}

/** Read one category's authored option list in original file order. */
function options(branch, index, category) {
  const list = resolveNode(branch).children[String(index)];
  if (!list || list.type !== "Property") {
    throw new Error(`Missing original create category ${category}`);
  }
  const values = [];
  for (const child of Object.values(resolveNode(list).children)) {
    const option = resolveNode(child).value;
    if (
      !Number.isSafeInteger(option) ||
      option < MIN_OPTION ||
      option > MAX_OPTION
    ) {
      throw new Error(`Unsupported original create option ${option}`);
    }
    values.push(option);
  }
  if (!values.length || values.length > MAX_OPTIONS) {
    throw new Error(`Original create category ${category} exceeded its bound`);
  }
  return values;
}

/** Every legal new-character choice, exactly as the original create packet carried it.
 * Etc.wz:MakeCharInfo.img/Info/CharMale|CharFemale. A submitted hair id is
 * base + colour, so callers must add the colour suffix rather than sending a base. */
export async function extractCharacterCreate(context) {
  const root = await context.image("Etc", "MakeCharInfo.img");
  const info = at(root, "Info");
  const nameRoot = resolveNode(root).children.Name ?? null;
  const genders = {};
  for (const [gender, branch] of GENDERS) {
    const node = at(info, branch);
    if (resolveNode(node).type !== "Property") {
      throw new Error(`Missing original character-create branch ${branch}`);
    }
    const sets = {};
    for (const [index, category] of CATEGORIES.entries()) {
      sets[category] = options(node, index, category);
    }
    const named = nameRoot ? resolveNode(nameRoot).children[branch] : null;
    if (named) {
      const names = {};
      for (const category of NAMED_CATEGORIES) {
        const list = optionNames(named, CATEGORIES.indexOf(category), category);
        if (list) names[category] = list;
      }
      sets.names = names;
    }
    genders[gender] = sets;
  }
  return { schemaVersion: 1, source: "Etc.wz:MakeCharInfo.img/Info", genders };
}

/** Minimum appearance list that packages every recoverable create choice: each
 * skin's body and head, every face, and every base hair with every colour. */
export function createAppearances(create) {
  const appearances = [];
  for (const gender of Object.keys(create.genders)) {
    const sets = create.genders[gender];
    const face = sets.face[0];
    const hair = sets.hairBase[0] + sets.hairColor[0];
    for (const skin of sets.skin) appearances.push({ skin, face, hair });
    for (const entry of sets.face) {
      appearances.push({ skin: sets.skin[0], face: entry, hair });
    }
    for (const base of sets.hairBase) {
      for (const colour of sets.hairColor) {
        appearances.push({ skin: sets.skin[0], face, hair: base + colour });
      }
    }
  }
  return appearances;
}
