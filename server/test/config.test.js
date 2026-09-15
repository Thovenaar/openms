import { expect, test } from "bun:test";
import { serverConfig } from "../src/config.js";

function environment(overrides = {}) {
  return {
    OPENMS_MODE: "production",
    OPENMS_POW_BITS: "8",
    DATABASE_URL: "postgres://unused.invalid/config_test",
    ...overrides,
  };
}

test("production runs without a rules pin", () => {
  expect(serverConfig(environment()).expectedRulesHash).toBe(null);
  expect(
    serverConfig(environment({ OPENMS_RULES_HASH: "" })).expectedRulesHash,
  ).toBe(null);
});

test("a configured rules pin must be a lowercase SHA-256 digest", () => {
  const hash = "a".repeat(64);
  for (const mode of ["production", "development"]) {
    expect(
      serverConfig(environment({ OPENMS_MODE: mode, OPENMS_RULES_HASH: hash }))
        .expectedRulesHash,
    ).toBe(hash);
  }
  for (const invalid of [
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    "z".repeat(64),
    `${"a".repeat(64)} `,
  ]) {
    expect(() =>
      serverConfig(environment({ OPENMS_RULES_HASH: invalid })),
    ).toThrow("OPENMS_RULES_HASH must be a 64-character lowercase SHA-256");
  }
});
