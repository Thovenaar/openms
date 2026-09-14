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

/** Adjacent clipped pages retain native easing up to arrival. Its overshoot belongs
 * to the continuous native field; allowing it here would expose an empty strip. */
export function loginPageOffset(fromY, toY, elapsedMs, durationMs) {
  // The 600px/800ms Hermite first reaches its target at t=2/3. Hold from
  // there: near t=1 floating-point ftol can otherwise reopen a one-pixel gap.
  if (elapsedMs >= (durationMs * 2) / 3) return 0;
  const remaining = 600 - loginCameraY(0, 600, elapsedMs, durationMs);
  if (remaining <= 0) return 0;
  return Math.sign(toY - fromY) * Math.max(0, Math.min(600, remaining));
}
