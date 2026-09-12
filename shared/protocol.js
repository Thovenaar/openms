import {
  array,
  boolean,
  canonical,
  closedRecord,
  enumeration,
  hash,
  id,
  integer,
  nullable,
  number,
  optional,
  point,
  protocolError,
  record,
  revision,
  seq,
  text,
  u32,
  union,
  validate,
  string,
} from "./schema.js";
import { decodeJson } from "./json.js";
import { animation, motionSchema } from "./motion-schema.js";
export { closedRecord, decodeJson, protocolError };
export {
  ANIMATION_ACTIONS,
  animationId,
  animationName,
} from "./motion-schema.js";

/** Initial engineering policy, not original server constants. */
export const PROTOCOL = Object.freeze({
  VERSION: 1,
  SUBPROTOCOL: "openms.game.v1",
  TICK_MS: 30,
  MAX_CATCH_UP: 4,
  INPUT_LEAD_TICKS: 4,
  INPUT_BUFFER_TICKS: 1,
  INPUT_HISTORY: 64,
  MAX_MESSAGE_BYTES: 16384,
  MAX_SERVER_MESSAGE_BYTES: 65536,
  MAX_SNAPSHOT_PARTS: 64,
  MAX_SNAPSHOT_BYTES: 1048576,
  ASSEMBLY_TIMEOUT_MS: 5000,
  MAX_ENTITY_CHANGES: 128,
  MAX_INPUT_HOLD_TICKS: 3,
});
export const RESULT_CODES = Object.freeze([
  "OK",
  "INVALID_MESSAGE",
  "UNAUTHENTICATED",
  "CHARACTER_BUSY",
  "STALE_CONNECTION",
  "STALE_FIELD",
  "STALE_REVISION",
  "OPERATION_CONFLICT",
  "OPERATION_EXPIRED",
  "NOT_ALLOWED",
  "NOT_IN_RANGE",
  "REQUIREMENTS_NOT_MET",
  "NOT_FOUND",
  "INSUFFICIENT_FUNDS",
  "INVENTORY_FULL",
  "COOLDOWN",
  "RATE_LIMITED",
  "CONTENT_MISMATCH",
  "PROTOCOL_MISMATCH",
  "UNSUPPORTED_VERSION",
  "RESYNC_REQUIRED",
  "TRANSITION_FAILED",
  "SERVER_BUSY",
  "SESSION_EXPIRED",
]);
const code = enumeration(...RESULT_CODES);
const quantity = number(1, 2147483647);
const mesos = number(0, 2147483647);
const template = u32;
const mapId = number(0, 999999998);
const facing = enumeration(-1, 1);
const axis = enumeration(-1, 0, 1);
const tab = enumeration("equip", "use", "setup", "etc", "cash");
const channel = enumeration(
  "map",
  "whisper",
  "party",
  "buddy",
  "guild",
  "alliance",
  "spouse",
);
const operationId = string(
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  36,
);
const target = union("kind", {
  entity: record({ kind: enumeration("entity"), entityId: id }),
  aim: record(
    {
      kind: enumeration("aim"),
      x: number(-1, 1, false),
      y: number(-1, 1, false),
    },
    (value) => value.x !== 0 || value.y !== 0,
  ),
});
const answer = union("kind", {
  next: record({ kind: enumeration("next") }),
  previous: record({ kind: enumeration("previous") }),
  cancel: record({ kind: enumeration("cancel") }),
  yesno: record({ kind: enumeration("yesno"), value: boolean }),
  choice: record({ kind: enumeration("choice"), choiceId: u32 }),
  number: record({ kind: enumeration("number"), value: integer }),
  text: record({ kind: enumeration("text"), value: text }),
});
const itemQuantity = record({ itemId: id, quantity });
const itemIdentity = (value) => value?.itemId;
const ACTION_ROWS = [
  ["portal.enter", "character", { portalId: u32 }],
  [
    "revive.request",
    "character",
    { method: enumeration("return", "consumable") },
  ],
  ["skill.cast", "character", { skillId: template, target: optional(target) }],
  ["buff.cancel", "character", { effectId: id }],
  ["drop.pickup", "inventory", { dropId: id }],
  [
    "inventory.move",
    "inventory",
    { itemId: id, quantity, to: record({ tab, slot: u32 }) },
  ],
  ["equipment.equip", "inventory", { itemId: id, slot: u32 }],
  ["equipment.unequip", "inventory", { itemId: id, toSlot: u32 }],
  ["item.use", "inventory", { itemId: id, target: optional(target) }],
  [
    "equipment.scroll",
    "inventory",
    { scrollId: id, equipmentId: id, protectionId: optional(id) },
  ],
  ["item.drop", "inventory", { itemId: id, quantity }],
  ["mesos.drop", "inventory", { amount: quantity }],
  ["npc.open", "character", { npcId: id }],
  ["npc.answer", "conversation", { conversationId: id, step: u32, answer }],
  [
    "quest.accept",
    "character",
    { questId: template, conversationId: id, step: u32 },
  ],
  [
    "quest.claim",
    "character",
    {
      questId: template,
      conversationId: id,
      step: u32,
      rewardChoice: optional(u32),
    },
  ],
  ["quest.abandon", "character", { questId: template }],
  ["shop.buy", "inventory", { shopSession: id, rowId: u32, quantity }],
  ["shop.sell", "inventory", { shopSession: id, itemId: id, quantity }],
  ["shop.recharge", "inventory", { shopSession: id, itemId: id }],
  ["trade.invite", "character", { targetId: id }],
  ["trade.answer", "invitation", { invitationId: id, accept: boolean }],
  [
    "trade.offer",
    "trade",
    { tradeId: id, items: array(itemQuantity, 9, 0, itemIdentity), mesos },
  ],
  ["trade.confirm", "trade", { tradeId: id }],
  ["trade.cancel", "trade", { tradeId: id }],
  [
    "stats.allocate",
    "character",
    {
      stat: enumeration("str", "dex", "int", "luk", "hp", "mp"),
      amount: quantity,
    },
  ],
  ["skills.allocate", "character", { skillId: template, amount: quantity }],
  ["chat.send", "social", { channel, recipientId: optional(id), text }],
];
const actionVariants = {},
  domains = new Map();
