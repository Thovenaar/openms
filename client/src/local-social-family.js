import { SOCIAL_LIMITS } from "./profile-social.js";
import {
  admitContact,
  invite,
  memberIds,
  socialRequire,
  socialText,
} from "./local-social-context.js";

/** Cosmic FamilyEntitlement.java: numeric order, costs, rates and descriptions.
 * Rates execute as explicit offline authority; Cosmic FamilyUseHandler129 itself is incomplete. */
export const FAMILY_ENTITLEMENTS = Object.freeze([
  { id: 0, name: "Family Reunion", cost: 300, kind: "travel" },
  { id: 1, name: "Summon Family", cost: 500, kind: "summon" },
  {
    id: 2,
    name: "My Drop Rate 1.5x (15 min)",
    cost: 700,
    kind: "drop",
    rate: 1.5,
    minutes: 15,
  },
  {
    id: 3,
    name: "My EXP 1.5x (15 min)",
    cost: 800,
    kind: "exp",
    rate: 1.5,
    minutes: 15,
  },
  {
    id: 4,
    name: "Family Bonding (30 min)",
    cost: 1000,
    kind: "bonding",
    rate: 2,
    minutes: 30,
  },
  {
    id: 5,
    name: "My Drop Rate 2x (15 min)",
    cost: 1200,
    kind: "drop",
    rate: 2,
    minutes: 15,
  },
  {
    id: 6,
    name: "My EXP 2x (15 min)",
    cost: 1500,
    kind: "exp",
    rate: 2,
    minutes: 15,
  },
  {
    id: 7,
    name: "My Drop Rate 2x (30 min)",
    cost: 2000,
    kind: "drop",
    rate: 2,
    minutes: 30,
  },
  {
    id: 8,
    name: "My EXP 2x (30 min)",
    cost: 2500,
    kind: "exp",
    rate: 2,
    minutes: 30,
  },
  {
    id: 9,
    name: "My Party Drop Rate2x (30 min)",
    cost: 4000,
    kind: "drop",
    rate: 2,
    minutes: 30,
    party: true,
  },
  {
    id: 10,
    name: "My Party EXP2x (30 min)",
    cost: 5000,
    kind: "exp",
    rate: 2,
    minutes: 30,
    party: true,
  },
]);
for (const entitlement of FAMILY_ENTITLEMENTS) Object.freeze(entitlement);

/** Local calendar-day identity follows Cosmic FamilyDailyResetTask, not rolling24-hour use. */
export function familyDay(now) {
  const date = new Date(now);
  return (
    date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
  );
}

function familyMember(id, parentId = null) {
  return {
    id,
    parentId,
    reputation: 0,
    reputationDay: 0,
    todayReputation: 0,
    totalReputation: 0,
    used: [],
  };
}

function changeReputation(member, amount, now, earned = false) {
  const day = familyDay(now);
  if (member.reputationDay !== day) {
    member.reputationDay = day;
    member.todayReputation = 0;
  }
  member.reputation += amount;
  member.todayReputation += amount;
  if (earned && amount > 0) member.totalReputation += amount;
}

function familyInvite(context) {
  const self = context.get(),
    target = context.target();
  admitFamily(context, context.actorId, context.payload.targetId);
  socialRequire(
    target.social.family?.id !== self.social.family?.id || !self.social.family,
    "same-family",
    "These characters already belong to the same family.",
  );
  invite(context, "family", context.payload.targetId, self.social.family);
}

function admitFamily(context, seniorId, juniorId) {
  const senior = context.get(seniorId),
    junior = context.get(juniorId),
    family = senior.social.family;
  socialRequire(
    seniorId !== juniorId && senior.location.mapId === junior.location.mapId,
    "family-map",
    "Both family members must be together in the same map.",
  );
  socialRequire(
    junior.level > 10 && Math.abs(senior.level - junior.level) <= 20,
    "family-level",
    "A junior must be above level10 and within20 levels of the senior.",
  );
  socialRequire(
    !junior.social.family || junior.social.family.leaderId === juniorId,
    "family-root",
    "Only an independent family leader can join another family.",
  );
  socialRequire(
    !family ||
      family.members.filter((member) => member.parentId === seniorId).length <
        2,
    "family-juniors",
    "A senior can have at most two direct juniors.",
  );
}

