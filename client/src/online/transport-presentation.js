import { PROTOCOL } from "../../../shared/protocol.js";
import { withinDeadline } from "../rendering/stream-deadline.js";

const MAX_PRESENTATIONS = 256;
const MAX_PRESENTATION_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();

/** Rendering owns a bounded asynchronous mailbox; protocol admission never awaits art.
 * Only ordinary consecutive motion is replaceable. Impulses and ordered events survive. */
export class TransportPresentation {
  constructor(transport) {
    this.transport = transport;
    this.queue = [];
    this.bytes = 0;
    this.active = null;
    this.task = null;
    this.fieldEpoch = null;
    this.generation = 0;
  }

  clear() {
    this.generation++;
    this.active?.abort();
    this.queue.length = 0;
    this.bytes = 0;
    this.fieldEpoch = null;
  }

  push(kind, value) {
    if (kind !== "snapshot" && !this.task && !this.queue.length) {
      this.deliver(kind, value);
      return;
    }
    const bytes = encoder.encode(JSON.stringify(value)).byteLength;
    const previous = this.queue.at(-1);
    if (kind === "motion" && replaceable(previous, value)) {
      this.bytes -= previous.bytes;
      this.queue.pop();
    }
    if (
      this.queue.length >= MAX_PRESENTATIONS ||
      this.bytes + bytes > MAX_PRESENTATION_BYTES
    ) {
      this.clear();
      this.transport.presentationFailed(new Error("PRESENTATION_BACKPRESSURE"));
      return;
    }
    this.queue.push({ kind, value, bytes });
    this.bytes += bytes;
    if (!this.task) this.task = this.drain();
  }

  async drain() {
    await Promise.resolve();
    // One bounded batch per microtask; a new connection can queue behind an aborted load.
    try {
      for (
        let count = 0;
        count < MAX_PRESENTATIONS && this.queue.length;
        count++
      ) {
        const entry = this.queue.shift();
        this.bytes -= entry.bytes;
        const generation = this.generation;
        try {
          if (entry.kind === "snapshot") await this.prepare(entry.value);
          else this.deliver(entry.kind, entry.value);
        } catch (error) {
          if (generation !== this.generation) continue;
          this.clear();
          this.transport.presentationFailed(error);
          break;
        }
      }
    } finally {
      this.task = null;
    }
    if (this.queue.length) queueMicrotask(() => this.start());
    else {
      try {
        this.transport.presentationIdle();
      } catch (error) {
        this.transport.fail(error);
      }
    }
  }

  start() {
    if (!this.task && this.queue.length) this.task = this.drain();
  }

  async prepare(model) {
    const controller = new AbortController();
    this.active = controller;
    const generation = this.generation;
    const timer = setTimeout(
      () => controller.abort(new Error("ASSET_PREPARATION_TIMEOUT")),
      PROTOCOL.ASSET_PREPARATION_TIMEOUT_MS,
    );
    try {
      await withinDeadline(
        this.transport.callbacks.onSnapshot?.(model, controller.signal),
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (generation === this.generation) this.fieldEpoch = model.fieldEpoch;
    } finally {
      clearTimeout(timer);
      if (this.active === controller) this.active = null;
    }
  }

  deliver(kind, value) {
    const callbacks = this.transport.callbacks;
    switch (kind) {
      case "motion":
        callbacks.onMotion?.(value);
        break;
      case "peers":
        callbacks.onPeers?.(value);
        break;
      case "state":
        callbacks.onState?.(value);
        break;
      case "event":
        callbacks.onEvent?.(value);
        break;
      case "transition":
        callbacks.onTransition?.(value);
        break;
    }
  }
}

function replaceable(previous, value) {
  return (
    previous?.kind === "motion" &&
    previous.value.fieldEpoch === value.fieldEpoch &&
    !previous.value.authoritative &&
    !value.authoritative &&
    previous.value.diverts.length === 0 &&
    value.diverts.length === 0
  );
}
