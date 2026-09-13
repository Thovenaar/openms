import {
  array,
  boolean,
  enumeration,
  id,
  integer,
  nullable,
  number,
  optional,
  record,
  string,
  u32,
} from "./schema.js";

const prose = string(/^[\s\S]*$/u, 65536);
const amount = number(0, 2147483647);
const rewardChoice = record({ index: u32, id: u32, count: integer });

export const NARRATIVE_ACTION_ROWS = [
  ["medal.open", "character", { questId: u32, stage: enumeration(0, 1) }],
  ["medal.forfeit", "character", { questId: u32 }],
];
export const NARRATIVE_EPHEMERAL_ACTIONS = ["medal.open"];
export const NARRATIVE_ACTION_FIELDS = {
  "quest.accept": { rewardChoice: optional(u32) },
  // Only original rechargeable zero-charge stacks may sell zero units; sellQuote owns admission.
  "shop.sell": { quantity: amount },
};

/** Authored reward indexes are never inferred from their position in this array. */
export const questDialogueSchema = record({
  questId: u32,
  stage: enumeration(0, 1),
  mode: enumeration(
    "offer",
    "confirm",
    "blocked",
    "accepted",
    "rejected",
    "closed",
  ),
  rewardChoices: array(rewardChoice, 128, 0, (value) => value.index),
});
export const NARRATIVE_EVENT_FIELDS = {
  dialogue: { quest: optional(questDialogueSchema) },
};

/** Original item maximum/absence and quest-state criteria keep their signed requirements. */
export const narrativeObjectiveSchema = record({
  kind: enumeration("item", "kill", "quest"),
  templateId: u32,
  current: u32,
  required: integer,
  done: boolean,
  progress: boolean,
});

export const medalProjectionSchema = array(
  record({
    id: u32,
    questId: u32,
    itemId: u32,
    name: prose,
    category: number(0, 3),
    state: enumeration(0, 1, 2),
    description: prose,
    criteria: array(
      record({
        text: prose,
        current: integer,
        required: integer,
        complete: boolean,
      }),
      128,
    ),
    canChallenge: boolean,
    canForfeit: boolean,
    canClaim: boolean,
    reason: nullable(prose),
  }),
  4096,
  0,
  (value) => value.questId,
);
export const NARRATIVE_PROJECTION_FIELDS = { medals: medalProjectionSchema };

export const NARRATIVE_EVENT_SCHEMAS = {
  "narrative.reward": record({
    kind: enumeration("narrative.reward"),
    source: enumeration("npc", "quest"),
    sourceId: u32,
    items: array(record({ itemId: u32, amount: integer }), 128),
    mesos: integer,
    exp: amount,
    fame: integer,
    levels: number(0, 200),
    questClear: boolean,
  }),
};

export const NARRATIVE_RESULT_SCHEMAS = {
  "npc.turn": record({
    kind: enumeration("npc.turn"),
    conversationId: id,
    step: u32,
  }),
  "quest.changed": record({
    kind: enumeration("quest.changed"),
    questId: u32,
    state: enumeration(0, 1, 2),
  }),
  "shop.transaction": record({
    kind: enumeration("shop.transaction"),
    shopSession: id,
    action: enumeration("buy", "sell", "recharge"),
    itemId: u32,
    uid: id,
    count: amount,
    amount,
    currency: enumeration("meso"),
  }),
};
