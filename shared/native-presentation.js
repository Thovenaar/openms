import {
  array,
  boolean,
  enumeration,
  number,
  record,
  string,
  u32,
  validate,
  closedRecord,
  protocolError,
} from "./schema.js";
import { decodeJson } from "./json.js";
import {
  validateProfile,
  validateKeyBindings,
} from "../client/src/profile/profile-validation.js";
import { validateSkillMacros } from "../client/src/profile/profile-domains.js";
import { GAME_OPTION_FIELDS } from "../client/src/profile/profile-game-options.js";
import { createCharacterStats } from "../client/src/character/character-stats.js";

export const NATIVE_CHUNK_SIZE = 12000;
export const NATIVE_MAX_BYTES = 768 * 1024;
const audio = record({ volume: number(0, 128), mute: boolean });
export const trackerSchema = record({
  ids: array(number(0, 999999999), 5, 0, true),
  auto: boolean,
  open: boolean,
});
export const settingsSchema = record({
  BGM: audio,
  SE: audio,
  chat: record({ state: number(1, 3), height: number(26, 507) }),
  questTracker: trackerSchema,
  gameOptions: record(
    Object.fromEntries(GAME_OPTION_FIELDS.map((key) => [key, boolean])),
  ),
  alerts: record({ hp: number(0, 19), mp: number(0, 19) }),
});
export const keyBindingsSchema = record(
  {
    keys: array(record({ type: number(0, 8), id: u32 }), 89, 89),
    quickSlots: array(number(0, 88), 8, 8, true),
  },
  (value) => Boolean(validateKeyBindings(value)),
);
export const skillMacrosSchema = array(
  record({
    name: string(/^[\s\S]*$/u, 12),
    skills: array(u32, 3, 3),
    shout: boolean,
  }),
  5,
  5,
);
const statsSchema = record(
  Object.fromEntries(
    Object.entries(createCharacterStats()).map(([key, value]) => [
      key,
      typeof value === "boolean"
        ? boolean
        : number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, false),
    ]),
  ),
);
const capabilitySchema = record(
  Object.fromEntries(
    [
      "settings",
      "keyBindings",
      "skillMacros",
      "questTracker",
      "questNotice",
      "inventory",
      "quests",
      "shop",
      "trade",
      "tradeChat",
      "storage",
      "cashShop",
      "pets",
      "socialManagement",
      "medals",
      "guild",
      "spouseChat",
    ].map((key) => [key, boolean]),
  ),
);
const objectiveSchema = record({
  kind: enumeration("item", "kill"),
  templateId: u32,
  current: u32,
  required: u32,
});
const questSchema = record({
  id: u32,
  state: number(0, 2),
  partition: number(0, 2),
  available: boolean,
  ready: boolean,
  supported: boolean,
  reason: string(/^[\s\S]*$/u, 2048),
  tracker: boolean,
  giveUp: boolean,
  noticeAcknowledged: boolean,
  objectives: array(objectiveSchema, 128),
});

/** Decode one complete bounded server projection, using the canonical pure profile validator. */
export function decodeNativePresentation(source, eventSchema) {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).byteLength > NATIVE_MAX_BYTES
  ) {
    throw protocolError();
  }
  // Node budget scales with the byte cap: the full 4096-record catalog must stay decodable.
  const value = decodeJson(source, {
    maxBytes: NATIVE_MAX_BYTES,
    maxDepth: 32,
    maxNodes: 262144,
  });
  closedRecord(value, [
    "profile",
    "stats",
    "capabilities",
    "quests",
    "interactions",
    "revisions",
    "paused",
  ]);
  validateProfile(value.profile);
  validate(value.stats, statsSchema);
  validate(value.capabilities, capabilitySchema);
  // The budget must cover the array bound (4096 records, each with its objectives), not one sample.
  validate(
    value.quests,
    array(questSchema, 4096, 0, (entry) => entry?.id),
    524288,
  );
  validate(value.interactions, array(eventSchema, 64), 100000);
  validate(
    value.revisions,
    record({
      conversation: number(0, Number.MAX_SAFE_INTEGER),
      trade: number(0, Number.MAX_SAFE_INTEGER),
      invitation: number(0, Number.MAX_SAFE_INTEGER),
    }),
  );
  validate(value.paused, boolean);
  return value;
}

export function validateNativePreferences(action) {
  if (action.kind === "settings.save") {
    validate(action.settings, settingsSchema);
  } else if (action.kind === "key-bindings.save") {
    validateKeyBindings(action.keyBindings);
  } else if (action.kind === "skill-macros.save") {
    validateSkillMacros(action.skillMacros);
  }
}
