/** 005f53c0 supplies two keys to Shape2D51408ee7. Tangents use units/second
 * (514092ec); 51409860 evaluates 51409d84's cubic Hermite before signed ftol. */
export function loginCameraY(start, end, elapsedMs, durationMs) {
  if (elapsedMs <= 0) return start;
  if (elapsedMs >= durationMs) return end;
  const velocity = Math.trunc(
    Math.trunc(((end - start) * 7000) / durationMs) / 2,
  );
  const tangent = durationMs * 0.001 * velocity;
  const t = elapsedMs / durationMs;
  const t2 = t * t;
  const t3 = t2 * t;
  return Math.trunc(
    (2 * t3 - 3 * t2 + 1) * start +
      (t3 - 2 * t2 + t) * tangent +
      (-2 * t3 + 3 * t2) * end,
  );
}
