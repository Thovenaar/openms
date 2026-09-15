import { createHash } from "node:crypto";
import { acquireBrowser } from "../browser-acquisition.js";
import { assertion, measureStage } from "../native-evidence.js";

/** Real browser storage only: no game account, database, extraction or gameplay probe. */
export async function runBrowserCache() {
  const report = { status: "running", timings: {}, checks: [] };
  let server, browser;
  try {
    const code = await measureStage(report.timings, "build", buildCacheModule);
    report.source = createHash("sha256").update(code).digest("hex");
    server = serveCacheModule(code);
    browser = (
      await measureStage(report.timings, "browserAcquisition", () =>
        acquireBrowser(),
      )
    ).browser;
    const page = await browser.newPage();
    await page.goto(server.url.href);
    await measureStage(report.timings, "seed", () => seed(page));
    report.initial = await openCache(page);
    report.warm = await openCache(page);
    assertion(
      report.warm.cacheEntries > 0,
      "Cached files were lost across reopen",
    );
    if (report.warm.cacheIndexStatus) {
      assertion(
        report.warm.headerReads === 0,
        "Warm startup scanned cached file headers",
      );
      await extendedChecks(page, report);
    }
    report.checks.push(
      "A populated cache survives reopening; file-header reads and open duration are measured",
    );
    report.status = "pass";
  } catch (error) {
    report.status = "fail";
    report.failure = { message: error.message, stack: error.stack };
  } finally {
    await measureStage(report.timings, "teardown", async () => {
      await browser?.close();
      await server?.stop(true);
    });
  }
  return report;
}

function serveCacheModule(code) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/cache.js") {
        return new Response(code, {
          headers: { "content-type": "text/javascript" },
        });
      }
      if (path === "/") {
        return new Response("<!doctype html><title>Cache check</title>", {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("Unexpected cache miss", { status: 404 });
    },
  });
}

async function extendedChecks(page, report) {
  report.growth = await measureStage(report.timings, "growth", () =>
    growCache(page),
  );
  report.largeReopen = await openCache(page);
  assertion(
    report.largeReopen.cacheEntries === 4096,
    "Growth beyond the old file limit was not retained",
  );
  assertion(
    report.largeReopen.headerReads === 0,
    "Larger cache performed a header scan",
  );
  report.recovery = await interruptedWrites(page);
  assertion(
    report.recovery.cacheEntries === 4096 &&
      report.recovery.cacheHeaderReads === 3,
    "Interrupted writes were not reconciled with three targeted reads",
  );
  report.checks.push(
    "4096 files retained across reopen; interrupted insertion, deletion and unstarted writes recover through the journal",
  );
  report.corruption = await corruptPayload(page);
  assertion(
    report.corruption.rejected && !report.corruption.retained,
    "Corrupt payload or metadata was retained",
  );
  report.checks.push(
    "A corrupt cached payload fails hash verification and its index entry is removed",
  );
  report.readOnly = await unavailableIndex(page);
  assertion(
    report.readOnly.cacheStatus.startsWith("read-only:") &&
      report.readOnly.cacheHits === 1,
    "Index failure prevented verified reads of existing cached assets",
  );
  report.checks.push(
    "Index unavailability preserves verified reads and disables writes",
  );
}

async function unavailableIndex(page) {
  return page.evaluate(async () => {
    const open = indexedDB.open;
    let network;
    try {
      indexedDB.open = () => {
        throw new Error("Cache fixture index unavailable");
      };
      network = new window.cacheProbe.Network();
      await network.ready;
    } finally {
      indexedDB.open = open;
    }
    const url = "/generated/cache-probe-1";
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(1024));
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    await network.load(
      { url, bytes: 1024, sha256 },
      new AbortController().signal,
    );
    return network.snapshot();
  });
}

async function growCache(page) {
  return page.evaluate(async () => {
    const network = new window.cacheProbe.Network();
    await network.ready;
    const payload = new ArrayBuffer(1024);
    for (let id = 2048; id < 4096; id++) {
      await network.store(
        new URL(`/generated/cache-probe-${id}`, location.origin).href,
        payload,
      );
    }
    const result = network.snapshot();
    network.cacheIndex.close();
    return result;
  });
}

async function interruptedWrites(page) {
  return page.evaluate(async () => {
    const network = new window.cacheProbe.Network();
    await network.ready;
    const inserted = new URL("/generated/interrupted-insert", location.origin)
      .href;
    const removed = new URL("/generated/cache-probe-0", location.origin).href;
    const unstarted = new URL(
      "/generated/interrupted-unstarted",
      location.origin,
    ).href;
    for (const url of [inserted, removed, unstarted]) {
      await network.cacheIndex.begin(url);
    }
    await network.cache.put(
      inserted,
      new Response(new Uint8Array(1024), {
        headers: { "x-maple-bytes": "1024" },
      }),
    );
    await network.cache.delete(removed);
    network.cacheIndex.close();
    const reopened = new window.cacheProbe.Network();
    await reopened.ready;
    const result = reopened.snapshot();
    if (
      !reopened.cacheEntries.has(inserted) ||
      reopened.cacheEntries.has(removed) ||
      reopened.cacheEntries.has(unstarted)
    ) {
      throw new Error(
        "Journal recovery retained the wrong resource identities",
      );
    }
    reopened.cacheIndex.close();
    return result;
  });
}

async function corruptPayload(page) {
  return page.evaluate(async () => {
    const network = new window.cacheProbe.Network();
    await network.ready;
    const url = "/generated/interrupted-insert";
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(1024));
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    await network.cache.put(
      url,
      new Response(new Uint8Array(1024).fill(1), {
        headers: { "x-maple-bytes": "1024" },
      }),
    );
    let rejected = false;
    try {
      await network.load(
        { url, bytes: 1024, sha256 },
        new AbortController().signal,
      );
    } catch (error) {
      rejected = error.message.includes("Asset hash mismatch");
    }
    network.cacheIndex.close();
    const reopened = new window.cacheProbe.Network();
    await reopened.ready;
    const result = {
      rejected,
      retained: reopened.cacheEntries.has(new URL(url, location.origin).href),
    };
    reopened.cacheIndex.close();
    return result;
  });
}

async function buildCacheModule() {
  const result = await Bun.build({
    entrypoints: [
      new URL("../../src/rendering/stream-network.js", import.meta.url)
        .pathname,
    ],
    target: "browser",
    format: "esm",
    write: false,
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Cache module build failed");
  }
  return result.outputs[0].text();
}

async function seed(page) {
  await page.evaluate(async () => {
    const { Network } = await import("/cache.js");
    const cache = await caches.open("maple-content-v2");
    const payload = new Uint8Array(1024);
    for (let start = 0; start < 2048; start += 4) {
      await Promise.all(
        Array.from({ length: 4 }, (_, offset) =>
          cache.put(
            `/generated/cache-probe-${start + offset}`,
            new Response(payload, {
              headers: { "x-maple-bytes": String(payload.byteLength) },
            }),
          ),
        ),
      );
    }
    window.cacheProbe = { Network, headerReads: 0 };
    const match = Cache.prototype.match;
    Cache.prototype.match = function (...args) {
      window.cacheProbe.headerReads++;
      return match.apply(this, args);
    };
  });
}

async function openCache(page) {
  return page.evaluate(async () => {
    window.cacheProbe.headerReads = 0;
    const start = performance.now();
    const network = new window.cacheProbe.Network();
    await network.ready;
    const result = {
      ...network.snapshot(),
      openMs: performance.now() - start,
      headerReads: window.cacheProbe.headerReads,
    };
    network.cacheIndex?.close();
    return result;
  });
}
