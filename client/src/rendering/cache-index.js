import { LIMITS } from "./stream-validation.js";

const DATABASE = "maple-content-index-v1";
const STORES = ["entries", "pending", "state"];
const TIMEOUT_MS = 5000;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Commit, rather than individual request success, establishes the persisted index. */
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        transaction.abort();
      } catch (error) {
        reject(error);
      }
    }, TIMEOUT_MS);
    transaction.oncomplete = () => {
      clearTimeout(timer);
      resolve();
    };
    transaction.onabort = () => {
      clearTimeout(timer);
      reject(transaction.error ?? new Error("Cache index transaction aborted"));
    };
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let settled = false;
    const fail = (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error("Cache index open timed out")),
      TIMEOUT_MS,
    );
    request.onblocked = () => fail(new Error("Cache index upgrade blocked"));
    request.onerror = () => fail(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of STORES) database.createObjectStore(name);
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      clearTimeout(timer);
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function validURL(url) {
  if (typeof url !== "string" || url.length > 1024) return false;
  if (!URL.canParse(url, location.origin)) return false;
  const parsed = new URL(url, location.origin);
  return (
    parsed.href === url &&
    parsed.origin === location.origin &&
    /^\/generated\/[a-zA-Z0-9/_.-]+$/.test(parsed.pathname) &&
    !parsed.search &&
    !parsed.hash
  );
}

function validBytes(bytes) {
  return (
    Number.isSafeInteger(bytes) && bytes > 0 && bytes <= LIMITS.resourceBytes
  );
}

function validRows(rows) {
  if (rows.length > LIMITS.cacheEntries) return false;
  const urls = new Set();
  for (const row of rows) {
    if (
      !row ||
      !validURL(row.url) ||
      !validBytes(row.bytes) ||
      !Number.isSafeInteger(row.used) ||
      row.used < 0 ||
      urls.has(row.url)
    ) {
      return false;
    }
    urls.add(row.url);
  }
  return true;
}

/** Metadata and a write-ahead journal; asset payloads stay in the existing CacheStorage. */
export class CacheIndex {
  constructor(database) {
    this.database = database;
    this.order = 0;
    this.status = "initializing";
    this.headerReads = 0;
  }
  static async open() {
    return new CacheIndex(await openDatabase());
  }
  close() {
    this.database.close();
  }

  async read() {
    const transaction = this.database.transaction(STORES, "readonly");
    const done = transactionDone(transaction);
    const [rows, pending, state] = await Promise.all([
      requestResult(
        transaction
          .objectStore("entries")
          .getAll(undefined, LIMITS.cacheEntries + 1),
      ),
      requestResult(
        transaction
          .objectStore("pending")
          .getAll(undefined, LIMITS.cacheEntries + 1),
      ),
      requestResult(transaction.objectStore("state").get("ready")),
      done,
    ]);
    return { rows, pending, state };
  }

  async write(operation) {
    const transaction = this.database.transaction(STORES, "readwrite");
    const done = transactionDone(transaction);
    try {
      operation(transaction);
    } catch (error) {
      transaction.abort();
      await Promise.allSettled([done]);
      throw error;
    }
    await done;
  }

  async restore(cache, fresh) {
    const { rows, pending, state } = await this.read();
    if (
      fresh ||
      state !== 1 ||
      !validRows(rows) ||
      pending.length > LIMITS.cacheEntries ||
      !pending.every(validURL)
    ) {
      return this.rebuild(cache);
    }
    this.order = rows.reduce((maximum, row) => Math.max(maximum, row.used), 0);
    const records = new Map(rows.map((row) => [row.url, row]));
    for (const url of pending) {
      const row = await this.inspect(cache, url);
      await this.finish(url, row?.bytes ?? null);
      if (row) records.set(url, row);
      else records.delete(url);
    }
    this.status = pending.length ? "recovered" : "restored";
    return [...records.values()].sort((left, right) => left.used - right.used);
  }

  async inspect(cache, url) {
    this.headerReads++;
    const response = await cache.match(url);
    if (!response) return null;
    const bytes = Number(response.headers.get("x-maple-bytes"));
    if (!validURL(url) || !validBytes(bytes)) {
      await cache.delete(url);
      return null;
    }
    return { url, bytes, used: this.nextOrder() };
  }

  /** One migration/recovery scan; ordinary launches read only metadata rows. */
  async rebuild(cache) {
    const keys = await cache.keys();
    if (keys.length > LIMITS.cacheEntries) {
      throw new Error("Cache inventory exceeds file limit");
    }
    const rows = [];
    for (let start = 0; start < keys.length; start += LIMITS.fetches) {
      const batch = keys.slice(start, start + LIMITS.fetches);
      const records = await Promise.all(
        batch.map((key) => this.inspect(cache, key.url)),
      );
      for (const row of records) {
        if (row) {
          row.used = this.nextOrder();
          rows.push(row);
        }
      }
    }
    await this.write((transaction) => {
      for (const name of STORES) transaction.objectStore(name).clear();
      for (const row of rows) {
        transaction.objectStore("entries").put(row, row.url);
      }
      transaction.objectStore("state").put(1, "ready");
    });
    this.status = "rebuilt";
    return rows;
  }

  nextOrder() {
    this.order = Math.max(Date.now(), this.order + 1);
    if (!Number.isSafeInteger(this.order)) {
      throw new Error("Cache recency counter exhausted");
    }
    return this.order;
  }
  async begin(url) {
    await this.write((transaction) =>
      transaction.objectStore("pending").put(url, url),
    );
  }
  async cancel(url) {
    await this.write((transaction) =>
      transaction.objectStore("pending").delete(url),
    );
  }
  async finish(url, bytes) {
    const row = bytes === null ? null : { url, bytes, used: this.nextOrder() };
    await this.write((transaction) => {
      if (row) transaction.objectStore("entries").put(row, url);
      else transaction.objectStore("entries").delete(url);
      transaction.objectStore("pending").delete(url);
    });
  }
}
