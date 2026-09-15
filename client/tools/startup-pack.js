import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { StartupPreload } from "../src/online/startup-preload.js";
import { planStartupAssets } from "../src/online/startup-assets.js";
import { catalog as validateCatalog } from "../src/rendering/stream-validation.js";
import {
  validateDescriptor,
  verifyBytes,
  sha256,
} from "../src/assets/resource-validation.js";
import { validateStartupPack } from "../src/assets/startup-pack.js";
import { publishFile } from "./atlas.js";

/** Build only the common closure from retained extraction; never scan/reconvert the world. */
export async function buildStartupPack(root, catalogBytes, catalogHash) {
  const chunks = new Map();
  const catalogInfo = {
    url: "/generated/catalog.json",
    sha256: catalogHash,
    bytes: catalogBytes.byteLength,
  };
  await verifyBytes(catalogBytes, catalogInfo);
  chunks.set(catalogInfo.url, { info: catalogInfo, bytes: catalogBytes });
  const catalog = validateCatalog(
    JSON.parse(new TextDecoder().decode(catalogBytes)),
  );
  const network = {
    async load(info) {
      validateDescriptor(info);
      const file = Bun.file(resolve(root, `.${info.url}`));
      if (file.size !== info.bytes) {
        throw new Error(`Startup file size mismatch: ${info.url}`);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      await verifyBytes(bytes, info);
      chunks.set(info.url, {
        info: { url: info.url, sha256: info.sha256, bytes: info.bytes },
        bytes,
      });
      return bytes;
    },
    async json(info) {
      return JSON.parse(new TextDecoder().decode(await this.load(info)));
    },
  };
  const plan = new StartupPreload(network);
  planStartupAssets(plan, catalog);
  plan.add(catalog.loadingDecoration);
  const signal = new AbortController().signal;
  for (let index = 0; index < plan.jobs.length; index++) {
    await plan.load(plan.jobs[index], signal);
  }
  const ordered = [...chunks.values()].sort((a, b) =>
    a.info.url.localeCompare(b.info.url, "en"),
  );
  return encodeStartupPack(root, ordered, catalogHash);
}

async function encodeStartupPack(root, ordered, catalogHash) {
  const unpacked = new Uint8Array(
    await new Blob(ordered.map((entry) => entry.bytes)).arrayBuffer(),
  );
  const bytes = Bun.gzipSync(unpacked, { level: 6 });
  const hash = await sha256(bytes);
  const pack = validateStartupPack(
    {
      version: 1,
      url: `/generated/startup/${hash}.bin`,
      sha256: hash,
      bytes: bytes.byteLength,
      unpackedBytes: unpacked.byteLength,
      members: ordered.map((entry) => entry.info),
    },
    catalogHash,
  );
  const path = resolve(root, `.${pack.url}`);
  await mkdir(resolve(root, "generated/startup"), { recursive: true });
  const previous = Bun.file(path);
  if (
    !(await previous.exists()) ||
    (await sha256(await previous.arrayBuffer())) !== hash
  ) {
    await publishFile(path, bytes);
  }
  return pack;
}
