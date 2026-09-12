import { profileError } from "../profile/profile-validation.js";

import { requiresSkillMastery, skillBooks } from "../ui/ui-skill-books.js";

const MAX_JOB_BOOKS = 1024;
const AP_TARGETS = ["hp", "mp", "str", "dex", "int", "luk"];
const PRIMARY_STATS = ["str", "dex", "int", "luk"];

/** Cosmic SERVER-reference policy, not original client growth formulas.
 * AssignAPProcessor.calcHpChange/calcMpChange; config.yaml randomize=true, MAX_AP=32767.
 * The browser persists the visible 30000 vital cap (no separate hidden server max).
 */
export const AP_POLICY = Object.freeze({
  authority: "Cosmic-server-reference/local-offline-policy",
  statMinimum: 4,
  statMaximum: 32767,
  vitalMaximum: 30000,
  hpMinimum: 50,
  mpMinimum: 5,
  warningAboveLevel: 19,
});

function invalid(field) {
  throw profileError(
    "invalid-profile-edit",
    `Invalid character edit: ${field}`,
  );
}

/** Numeric original Skill IMG identities, including books with no retained skill rows. */
export function catalogJobs(catalog) {
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

export function validateLearnedSkill(id, record, catalog) {
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

export function apField(target) {
  return target === "hp" ? "baseMaxHP" : target === "mp" ? "baseMaxMP" : target;
}

function admitApProfile(profile, jobs) {
  if (!profile) {
    throw profileError("profile-unavailable", "No local character is loaded.");
  }
  if (profile.hp <= 0) {
    throw profileError("character-dead", "You cannot assign AP while dead.");
  }
  if (!jobs.has(profile.job)) {
    throw profileError("unsupported-job", "Original job data is unavailable.");
  }
  if (profile.remainingAp < 1) {
    throw profileError("insufficient-ap", "You do not have any AP to assign.");
  }
}

function admitPrimaryApRange(profile) {
  for (const stat of PRIMARY_STATS) {
    if (
      profile[stat] < AP_POLICY.statMinimum ||
      profile[stat] > AP_POLICY.statMaximum
    ) {
      throw profileError(
        "ap-stat-range",
        "Primary stats are outside the Cosmic AP assignment range.",
      );
    }
  }
}

export function admitAp(profile, target, confirmed, jobs) {
  if (!AP_TARGETS.includes(target)) {
    throw profileError("invalid-ap-target", "Unknown AP target.");
  }
  admitApProfile(profile, jobs);
  const vital = target === "hp" || target === "mp";
  // 00a239b7's outer sender branch excludes HP/MP through level19 entirely.
  if (vital && profile.level <= AP_POLICY.warningAboveLevel) {
    throw profileError(
      "ap-level-required",
      "HP/MP AP assignment becomes available above level 19.",
    );
  }
  if (
    profile[apField(target)] >=
    (vital ? AP_POLICY.vitalMaximum : AP_POLICY.statMaximum)
  ) {
    throw profileError("ap-cap", "This stat has reached the offline AP cap.");
  }
  if (!vital) admitPrimaryApRange(profile);
  // Original Stat request 00a239b7, warning string 0x148b, Yes result6.
  if (vital && profile.level > AP_POLICY.warningAboveLevel && !confirmed) {
    throw profileError(
      "ap-confirmation-required",
      "Confirm the native HP/MP AP warning before assigning this point.",
    );
  }
}

function growthSkillBonus(profile, catalog, id, now) {
  const record = profile.skills[id];
  if (
    !record?.level ||
    (record.expiresAt !== null && record.expiresAt <= now)
  ) {
    return 0;
  }
  validateLearnedSkill(String(id), record, catalog);
  if (!skillBooks(profile.job).includes(catalog.ui.skills[id].bookId)) return 0;
  const bonus = catalog.ui.skills[id].levels?.[record.level]?.y;
  if (!Number.isSafeInteger(bonus) || bonus < 0) {
    throw profileError(
      "ap-growth-unavailable",
      `Original AP growth skill ${id} rank ${record.level} is unavailable.`,
    );
  }
  return bonus;
}

/** Cosmic Job.isA(first-job) is an integer-hundreds branch comparison. */
export function hpGrowth(profile, catalog, now = Date.now()) {
  const branch = Math.floor(profile.job / 100);
  if (branch === 1 || branch === 11) {
    return [
      18,
      22,
      growthSkillBonus(
        profile,
        catalog,
        branch === 11 ? 11000000 : 1000001,
        now,
      ),
    ];
  }
  if (branch === 21) return [26, 30, 0];
  if (branch === 2 || branch === 12) return [5, 9, 0];
  if ([3, 4, 13, 14].includes(branch)) return [14, 18, 0];
  if (branch === 5 || branch === 15) {
    return [
      16,
      20,
      growthSkillBonus(
        profile,
        catalog,
        branch === 5 ? 5100000 : 15100000,
        now,
      ),
    ];
  }
  return [8, 12, 0];
}

export function mpGrowth(profile, catalog, now = Date.now()) {
  const branch = Math.floor(profile.job / 100);
  const intellect = Math.floor(profile.int / 10);
  if ([1, 11, 21].includes(branch)) return [2, 4, intellect];
  if (branch === 2 || branch === 12) {
    return [
      12,
      16,
      Math.floor(profile.int / 20) +
        growthSkillBonus(
          profile,
          catalog,
          branch === 12 ? 12000000 : 2000001,
          now,
        ),
    ];
  }
  if ([3, 4, 13, 14].includes(branch)) return [6, 8, intellect];
  if (branch === 5 || branch === 15) return [7, 9, intellect];
  return [4, 6, intellect];
}

/** The options supply authority-owned randomness and the growth-skill clock in milliseconds. */
export function apGain(profile, target, catalog, { random, now = Date.now() }) {
  if (target !== "hp" && target !== "mp") return 1;
  const [minimum, maximum, bonus] =
    target === "hp"
      ? hpGrowth(profile, catalog, now)
      : mpGrowth(profile, catalog, now);
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw profileError(
      "invalid-random-source",
      "AP random source must return a value in [0,1).",
    );
  }
  const current = profile[apField(target)];
  const gain = minimum + Math.floor(sample * (maximum - minimum + 1)) + bonus;
  // AbstractCharacterObject.changeStatPool normalizes newly assigned maxima.
  const floor = target === "hp" ? AP_POLICY.hpMinimum : AP_POLICY.mpMinimum;
  return (
    Math.min(AP_POLICY.vitalMaximum, Math.max(floor, current + gain)) - current
  );
}
