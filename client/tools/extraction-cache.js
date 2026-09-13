import { mkdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { hash, publishFile } from "./atlas.js";
import { publicationLedger } from "./extraction-state.js";
import { extractionOutputs } from "./extraction-outputs.js";

const SCHEMA = 1;
/** Bounded to one record per unit; the ui catalog unit is the largest because it
 * carries every item, skill and avatar descriptor. Measured 128.3 MiB after adding
 * the original create appearances (faces, hair colours and skin tones), so the bound
 * is a measured headroom, not an open limit. */
const MAX_RECORD_BYTES = 144 * 1024 * 1024;
const MAX_SOURCES = 100000;
const SOURCE_PROGRESS_INTERVAL = 256;
const HASH = /^[a-f0-9]{64}$/;
const digest = (value) => hash(Buffer.from(JSON.stringify(value)));

/** One sequential owner; units publish immutable resources, never the mutable catalog. */
export async function createExtractionCache(options) {
  const directory = resolve(options.directory);
  const output = resolve(options.state.output);
  if (directory === output || directory.startsWith(output + sep)) {
    throw new Error("Extraction cache must be outside generated public assets");
  }
  await mkdir(resolve(directory, "records"), { recursive: true });
  const runtime = {
    ...options,
    directory,
    ledger: publicationLedger(options.state),
    outputs: extractionOutputs(output, options.progress),
    active: null,
    evidence: { hits: 0, misses: 0, reusedRGBABytes: 0, units: [] },
  };
  return {
    evidence: runtime.evidence,
    verification: runtime.outputs.stats,
    observe(key) {
      if (runtime.active) runtime.active.add(key);
    },
    run(unit, build) {
      return runUnit(runtime, unit, build);
    },
  };
}

async function loadRecord(runtime, id) {
  try {
    const pointer = Bun.file(resolve(runtime.directory, `${digest(id)}.json`));
    if (!(await pointer.exists())) return { reason: "cache-record-missing" };
    if (pointer.size > 1024) return { reason: "cache-pointer-corrupt" };
    const index = await pointer.json();
    if (!HASH.test(index?.record)) return { reason: "cache-pointer-corrupt" };
    const file = Bun.file(
      resolve(runtime.directory, "records", `${index.record}.json`),
    );
    if (file.size < 1 || file.size > MAX_RECORD_BYTES) {
      return { reason: "cache-record-missing-or-oversized" };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (hash(bytes) !== index.record) {
      return { reason: "cache-payload-corrupt" };
    }
    const record = JSON.parse(bytes.toString());
    if (!validRecord(record, id)) {
      return { reason: "cache-record-incompatible" };
    }
    return { record };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      return { reason: "cache-record-corrupt-or-missing" };
    }
    throw error;
  }
}

function validRecord(record, id) {
  if (record?.schemaVersion !== SCHEMA || record.id !== id) return false;
  if (
    ![record.recipe, record.prerequisites, record.requiredSources].every(
      (value) => HASH.test(value),
    )
  ) {
    return false;
  }
  if (
    !record.sources ||
    typeof record.sources !== "object" ||
    Array.isArray(record.sources)
  ) {
    return false;
  }
  const sources = Object.entries(record.sources);
  if (sources.length > MAX_SOURCES || !Array.isArray(record.outputs)) {
    return false;
  }
  if (
    !Number.isSafeInteger(record.decodedRGBABytes) ||
    record.decodedRGBABytes < 0
  ) {
    return false;
  }
  return sources.every(
    ([key, source]) =>
      /^[A-Za-z0-9]+\.wz:.+$/.test(key) &&
      HASH.test(source?.sha256) &&
      Number.isSafeInteger(source.bytes) &&
      source.bytes >= 0,
  );
}

async function probe(runtime, unit) {
  if (runtime.full) return { reason: "forced-full" };
  const loaded = await loadRecord(runtime, unit.id);
  if (!loaded.record) return loaded;
  const { record } = loaded;
  const difference = unitDifference(record, unit);
  if (difference) return { reason: difference };
  const sources = Object.entries(record.sources);
  let completed = 0;
  for (const [key, expected] of sources) {
    if (completed % SOURCE_PROGRESS_INTERVAL === 0) {
      runtime.progress?.(
        `${unit.id}: verifying original source ${completed + 1}/${sources.length}: ${key}`,
      );
    }
    const actual = runtime.source(key);
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      return { reason: `source-changed:${key}` };
    }
    completed++;
  }
  if (!runtime.ledger.matches(record.publication)) {
    return { reason: "atlas-publication-binding-changed" };
  }
  return verifyRecord(runtime, record);
}

