import { ImageSource } from "pixi.js";
import { Gate, aborted, check } from "./stream-network.js";
import { LIMITS } from "./stream-validation.js";

class Decoder {
  constructor(workerURL) {
    this.worker = new Worker(workerURL, { type: "module" });
    this.gate = new Gate(LIMITS.decodes);
    this.pending = new Map();
    this.serial = 0;
    this.failure = null;
    this.worker.onmessage = this.receive.bind(this);
    this.worker.onerror = this.fail.bind(this);
  }
  receive(event) {
    const { id, bitmap, error } = event.data;
    const job = this.pending.get(id);
    if (!job) {
      bitmap?.close();
      return;
    }
    this.pending.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve(bitmap);
  }
  fail(event) {
    this.failure = new Error(event.message || "Atlas worker stopped");
    for (const job of this.pending.values()) job.reject(this.failure);
    this.pending.clear();
  }
  decode(buffer, info, signal) {
    return this.gate.run(async () => {
      if (this.failure) throw this.failure;
      check(signal);
      const bitmap = await new Promise((resolve, reject) => {
        const id = ++this.serial;
        this.pending.set(id, { resolve, reject });
        this.worker.postMessage(
          { id, buffer, width: info.width, height: info.height },
          [buffer],
        );
      });
      if (signal.aborted) {
        bitmap.close();
        throw aborted();
      }
      return bitmap;
    }, signal);
  }
  destroy() {
    this.worker.terminate();
    this.fail({ message: "Atlas decoder destroyed" });
  }
}

/** Timer-driven upload queue. Never called by RAF; one atlas fits the byte budget. */
class Uploads {
  constructor(renderer) {
    this.renderer = renderer;
    this.queue = [];
    this.timer = null;
    this.flushBound = this.flush.bind(this);
    this.batches = 0;
    this.longestMs = 0;
  }
  add(source, bytes, signal) {
    check(signal);
    if (bytes > LIMITS.uploadBytes || this.queue.length >= LIMITS.queue) {
      throw new Error("Upload backpressure limit");
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ source, bytes, signal, resolve, reject });
      if (this.timer === null) this.timer = setTimeout(this.flushBound, 0);
    });
  }
  flush() {
    this.timer = null;
    const start = performance.now();
    let bytes = 0;
    while (this.queue.length && performance.now() - start < LIMITS.uploadMs) {
      const job = this.queue[0];
      if (bytes + job.bytes > LIMITS.uploadBytes) break;
      this.queue.shift();
      if (job.signal.aborted) {
        job.reject(aborted());
        continue;
      }
      try {
        this.renderer.texture.initSource(job.source);
        job.resolve();
      } catch (error) {
        job.reject(error);
      }
      bytes += job.bytes;
    }
    this.batches++;
    this.longestMs = Math.max(this.longestMs, performance.now() - start);
    if (this.queue.length) this.timer = setTimeout(this.flushBound, 0);
  }
  destroy() {
    clearTimeout(this.timer);
    this.timer = null;
    for (const job of this.queue) job.reject(aborted());
    this.queue.length = 0;
  }
}

/** Hash-keyed shared ownership; all memory is reserved before fetch or decode. */
export class AtlasStore {
  constructor(renderer, network, { workerURL = "/dist/atlas-worker.js" } = {}) {
    this.network = network;
    this.decoder = new Decoder(workerURL);
    this.uploads = new Uploads(renderer);
    this.records = new Map();
    this.cpuBytes = 0;
    this.gpuBytes = 0;
    this.evictions = 0;
    this.backpressure = 0;
    this.destroyed = false;
  }
  acquire(info, signal) {
    check(signal);
    if (this.destroyed) throw aborted();
    let record = this.records.get(info.sha256);
    if (!record) record = this.create(info);
    if (
      record.info.width !== info.width ||
      record.info.height !== info.height
    ) {
      throw new Error("Conflicting atlas hash metadata");
    }
    record.refs++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal.removeEventListener("abort", release);
      record.refs--;
      if (!record.refs) this.remove(record);
    };
    signal.addEventListener("abort", release, { once: true });
    return { ready: record.ready, release };
  }
  create(info) {
    const bytes = info.width * info.height * 4;
    if (
      this.cpuBytes + bytes > LIMITS.cpuBytes ||
      this.gpuBytes + bytes > LIMITS.gpuBytes
    ) {
      this.backpressure++;
      throw new Error("Atlas residency backpressure: current map retained");
    }
    const record = {
      info,
      bytes,
      refs: 0,
      controller: new AbortController(),
      bitmap: null,
      source: null,
      ready: null,
      settled: false,
      removed: false,
    };
    this.cpuBytes += bytes;
    this.gpuBytes += bytes;
    this.records.set(info.sha256, record);
    record.ready = this.prepare(record);
    return record;
  }
  async prepare(record) {
    try {
      const signal = record.controller.signal;
      const bytes = await this.network.load(record.info, signal);
      record.bitmap = await this.decoder.decode(bytes, record.info, signal);
      check(signal);
      record.source = new ImageSource({
        resource: record.bitmap,
        scaleMode: "nearest",
        alphaMode: "premultiplied-alpha",
        autoGenerateMipmaps: false,
      });
      await this.uploads.add(record.source, record.bytes, signal);
      check(signal);
      return record.source;
    } finally {
      record.settled = true;
      if (record.removed) this.dispose(record);
    }
  }
  remove(record) {
    if (record.removed) return;
    record.removed = true;
    record.controller.abort();
    if (this.records.get(record.info.sha256) === record) {
      this.records.delete(record.info.sha256);
    }
    if (record.settled) this.dispose(record);
  }
  dispose(record) {
    record.source?.destroy();
    record.bitmap?.close();
    this.cpuBytes -= record.bytes;
    this.gpuBytes -= record.bytes;
    this.evictions++;
  }
  snapshot() {
    return {
      atlases: this.records.size,
      cpuDecodedBytes: this.cpuBytes,
      gpuEstimatedBytes: this.gpuBytes,
      decodeActive: this.decoder.gate.active,
      decodeQueued: this.decoder.gate.queue.length,
      uploadQueued: this.uploads.queue.length,
      uploadBatches: this.uploads.batches,
      longestUploadBatchMs: this.uploads.longestMs,
      evictions: this.evictions,
      backpressure: this.backpressure,
    };
  }
  destroy() {
    this.destroyed = true;
    for (const record of this.records.values()) this.remove(record);
    this.uploads.destroy();
    this.decoder.destroy();
  }
}
