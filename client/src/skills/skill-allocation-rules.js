import { requiresSkillMastery, skillBooks } from "../ui/ui-skill-books.js";

// 00765e9e sums all four original beginner triples, even after a job-family edit.
const BEGINNER_ROOTS = [0, 10000000, 20000000, 20010000];

// Full/Over Swing select original hidden attacks at the learned passive rank.
const SWING_RANKS = Object.freeze({
  21110007: [21000002, 21110002],
  21110008: [21100001, 21110002],
  21120009: [21000002, 21120002],
  21120010: [21100001, 21120002],
});

export function rankOf(profile, id, now) {
  const record = profile.skills[id];
  return record && (record.expiresAt === null || record.expiresAt > now)
    ? record.level
    : 0;
}

export function profileSkillAllowed(skill, books) {
  return (
    !!skill &&
    books.includes(skill.bookId) &&
    !skill.flags.disabled &&
    !skill.flags.timeLimited &&
    !(skill.bookId >= 800 && skill.bookId < 1000)
  );
}

export function learnedProfileRank(profile, id, now) {
  const parents = SWING_RANKS[id];
  if (!parents) return rankOf(profile, id, now);
  return rankOf(profile, parents[0], now) > 0
    ? rankOf(profile, parents[1], now)
    : 0;
}

/** Pure durable-profile selection; transient event-field authority remains in SkillSystem. */
export function profileSkillLevel(catalog, profile, id, now) {
  const skill = catalog[id];
  if (!profileSkillAllowed(skill, skillBooks(profile.job))) return 0;
  return learnedProfileRank(profile, id, now);
}
export function skillPointPool(book) {
  return book >= 2210 && book <= 2218 ? book - 2209 : 0;
}

export function allocationAuthorityError(skill) {
  if (
    skill.flags.disabled ||
    skill.flags.invisible ||
    skill.flags.timeLimited ||
    (skill.bookId >= 800 && skill.bookId < 1000)
  ) {
    return "Skill requires original hidden/event/expiration authority";
  }
  return skill.allocationCost.kind === "unknown"
    ? "Original allocation-cost consumer is unavailable"
    : null;
}

export function allocationRankError(profile, skill, now) {
  const current = profile.skills[skill.id];
  const rank = rankOf(profile, skill.id, now);
  const cap = requiresSkillMastery(skill.bookId)
    ? Math.min(skill.maxLevel, current?.masterLevel ?? 0)
    : skill.maxLevel;
  if (rank >= cap) return "Skill max/master rank reached";
  if (!Object.hasOwn(skill.levels, rank + 1)) {
    return "Original next skill rank is unavailable";
  }
  if (current?.expiresAt !== null && current?.expiresAt !== undefined) {
    return "Expiring skill allocation requires expiration authority";
  }
  if (skill.properties.reqLev && profile.level < skill.properties.reqLev) {
    return "Character level requirement not met";
  }
  return null;
}

export function allocationPoints(profile, skill, now) {
  if (skill.allocationCost.kind !== "beginner-entitlement") {
    return profile.remainingSp[skillPointPool(skill.bookId)];
  }
  let used = 0;
  for (const root of BEGINNER_ROOTS) {
    for (let index = 0; index < 3; index++) {
      used += rankOf(profile, root + 1000 + index, now);
    }
  }
  return Math.min(profile.level - 1, 6) - used;
}

/** Shared durable allocation admission; adapters additionally admit runtime resources. */
export function allocationError(profile, skill, now) {
  if (!skill || !skillBooks(profile.job).includes(skill.bookId)) {
    return "Skill is outside the current job books";
  }
  const eligibility = allocationAuthorityError(skill);
  if (eligibility) return eligibility;
  const rankError = allocationRankError(profile, skill, now);
  if (rankError) return rankError;
  for (const req of skill.prerequisites) {
    if (rankOf(profile, req.skillId, now) < req.rank) {
      return `Requires skill ${req.skillId} rank ${req.rank}`;
    }
  }
  return allocationPoints(profile, skill, now) > 0
    ? null
    : "No skill points available";
}

/** Mutates a detached profile only, after shared and adapter admissions. */
export function allocateSkill(profile, skill) {
  const current = profile.skills[skill.id];
  profile.skills[skill.id] = {
    level: (current?.level ?? 0) + 1,
    masterLevel: current?.masterLevel ?? 0,
    expiresAt: null,
  };
  if (skill.allocationCost.kind === "sp") {
    profile.remainingSp[skillPointPool(skill.bookId)]--;
  }
}