export function acceptFamily(context, request) {
  admitContact(context, request.fromId);
  admitFamily(context, request.fromId, context.actorId);
  const senior = context.get(request.fromId),
    self = context.get();
  const family = senior.social.family ?? {
    id: context.uid(),
    leaderId: request.fromId,
    members: [familyMember(request.fromId)],
    precept: "",
  };
  const target = self.social.family;
  socialRequire(
    !target || target.id !== family.id,
    "family-cycle",
    "Members of the same family cannot form a new parent link.",
  );
  const newcomers = target ? target.members : [familyMember(context.actorId)];
  socialRequire(
    family.members.length + newcomers.length <= SOCIAL_LIMITS.members,
    "family-capacity",
    "The local family participant limit was reached.",
  );
  newcomers.find((entry) => entry.id === context.actorId).parentId =
    request.fromId;
  family.members.push(...newcomers);
  context.mirror("family", family);
}

function descendants(family, rootId) {
  const found = new Set([rootId]);
  for (let pass = 0; pass < family.members.length; pass++) {
    let changed = false;
    for (const member of family.members) {
      if (found.has(member.parentId) && !found.has(member.id)) {
        found.add(member.id);
        changed = true;
      }
    }
    if (!changed) return found;
  }
  socialRequire(
    false,
    "family-cycle",
    "A family cycle prevents this operation.",
  );
}

function familySever(context) {
  const family = context.group("family"),
    targetId = context.payload.targetId ?? context.actorId;
  const target = family.members.find((member) => member.id === targetId);
  socialRequire(
    target?.parentId &&
      (targetId === context.actorId || target.parentId === context.actorId),
    "family-link",
    "Only your senior or direct junior link can be severed.",
  );
  const senior = family.members.find((entry) => entry.id === target.parentId);
  const difference = Math.abs(
    context.get().level - context.get(senior.id).level,
  );
  const cost = 2500 * difference + difference * difference;
  socialRequire(
    context.get().meso >= cost,
    "insufficient-mesos",
    `Severing this family link requires ${cost} mesos.`,
  );
  context.get().meso -= cost;
  const level = context.get(targetId).level,
    repCost = (Math.floor(level / 20) + 10) * level * 2;
  changeReputation(senior, -repCost, context.now);
  const grandparent = family.members.find(
    (entry) => entry.id === senior.parentId,
  );
  if (grandparent) {
    changeReputation(grandparent, -Math.floor(repCost / 2), context.now);
  }
  const splitIds = descendants(family, targetId),
    previous = memberIds(family);
  const split = {
    id: context.uid(),
    leaderId: targetId,
    members: family.members.filter((member) => splitIds.has(member.id)),
    precept: "",
  };
  split.members.find((member) => member.id === targetId).parentId = null;
  family.members = family.members.filter((member) => !splitIds.has(member.id));
  context.mirror("family", family, previous);
  context.mirror("family", split);
}

function familyPrecept(context) {
  const family = context.group("family");
  context.leader(family);
  family.precept = socialText(
    context.payload.text,
    SOCIAL_LIMITS.precept,
    "Family precept",
    0,
  );
  context.mirror("family", family);
}

function admitEntitlement(context) {
  const family = context.group("family"),
    member = family.members.find((entry) => entry.id === context.actorId);
  const entitlement = FAMILY_ENTITLEMENTS.find(
    (entry) => entry.id === context.payload.entitlement,
  );
  socialRequire(
    entitlement,
    "entitlement-missing",
    "Select an original family entitlement.",
  );
  socialRequire(
    member.reputation >= entitlement.cost,
    "family-reputation",
    "You do not have enough family reputation.",
  );
  const used = member.used.find((entry) => entry.id === entitlement.id);
  socialRequire(
    !used || used.day !== familyDay(context.now),
    "entitlement-used",
    "This entitlement has already been used today.",
  );
  return { family, member, entitlement };
}

function consumeEntitlement(context, state) {
  changeReputation(state.member, -state.entitlement.cost, context.now);
  state.member.used = state.member.used.filter(
    (entry) => entry.id !== state.entitlement.id,
  );
  state.member.used.push({
    id: state.entitlement.id,
    day: familyDay(context.now),
  });
  context.mirror("family", state.family);
}

function applyRate(profile, kind, entitlement, now) {
  profile.social.familyEffects = profile.social.familyEffects.filter(
    (effect) => effect.kind !== kind && effect.expiresAt > now,
  );
  profile.social.familyEffects.push({
    kind,
    rate: entitlement.rate,
    expiresAt: now + entitlement.minutes * 60000,
  });
}

