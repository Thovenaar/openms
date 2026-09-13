import {
  array,
  boolean,
  enumeration,
  id,
  nullable,
  number,
  optional,
  record,
  revision,
  string,
  union,
} from "./schema.js";
export const SOCIAL_MAX_PROJECTION_NODES = 131072;

const label = (max, min = 0) =>
  string(new RegExp(`^[\\u0020-\\uffff]{${min},${max}}$`), max);
const socialId = string(/^[A-Za-z0-9_-]{1,80}$/, 80);
const target = { targetId: id };
const invitation = { invitationId: socialId };
const rankTitles = array(label(45, 1), 5, 5);
export const socialEmblemSchema = record({
  background: number(0, 65535),
  backgroundColor: number(0, 255),
  logo: number(0, 65535),
  logoColor: number(0, 255),
});
const searchFields = {
  minLevel: optional(number(1, 200)),
  maxLevel: optional(number(1, 200)),
  jobs: optional(array(number(0, 9999), 64, 0)),
  text: optional(label(100)),
  paused: optional(boolean),
};
const threadFields = {
  name: label(25, 1),
  text: label(600, 1),
  notice: optional(boolean),
};
const REQUEST_ROWS = [
  ["friend.invite", { ...target, groupId: optional(label(16, 1)) }],
  ["friend.remove", target],
  ["friend.block", target],
  ["friend.unblock", target],
  [
    "friend.group",
    {
      targetId: optional(id),
      groupId: optional(label(16, 1)),
      name: optional(label(16, 1)),
      remove: optional(boolean),
    },
  ],
  ["party.create", {}],
  ["party.invite", target],
  ["party.leave", {}],
  ["party.expel", target],
  ["party.leader", target],
  ["messenger.open", {}],
  ["messenger.invite", target],
  ["messenger.leave", {}],
  ["messenger.send", { text: label(256, 1) }],
  ["search.register", searchFields],
  ["search.update", searchFields],
  ["search.remove", {}],
  ["search.invite", target],
  ["guild.create", { name: label(12, 3) }],
  ["guild.invite", target],
  ["guild.leave", {}],
  ["guild.expel", target],
  ["guild.leader", target],
  [
    "guild.rank",
    {
      targetId: optional(id),
      rank: optional(number(1, 5)),
      ranks: optional(rankTitles),
    },
  ],
  ["guild.notice", { text: label(100) }],
  ["guild.emblem", { emblem: socialEmblemSchema }],
  ["guild.disband", {}],
  ["alliance.create", { name: label(12, 1) }],
  ["alliance.invite", target],
  ["alliance.leave", {}],
  ["alliance.expel", target],
  ["alliance.leader", target],
  [
    "alliance.rank",
    {
      targetId: optional(id),
      rank: optional(number(1, 5)),
      ranks: optional(array(label(11, 1), 5, 5)),
    },
  ],
  ["alliance.notice", { text: label(20) }],
  ["guild.board.write", threadFields],
  ["guild.board.edit", { threadId: socialId, ...threadFields }],
  ["guild.board.delete", { threadId: socialId }],
  ["guild.board.comment", { threadId: socialId, text: label(25, 1) }],
  ["guild.board.comment.remove", { threadId: socialId, commentId: socialId }],
  ["invitation.accept", invitation],
  ["invitation.decline", invitation],
  ["family.invite", target],
  ["family.sever", { targetId: optional(id) }],
  ["family.precept", { text: label(200) }],
  [
    "family.entitlement",
    { entitlement: number(0, 10), targetId: optional(id) },
  ],
];
export const SOCIAL_REQUEST_FIELDS = Object.freeze(
  Object.fromEntries(REQUEST_ROWS),
);
export const SOCIAL_ACTIONS = Object.freeze(REQUEST_ROWS.map(([kind]) => kind));
export const socialRequestSchema = union(
  "kind",
  Object.fromEntries(
    REQUEST_ROWS.map(([kind, fields]) => [
      kind,
      record({ kind: enumeration(kind), ...fields }),
    ]),
  ),
);
export const SOCIAL_ACTION_ROWS = [
  ["social.execute", "social", { request: socialRequestSchema }],
  ["social.read", "social", { query: label(32), targetId: optional(id) }],
  ["social.peer", "social", { targetId: id }],
  ["social.resolve", "social", { name: label(80, 1) }],
];
export const SOCIAL_EPHEMERAL_ACTIONS = [
  "social.read",
  "social.peer",
  "social.resolve",
];

