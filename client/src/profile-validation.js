import { PROGRESSION_POLICY } from "./offline-progression.js";
import { createDefaultBindings, isAssignableKey } from "./keymap.js";

/** Versioned browser save format; limits are local engineering policies, not native rules. */
export const PROFILE_VERSION = 3;
export const PROFILE_LIMITS = Object.freeze({
  inventory: 4096,
  equipment: 128,
  quests: 16384,
  kills: 4096,
  totalKills: 65536,
  coordinate: 10000000,
  name: 32,
  skills: 4096,
});

const PROFILE_KEYS = [
  "schemaVersion",
  "name",
  "level",
  "job",
  "exp",
  "meso",
  "fame",
  "hp",
  "maxHP",
  "mp",
  "maxMP",
  "str",
  "dex",
  "int",
  "luk",
  "inventory",
  "equipment",
  "quests",
  "location",
  "settings",
  "keyBindings",
  "remainingSp",
  "skills",
];

/** Errors retain a stable code for native UI and inspection consumers. */
export function profileError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = "ProfileError";
  error.code = code;
  return error;
}

function invalid(path) {
  throw profileError("corrupt-profile", `Invalid saved profile: ${path}`);
}

function object(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(path);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path);
}

function keys(value, allowed, path) {
  object(value, path);
  const own = Reflect.ownKeys(value);
  if (own.length > allowed.length) invalid(`${path} fields`);
  for (const key of own) {
    if (!allowed.includes(key)) invalid(`${path} field ${String(key)}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      invalid(path);
    }
  }
}

function integer(value, minimum, path) {
  if (!Number.isSafeInteger(value) || value < minimum) invalid(path);
}

function itemId(value, path) {
  integer(value, 1, path);
  if (value > 99999999) invalid(path);
}

function dictionary(value, limit, path) {
  object(value, path);
  const own = Reflect.ownKeys(value);
  if (own.length > limit) invalid(`${path} capacity`);
  for (const key of own) {
    if (typeof key !== "string" || !/^(0|[1-9]\d{0,8})$/.test(key)) {
      invalid(path);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      invalid(path);
    }
  }
  return own;
}

function inventory(values) {
  if (!Array.isArray(values) || values.length > PROFILE_LIMITS.inventory) {
    invalid("inventory");
  }
  const seen = new Set();
  for (const entry of values) {
    keys(entry, ["id", "count"], "inventory entry");
    itemId(entry.id, "inventory id");
    integer(entry.count, 1, "inventory count");
    if (seen.has(entry.id)) invalid("duplicate inventory id");
    seen.add(entry.id);
  }
}

function equipment(values) {
  if (!Array.isArray(values) || values.length > PROFILE_LIMITS.equipment) {
    invalid("equipment");
  }
  const seen = new Set();
  for (const id of values) {
    itemId(id, "equipment id");
    if (seen.has(id)) invalid("duplicate equipment id");
    seen.add(id);
  }
}

function quests(value) {
  const ids = dictionary(value, PROFILE_LIMITS.quests, "quests");
  let total = 0;
  for (const id of ids) {
    const entry = value[id];
    keys(entry, ["state", "kills", "completedAt"], `quest ${id}`);
    if (![0, 1, 2].includes(entry.state)) invalid(`quest ${id} state`);
    if (Object.hasOwn(entry, "completedAt")) {
      integer(entry.completedAt, 0, "completedAt");
    }
    const targets = dictionary(
      entry.kills,
      PROFILE_LIMITS.kills,
      "quest kills",
    );
    total += targets.length;
    if (total > PROFILE_LIMITS.totalKills) invalid("total quest kill capacity");
    for (const target of targets) {
      integer(entry.kills[target], 0, "quest kill count");
    }
  }
}

/** Location is durable feet coordinates; geometry is revalidated by scene preparation. */
export function validateProfileLocation(value) {
  keys(value, ["mapId", "x", "y", "facing"], "location");
  if (typeof value.mapId !== "string" || !/^\d{9}$/.test(value.mapId)) {
    invalid("mapId");
  }
  for (const key of ["x", "y"]) {
    if (
      !Number.isFinite(value[key]) ||
      Math.abs(value[key]) > PROFILE_LIMITS.coordinate
    ) {
      invalid(`location ${key}`);
    }
  }
  if (value.facing !== -1 && value.facing !== 1) invalid("location facing");
  return value;
}

function settings(value) {
  keys(value, ["BGM", "SE", "chat"], "settings");
  for (const category of ["BGM", "SE"]) {
    const audio = value[category];
    keys(audio, ["volume", "mute"], `settings ${category}`);
    integer(audio.volume, 0, "audio volume");
    if (audio.volume > 128 || typeof audio.mute !== "boolean") {
      invalid("audio settings");
    }
  }
  keys(value.chat, ["state", "height"], "chat settings");
  integer(value.chat.state, 1, "chat state");
  integer(value.chat.height, 26, "chat height");
  if (value.chat.state > 3 || value.chat.height > 507) invalid("chat settings");
}

/** Preserve the packed byte/uint32 contract, including assigned type4/ID0. */
export function validateKeyBindings(value) {
  keys(value, ["keys", "quickSlots"], "key bindings");
  if (!Array.isArray(value.keys) || value.keys.length !== 89) {
    invalid("functional keys");
  }
  for (const binding of value.keys) {
    keys(binding, ["type", "id"], "functional key");
    integer(binding.type, 0, "functional key type");
    integer(binding.id, 0, "functional key id");
    if (binding.type > 8 || binding.id > 0xffffffff) {
      invalid("packed functional key");
    }
  }
  validateQuickSlots(value.quickSlots);
  return value;
}

function validateQuickSlots(quickSlots) {
  if (!Array.isArray(quickSlots) || quickSlots.length !== 8) {
    invalid("quick slots");
  }
  const seen = new Set();
  for (const index of quickSlots) {
    integer(index, 0, "quick slot key");
    if (
      index > 88 ||
      index === 54 ||
      !isAssignableKey(index) ||
      seen.has(index)
    ) {
      invalid("quick slot key");
    }
    seen.add(index);
  }
}

/** Sequential migrations validate old root keys before adding only new domains. */
export function migrateProfile(value) {
  object(value, "root");
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    return validateProfile(value);
  }
  const oldKeys = PROFILE_KEYS.slice(0, -2);
  keys(
    value,
    value.schemaVersion === 1 ? oldKeys.slice(0, -1) : oldKeys,
    "legacy root",
  );
  keys(value.settings, ["BGM", "SE"], "legacy settings");
  const migrated = structuredClone(value);
  if (migrated.schemaVersion === 1) {
    migrated.keyBindings = createDefaultBindings();
    migrated.schemaVersion = 2;
  }
  migrated.remainingSp = Array(10).fill(0);
  migrated.skills = {};
  migrated.settings.chat = { state: 1, height: 70 };
  migrated.schemaVersion = PROFILE_VERSION;
  return validateProfile(migrated);
}

/** Catalog maximum ranks are checked by the character/skill service boundary. */
function learnedSkills(value) {
  dictionary(value, PROFILE_LIMITS.skills, "skills");
  for (const [id, record] of Object.entries(value)) {
    if (!/^(0|[1-9][0-9]*)$/.test(id)) invalid("skill id");
    const numeric = Number(id);
    if (!Number.isSafeInteger(numeric) || numeric > 0xffffffff) {
      invalid("skill id");
    }
    keys(record, ["level", "masterLevel", "expiresAt"], `skill ${id}`);
    integer(record.level, 0, "skill level");
    integer(record.masterLevel, record.level, "skill masterLevel");
    if (record.expiresAt !== null) {
      integer(record.expiresAt, 0, "skill expiration");
    }
  }
}

/** Scalar character fields retain their existing validation order and numeric limits. */
function validateCharacterScalars(value) {
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > PROFILE_LIMITS.name
  ) {
    invalid("name");
  }
  for (const key of ["level", "maxHP", "str", "dex", "int", "luk"]) {
    integer(value[key], 1, key);
  }
  if (value.level > PROGRESSION_POLICY.maxLevel) {
    invalid("level exceeds local progression");
  }
  for (const key of ["job", "exp", "meso", "hp", "mp", "maxMP"]) {
    integer(value[key], 0, key);
  }
  integer(value.fame, Number.MIN_SAFE_INTEGER, "fame");
  if (value.hp > value.maxHP || value.mp > value.maxMP) {
    invalid("vitals exceed maximum");
  }
}

/** Validate all durable fields before accepting or cloning a checkpoint. */
export function validateProfile(value) {
  object(value, "root");
  if (value.schemaVersion !== PROFILE_VERSION) {
    const code =
      value.schemaVersion > PROFILE_VERSION
        ? "future-profile-version"
        : "migration-required";
    throw profileError(
      code,
      `Saved profile schema ${String(value.schemaVersion)} cannot be loaded as schema ${PROFILE_VERSION}; migration or an explicit reset is required.`,
    );
  }
  keys(value, PROFILE_KEYS, "root");
  validateCharacterScalars(value);
  inventory(value.inventory);
  equipment(value.equipment);
  quests(value.quests);
  validateProfileLocation(value.location);
  settings(value.settings);
  validateKeyBindings(value.keyBindings);
  if (!Array.isArray(value.remainingSp) || value.remainingSp.length !== 10) {
    invalid("remainingSp");
  }
  for (const points of value.remainingSp) integer(points, 0, "remainingSp");
  learnedSkills(value.skills);
  return value;
}

/** The envelope revision is independent of the gameplay schema and IDB physical version. */
export function validateProfileRecord(record) {
  keys(
    record,
    ["id", "generation", "revision", "createdAt", "updatedAt", "profile"],
    "envelope",
  );
  if (record.id !== "local") invalid("envelope id");
  if (
    typeof record.generation !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      record.generation,
    )
  ) {
    invalid("generation");
  }
  integer(record.revision, 0, "revision");
  integer(record.createdAt, 0, "createdAt");
  integer(record.updatedAt, record.createdAt, "updatedAt");
  validateProfile(record.profile);
  return record;
}

/** Explicit provisional beginner policy, not recovered original character grants. */
export function createProfile(location) {
  if (!location) {
    throw profileError(
      "missing-bootstrap",
      "A validated packaged spawn is required to create or reset an offline profile.",
    );
  }
  validateProfileLocation(location);
  return {
    schemaVersion: PROFILE_VERSION,
    name: "Maple",
    level: 1,
    job: 0,
    exp: 0,
    meso: 0,
    fame: 0,
    hp: 50,
    maxHP: 50,
    mp: 30,
    maxMP: 30,
    str: 12,
    dex: 5,
    int: 4,
    luk: 4,
    inventory: [],
    equipment: [1040002, 1060002, 1072001, 1302000],
    quests: {},
    location: { ...location },
    keyBindings: createDefaultBindings(),
    remainingSp: Array(10).fill(0),
    skills: {},
    settings: {
      BGM: { volume: 64, mute: false },
      SE: { volume: 64, mute: false },
      chat: { state: 1, height: 70 },
    },
  };
}
