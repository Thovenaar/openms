/** Diagnostic wall time; never included in immutable asset or recipe results. */
export async function extractionStage(timings, name, work) {
  const started = performance.now();
  try {
    return await work();
  } finally {
    timings[name] = (timings[name] ?? 0) + performance.now() - started;
  }
}