const publicEquipment = array(
  record({ id: number(1000000, 9999999), slot: number(-199, -1) }),
  128,
);
const appearance = record({
  skin: number(0, 255),
  face: number(0, 99999999),
  hair: number(0, 99999999),
});
const publicFamilyMember = record({
  id,
  parentId: nullable(id),
  reputation: number(-2147483648, 2147483647),
  reputationDay: revision,
  todayReputation: number(-2147483648, 2147483647),
  totalReputation: number(0, 2147483647),
});
export const publicFamilySchema = record({
  id: socialId,
  leaderId: id,
  members: array(publicFamilyMember, 32, 1),
  precept: label(200),
});
const rankedMember = record({ id, rank: number(1, 5) });
export const publicGuildSchema = record({
  id: socialId,
  name: label(12, 1),
  leaderId: id,
  members: array(rankedMember, 32, 1),
  ranks: rankTitles,
  notice: label(100),
  emblem: socialEmblemSchema,
  forming: boolean,
});
const publicSearch = record({
  minLevel: number(1, 200),
  maxLevel: number(1, 200),
  jobs: array(number(0, 9999), 64),
  text: label(100),
  partyId: nullable(socialId),
  paused: boolean,
});
export const socialParticipantSchema = record({
  id,
  name: label(32, 1),
  level: number(1, 200),
  job: number(0, 9999),
  mapId: string(/^\d{1,9}$/, 9),
  hp: nullable(number(0, Number.MAX_SAFE_INTEGER)),
  maxHp: nullable(number(1, Number.MAX_SAFE_INTEGER)),
  online: boolean,
  portrait: nullable(
    record({ gender: number(0, 1), appearance, equipment: publicEquipment }),
  ),
  search: nullable(publicSearch),
  guild: nullable(publicGuildSchema),
  family: nullable(publicFamilySchema),
});
export const publicPeerSchema = record({
  identity: record({ id, revision: nullable(revision), online: boolean }),
  name: label(32, 1),
  level: number(1, 200),
  job: number(0, 9999),
  fame: number(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  gender: number(0, 1),
  appearance,
  equipment: publicEquipment,
  guild: nullable(record({ id: socialId, name: label(12, 1) })),
  alliance: nullable(record({ id: socialId, name: label(12, 1) })),
  wishlist: array(number(1, 2147483647), 10),
  book: record({
    cover: number(0, 9999999),
    cards: array(record({ id: number(0, 9999999), count: number(1, 5) }), 4096),
  }),
  medals: array(number(29000, 9999999), 4096),
});
export const socialPresentationSchema = record({
  projectionId: nullable(id),
  participants: array(socialParticipantSchema, 512, 1, (entry) => entry.id),
  familyRates: boolean,
  familyTravel: boolean,
  selectedPeer: nullable(publicPeerSchema),
});
export const SOCIAL_RESULT_SCHEMAS = {
  "social.result": record({
    kind: enumeration("social.result"),
    action: enumeration(...SOCIAL_ACTIONS),
    invitationId: optional(socialId),
    groupId: optional(socialId),
    threadId: optional(socialId),
    commentId: optional(socialId),
    cancelled: optional(boolean),
  }),
  "social.read": record({ kind: enumeration("social.read"), projectionId: id }),
  "social.peer": record({
    kind: enumeration("social.peer"),
    targetId: id,
    projectionId: id,
  }),
  "social.identity": record({
    kind: enumeration("social.identity"),
    targetId: id,
  }),
};
export const SOCIAL_EVENT_SCHEMAS = {
  "social.changed": record({
    kind: enumeration("social.changed"),
    actorId: id,
    action: enumeration(...SOCIAL_ACTIONS),
    revision,
  }),
};
// Main merges these fields into the existing chat action/event schemas, not a second chat action.
export const SOCIAL_CHAT_CHANNELS = [
  "map",
  "buddy",
  "group",
  "party",
  "guild",
  "alliance",
  "whisper",
  "spouse",
];
export const SOCIAL_CHAT_ACTION_FIELDS = {
  groupId: optional(label(16, 1)),
  recipientName: optional(label(80, 1)),
};
