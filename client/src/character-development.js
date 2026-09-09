import { experienceRequired } from "./offline-progression.js";
import { profileError, validateProfile } from "./profile-validation.js";
import { requiresSkillMastery } from "./ui-skill-books.js";

const MAX_JOB_BOOKS = 1024;
const EDITABLE_FIELDS = [
  "name",
  "level",
  "job",
  "exp",
  "hp",
  "mp",
  "maxHP",
  "maxMP",
  "str",
  "dex",
  "int",
  "luk",
  "meso",
  "fame",
  "remainingSp",
  "remainingAp",
  "skills",
];

function invalid(field) {
  throw profileError(
    "invalid-profile-edit",
    `Invalid character edit: ${field}`,
  );
}

/** Check descriptors before cloning: structuredClone otherwise drops unknown fields. */
function snapshotPatch(patch, profile) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    invalid("patch");
  }
  const prototype = Object.getPrototypeOf(patch);
  if (prototype !== Object.prototype && prototype !== null) invalid("patch");
  const fields = Reflect.ownKeys(patch);
  if (fields.length > EDITABLE_FIELDS.length) invalid("patch fields");
  for (const field of fields) {
    if (!EDITABLE_FIELDS.includes(field)) invalid(`field ${String(field)}`);
    const descriptor = Object.getOwnPropertyDescriptor(patch, field);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      invalid("patch descriptor");
    }
  }
  // Validate nested record fields before serialization can erase invalid descriptors.
  validateProfile({ ...profile, ...patch });
  return structuredClone(patch);
}

/** Numeric original Skill IMG identities, including books with no retained skill rows. */
function catalogJobs(catalog) {
  const books = catalog?.ui?.coverage?.skillCoverage?.playerBooks;
  if (
    !Array.isArray(books) ||
    books.length === 0 ||
    books.length > MAX_JOB_BOOKS
  ) {
    invalid("catalog skill books");
  }
  const jobs = new Set();
  for (const book of books) {
    if (!Number.isSafeInteger(book) || book < 0 || jobs.has(book)) {
      invalid("catalog job");
    }
    jobs.add(book);
  }
  return jobs;
}

/** The structural validator bounds the skill dictionary and verifies each saved record. */
function validateDevelopment(profile, catalog, jobs) {
  if (!jobs.has(profile.job)) invalid("job");
  const required = experienceRequired(profile.level);
  if (required === 0 ? profile.exp !== 0 : profile.exp >= required) {
    invalid("exp");
  }
  for (const [id, record] of Object.entries(profile.skills)) {
    validateLearnedSkill(id, record, catalog);
  }
}

function validateLearnedSkill(id, record, catalog) {
  const skill = Object.hasOwn(catalog.ui.skills, id)
    ? catalog.ui.skills[id]
    : null;
  if (!skill || skill.id !== Number(id)) invalid(`unknown skill ${id}`);
  if (!Number.isSafeInteger(skill.maxLevel) || skill.maxLevel < 0) {
    invalid(`skill ${id} catalog maximum`);
  }
  if (record.level > skill.maxLevel || record.masterLevel > skill.maxLevel) {
    invalid(`skill ${id} rank`);
  }
  if (requiresSkillMastery(skill.bookId) && record.level > record.masterLevel) {
    invalid(`skill ${id} mastery`);
  }
}

/** Local development edits only; no job grants, progression awards, or skill activation. */
export class CharacterDevelopment {
  constructor(store, catalog) {
    this.store = store;
    this.catalog = catalog;
    this.jobs = catalogJobs(catalog);
    if (!catalog.ui.skills || typeof catalog.ui.skills !== "object") {
      invalid("catalog skills");
    }
  }

  /** Snapshot a complete or partial patch, then await its all-or-nothing durable commit. */
  async edit(patch) {
    const snapshot = snapshotPatch(patch, this.store.profile);
    await this.store.commitProfile((draft) => {
      Object.assign(draft, snapshot);
      validateProfile(draft);
      validateDevelopment(draft, this.catalog, this.jobs);
    });
  }
}
