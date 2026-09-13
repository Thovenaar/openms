/**4096 learned records plus89 native keys; limits apply only to the audited GM endpoint. */
export const DEVELOPMENT_JSON = Object.freeze({
  maxBytes: 512 * 1024,
  maxDepth: 8,
  maxNodes: 65536,
});

/** Stable full payload identity, including dynamic skill IDs and their nested values. */
export function developmentCanonical(action) {
  const pending = [action];
  const keys = new Set();
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index];
    if (!node || typeof node !== "object") continue;
    for (const [key, value] of Object.entries(node)) {
      keys.add(key);
      if (pending.length >= DEVELOPMENT_JSON.maxNodes) {
        throw new Error("Development payload exceeds its node bound");
      }
      pending.push(value);
    }
  }
  return JSON.stringify(action, [...keys].sort());
}
