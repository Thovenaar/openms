import { profileError } from "../profile/profile-validation.js";
import { SOCIAL_LIMITS } from "../profile/profile-social.js";

export function socialRequire(condition, code, reason) {
  if (!condition) throw profileError(code, reason);
}

export function socialText(value, max, label, min = 1) {
  socialRequire(
    typeof value === "string" &&
      value.length >= min &&
      value.length <= max &&
      !/[^\u0020-\uffff]/.test(value),
    "invalid-text",
    `${label} must contain ${min}–${max} characters.`,
  );
  return value;
}

export function memberIds(group) {
  return group.members.map((member) =>
    typeof member === "string" ? member : member.id,
  );
}

/** Detached operation workspace; every read participant joins the same final CAS. */
export class SocialContext {
  constructor(profiles, actorId, payload, now) {
    this.profiles = profiles;
    this.actorId = actorId;
    this.payload = payload;
    this.now = now;
    this.touched = new Set();
    this.result = {};
    this.sequence = 0;
    this.allowed = null;
  }

  get(id = this.actorId) {
    socialRequire(
      !this.allowed || this.allowed.has(id),
      "social-conflict",
      "The operation's local participant set changed before commit.",
    );
    const profile = this.profiles.get(id);
    socialRequire(
      profile,
      "participant-missing",
      "The selected local character is not loaded.",
    );
    this.touched.add(id);
    return profile;
  }

  target() {
    socialRequire(
      this.payload.targetId !== this.actorId,
      "self-target",
      "Choose another local character.",
    );
    return this.get(this.payload.targetId);
  }

  uid() {
    // Request nonce stays stable across preflight and the synchronous draft transform.
    return `${this.payload.requestId}_${this.sequence++}`;
  }

  group(kind) {
    const group = this.get().social[kind];
    socialRequire(
      group && memberIds(group).includes(this.actorId),
      "not-member",
      `You are not a member of this ${kind}.`,
    );
    for (const id of memberIds(group)) {
      const other = this.get(id).social[kind];
      socialRequire(
        other && JSON.stringify(other) === JSON.stringify(group),
        "social-conflict",
        `The saved ${kind} participants disagree; no changes were made.`,
      );
    }
    return group;
  }

  leader(group) {
    socialRequire(
      group.leaderId === this.actorId,
      "leader-required",
      "Only the group leader can do that.",
    );
  }

  rank(group, maximum = 2) {
    const member = group.members.find((entry) => entry.id === this.actorId);
    socialRequire(
      member && member.rank <= maximum,
      "rank-required",
      "Your group rank cannot perform this action.",
    );
    return member.rank;
  }

  mirror(kind, group, previous = []) {
    const ids = new Set([...previous, ...(group ? memberIds(group) : [])]);
    socialRequire(
      ids.size <= SOCIAL_LIMITS.members,
      "participant-limit",
      "The local participant limit was reached.",
    );
    const remaining = new Set(group ? memberIds(group) : []);
    for (const id of ids) {
      this.get(id).social[kind] = remaining.has(id)
        ? structuredClone(group)
        : null;
    }
  }

  removeInvitations(predicate) {
    for (const [id, profile] of this.profiles) {
      if (!profile.social.invitations.some(predicate)) continue;
      this.get(id).social.invitations = profile.social.invitations.filter(
        (entry) => !predicate(entry),
      );
    }
  }
}

export function admitContact(context, targetId) {
  const self = context.get(),
    target = context.get(targetId);
  socialRequire(
    targetId !== context.actorId,
    "self-target",
    "Choose another local character.",
  );
  socialRequire(
    !self.social.blacklist.includes(targetId) &&
      !target.social.blacklist.includes(context.actorId),
    "blocked",
    "A blacklist prevents this request.",
  );
  return target;
}

const INVITE_OPTIONS = Object.freeze({
  friend: "allowFriend",
  party: "allowParty",
  guild: "allowGuildInvite",
  "guild-create": "allowGuildInvite",
  alliance: "allowAllianceInvite",
  "alliance-create": "allowAllianceInvite",
  family: "allowFamily",
  "family-summon": "allowFamily",
  messenger: "allowMessenger",
});

export function admitInvitationPreference(context, kind, targetId) {
  const field = INVITE_OPTIONS[kind];
  socialRequire(
    field && context.get(targetId).settings.gameOptions[field],
    "invitation-disabled",
    "That local character has disabled this kind of invitation in Game Options.",
  );
}

export function invite(context, kind, targetId, group = null) {
  const target = admitContact(context, targetId),
    self = context.get();
  admitInvitationPreference(context, kind, targetId);
  socialRequire(
    !target.social.invitations.some(
      (entry) => entry.kind === kind && entry.toId === targetId,
    ),
    "invitation-pending",
    "That character already has a pending invitation of this kind.",
  );
  socialRequire(
    self.social.invitations.length < SOCIAL_LIMITS.invitations &&
      target.social.invitations.length < SOCIAL_LIMITS.invitations,
    "invitation-limit",
    "The local invitation capacity was reached.",
  );
  const request = {
    id: context.uid(),
    kind,
    fromId: context.actorId,
    toId: targetId,
    groupId: group?.id ?? null,
    groupName: group?.name ?? "",
    createdAt: context.now,
  };
  self.social.invitations.push(request);
  target.social.invitations.push(structuredClone(request));
  context.result.invitationId = request.id;
  return request;
}

export function pendingInvitation(context) {
  const request = context
    .get()
    .social.invitations.find(
      (entry) => entry.id === context.payload.invitationId,
    );
  socialRequire(
    request,
    "invitation-missing",
    "The invitation is no longer pending.",
  );
  const sender = context.get(request.fromId),
    recipient = context.get(request.toId);
  socialRequire(
    sender.social.invitations.some(
      (entry) => JSON.stringify(entry) === JSON.stringify(request),
    ) &&
      recipient.social.invitations.some(
        (entry) => JSON.stringify(entry) === JSON.stringify(request),
      ),
    "social-conflict",
    "The saved invitation participants disagree; no changes were made.",
  );
  return request;
}

export function cancelGroupInvitations(context, kind, id) {
  context.removeInvitations(
    (entry) =>
      entry.groupId === id &&
      (entry.kind === kind || entry.kind === `${kind}-create`),
  );
}