for (const [kind, domain, fields] of ACTION_ROWS) {
  const check =
    kind === "chat.send"
      ? (value) =>
          (value.channel === "whisper") === Object.hasOwn(value, "recipientId")
      : null;
  actionVariants[kind] = record({ kind: enumeration(kind), ...fields }, check);
  domains.set(kind, domain);
}
export const ACTION_KINDS = Object.freeze(ACTION_ROWS.map((row) => row[0]));
export const actionSchema = union("kind", actionVariants);
const clientBase = { v: enumeration(1), connectionEpoch: id, seq };
function clientRecord(type, fields) {
  return record({ ...clientBase, type: enumeration(type), ...fields });
}
const clientSchema = union("type", {
  hello: record({
    v: enumeration(1),
    type: enumeration("hello"),
    ticket: string(/^[A-Za-z0-9_-]{43}$/, 43),
    rulesHash: hash,
    assetBuildId: hash,
    resume: optional(record({ playSession: id, lastEventSeq: seq })),
  }),
  input: clientRecord("input", {
    fieldEpoch: id,
    inputSeq: seq,
    targetTick: revision,
    horizontal: axis,
    vertical: axis,
    jump: boolean,
    attack: boolean,
  }),
  command: clientRecord("command", {
    fieldEpoch: id,
    operationId,
    expectedRevision: revision,
    action: actionSchema,
  }),
  ready: clientRecord("ready", { fieldEpoch: id, snapshotId: id }),
  ack: clientRecord("ack", { eventSeq: seq, snapshotId: id }),
  resync: clientRecord("resync", {
    fieldEpoch: id,
    lastEventSeq: seq,
    reason: enumeration("gap", "baseline", "prediction-overflow"),
  }),
  pong: clientRecord("pong", { nonce: id }),
});

