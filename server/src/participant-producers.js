// One reward head, Pickpocket plan and incoming-hit head per maximum128 live characters.
const MAX_PRODUCERS = 384;

function busy() {
  throw Object.assign(new Error("Accepted producer capacity exhausted"), {
    code: "SERVER_BUSY",
  });
}

/** Earned effects wait for authority; unlike client commands, contention is not a refusal. */
export class ParticipantProducers {
  constructor(participants) {
    this.participants = participants;
    this.entries = [];
    this.pending = new Map();
    this.running = false;
    this.wake = null;
  }

  nextChange() {
    this.wake ??= Promise.withResolvers();
    return this.wake.promise;
  }

  signal() {
    if (!this.wake) return;
    const wake = this.wake;
    this.wake = null;
    wake.resolve();
  }

  setKeys(entry, keys) {
    for (const id of entry.keys ?? []) {
      const count = this.pending.get(id) - 1;
      if (count) this.pending.set(id, count);
      else this.pending.delete(id);
    }
    entry.keys = keys;
    for (const id of keys)
      {this.pending.set(id, (this.pending.get(id) ?? 0) + 1);}
  }

  enqueue(entry, keys) {
    if (this.entries.length >= MAX_PRODUCERS) busy();
    const completion = Promise.withResolvers();
    entry.completion = completion;
    this.setKeys(entry, keys);
    this.entries.push(entry);
    if (!this.running) void this.drain();
    return completion.promise;
  }

  async drain() {
    this.running = true;
    try {
      while (this.entries.length) {
        const entry = this.entries[0];
        try {
          entry.completion.resolve(await this.participants.runProduced(entry));
        } catch (error) {
          entry.completion.reject(error);
        } finally {
          this.setKeys(entry, []);
          this.entries.shift();
          this.signal();
        }
      }
    } finally {
      this.running = false;
    }
  }

  has(id) {
    return this.pending.has(id);
  }
}
