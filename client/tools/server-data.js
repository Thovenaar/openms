import { readdir, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSql, MAX_SQL_BYTES } from "./sql-data.js";
import { hash, resource } from "./atlas.js";
import { compileNpcScript } from "./npc-script-compiler.js";
import { compileNpcRoutes } from "./npc-script-routes.js";
import { compileTutorialPortal } from "./portal-data.js";
import { TUTORIAL_PORTAL_PROGRAMS } from "../src/npc/npc-script-portals.js";

const DB_ROOT = "src/main/resources/db";
const MAX_FILES = 10000;
const MAX_SQL_FILES = 128;
const MAX_TOTAL_BYTES = 64000000;
const MAX_SCRIPT_BYTES = 1000000;
const MAX_TOTAL_ROWS = 200000;
const DOMAINS = Object.freeze({
  shops: ["shops", "shopitems"],
  drops: ["drop_data", "drop_data_global", "reactordrops"],
  crafting: [
    "makercreatedata",
    "makerrecipedata",
    "makerrewarddata",
    "makerreagentdata",
  ],
  cards: ["monstercarddata"],
  cash: ["specialcashitems", "nxcoupons"],
});
const AUTHORITY = "Cosmic-authorized-server-reference-not-original-client";

export function serverReferenceRoot(serverRoot) {
  return resolve(
    serverRoot ??
      Bun.env.MAPLE_SERVER_REFERENCE ??
      "/Users/k/Development/tensorfish/Cosmic",
  );
}

