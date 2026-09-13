import {
  array,
  boolean,
  enumeration,
  id,
  nullable,
  number,
  optional,
  point,
  record,
  revision,
  string,
} from "./schema.js";

const expressionName = enumeration(
  "blink",
  "hit",
  "smile",
  "troubled",
  "cry",
  "angry",
  "bewildered",
  "stunned",
  "vomit",
  "oops",
  "cheers",
  "chu",
  "wink",
  "pain",
  "glitter",
  "blaze",
  "shine",
  "love",
  "despair",
  "hum",
  "bowing",
  "hot",
  "dam",
);
const placementId = string(/^reactor:[0-9]{1,16}$/u, 24);
export const worldDestinationSchema = record({
  instanceId: id,
  mapId: number(0, 999999998),
  fieldEpoch: id,
  spawn: point,
});
export const WORLD_ACTION_ROWS = [
  ["expression.use", "character", { expression: number(0, 22) }],
  ["expression.cash", "character", { templateId: number(5160000, 5169999) }],
  ["seat.toggle", "character", {}],
  ["reactor.offer", "inventory", { itemId: id }],
];
// Only tutorial portal receipts are transient; ordinary portal travel still commits through the DB.
export const WORLD_EPHEMERAL_ACTIONS = [
  "expression.use",
  "expression.cash",
  "seat.toggle",
  "portal.enter",
];
/** Merge each entry with the existing client packet envelope. Never dispatch as an action. */
export const WORLD_CLIENT_MESSAGES = {
  "transition-ready": { fieldEpoch: id, transitionId: id, accepted: boolean },
};

/** Root supplies its current complete entity union, keeping domain schemas acyclic. */
export function worldTransitionFields(entitySchema, maxEntities) {
  return {
    preparation: optional(
      record(
        {
          serverTick: revision,
          part: number(0, 63),
          parts: number(1, 64),
          entities: array(entitySchema, maxEntities),
        },
        (value) => value.part < value.parts,
      ),
    ),
  };
}
export const WORLD_ENTITY_FIELDS = {
  npcSpeech: optional(
    nullable(
      record({
        actionIndex: nullable(number(0, 4095)),
        lineIndex: number(0, 4095),
        startTick: revision,
      }),
    ),
  ),
  expression: optional(
    nullable(
      record(
        { name: expressionName, startedAt: revision, expiresAt: revision },
        (value) => value.expiresAt > value.startedAt,
      ),
    ),
  ),
  seat: optional(
    nullable(
      record({
        id: revision,
        x: number(-1048576, 1048576),
        y: number(-1048576, 1048576),
      }),
    ),
  ),
  reactor: optional(
    record({
      placementId,
      state: number(-1, 255),
      phase: enumeration("idle", "hit"),
      action: nullable(
        string(/^(?:state:[0-9]{1,3}|hit:[0-9]{1,3}(?::[0-9]{1,16})?)$/u, 24),
      ),
      elapsedMs: number(0, Number.MAX_SAFE_INTEGER, false),
      repeat: boolean,
      visible: boolean,
      generation: revision,
      scriptRewards: enumeration(false),
    }),
  ),
};
export const WORLD_EVENT_SCHEMAS = {
  "world.reactor": record({
    kind: enumeration("world.reactor"),
    reactorId: id,
    placementId,
    fromState: number(-1, 255),
    state: number(-1, 255),
    generation: revision,
    impactTick: revision,
    scriptRewards: enumeration(false),
  }),
  "world.teleport": record({
    kind: enumeration("world.teleport"),
    actorId: id,
    source: point,
    destination: point,
    impactTick: revision,
    recoveryMs: enumeration(600),
  }),
  "world.portal": record({ kind: enumeration("world.portal"), actorId: id }),
  "world.tutorial": record({
    kind: enumeration("world.tutorial"),
    path: enumeration(
      "UI/tutorial.img/25",
      "UI/tutorial.img/21",
      "UI/tutorial.img/22",
      "UI/tutorial.img/27",
    ),
  }),
};
export const WORLD_RESULT_SCHEMAS = {
  "world.character-action": record({
    kind: enumeration("world.character-action"),
    action: enumeration("expression.use", "expression.cash", "seat.toggle"),
  }),
  "world.reactor-offer": record({
    kind: enumeration("world.reactor-offer"),
    accepted: enumeration(true),
    consumed: number(1, 2147483647),
    reactorId: id,
    scriptRewards: enumeration(false),
  }),
  "world.travel": record({
    kind: enumeration("world.travel"),
    destination: worldDestinationSchema,
  }),
};