function rateTargets(context, state) {
  if (state.entitlement.kind === "bonding") {
    const ids = descendants(state.family, context.actorId);
    ids.delete(context.actorId);
    socialRequire(
      ids.size >= 6,
      "family-bonding",
      "Family Bonding requires at least six loaded descendants.",
    );
    ids.add(context.actorId);
    return [...ids];
  }
  if (!state.entitlement.party) return [context.actorId];
  const party = context.group("party");
  return party.members.filter(
    (id) => context.get(id).location.mapId === context.get().location.mapId,
  );
}

function familyEntitlement(context) {
  const state = admitEntitlement(context),
    kind = state.entitlement.kind;
  if (kind === "travel" || kind === "summon") {
    return travelEntitlement(context, state);
  }
  socialRequire(
    context.capabilities.familyRates === true,
    "family-rates-unavailable",
    "The active gameplay authority has not attached family EXP/drop-rate consumers.",
  );
  const targets = rateTargets(context, state);
  for (const id of targets) {
    const profile = context.get(id);
    if (kind === "bonding") {
      applyRate(profile, "exp", state.entitlement, context.now);
      applyRate(profile, "drop", state.entitlement, context.now);
    } else applyRate(profile, kind, state.entitlement, context.now);
  }
  consumeEntitlement(context, state);
}

function travelEntitlement(context, state) {
  const targetId = context.payload.targetId;
  socialRequire(
    targetId !== context.actorId &&
      state.family.members.some((entry) => entry.id === targetId),
    "family-member",
    "Choose another member of your family.",
  );
  if (state.entitlement.kind === "summon") {
    socialRequire(
      context.travel?.actorId === context.actorId &&
        context.travel?.targetId === targetId,
      "family-travel-unavailable",
      "Original field-limit and portal-zero validation is required before requesting a family summon.",
    );
    invite(context, "family-summon", targetId, state.family);
  } else {
    socialRequire(
      context.travel?.actorId === context.actorId &&
        context.travel?.targetId === targetId,
      "family-travel-unavailable",
      "Original field-limit checks and portal-zero scene preparation are required before reunion travel.",
    );
    context.get().location = structuredClone(context.travel.location);
  }
  consumeEntitlement(context, state);
}

export function acceptSummon(context, request) {
  const family = context.group("family");
  socialRequire(
    family.id === request.groupId &&
      family.members.some((entry) => entry.id === request.fromId),
    "family-member",
    "The summoning character is no longer in this family.",
  );
  socialRequire(
    context.travel?.actorId === context.actorId &&
      context.travel?.targetId === request.fromId,
    "family-travel-unavailable",
    "Original field-limit checks and portal-zero scene preparation are required before accepting a summon.",
  );
  context.get().location = structuredClone(context.travel.location);
}

/** Trusted producer boundary only; never exposed through execute's peer action enum. */
export function applyFamilyProgress(context, event) {
  const family = context.get().social.family;
  context.result.applied = false;
  if (!family) return;
  const member = family.members.find((entry) => entry.id === context.actorId);
  const senior = family.members.find((entry) => entry.id === member.parentId);
  if (!senior) return;
  const gains = { kill: 4, boss: 20, level: 200 };
  const base = gains[event.kind];
  socialRequire(
    base !== undefined,
    "family-progress",
    "Unknown trusted family progress event.",
  );
  if (event.kind !== "level") {
    socialRequire(
      Number.isFinite(event.maxHp) && event.maxHp > 0,
      "family-progress",
      "A family kill award requires the defeated monster's authored maximumHP.",
    );
    if (event.maxHp <= 1) return;
  }
  const gain =
    context.get(senior.id).level < context.get().level
      ? Math.floor(base / 2)
      : base;
  changeReputation(senior, gain, context.now, true);
  const grandparent = family.members.find(
    (entry) => entry.id === senior.parentId,
  );
  if (grandparent) changeReputation(grandparent, gain, context.now, true);
  context.mirror("family", family);
  context.result.applied = true;
}

export function familyRate(profile, kind, now = Date.now()) {
  const effect = profile.social.familyEffects.find(
    (entry) => entry.kind === kind && entry.expiresAt > now,
  );
  return effect?.rate ?? 1;
}

export const FAMILY_ACTIONS = Object.freeze({
  "family.invite": familyInvite,
  "family.sever": familySever,
  "family.precept": familyPrecept,
  "family.entitlement": familyEntitlement,
});
