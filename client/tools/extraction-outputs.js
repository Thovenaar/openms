import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  collectDescriptors,
  DELIVERY_LIMITS,
  validateDescriptor,
  verifyBytes,
} from "../public/offline-manifest.js";

/** Cache only verified descriptor children, not resource bytes or enormous parsed bundles. */
export function extractionOutputs(output) {
  const verified = new Map();
  const stats = { resources: 0, bytes: 0 };
  return {
    stats,
    async closure(value) {
      const found = new Map();
      const budget = { nodes: 0 };
      collectDescriptors(value, found, budget);
      for (const descriptor of found.values()) {
        const children = await verifiedChildren(
          output,
          descriptor,
          verified,
          stats,
        );
        for (const child of children) collectDescriptors(child, found, budget);
      }
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
  const root = await realpath(output);
  const path = await realpath(
    resolve(output, descriptor.url.slice("/generated/".length)),
  );
  if (
    !descriptor.url.startsWith("/generated/") ||
    !path.startsWith(root + sep)
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
  const bytes = new Uint8Array(await file.arrayBuffer());
  await verifyBytes(bytes, descriptor);
  const children = new Map();
  if (descriptor.url.endsWith(".json")) {
    collectDescriptors(JSON.parse(new TextDecoder().decode(bytes)), children, {
      nodes: 0,
    });
  }
  const result = [...children.values()];
  verified.set(key, result);
  stats.resources++;
  stats.bytes += bytes.length;
  return result;
}
