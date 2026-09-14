import { expect, test } from "bun:test";
import { OnlineUI } from "../src/online/ui.js";
import {
  nativeOutcome,
  NativeOperationRefusal,
} from "../src/online/native-source.js";

function owner(code) {
  const messages = [],
    errors = [];
  const ui = Object.assign(Object.create(OnlineUI.prototype), {
    pending: 0,
    transport: { command: async () => ({ status: "rejected", code }) },
    ui: { status: (text) => messages.push(text) },
    hooks: { report: (error) => errors.push(error) },
  });
  return { ui, messages, errors };
}

test("expected command refusals stay visible as feedback without entering the error journal", async () => {
  for (const code of ["SERVER_BUSY", "REQUIREMENTS_NOT_MET"]) {
    const { ui, messages, errors } = owner(code);
    const result = await ui.request({ kind: "equipment.equip" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(code);
    expect(messages).toEqual([result.reason]);
    expect(errors).toEqual([]);
    expect(ui.pending).toBe(0);
  }
});

test("persistence refuses its caller without relabeling the refusal as an unexpected exception", async () => {
  const { ui, errors } = owner("REQUIREMENTS_NOT_MET");
  await expect(ui.persist({ kind: "skill.allocate" })).rejects.toBeInstanceOf(
    NativeOperationRefusal,
  );
  ui.report(
    new NativeOperationRefusal(
      nativeOutcome({ status: "rejected", code: "SERVER_BUSY" }),
    ),
  );
  ui.report("No skill points available");
  expect(errors).toEqual([]);
  const exception = new TypeError("Unexpected renderer failure");
  ui.report(exception);
  expect(errors).toEqual([exception]);
});

test("online beginner skill controls display earned entitlement independently of ordinary SP", () => {
  const profile = { level: 5, skills: {}, remainingSp: Array(10).fill(0) };
  const ui = {
    catalog: {
      ui: {
        skills: { 1000: { allocationCost: { kind: "beginner-entitlement" } } },
      },
    },
    store: { profile },
  };
  expect(OnlineUI.prototype.skillPoints.call(ui, 1000)).toBe(4);
  profile.skills[1000] = { level: 2, expiresAt: null };
  expect(OnlineUI.prototype.skillPoints.call(ui, 1000)).toBe(2);
});
