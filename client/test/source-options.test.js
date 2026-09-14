import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  sourcePaths,
  parseFlags,
  sourceFlags,
  inventoryOptions,
} from "../tools/source-options.js";
import { cliOptions } from "../tools/server-data.js";
import { preflightOptions } from "../tools/preflight.js";

test("tool defaults and explicit flags ignore legacy environment overrides", () => {
  const keys = [
    "MAPLE_ASSETS",
    "MAPLE_SERVER_REFERENCE",
    "MAPLE_EXTRACTION_CACHE",
  ];
  const previous = keys.map((key) => process.env[key]);
  try {
    for (const key of keys) process.env[key] = "/unintended-environment-path";
    const defaults = sourcePaths();
    expect(defaults.assets).toBe(
      resolve(import.meta.dir, "../../../Maplestory-Client"),
    );
    expect(defaults.gameplayDefinitionsRoot).toBe(
      resolve(import.meta.dir, "../../infra/gameplay-definitions"),
    );
    expect(defaults.cacheDir).toBe(
      resolve(import.meta.dir, "../.cache/extraction"),
    );
    expect(defaults.sqlRoot).toBe(resolve(import.meta.dir, "../../infra/sql"));
    const config = preflightOptions([
      "--assets",
      "/explicit-wz",
      "--gameplay-definitions-root",
      "/explicit-gameplay-definitions",
      "--sql-root",
      "/explicit-sql",
    ]);
    expect(config).toMatchObject({
      assets: "/explicit-wz",
      gameplayDefinitionsRoot: "/explicit-gameplay-definitions",
      sqlRoot: "/explicit-sql",
    });
    expect(sourceFlags({ ...config, cacheDir: "/explicit-cache" })).toEqual([
      "--assets",
      "/explicit-wz",
      "--gameplay-definitions-root",
      "/explicit-gameplay-definitions",
      "--sql-root",
      "/explicit-sql",
      "--cache-dir",
      "/explicit-cache",
    ]);
  } finally {
    for (let index = 0; index < keys.length; index++) {
      if (previous[index] === undefined) delete process.env[keys[index]];
      else process.env[keys[index]] = previous[index];
    }
  }
});

test("CLI boundaries reject unknown, repeated, missing and conflicting flags", () => {
  for (const args of [
    ["--wrong", "x"],
    ["--assets"],
    ["--assets", ""],
    ["--assets", "a", "--assets", "b"],
    ["positional"],
  ]) {
    expect(() => parseFlags(args, { assets: { type: "string" } })).toThrow();
  }
  expect(() =>
    preflightOptions(["--map", "100000000", "--maps", "100000001"]),
  ).toThrow();
  for (const flag of [
    "--server-root",
    "--server-reference",
    "--scripts-root",
  ]) {
    expect(() => cliOptions([flag, "/unused"])).toThrow();
  }
  expect(() => sourcePaths({ serverRoot: "/unused" })).toThrow();
  expect(() => sourcePaths({ serverReference: "/unused" })).toThrow();
  expect(() => sourcePaths({ scriptsRoot: "/unused" })).toThrow();
  expect(
    cliOptions([
      "--gameplay-definitions-root",
      "/gameplay-definitions",
      "--sql-root",
      "/sql",
      "--output",
      "/output",
    ]),
  ).toEqual({
    gameplayDefinitionsRoot: "/gameplay-definitions",
    sqlRoot: "/sql",
    output: "/output",
  });
  expect(
    inventoryOptions(["--assets", "/wz", "--output", "/report"], "unused"),
  ).toMatchObject({ assets: "/wz", output: "/report" });
});
