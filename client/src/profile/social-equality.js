const MAX_VALUES = 65536;

/** Compare already-validated social records across JSONB reloads. Object key order
 * is irrelevant; member/message array order and every scalar value remain significant. */
export function socialEqual(left, right) {
  const pending = [[left, right]];
  for (let index = 0; index < pending.length; index++) {
    const [a, b] = pending[index];
    if (a === b) continue;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") {
      return false;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    if (pending.length + keys.length > MAX_VALUES) {
      throw new Error("Social comparison exceeds its value bound");
    }
    for (const key of keys) {
      if (!Object.hasOwn(b, key)) return false;
      pending.push([a[key], b[key]]);
    }
  }
  return true;
}
