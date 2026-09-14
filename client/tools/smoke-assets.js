import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { extractionRecipes } from "./extraction-recipes.js";
import { readJSON } from "./smoke-jobs.js";
import { publishFile } from "./atlas.js";
import { sourcePaths } from "./source-options.js";

const MAX_CATALOG_BYTES = 64 * 1024 * 1024;
const MAX_UNITS = 1152;
const HASH = /^[a-f0-9]{64}$/;
const digest = (value) => createHash("sha256").update(value).digest("hex");

function receiptPath(options) {
  const cache = sourcePaths(options).cacheDir;
  const key = digest(
    JSON.stringify([
      options.assets,
      options.gameplayDefinitionsRoot,
      sourcePaths(options).sqlRoot,
    ]),
  );
  return resolve(cache, `smoke-${key}.json`);
}

/** Recipe names come from the actual successful extraction, not a second unit inventory. */
function recipeNames(report) {
  const units = report.incremental?.units;
  if (!Array.isArray(units) || units.length === 0 || units.length > MAX_UNITS) {
    throw new Error(
      "Extraction report has no bounded conversion-unit inventory",
    );
  }
  const names = new Set();
  for (const unit of units) {
    if (
      typeof unit.id !== "string" ||
      !/^[a-z]+(?:\/[0-9]{9})?$/.test(unit.id)
    ) {
      throw new Error("Invalid extraction unit identity");
    }
    names.add(unit.id.split("/")[0]);
  }
  if (!names.has("map")) {
    throw new Error("Extraction report lacks map conversion");
  }
  return [...names].sort();
}

/** Hash original/reference input content plus the existing transitive recipe graph. */
async function inputIdentity(options, inputs, names) {
  const recipe = extractionRecipes(options.repository);
  const recipes = [];
  for (const name of names) recipes.push([name, await recipe(name)]);
  const originals = [];
  for (const [path, record] of inputs) {
    if (
      path.startsWith("original/") ||
      path.startsWith("gameplay-definitions/") ||
      path.startsWith("reference-sql/") ||
      path === "bun.lock"
    ) {
      originals.push([path, record.hash]);
    }
  }
  originals.sort(([a], [b]) => a.localeCompare(b, "en"));
  return digest(
    JSON.stringify({
      assets: options.assets,
      gameplayDefinitionsRoot: options.gameplayDefinitionsRoot,
      sqlRoot: sourcePaths(options).sqlRoot,
      recipes,
      originals,
      bun: Bun.version,
    }),
  );
}

async function publication(options, inputs) {
  const report = await readJSON(
    resolve(options.repository, "docs/extraction.json"),
  );
  const file = Bun.file(
    resolve(options.repository, "client/public/generated/catalog.json"),
  );
  if (file.size < 1 || file.size > MAX_CATALOG_BYTES) {
    throw new Error("Invalid published catalog size");
  }
  const bytes = await file.arrayBuffer();
  const catalog = JSON.parse(new TextDecoder().decode(bytes));
  if (!HASH.test(report.buildId) || report.buildId !== catalog.buildId) {
    throw new Error("Extraction report differs from published catalog");
  }
  return {
    schemaVersion: 1,
    inputSha256: await inputIdentity(options, inputs, recipeNames(report)),
    catalogSha256: digest(Buffer.from(bytes)),
    assetBuildId: catalog.buildId,
  };
}

async function readReceipt(path) {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  if (file.size > 4096) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || error.code === "ENOENT") return null;
    throw error;
  }
}

/** Reuse skips conversion/preflight, not the dev server's published-resource integrity gate. */
export async function inspectExtractedAssets(options, inputs) {
  let current;
  try {
    current = await publication(options, inputs);
  } catch (error) {
    return {
      reusable: false,
      reason: `publication-unavailable: ${error.message}`,
    };
  }
  const saved = await readReceipt(receiptPath(options));
  const reusable =
    saved?.schemaVersion === 1 &&
    saved.inputSha256 === current.inputSha256 &&
    saved.catalogSha256 === current.catalogSha256;
  return {
    ...current,
    reusable,
    reason: reusable
      ? "unchanged-extraction-inputs-and-catalog"
      : "missing-or-changed-extraction-receipt",
  };
}

/** Call only after successful extraction; never bless a catalog merely because it exists. */
export async function rememberExtractedAssets(options, inputs, before) {
  const current = await publication(options, inputs);
  if (before.inputSha256 && before.inputSha256 !== current.inputSha256) {
    throw new Error(
      "Extraction algorithms changed during conversion; refusing reuse receipt",
    );
  }
  const path = receiptPath(options);
  await mkdir(dirname(path), { recursive: true });
  await publishFile(path, JSON.stringify(current));
  return current;
}
