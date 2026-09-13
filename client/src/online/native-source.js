/** A read-only publication source. It deliberately has no save, flush or mutation methods. */
export class NativeProfileSource {
  constructor(owner) {
    this.owner = owner;
    this.listeners = new Set();
  }
  get profile() {
    return this.owner.state?.presentation.profile ?? null;
  }
  get id() {
    return this.owner.state?.self.entity.id ?? null;
  }
  get profileTransactionPending() {
    return this.owner.pending > 0;
  }
  get pending() {
    return this.profileTransactionPending;
  }
  get status() {
    return this.owner.connection?.status ?? "disconnected";
  }
  subscribe(listener) {
    if (typeof listener !== "function" || this.listeners.size >= 64) {
      throw new Error("Invalid native profile observer");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish() {
    for (const listener of this.listeners) listener(this);
  }
  destroy() {
    this.listeners.clear();
  }
}

export function unsupported(domain) {
  return {
    ok: false,
    code: "UNSUPPORTED_CAPABILITY",
    reason: `The server does not provide ${domain}.`,
  };
}

/** Native controls receive the actual terminal receipt, never an optimistic profile edit. */
export function nativeOutcome(receipt) {
  return {
    ok: receipt?.status === "committed",
    code: receipt?.code ?? "OUTCOME_UNKNOWN",
    reason:
      receipt?.status === "committed"
        ? undefined
        : (receipt?.code ??
          "Operation outcome is unknown; reconnect to recover it."),
    receipt,
    value: receipt?.value,
  };
}
