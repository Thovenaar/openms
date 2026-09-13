import { expect, test } from "bun:test";
import { NpcWorldPresentation } from "../src/npc/npc-world-presentation.js";

function fixture(marker = -1) {
  const shown = [];
  let speech = { actionIndex: 0, lineIndex: 0, startTick: 10 };
  const presenter = Object.create(NpcWorldPresentation.prototype);
  presenter.options = { speech: () => speech, tick: () => 20 };
  const slot = {
    life: { record: { id: "life:13" } },
    state: marker,
    speechStartTick: null,
    speech: { remainingMs: -1, showPrepared: (line) => shown.push(line.text) },
    lines: [{ text: "global" }],
    actions: [{ lines: [{ text: "authored action line" }] }],
  };
  return {
    presenter,
    slot,
    shown,
    replace: (value) => {
      speech = value;
    },
  };
}

test("online NPC prose resumes its server clock without replaying on duplicate publication", () => {
  const probe = fixture();
  probe.presenter.observeAmbient(probe.slot);
  expect(probe.shown).toEqual(["authored action line"]);
  expect(probe.slot.speechTickMs).toBe(300);
  probe.presenter.observeAmbient(probe.slot);
  expect(probe.shown.length).toBe(1);
  probe.replace(null);
  probe.presenter.observeAmbient(probe.slot);
  expect(probe.slot.speech.remainingMs).toBe(-1);
});

test("server-published quest markers suppress ambient prose and unknown line IDs fail closed", () => {
  const probe = fixture(1);
  probe.presenter.observeAmbient(probe.slot);
  expect(probe.shown).toEqual([]);
  probe.replace({ actionIndex: 99, lineIndex: 0, startTick: 30 });
  expect(() => probe.presenter.observeAmbient(probe.slot)).toThrow(
    "unknown original NPC utterance",
  );
});