const appearance = record({
  name: text,
  gender: enumeration(0, 1),
  skin: u32,
  face: template,
  hair: template,
  equipment: array(
    record({ slot: u32, templateId: template }),
    32,
    0,
    (value) => value?.slot,
  ),
});
const entity = record(
  {
    id,
    kind: enumeration("player", "mob", "npc", "drop"),
    templateId: template,
    position: point,
    velocity: point,
    foothold: nullable(u32),
    facing,
    action: animation,
    actionStartTick: revision,
    appearance: nullable(appearance),
  },
  (value) => (value.kind === "player") === (value.appearance !== null),
);
const statKey = enumeration(
  "str",
  "dex",
  "int",
  "luk",
  "hp",
  "mp",
  "pad",
  "mad",
  "pdd",
  "mdd",
  "acc",
  "eva",
  "speed",
  "jump",
);
const equipment = record({
  upgradesRemaining: u32,
  upgradesUsed: u32,
  stats: array(
    record({ key: statKey, value: integer }),
    14,
    0,
    (value) => value?.key,
  ),
});
const location = union("kind", {
  inventory: record({ kind: enumeration("inventory"), tab, slot: u32 }),
  equipped: record({ kind: enumeration("equipped"), slot: u32 }),
});
// Only server-admitted rechargeable templates may publish zero remaining charges.
// Template-aware profile/database admission enforces that predicate; intents stay positive.
const item = record({
  id,
  templateId: template,
  quantity: number(0, 2147483647),
  location,
  revision,
  equipment: nullable(equipment),
});
const skill = record({
  id: template,
  rank: u32,
  mastery: u32,
  cooldownUntil: revision,
});
const effect = record({
  id,
  templateId: template,
  expiresAt: revision,
  cancelable: boolean,
});
const quest = record({
  id: template,
  state: enumeration("active", "claimed"),
  ready: boolean,
  revision,
  objectives: array(
    record({
      kind: enumeration("item", "kill"),
      templateId: template,
      current: u32,
      required: u32,
    }),
    128,
  ),
});
const fieldRef = record({
  instanceId: id,
  mapId,
  fieldEpoch: id,
  spawn: point,
});
const self = record(
  {
    entity,
    hp: u32,
    mp: u32,
    maxHp: u32,
    maxMp: u32,
    job: template,
    level: u32,
    exp: revision,
    ap: u32,
    sp: array(u32, 10, 10),
    stats: record({ str: u32, dex: u32, int: u32, luk: u32 }),
    effects: array(effect, 128, 0, (value) => value?.id),
  },
  (value) =>
    value.entity?.kind === "player" &&
    value.hp <= value.maxHp &&
    value.mp <= value.maxMp,
);
const capacities = record({
  equip: u32,
  use: u32,
  setup: u32,
  etc: u32,
  cash: u32,
});
const identity = (value) => value?.id;
export const snapshotPartSchema = union("kind", {
  field: record({
    kind: enumeration("field"),
    field: fieldRef,
    characterRevision: revision,
    inventoryRevision: revision,
    socialRevision: revision,
    self,
  }),
  entities: record({
    kind: enumeration("entities"),
    entities: array(entity, 128, 0, identity),
  }),
  inventory: record({
    kind: enumeration("inventory"),
    items: array(item, 128, 0, identity),
    mesos,
    capacities,
  }),
  progress: record(
    {
      kind: enumeration("progress"),
      quests: array(quest, 128, 0, identity),
      skills: array(skill, 128, 0, identity),
    },
    (value) =>
      Array.isArray(value.quests) &&
      Array.isArray(value.skills) &&
      value.quests.length + value.skills.length <= 128,
  ),
});
const entityChange = union("kind", {
  upsert: record({ kind: enumeration("upsert"), entity }),
  remove: record({ kind: enumeration("remove"), entityId: id }),
});
const shopRow = record({
  rowId: u32,
  templateId: template,
  unitPrice: mesos,
  stock: nullable(u32),
});
const tradeOffer = record({
  ownerId: id,
  items: array(
    record(
      { item, quantity },
      (value) => value.quantity <= value.item?.quantity,
    ),
    9,
    0,
    (value) => value?.item?.id,
  ),
  mesos,
  confirmed: boolean,
});
const part = number(0, 63),
  parts = number(1, 64);