function unitDifference(record, unit) {
  if (record.recipe !== unit.recipe) return "recipe-changed";
  if (record.prerequisites !== digest(unit.prerequisites ?? null)) {
    return "prerequisite-changed";
  }
  if (record.requiredSources !== digest([...(unit.sources ?? [])].sort())) {
    return "source-set-changed";
  }
  for (const key of unit.sources ?? []) {
    if (!Object.hasOwn(record.sources, key)) return `source-set-changed:${key}`;
  }
  return null;
}

async function verifyRecord(runtime, record) {
  try {
    runtime.progress?.(`${record.id}: verifying cached output closure`);
    const outputs = await runtime.outputs.closure({
      result: record.result,
      publication: record.publication.delta,
    });
    if (digest(outputs) !== digest(record.outputs)) {
      return { reason: "cache-output-closure-corrupt" };
    }
    return { record };
  } catch (error) {
    if (error.code && error.code !== "ENOENT") throw error;
    return { reason: `output-corrupt-or-missing:${error.message}` };
  }
}

async function saveRecord(runtime, record) {
  const bytes = Buffer.from(JSON.stringify(record));
  if (bytes.length > MAX_RECORD_BYTES) {
    throw new Error(`Extraction cache record too large: ${record.id}`);
  }
  const identity = hash(bytes);
  await publishFile(
    resolve(runtime.directory, "records", `${identity}.json`),
    bytes,
  );
  await publishFile(
    resolve(runtime.directory, `${digest(record.id)}.json`),
    JSON.stringify({ record: identity }),
  );
}

async function runUnit(runtime, unit, build) {
  if (!/^[a-z][a-z0-9/-]{0,127}$/.test(unit.id) || !HASH.test(unit.recipe)) {
    throw new Error("Invalid extraction unit identity");
  }
  const started = performance.now();
  runtime.progress?.(
    `${unit.id}: ${runtime.full ? "bypassing cache (--full)" : "loading and verifying cache record"}`,
  );
  const checked = await probe(runtime, unit);
  if (checked.record) {
    for (const key of Object.keys(checked.record.sources)) {
      runtime.retain?.(key);
    }
    runtime.ledger.restore(checked.record.publication);
    runtime.evidence.hits++;
    runtime.evidence.reusedRGBABytes += checked.record.decodedRGBABytes;
    recordTiming(runtime, unit.id, {
      status: "hit",
      reason: "verified",
      started,
    });
    return checked.record.result;
  }
  runtime.evidence.misses++;
  try {
    runtime.progress?.(`${unit.id}: converting (${checked.reason})`);
    const record = await rebuildUnit(runtime, unit, build);
    runtime.progress?.(`${unit.id}: saving verified cache record`);
    await saveRecord(runtime, record);
    recordTiming(runtime, unit.id, {
      status: "rebuilt",
      reason: checked.reason,
      started,
    });
    return record.result;
  } catch (error) {
    recordTiming(runtime, unit.id, {
      status: "failed",
      reason: error.message,
      started,
    });
    throw error;
  }
}

async function rebuildUnit(runtime, unit, build) {
  const before = runtime.state.rgbaBytes;
  runtime.active = new Set(unit.sources ?? []);
  runtime.ledger.begin();
  let result, publication, sources;
  try {
    for (const key of runtime.active) runtime.source(key);
    result = await build();
    sources = sourceRecords(runtime);
  } finally {
    publication = runtime.ledger.finish();
    runtime.active = null;
  }
  runtime.progress?.(`${unit.id}: verifying converted output closure`);
  const outputs = await runtime.outputs.closure({
    result,
    publication: publication.delta,
  });
  return {
    schemaVersion: SCHEMA,
    id: unit.id,
    recipe: unit.recipe,
    prerequisites: digest(unit.prerequisites ?? null),
    sources,
    publication,
    outputs,
    result,
    requiredSources: digest([...(unit.sources ?? [])].sort()),
    decodedRGBABytes: runtime.state.rgbaBytes - before,
  };
}

function sourceRecords(runtime) {
  if (runtime.active.size > MAX_SOURCES) {
    throw new Error("Extraction source dependency limit exceeded");
  }
  const sources = Object.create(null);
  for (const key of [...runtime.active].sort()) {
    const { sha256, bytes } = runtime.source(key);
    runtime.retain?.(key);
    sources[key] = { sha256, bytes };
  }
  return sources;
}

function recordTiming(runtime, id, result) {
  const evidence = {
    id,
    status: result.status,
    reason: result.reason,
    elapsedMs: Math.round(performance.now() - result.started),
  };
  runtime.evidence.units.push(evidence);
  console.log(JSON.stringify({ extractionUnit: evidence }));
  runtime.progress?.(
    `${id}: ${result.status === "hit" ? "verified cache reused" : result.status === "rebuilt" ? "conversion complete" : "failed"} (${(evidence.elapsedMs / 1000).toFixed(2)}s; ${result.reason})`,
  );
}
