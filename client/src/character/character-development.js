import { experienceRequired } from "./offline-progression.js";
import {
  profileError,
  validateProfile,
} from "../profile/profile-validation.js";
import { skillBooks } from "../ui/ui-skill-books.js";
import { recalculateVitals } from "./character-stats.js";
import { isAssignableKey, KEY_COUNT } from "../input/keymap.js";
import { applyJobPresetLoadout } from "../development/character-presets.js";

import {
  AP_POLICY,
  catalogJobs,
  validateLearnedSkill,
  apField,
  admitAp,
  hpGrowth,
  mpGrowth,
  apGain,
} from "./ap-rules.js";
const EDITABLE_FIELDS = [
  "name",
  "level",
  "job",
  "exp",
  "hp",
  "mp",
  "baseMaxHP",
  "baseMaxMP",
  "str",
  "dex",
  "int",
  "luk",
  "meso",
  "fame",
  "remainingSp",
  "remainingAp",
  "skills",
  "keyBindings",
];

function invalid(field) {
  throw profileError(
    "invalid-profile-edit",
    `Invalid character edit: ${field}`,
  );
}

/** Check descriptors before cloning: structuredClone otherwise drops unknown fields. */
function snapshotPatch(patch, profile, items) {
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
  applyDevelopmentPatch({ ...profile }, patch, items);
  return structuredClone(patch);
}

