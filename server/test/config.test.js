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

test("the motion watchdog defaults off and accepts explicit true/false in either mode", () => {
  for (const mode of ["production", "development"]) {
    const base = environment({ OPENMS_MODE: mode });
    expect(serverConfig(base).watchdogEnabled).toBe(false);
    for (const value of ["true", "false"]) {
      expect(
        serverConfig({ ...base, OPENMS_MOTION_WATCHDOG_ENABLED: value })
          .watchdogEnabled,
      ).toBe(value === "true");
    }
  }
  for (const value of ["", "1", "0", "yes", "FALSE", "tru"]) {
    expect(() =>
      serverConfig(environment({ OPENMS_MOTION_WATCHDOG_ENABLED: value })),
    ).toThrow("OPENMS_MOTION_WATCHDOG_ENABLED must be true or false");
  }
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
