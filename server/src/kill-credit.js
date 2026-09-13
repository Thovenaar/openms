import { familyProgressIds, familyRate } from "./social-family.js";
import { sameParty } from "./party-skills.js";

const MAX_CONTRIBUTORS = 128;
const SHARE_X = 1200;
const SHARE_Y = 600;
const LEVEL_MARGIN = 20;

/** Actual HP removed, before onKill; misses, immunity and overkill contribute nothing. */
export function recordKillDamage(actor, mob, amount) {
  if (!(amount > 0)) return;
  const generation = mob.deaths - (mob.alive ? 0 : 1);
  if (mob.creditGeneration !== generation) {
    mob.creditGeneration = generation;
    mob.damageCredit = new Map();
  }
  const prior = mob.damageCredit.get(actor.id);
  if (!prior && mob.damageCredit.size >= MAX_CONTRIBUTORS) {
    throw new Error("Monster contributor capacity exceeded");
  }
  if (prior) prior.damage += amount;
  else mob.damageCredit.set(actor.id, { actor, damage: amount });
}

function eligible(world, actor, field, mob) {
  return (
    world.actors.get(actor.id) === actor &&
    actor.field === field &&
    actor.state === "active" &&
    !actor.retiring &&
    !actor.deliveryError &&
    actor.profile.hp > 0 &&
    Math.abs(actor.simulation.x - mob.x) <= SHARE_X &&
    Math.abs(actor.simulation.y - mob.y) <= SHARE_Y
  );
}

/** OpenMS: damage earns a group pool, split equally among nearby eligible members. */
export function planKillCredit(world, killer, mob) {
  const credits = creditEntries(killer, mob);
  const total = credits.reduce((sum, entry) => sum + entry.damage, 0);
  const groups = new Map();
  const ordered = credits.toSorted(
    (a, b) => b.damage - a.damage || a.actor.id.localeCompare(b.actor.id),
  );
  let lootOwner = killer;
  for (const entry of ordered) {
    if (!eligible(world, entry.actor, killer.field, mob)) continue;
    if (!groups.size) lootOwner = entry.actor;
    const key = entry.actor.profile.social.party?.id ?? entry.actor.id;
    let group = groups.get(key);
    if (!group) {
      group = { actor: entry.actor, damage: 0, contributors: [], members: [] };
      groups.set(key, group);
    }
    group.damage += entry.damage;
    group.contributors.push(entry.actor);
  }
  const rewards = [];
  for (const group of groups.values()) {
    selectMembers(world, killer.field, mob, group);
    const base = Math.floor(
      ((mob.template.info.exp ?? 0) * group.damage) / total,
    );
    const each = Math.floor(base / group.members.length);
    for (const [index, actor] of group.members.entries()) {
      const share = each + (index < base % group.members.length ? 1 : 0);
      rewards.push({
        actor,
        amount: adjustedExperience(world, actor, share, mob.showdown ?? 0),
      });
    }
  }
  return { rewards, lootOwner, field: killer.field };
}

function selectMembers(world, field, mob, group) {
  const highest = Math.max(
    ...group.contributors.map((actor) => actor.profile.level),
  );
  const minimum = Math.max(
    1,
    Math.min(highest, mob.template.info.level ?? highest) - LEVEL_MARGIN,
  );
  for (const actor of field.characters.values()) {
    if (!eligible(world, actor, field, mob)) continue;
    if (
      group.contributors.includes(actor) ||
      (sameParty(group.actor, actor) && actor.profile.level >= minimum)
    ) {
      group.members.push(actor);
    }
  }
  group.members.sort((a, b) => a.id.localeCompare(b.id));
}

function adjustedExperience(world, actor, share, showdown) {
  const holySymbol = actor.skills?.derived().holySymbol ?? 0;
  const curse = actor.skillField?.diseases.has(124) ? 0.5 : 1;
  return Math.trunc(
    share *
      familyRate(actor.profile, "exp", world.now) *
      (1 + holySymbol / 500) *
      (1 + showdown / 100) *
      curse,
  );
}

/** Include every affected family before acquiring participant locks. */
export function killCreditIds(plan) {
  const ids = new Set();
  for (const { actor } of plan.rewards) {
    ids.add(actor.id);
    for (const id of familyProgressIds(actor.profile)) ids.add(id);
  }
  return [...ids];
}

export function assignKillLoot(plan, drops) {
  const owner = plan.lootOwner;
  const members = plan.rewards
    .map(({ actor }) => actor)
    .filter((actor) => actor === owner || sameParty(owner, actor))
    .map((actor) => actor.id);
  for (const drop of drops.requests) {
    drop.ownerId = owner.id;
    drop.ownerPartyId = owner.profile.social.party?.id ?? null;
    drop.ownerMemberIds = members;
  }
}

function creditEntries(killer, mob) {
  const credits = mob.damageCredit?.size
    ? [...mob.damageCredit.values()]
    : [{ actor: killer, damage: mob.maxHP }];
  return credits;
}
