import { expect, test } from "bun:test";
import {
  requestPrompt,
  settlePrompt,
  submitPrompt,
} from "../src/ui/ui-prompt.js";
import { parseMesoAmount } from "../src/ui/ui-meso-dialog.js";

function promptOwner() {
  return {
    promptRequest: null,
    hooks: { clearInput() {} },
    modal: () => null,
    open: () => Promise.resolve(),
    close() {},
    report(error) {
      throw error;
    },
  };
}

function promptPanel(owner, value) {
  return {
    owner,
    promptState: owner.promptRequest,
    promptInput: { value, reportValidity: () => true },
  };
}

test("numeric prompt rejects malformed and out-of-range replies without settling", async () => {
  const owner = promptOwner();
  const reply = requestPrompt(owner, {
    kind: "number",
    text: "Quantity",
    min: 1,
    max: 25,
  });
  const panel = promptPanel(owner, "");
  for (const value of ["", "1e1", "1.5", "26", "0", "9007199254740992"]) {
    panel.promptInput.value = value;
    expect(submitPrompt(panel)).toBe(false);
  }
  panel.promptInput.value = "25";
  expect(submitPrompt(panel)).toBe(true);
  expect(await reply).toBe(25);
});

test("cancellation wins over a later submit and permits the next prompt", async () => {
  const owner = promptOwner();
  const controller = new AbortController();
  const reply = requestPrompt(owner, {
    kind: "number",
    text: "Quantity",
    min: 1,
    max: 25,
    signal: controller.signal,
  });
  const panel = promptPanel(owner, "10");
  controller.abort();
  expect(submitPrompt(panel)).toBe(false);
  expect(await reply).toBeNull();
  const next = requestPrompt(owner, { kind: "confirm", text: "Drop item?" });
  expect(settlePrompt(owner, owner.promptRequest, false)).toBe(true);
  expect(await next).toBe(false);
});

test("mesos amount honors both native bounds and the current balance", () => {
  expect(parseMesoAmount("10", 10)).toEqual({ ok: true, amount: 10 });
  expect(parseMesoAmount("50000", 100000)).toEqual({ ok: true, amount: 50000 });
  for (const [text, balance] of [
    ["9", 100],
    ["11", 10],
    ["50001", 100000],
    ["1e2", 100000],
    ["10", 9],
  ]) {
    expect(parseMesoAmount(text, balance).ok).toBe(false);
  }
});
