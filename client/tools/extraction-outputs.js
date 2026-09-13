import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  collectDescriptors,
  DELIVERY_LIMITS,
  validateDescriptor,
} from "../public/offline-manifest.js";

const OUTPUT_PROGRESS_INTERVAL = 256;

/** Cache only verified descriptor children, not resource bytes or enormous parsed bundles. */
export function extractionOutputs(output, progress) {
  const verified = new Map();
  const stats = { resources: 0, bytes: 0, readMs: 0, hashMs: 0, jsonMs: 0 };
  // Resolve the owned output directory once, while checking every resource's real path.
  let root;
  return {
    stats,
    async closure(value) {
      root ??= await realpath(output);
      const found = new Map();
      const budget = { nodes: 0 };
      collectDescriptors(value, found, budget);
      let completed = 0;
      for (const descriptor of found.values()) {
        if (completed % OUTPUT_PROGRESS_INTERVAL === 0) {
          progress?.(
            `Output verification: ${completed} descriptors checked, ${found.size} discovered; current ${descriptor.url}`,
          );
        }
        const children = await verifiedChildren(
          root,
          descriptor,
          verified,
          stats,
        );
        for (const child of children) collectDescriptors(child, found, budget);
        completed++;
      }
      progress?.(
        `Output verification complete: ${completed} descriptors checked`,
      );
      return [...found.values()].sort((a, b) =>
        a.url.localeCompare(b.url, "en"),
      );
    },
  };
}

async function verifiedChildren(output, descriptor, verified, stats) {
  validateDescriptor(descriptor);
  const key = `${descriptor.url}:${descriptor.sha256}:${descriptor.bytes}`;
  if (verified.has(key)) return verified.get(key);
  const started = performance.now();
  const path = await realpath(
    resolve(output, descriptor.url.slice("/generated/".length)),
  );
  if (
    !descriptor.url.startsWith("/generated/") ||
    !path.startsWith(output + sep)
  ) {
    throw new Error(
      `Cache output escapes generated directory: ${descriptor.url}`,
    );
  }
  const file = Bun.file(path);
  if (
    file.size !== descriptor.bytes ||
    file.size > DELIVERY_LIMITS.resourceBytes
  ) {
    throw new Error(`Cache output byte length mismatch: ${descriptor.url}`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const read = performance.now();
  stats.readMs += read - started;
  // This offline conversion process owns the buffer; no browser digest/thread-pool hop.
  if (
    bytes.length !== descriptor.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256
  ) {
    throw new Error(
      `Cache output SHA-256 or byte length mismatch: ${descriptor.url}`,
    );
  }
  const hashed = performance.now();
  stats.hashMs += hashed - read;
  const children = new Map();
  if (descriptor.url.endsWith(".json")) {
    collectDescriptors(JSON.parse(bytes.toString("utf8")), children, {
      nodes: 0,
    });
  }
  stats.jsonMs += performance.now() - hashed;
  const result = [...children.values()];
  verified.set(key, result);
  stats.resources++;
  stats.bytes += bytes.length;
  return result;
}
