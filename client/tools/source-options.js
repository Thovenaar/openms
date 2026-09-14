import { resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = resolve(import.meta.dir, "../..");

/** Explicit CLI/programmatic inputs; defaults are repository-relative, never ambient environment. */
export function sourcePaths(options = {}) {
  if (
    options.serverRoot !== undefined ||
    options.serverReference !== undefined ||
    options.scriptsRoot !== undefined
  ) {
    throw new Error(
      "Source options were renamed; use gameplayDefinitionsRoot for local gameplay definitions",
    );
  }
  return {
    assets: resolve(options.assets ?? resolve(ROOT, "../Maplestory-Client")),
    gameplayDefinitionsRoot: resolve(
      options.gameplayDefinitionsRoot ??
        resolve(ROOT, "infra/gameplay-definitions"),
    ),
    sqlRoot: resolve(options.sqlRoot ?? resolve(ROOT, "infra/sql")),
    cacheDir: resolve(
      options.cacheDir ?? resolve(ROOT, "client/.cache/extraction"),
    ),
  };
}

/** Bound arguments and reject unknown/duplicate flags before starting expensive work. */
export function parseFlags(args, options) {
  if (args.length > 64 || args.some((value) => value.length > 4096)) {
    throw new Error("CLI argument limit exceeded");
  }
  const { values, tokens } = parseArgs({
    args,
    options,
    tokens: true,
    strict: true,
    allowPositionals: false,
  });
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) {
      throw new Error(`Duplicate option: --${token.name}`);
    }
    seen.add(token.name);
  }
  for (const [name, value] of Object.entries(values)) {
    if (
      typeof value === "string" &&
      (!value.trim() || value.startsWith("--"))
    ) {
      throw new Error(`Missing value for --${name}`);
    }
  }
  return values;
}

/** Parent tools forward paths as flags; no environment-based child configuration. */
export function sourceFlags(options) {
  const paths = sourcePaths(options);
  return [
    "--assets",
    paths.assets,
    "--gameplay-definitions-root",
    paths.gameplayDefinitionsRoot,
    "--sql-root",
    paths.sqlRoot,
    "--cache-dir",
    paths.cacheDir,
  ];
}

export function inventoryOptions(args, output) {
  const values = parseFlags(args, {
    assets: { type: "string" },
    output: { type: "string", default: output },
    help: { type: "boolean", default: false },
  });
  return {
    ...values,
    assets: sourcePaths(values).assets,
    output: resolve(values.output),
  };
}