function validPart(value) {
  return value.part < value.parts;
}
function validDialogue(value) {
  if (value.input !== "number" && value.input !== "text") {
    return value.minimum === null && value.maximum === null;
  }
  if (
    !Number.isSafeInteger(value.minimum) ||
    !Number.isSafeInteger(value.maximum) ||
    value.minimum > value.maximum
  ) {
    return false;
  }
  return value.input !== "text" || (value.minimum >= 0 && value.maximum <= 256);
}
function validTrade(value) {
  if (!Array.isArray(value.participants) || !Array.isArray(value.offers)) {
    return false;
  }
  for (const offer of value.offers) {
    if (!value.participants.includes(offer?.ownerId)) return false;
  }
  return true;
}
export const domainEventSchema = union("kind", {
  combat: record({
    kind: enumeration("combat"),
    actionId: id,
    actorId: id,
    skillId: nullable(template),
    hits: array(
      record({
        targetId: id,
        damage: u32,
        outcome: enumeration("hit", "miss", "guard"),
      }),
      32,
    ),
    impactTick: revision,
  }),
  "quest.ready": record({
    kind: enumeration("quest.ready"),
    questId: template,
    questRevision: revision,
  }),
  "quest.offer": record({
    kind: enumeration("quest.offer"),
    conversationId: id,
    step: u32,
    npcId: id,
    quests: array(
      record({ questId: template, action: enumeration("accept", "claim") }),
      128,
      0,
      (value) => value?.questId,
    ),
  }),
  dialogue: record(
    {
      kind: enumeration("dialogue"),
      conversationId: id,
      step: u32,
      npcId: id,
      contentId: hash,
      choices: array(u32, 128, 0, true),
      input: enumeration("next", "yesno", "choice", "number", "text"),
      minimum: nullable(integer),
      maximum: nullable(integer),
    },
    validDialogue,
  ),
  "dialogue.closed": record({
    kind: enumeration("dialogue.closed"),
    conversationId: id,
  }),
  shop: record(
    {
      kind: enumeration("shop"),
      shopSession: id,
      npcId: id,
      revision,
      part,
      parts,
      rows: array(shopRow, 128, 0, (value) => value?.rowId),
    },
    validPart,
  ),
  chat: record({
    kind: enumeration("chat"),
    messageId: id,
    senderId: id,
    channel,
    text,
  }),
  trade: record(
    {
      kind: enumeration("trade"),
      tradeId: id,
      revision,
      state: enumeration(
        "invited",
        "open",
        "confirmed",
        "committed",
        "cancelled",
      ),
      participants: array(id, 2, 2, true),
      offers: array(tradeOffer, 2, 0, (value) => value?.ownerId),
    },
    validTrade,
  ),
});
const serverBase = {
  v: enumeration(1),
  connectionEpoch: id,
  serverTick: revision,
};
function serverRecord(type, fields, check = null) {
  return record({ ...serverBase, type: enumeration(type), ...fields }, check);
}
export const serverSchema = union("type", {
  welcome: serverRecord("welcome", {
    playSession: id,
    fieldEpoch: id,
    rulesHash: hash,
    assetBuildId: hash,
    serverTime: revision,
    tickMs: enumeration(30),
    inputLeadTicks: number(0, 4),
    inputBufferTicks: number(0, 4),
    resume: enumeration("continued", "snapshot"),
    limits: record({
      inputPerSecond: u32,
      commandPerSecond: u32,
      maxMessageBytes: number(1, 16384),
    }),
  }),
  snapshot: serverRecord(
    "snapshot",
    {
      snapshotId: id,
      fieldEpoch: id,
      eventSeq: seq,
      ackInputSeq: nullable(seq),
      part,
      parts,
      view: snapshotPartSchema,
    },
    validPart,
  ),
  state: serverRecord("state", {
    snapshotId: id,
    baseSnapshotId: id,
    fieldEpoch: id,
    eventSeq: seq,
    ackInputSeq: nullable(seq),
    changes: array(entityChange, 128),
  }),
  result: serverRecord(
    "result",
    {
      eventSeq: seq,
      operationId,
      status: enumeration("committed", "rejected"),
      code,
      domainRevision: revision,
      transactionId: nullable(id),
    },
    (value) => (value.status === "committed") === (value.code === "OK"),
  ),
  event: serverRecord("event", {
    eventSeq: seq,
    fieldEpoch: id,
    event: domainEventSchema,
  }),
  transition: serverRecord(
    "transition",
    {
      eventSeq: seq,
      transitionId: id,
      phase: enumeration("prepare", "committed", "aborted"),
      sourceEpoch: id,
      destination: nullable(fieldRef),
      requiredContent: array(hash, 128, 0, true),
      deadline: revision,
      code,
    },
    (value) => value.phase === "aborted" || value.destination !== null,
  ),
  ping: serverRecord("ping", {
    nonce: id,
    serverTime: revision,
    roundTripMs: nullable(u32),
  }),
  closing: serverRecord("closing", { code, retryAfterMs: u32 }),
  motion: serverRecord("motion", {
    fieldEpoch: id,
    ackInputSeq: nullable(seq),
    paused: boolean,
    motion: motionSchema,
  }),
});

export function decodeClient(source) {
  const value = decodeJson(source);
  if (value && Object.hasOwn(value, "v") && value.v !== 1) {
    throw protocolError("UNSUPPORTED_VERSION");
  }
  return validate(value, clientSchema, 256);
}
export function decodeServer(source) {
  const value = decodeJson(source, {
    maxBytes: PROTOCOL.MAX_SERVER_MESSAGE_BYTES,
    maxDepth: 16,
    maxNodes: 32768,
  });
  return validate(value, serverSchema);
}
export function actionDomain(action) {
  validate(action, actionSchema, 256);
  return domains.get(action.kind);
}
/** Hash this canonical domain/action string, never incoming JSON bytes or socket epochs. */
export function canonicalAction(action) {
  const domain = actionDomain(action);
  return (
    '{"domain":' +
    JSON.stringify(domain) +
    ',"action":' +
    canonical(action, actionSchema) +
    "}"
  );
}
