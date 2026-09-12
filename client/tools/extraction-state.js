import { hash } from "./atlas.js";

const TABLES = ["textures", "atlases", "regions", "tiledCanvases"];
const MAX_BINDINGS = 1000000;

function identity(value) {
  return value === undefined ? null : hash(Buffer.from(JSON.stringify(value)));
}

/** Observe only bounded publication tables, never decoded pixels or parser trees. */
export function publicationLedger(state) {
  const owner = { active: null };
  const tables = Object.create(null);
  for (const name of TABLES) {
    const target = state[name];
    tables[name] = target;
    state[name] = new Proxy(target, {
      get(object, key) {
        recordBinding(owner.active, name, key, object[key]);
        return object[key];
      },
      set(object, key, value) {
        recordBinding(owner.active, name, key, object[key]);
        if (owner.active) owner.active.delta[name][key] = value;
        object[key] = value;
        return true;
      },
    });
  }
  return {
    begin() {
      if (owner.active) throw new Error("Nested extraction publication unit");
      const active = { bindings: {}, delta: {}, count: 0 };
      owner.active = active;
      for (const name of TABLES) {
        active.bindings[name] = Object.create(null);
        active.delta[name] = Object.create(null);
      }
    },
    finish() {
      const result = owner.active;
      owner.active = null;
      return result;
    },
    matches(record) {
      return matchingBindings(tables, record);
    },
    restore(record) {
      if (owner.active) {
        throw new Error("Cannot replay an active publication unit");
      }
      for (const name of TABLES) {
        Object.assign(tables[name], record.delta[name]);
      }
    },
  };
}

function recordBinding(active, name, key, value) {
  if (!active || typeof key !== "string") return;
  if (Object.hasOwn(active.delta[name], key)) return;
  if (Object.hasOwn(active.bindings[name], key)) return;
  if (++active.count > MAX_BINDINGS) {
    throw new Error("Publication binding limit exceeded");
  }
  active.bindings[name][key] = identity(value);
}

function matchingBindings(tables, record) {
  if (!record?.bindings || !record.delta) return false;
  let count = 0;
  for (const name of TABLES) {
    if (!record.bindings[name] || !record.delta[name]) return false;
    const bindings = Object.entries(record.bindings[name]);
    const keys = Object.keys(record.delta[name]);
    count += bindings.length + keys.length;
    if (count > MAX_BINDINGS || keys.includes("__proto__")) return false;
    for (const [key, expected] of bindings) {
      if (identity(tables[name][key]) !== expected) return false;
    }
  }
  return true;
}
