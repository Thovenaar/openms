import { domainInvalid } from "./profile-domain-validation.js";

const GROUPS = Object.freeze([
  "party",
  "guild",
  "alliance",
  "family",
  "messenger",
]);

function ids(group) {
  return group
    ? group.members.map((member) =>
        typeof member === "string" ? member : member.id,
      )
    : [];
}

/** Only changing a mirrored domain acquires its complete old/new participant cohort.
 * Ordinary inventory, vitals, options and friend-group labels retain single-store semantics. */
export function validateSocialCommit(characterIds, originals, drafts) {
  const positions = new Map(characterIds.map((id, index) => [id, index]));
  for (let index = 0; index < characterIds.length; index++) {
    const before = originals[index].social,
      after = drafts[index].social;
    for (const kind of GROUPS) {
      if (JSON.stringify(before[kind]) === JSON.stringify(after[kind])) {
        continue;
      }
      for (const memberId of new Set([
        ...ids(before[kind]),
        ...ids(after[kind]),
      ])) {
        if (!positions.has(memberId)) {
          domainInvalid(`atomic ${kind} participant cohort`);
        }
      }
      if (after[kind]) validateMirrors(after[kind], kind, positions, drafts);
    }
    validateInvitationChanges(
      before.invitations,
      after.invitations,
      positions,
      drafts,
    );
    validateFriendChanges(before.friends, after.friends, {
      positions,
      drafts,
      id: characterIds[index],
    });
  }
}

function validateMirrors(group, kind, positions, drafts) {
  const encoded = JSON.stringify(group);
  for (const id of ids(group)) {
    if (JSON.stringify(drafts[positions.get(id)].social[kind]) !== encoded) {
      domainInvalid(`atomic ${kind} mirrors`);
    }
  }
}

function validateInvitationChanges(before, after, positions, drafts) {
  const old = new Map(before.map((entry) => [entry.id, entry]));
  const next = new Map(after.map((entry) => [entry.id, entry]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    if (JSON.stringify(old.get(id)) === JSON.stringify(next.get(id))) continue;
    const entry = next.get(id) ?? old.get(id);
    for (const participant of [entry.fromId, entry.toId]) {
      if (!positions.has(participant)) {
        domainInvalid("atomic invitation participants");
      }
      const copy = drafts[positions.get(participant)].social.invitations.find(
        (candidate) => candidate.id === id,
      );
      if (JSON.stringify(copy) !== JSON.stringify(next.get(id))) {
        domainInvalid("atomic invitation mirrors");
      }
    }
  }
}

function validateFriendChanges(before, after, context) {
  const old = new Set(before.map((entry) => entry.id)),
    next = new Set(after.map((entry) => entry.id));
  for (const id of new Set([...old, ...next])) {
    if (old.has(id) === next.has(id)) continue;
    if (!context.positions.has(id)) domainInvalid("atomic buddy participants");
    const peer = context.drafts[context.positions.get(id)].social.friends;
    if (peer.some((entry) => entry.id === context.id) !== next.has(id)) {
      domainInvalid("atomic buddy relation");
    }
  }
}

export function hasSocialLinks(social) {
  return Boolean(
    social &&
    (social.friends.length ||
      social.invitations.length ||
      GROUPS.some((kind) => social[kind])),
  );
}