async function sourceFile(root, source, maximum) {
  const file = Bun.file(resolve(root, source));
  if (file.size > maximum) throw new Error(`Source byte limit: ${source}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > maximum) {
    throw new Error(`Source changed beyond byte limit: ${source}`);
  }
  return {
    source,
    bytes: bytes.length,
    sha256: hash(bytes),
    text: bytes.toString("utf8"),
  };
}

/** Directory walk is iterative, bounded, sorted, and refuses symbolic links. */
async function sourcePaths(root, directory, extension) {
  const queue = [directory],
    paths = [];
  let entries = 0;
  for (let index = 0; index < queue.length; index++) {
    const children = await readdir(resolve(root, queue[index]), {
      withFileTypes: true,
    });
    entries += children.length;
    if (entries > MAX_FILES) throw new Error("Server reference file limit");
    children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) {
      const path = `${queue[index]}/${child.name}`;
      if (child.isSymbolicLink()) {
        throw new Error(`Server reference symlink unsupported: ${path}`);
      }
      if (child.isDirectory()) queue.push(path);
      else if (child.isFile() && child.name.endsWith(extension)) {
        paths.push(path);
      }
    }
  }
  return paths.sort();
}

async function readSqlInventory(root) {
  const files = [],
    parsed = [];
  let bytes = 0;
  for (const directory of ["tables", "data"]) {
    const paths = await sourcePaths(root, `${DB_ROOT}/${directory}`, ".sql");
    if (paths.length + files.length > MAX_SQL_FILES) {
      throw new Error("SQL file limit");
    }
    for (const source of paths) {
      const file = await sourceFile(root, source, MAX_SQL_BYTES);
      bytes += file.bytes;
      if (bytes > MAX_TOTAL_BYTES) throw new Error("SQL aggregate byte limit");
      const sql = parseSql(file.text);
      parsed.push(sql);
      files.push({
        source,
        bytes: file.bytes,
        sha256: file.sha256,
        role: directory === "tables" ? "schema" : "companion-data",
        statements: sql.statementCount,
        schemas: sql.schemas.map((schema) => schema.table),
        inserts: sql.inserts.map((insert) => ({
          table: insert.table,
          columns: insert.columns,
          rows: insert.rowCount,
          convertedRows: insert.rows?.length ?? 0,
        })),
        unsupported: sql.unsupported,
      });
    }
  }
  return { files, parsed };
}

function collectTables(inventory) {
  const tables = Object.create(null);
  for (let index = 0; index < inventory.files.length; index++) {
    for (const schema of inventory.parsed[index].schemas) {
      if (tables[schema.table]) {
        throw new Error(`Duplicate SQL schema: ${schema.table}`);
      }
      tables[schema.table] = {
        ...schema,
        source: inventory.files[index].source,
        rows: 0,
        convertedRows: 0,
        dataSources: [],
      };
    }
  }
  let rows = 0;
  for (let index = 0; index < inventory.files.length; index++) {
    for (const insert of inventory.parsed[index].inserts) {
      const table = tables[insert.table];
      if (!table) {
        throw new Error(`INSERT has no supplied schema: ${insert.table}`);
      }
      const names = new Set(
        table.columns.map((column) => column.name.toLowerCase()),
      );
      for (const column of insert.columns) {
        if (!names.has(column.toLowerCase())) {
          throw new Error(`Unknown INSERT column: ${insert.table}.${column}`);
        }
      }
      table.rows += insert.rowCount;
      table.convertedRows += insert.rows ? insert.rows.length : 0;
      rows += insert.rowCount;
      if (rows > MAX_TOTAL_ROWS) {
        throw new Error("Server reference total row limit");
      }
      const source = inventory.files[index].source;
      if (!table.dataSources.includes(source)) table.dataSources.push(source);
    }
  }
  return tables;
}

/** Only numeric NPC sources have a unique original String.wz default-talk owner. */
function scriptDefaultTalk(source, defaultTalkForNpc) {
  const id = /^scripts\/npc\/(\d{1,8})\.js$/.exec(source)?.[1];
  if (!id || !defaultTalkForNpc) return undefined;
  return defaultTalkForNpc(Number(id));
}

async function scriptInventory(
  root,
  defaultTalkForNpc,
  staticConfig,
  originalQuestIds,
) {
  const paths = await sourcePaths(root, "scripts", ".js");
  const files = [],
    compilations = [],
    categories = Object.create(null);
  const portalPrograms = Object.create(null);
  let bytes = 0;
  for (const source of paths) {
    const file = await sourceFile(root, source, MAX_SCRIPT_BYTES);
    bytes += file.bytes;
    if (bytes > MAX_TOTAL_BYTES) throw new Error("Script aggregate byte limit");
    if (hash(Buffer.from(file.text, "utf8")) !== file.sha256) {
      throw new Error(
        `NPC source must round-trip original UTF-8 bytes: ${source}`,
      );
    }
    const parts = source.split("/");
    const category = parts.length > 2 ? parts[1] : "root";
    categories[category] = (categories[category] ?? 0) + 1;
    const record = { source, bytes: file.bytes, sha256: file.sha256 };
    if (category === "npc") {
      const compilation = compileNpcScript({
        text: file.text,
        path: source,
        sha256: file.sha256,
        defaultTalk: scriptDefaultTalk(source, defaultTalkForNpc),
        staticConfig,
        originalQuestIds,
      });
      compilations.push(compilation);
      record.sourceText = file.text;
      record.compilation = compilationSummary(compilation);
    }
    if (category === "portal") {
      const script = source.slice("scripts/portal/".length, -3);
      if (Object.hasOwn(TUTORIAL_PORTAL_PROGRAMS, script)) {
        portalPrograms[script] = compileTutorialPortal({
          script,
          text: file.text,
        });
      }
    }
    files.push(record);
  }
  return {
    status:
      "npc-complete-source-compiler; verified-tutorial-portals; other-categories-inventoried",
    categories,
    files,
    compilations,
    portalPrograms,
  };
}

function compilationSummary(compilation) {
  return {
    status: compilation.status,
    blockers: compilation.blockers,
    astNodes: compilation.astNodes,
    requirements: compilation.requirements,
    dependencies: compilation.dependencies,
  };
}

function domainData(name, tableNames, inventory, tables) {
  const records = Object.create(null),
    sources = [],
    tableSources = Object.create(null);
  for (const table of tableNames) {
    if (!tables[table]) throw new Error(`Missing reference schema: ${table}`);
    records[table] = [];
    tableSources[table] = [];
  }
  for (let index = 0; index < inventory.files.length; index++) {
    const file = inventory.files[index],
      sql = inventory.parsed[index];
    if (
      file.unsupported.length &&
      !file.source.endsWith("/161-admin-data.sql")
    ) {
      throw new Error(
        `Cannot publish incomplete SQL conversion: ${file.source}`,
      );
    }
    let used = false;
    for (const insert of sql.inserts) {
      if (!Object.hasOwn(records, insert.table)) continue;
      if (!insert.rows) {
        throw new Error(`Unsupported reference rows: ${insert.table}`);
      }
      tableSources[insert.table].push({
        source: file.source,
        sha256: file.sha256,
        bytes: file.bytes,
        firstRow: records[insert.table].length + 1,
        rowCount: insert.rows.length,
      });
      used = true;
      for (const row of insert.rows) {
        const record = Object.create(null);
        for (let column = 0; column < insert.columns.length; column++) {
          record[insert.columns[column]] = row[column];
        }
        records[insert.table].push(record);
      }
    }
    if (used) {
      sources.push({
        source: file.source,
        sha256: file.sha256,
        bytes: file.bytes,
      });
    }
  }
  return {
    schemaVersion: 1,
    authority: AUTHORITY,
    domain: name,
    sources,
    tables: records,
    tableSources,
  };
}

function inventorySummary(inventory, tables, scripts) {
  const rows = Object.values(tables);
  return {
    schemaFiles: inventory.files.filter((file) => file.role === "schema")
      .length,
    dataFiles: inventory.files.filter((file) => file.role === "companion-data")
      .length,
    tables: rows.length,
    schemaOnlyTables: rows.filter((table) => table.rows === 0).length,
    authoredRows: rows.reduce((total, table) => total + table.rows, 0),
    literalRows: rows.reduce((total, table) => total + table.convertedRows, 0),
    unsupportedStatements: inventory.files.reduce(
      (total, file) => total + file.unsupported.length,
      0,
    ),
    scripts: scripts.files.length,
    npcScriptsSupported: scripts.compilations.filter(
      (script) => script.status === "supported",
    ).length,
    npcScriptsBlocked: scripts.compilations.filter(
      (script) => script.status === "blocked",
    ).length,
  };
}

/** Publish only the closed NPC settings and hashes, never secret configuration text. */
async function npcRuntimePolicy(root) {
  const sources = [];
  const staticConfig = Object.create(null);
  let enhancedCrafting;
  for (const source of [
    "config.yaml",
    "src/main/java/client/Character.java",
    "src/main/java/scripting/AbstractPlayerInteraction.java",
    "src/main/java/scripting/npc/NPCScriptManager.java",
    "src/main/java/constants/inventory/ItemConstants.java",
    "src/main/java/scripting/npc/NPCConversationManager.java",
    "src/main/java/constants/game/GameConstants.java",
    "src/main/java/constants/id/MapId.java",
  ]) {
    const file = await sourceFile(root, source, MAX_SCRIPT_BYTES);
    if (source === "config.yaml") {
      const server = Bun.YAML.parse(file.text)?.server;
      enhancedCrafting = server?.USE_ENHANCED_CRAFTING;
      for (const key of [
        "USE_CPQ",
        "USE_ENABLE_SOLO_EXPEDITIONS",
        "USE_AUTOASSIGN_STARTERS_AP",
        "USE_STARTING_AP_4",
        "USE_ENFORCE_JOB_SP_RANGE",
      ]) {
        if (server?.[key] === undefined) continue;
        if (typeof server[key] !== "boolean") {
          throw new Error(`NPC server setting must be boolean: ${key}`);
        }
        staticConfig[key] = server[key];
      }
    }
    sources.push({ source, sha256: file.sha256, bytes: file.bytes });
  }
  if (enhancedCrafting !== false) {
    throw new Error(
      "Offline NPC equipment grants require server.USE_ENHANCED_CRAFTING=false",
    );
  }
  return {
    sources,
    enhancedCrafting,
    equipmentRandomStats: false,
    staticConfig,
  };
}

/** Convert authorized reference files. No source JavaScript or SQL is executed. */
export async function convertServerData(options = {}) {
  const root = serverReferenceRoot(options.serverRoot);
  const policy = await npcRuntimePolicy(root);
  const inventory = await readSqlInventory(root);
  const tables = collectTables(inventory);
  const scripts = await scriptInventory(
    root,
    options.defaultTalkForNpc,
    policy.staticConfig,
    options.originalQuestIds,
  );
  const datasets = Object.create(null);
  for (const [name, names] of Object.entries(DOMAINS)) {
    datasets[name] = domainData(name, names, inventory, tables);
  }
  Object.assign(
    datasets.shops,
    compileNpcRoutes(datasets.shops.tables, scripts.compilations),
  );
  datasets.shops.sources.push(...policy.sources);
  datasets.shops.npcCraftingPolicy = {
    enhancedCrafting: policy.enhancedCrafting,
    equipmentRandomStats: policy.equipmentRandomStats,
  };
  const summary = inventorySummary(inventory, tables, scripts);
  summary.npcRoutes = datasets.shops.routeSummary;
  const report = {
    schemaVersion: 2,
    authority: AUTHORITY,
    sqlFiles: inventory.files,
    tables: Object.values(tables),
    scripts: {
      status: scripts.status,
      categories: scripts.categories,
      files: scripts.files,
      portalPrograms: scripts.portalPrograms,
    },
    exclusions: [
      "Account, character, inventory, keymap and storage bootstrap rows are not browser reference data; no credentials are published.",
      "Schema-only tables contain no world content. SQL defaults are not seed rows.",
      "NPC compilation admits bounded closed syntax; unknown constructs block a route. Recognized unavailable services stop the selected step before durable effects commit. Four hash-verified tutorial portal programs are admitted; other script categories remain inventories.",
      "SQL prices/drop chances are Cosmic server policy, not original Nexon client authority.",
    ],
    summary,
  };
  return { report, datasets };
}

/** Uses the same immutable resource publisher and descriptor contract as extraction. */
export async function extractServerData(options) {
  if (!options?.output) {
    throw new Error("Server data output directory is required");
  }
  const output = resolve(options.output);
  const converted = options.converted ?? (await convertServerData(options));
  await mkdir(resolve(output, "references"), { recursive: true });
  const datasets = Object.create(null);
  for (const [name, data] of Object.entries(converted.datasets)) {
    datasets[name] = await resource(
      output,
      "references",
      "json",
      Buffer.from(JSON.stringify(data)),
    );
  }
  const report = await resource(
    output,
    "references",
    "json",
    Buffer.from(JSON.stringify(converted.report)),
  );
  return {
    schemaVersion: 2,
    authority: AUTHORITY,
    datasets,
    report,
    summary: converted.report.summary,
    supportedItemIds: converted.datasets.shops.supportedItemIds,
    supportedDependencies: converted.datasets.shops.supportedDependencies,
  };
}

function cliOptions(args) {
  const options = {};
  if (args.length > 4) throw new Error("Too many server-data arguments");
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index],
      value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${name}`);
    }
    if (name === "--server-root" && !options.serverRoot) {
      options.serverRoot = value;
    } else if (name === "--output" && !options.output) options.output = value;
    else throw new Error(`Unknown or duplicate option: ${name}`);
  }
  return options;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: bun client/tools/server-data.js --output DIR [--server-root COSMIC]\n" +
        "Default root: MAPLE_SERVER_REFERENCE or /Users/k/Development/tensorfish/Cosmic\n" +
        "Inventories every db/tables and db/data SQL file and scripts/**/*.js.\n" +
        "Writes immutable references/{sha256}.json; stdout is deterministic descriptor JSON.\n" +
        "Domains: shops, drops, crafting, cards, cash. Report includes hashes, schemas, row counts, unsupported statements and script identities.\n" +
        "Only CREATE TABLE and literal INSERT VALUES are interpreted; bootstrap SQL subqueries are reported, never executed. Credentials are excluded.\n" +
        "Limits: 16MB/SQL file, 128 SQL files, 100000 rows/SQL file, 200000 total rows, 10000 filesystem entries, 1MB/script, 64MB per source family.\n" +
        "SQL/reference parse failures stop publication; unsupported admin bootstrap expressions are report-only.",
    );
  } else {
    const result = await extractServerData(cliOptions(args));
    console.log(JSON.stringify(result));
  }
}
