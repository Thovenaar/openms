import { PROGRESSION_POLICY } from "./offline-progression.js";

/** Versioned browser save format; limits are local engineering policies, not native rules. */
export const PROFILE_VERSION = 1;
export const PROFILE_LIMITS = Object.freeze({
  inventory: 4096,
  equipment: 128,
  quests: 16384,
  kills: 4096,
  totalKills: 65536,
  coordinate: 10000000,
  name: 32,
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
  keys(value, ["BGM", "SE"], "settings");
  for (const category of ["BGM", "SE"]) {
    const audio = value[category];
    keys(audio, ["volume", "mute"], `settings ${category}`);
    integer(audio.volume, 0, "audio volume");
    if (audio.volume > 128 || typeof audio.mute !== "boolean") {
      invalid("audio settings");
    }
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
      `Saved profile schema ${String(value.schemaVersion)} cannot be loaded by schema ${PROFILE_VERSION}; no migration is available. Reset must be explicit.`,
    );
  }
  keys(value, PROFILE_KEYS, "root");
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
  inventory(value.inventory);
  equipment(value.equipment);
  quests(value.quests);
  validateProfileLocation(value.location);
  settings(value.settings);
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
    settings: {
      BGM: { volume: 64, mute: false },
      SE: { volume: 64, mute: false },
    },
  };
}
