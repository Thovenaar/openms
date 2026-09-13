/** Browser delivery policy, in milliseconds; separate idle and total ceilings. */
export const NETWORK_TIMEOUTS = Object.freeze({
  idleMs: 30000,
  totalMs: 300000,
});

export function networkDeadline(signal, policy = NETWORK_TIMEOUTS) {
  const controller = new AbortController();
  let idle;
  const timeout = () =>
    controller.abort(
      new DOMException("Asset download timed out", "TimeoutError"),
    );
  const cancel = () => controller.abort(signal.reason);
  const total = setTimeout(timeout, policy.totalMs);
  function progress() {
    clearTimeout(idle);
    idle = setTimeout(timeout, policy.idleMs);
  }
  function dispose() {
    clearTimeout(total);
    clearTimeout(idle);
    signal.removeEventListener("abort", cancel);
    controller.abort();
  }
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  progress();
  return { signal: controller.signal, progress, dispose };
}

/** Fetch/read must settle even if an intermediary's body stream ignores cancellation. */
export function withinDeadline(work, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      signal.removeEventListener("abort", cancel);
      cancel();
    }
    Promise.resolve(work)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", cancel);
      });
  });
}
