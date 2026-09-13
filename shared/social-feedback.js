/** Closed, user-facing rule refusals. Internal exceptions are never sent as prose. */
export const SOCIAL_RULE_CODES = Object.freeze({
  "self-target": "SOCIAL_SELF_TARGET",
  "already-friends": "BUDDY_ALREADY_ADDED",
  "friend-capacity": "BUDDY_LIST_FULL",
  "friend-missing": "BUDDY_NOT_FOUND",
  "group-missing": "BUDDY_GROUP_MISSING",
  "invitation-disabled": "INVITATION_DISABLED",
  "invitation-pending": "INVITATION_PENDING",
  "invitation-limit": "INVITATION_LIMIT",
  blocked: "CONTACT_BLOCKED",
});

export const SOCIAL_MESSAGES = Object.freeze({
  SOCIAL_SELF_TARGET:
    "Choose another character, rather than your own character name.",
  BUDDY_ALREADY_ADDED: "That character is already on your buddy list.",
  BUDDY_LIST_FULL: "One of the buddy lists is full.",
  BUDDY_NOT_FOUND: "That character is no longer on your buddy list.",
  BUDDY_GROUP_MISSING: "Choose an existing buddy group.",
  INVITATION_DISABLED:
    "That character has disabled these invitations in Game Options.",
  INVITATION_PENDING:
    "That character already has an invitation waiting for an answer.",
  INVITATION_LIMIT:
    "There are too many pending invitations. Answer or cancel one first.",
  CONTACT_BLOCKED: "A blacklist prevents this request.",
});
