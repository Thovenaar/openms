import { expect, test } from "bun:test";
import { OnlineLogin } from "../src/online/login.js";

function fixture(prepared = true) {
  const owner = Object.create(OnlineLogin.prototype);
  owner.selected = 0;
  owner.visible = true;
  const poses = [];
  const preview = {
    pose: { action: "stand1", facing: -1, state: "ground" },
    prepared: prepared ? { pose: (value) => poses.push({ ...value }) } : null,
    controller: new AbortController(),
    generation: 1,
  };
  const character = { id: "character" };
  return { owner, slot: { index: 0, character, preview }, character, poses };
}

test("roster selection changes walk/stand pose without replacing character artwork", () => {
  const { owner, slot, character, poses } = fixture();
  owner.renderRosterPreview(slot, character);
  owner.selected = 1;
  owner.renderRosterPreview(slot, character);
  expect(poses.map((pose) => pose.action)).toEqual(["walk1", "stand1"]);
  expect(poses.every((pose) => pose.facing === -1)).toBe(true);
  expect(slot.preview.generation).toBe(1);
  expect(slot.preview.controller.signal.aborted).toBe(false);
});

test("selection during portrait preparation retains the load and the latest pose", () => {
  const { owner, slot, character } = fixture(false);
  owner.renderRosterPreview(slot, character);
  expect(slot.preview.pose.action).toBe("walk1");
  owner.selected = 3;
  owner.renderRosterPreview(slot, character);
  expect(slot.preview.pose.action).toBe("stand1");
  expect(slot.preview.generation).toBe(1);
  expect(slot.preview.controller.signal.aborted).toBe(false);
});