function applyDevelopmentPatch(profile, patch, items) {
  Object.assign(profile, patch);
  recalculateVitals(profile, items);
  // Explicit invalid GM vitals must be rejected, not silently clamped by gear recomposition.
  if (Object.hasOwn(patch, "hp")) profile.hp = patch.hp;
  if (Object.hasOwn(patch, "mp")) profile.mp = patch.mp;
  validateProfile(profile);
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

function isLearnedJobSkill(skill, learned, books, now) {
  return Boolean(
    skill &&
    books.includes(skill.bookId) &&
    learned?.level &&
    (learned.expiresAt === null || learned.expiresAt > now),
  );
}

/** A development binding patch has the same learned ownership/native carry boundary.
 * Runtime capability is deliberately separate: a learned record never creates a controller.
 */
function validateDevelopmentBindings(profile, catalog) {
  const books = skillBooks(profile.job);
  const now = Date.now();
  for (let index = 0; index < KEY_COUNT; index++) {
    const binding = profile.keyBindings.keys[index];
    if (binding.type !== 1) continue;
    const skill = catalog.ui.skills[binding.id];
    const learned = profile.skills[binding.id];
    const family = Math.trunc(binding.id / 1000) % 10;
    if (!isAssignableKey(index) || index === 54) invalid(`skill key ${index}`);
    if (!isLearnedJobSkill(skill, learned, books, now)) {
      invalid(
        `binding ${binding.id} requires a learned, unexpired skill in this job`,
      );
    }
    if (family === 0 || family === 9) {
      invalid(`skill ${binding.id} cannot be carried to a key`);
    }
  }
}

/** Separate durable AP authority and explicit local GM development edits. */
export class CharacterDevelopment {
  constructor(store, catalog, options = {}) {
    this.store = store;
    this.catalog = catalog;
    this.jobs = catalogJobs(catalog);
    this.random = options.random ?? Math.random;
    this.isBusy = options.isBusy ?? (() => false);
    this.hooks = options;
    this.pending = false;
    if (
      typeof this.random !== "function" ||
      typeof this.isBusy !== "function"
    ) {
      invalid("AP hooks");
    }
    if (!catalog.ui.skills || typeof catalog.ui.skills !== "object") {
      invalid("catalog skills");
    }
  }

  /** Snapshot a complete or partial patch, then await its all-or-nothing durable commit. */
  async edit(patch, { jobPreset = null } = {}) {
    if (this.pending || this.store.profileTransactionPending || this.isBusy()) {
      throw profileError("save-busy", "The character is busy.");
    }
    const snapshot = snapshotPatch(
      patch,
      this.store.profile,
      this.catalog.ui.items,
    );
    if (jobPreset !== null) return this.editPreset(snapshot, jobPreset);
    await this.store.commitProfile((draft) => {
      applyDevelopmentPatch(draft, snapshot, this.catalog.ui.items);
      validateDevelopment(draft, this.catalog, this.jobs);
      if (Object.hasOwn(snapshot, "keyBindings")) {
        validateDevelopmentBindings(draft, this.catalog);
      }
    });
  }

  /** Preview and artwork must succeed before the isolated full-profile commit is admitted. */
  async editPreset(patch, job) {
    if (
      !Number.isSafeInteger(job) ||
      patch.job !== job ||
      !this.jobs.has(job)
    ) {
      invalid("preset job");
    }
    for (const name of [
      "isCurrent",
      "prepareAppearance",
      "publishAppearance",
      "releaseAppearance",
    ]) {
      if (typeof this.hooks[name] !== "function") {
        invalid(`preset ${name} hook`);
      }
    }
    const before = JSON.stringify(this.store.profile);
    const candidate = structuredClone(this.store.profile);
    applyDevelopmentPatch(candidate, patch, this.catalog.ui.items);
    applyJobPresetLoadout(candidate, this.catalog.ui, job);
    validateProfile(candidate, this.catalog.ui.items);
    validateDevelopment(candidate, this.catalog, this.jobs);
    validateDevelopmentBindings(candidate, this.catalog);
    this.pending = true;
    let prepared = null;
    let committed = false;
    try {
      prepared = await this.hooks.prepareAppearance(candidate);
      if (!prepared) {
        throw profileError(
          "appearance-unavailable",
          "Preset artwork preparation was cancelled.",
        );
      }
      this.admitPresetCommit(before);
      await this.store.commitProfile((draft) => {
        this.admitPresetCommit(before);
        Object.assign(draft, candidate);
      });
      committed = true;
      this.hooks.publishAppearance(prepared);
    } finally {
      if (prepared && !committed) this.hooks.releaseAppearance(prepared);
      this.pending = false;
    }
  }

  admitPresetCommit(before) {
    if (!this.hooks.isCurrent() || this.isBusy()) {
      throw profileError(
        "field-cancelled",
        "The preset's field ownership changed.",
      );
    }
    if (JSON.stringify(this.store.profile) !== before) {
      throw profileError(
        "profile-changed",
        "Your character changed while preparing the preset. Stage it again.",
      );
    }
  }

  /** Read-only UI admission; never samples RNG, mutates state or starts a save.
   * A ready HP/MP button still requires the distinct native warning confirmation.
   */
  apAdmission(target) {
    try {
      if (this.store.profileTransactionPending || this.isBusy()) {
        throw profileError("save-busy", "The character is busy.");
      }
      const profile = this.store.profile;
      admitAp(profile, target, true, this.jobs);
      if (target === "hp") hpGrowth(profile, this.catalog);
      if (target === "mp") mpGrowth(profile, this.catalog);
      const vital = target === "hp" || target === "mp";
      return {
        ok: true,
        code: "ap-ready",
        target,
        confirmationRequired: vital,
        cap: vital ? AP_POLICY.vitalMaximum : AP_POLICY.statMaximum,
        authority: AP_POLICY.authority,
      };
    } catch (error) {
      return {
        ok: false,
        code: error.code ?? "ap-unavailable",
        reason: error.message,
        confirmationRequired: false,
      };
    }
  }

  /** The renderer supplies only a target and native-warning acceptance, never a gain. */
  async spendAp(target, { confirmed = false } = {}) {
    try {
      if (typeof confirmed !== "boolean") {
        throw profileError(
          "invalid-confirmation",
          "AP confirmation must be boolean.",
        );
      }
      if (this.store.profileTransactionPending || this.isBusy()) {
        throw profileError("save-busy", "The character is busy.");
      }
      validateProfile(this.store.profile);
      admitAp(this.store.profile, target, confirmed, this.jobs);
      let gain = 0;
      await this.store.commitProfile((draft) => {
        if (this.isBusy()) {
          throw profileError("save-busy", "The character is busy.");
        }
        admitAp(draft, target, confirmed, this.jobs);
        gain = apGain(draft, target, this.catalog, { random: this.random });
        draft[apField(target)] += gain;
        if (target === "hp" || target === "mp") {
          recalculateVitals(draft, this.catalog.ui.items);
        }
        draft.remainingAp--;
        validateProfile(draft);
      });
      return {
        ok: true,
        code: "ap-assigned",
        target,
        gain,
        authority: AP_POLICY.authority,
      };
    } catch (error) {
      return {
        ok: false,
        code: error.code ?? "ap-failed",
        reason: error.message,
        confirmationRequired: error.code === "ap-confirmation-required",
      };
    }
  }
}
