import { createHash } from "node:crypto";
import { jsonDocument } from "./validation.js";

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Canonical property order for JSONB round trips, request retries and revision identities. */
export function canonical(value, limits) {
  jsonDocument(value, limits);
  const root = { value: null };
  const queue = [{ source: value, target: root, key: "value" }];
  for (let index = 0; index < queue.length; index++) {
    const { source, target, key } = queue[index];
    if (source === null || typeof source !== "object") {
      target[key] = source;
      continue;
    }
    const next = Array.isArray(source) ? [] : Object.create(null);
    target[key] = next;
    for (const name of Object.keys(source).sort()) {
      queue.push({ source: source[name], target: next, key: name });
    }
  }
  return JSON.stringify(root.value);
}
