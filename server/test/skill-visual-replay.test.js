import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import { AuthoritySkillResources } from "../src/skill-resources.js";
import { SkillWorldEffects } from "../../client/src/skills/skill-world-effects.js";
import { validate } from "../../shared/schema.js";
import { COMBAT_EVENT_SCHEMAS } from "../../shared/combat-protocol.js";

const content = await loadContent();

test("reusing the original Flash Jump artwork publishes a new playback at the new origin", async () => {
  const resources = new AuthoritySkillResources({ content }, {}, {}, {});
  const descriptor = content.catalog.ui.skillWorld.effects.Flying;
  const owner = await resources.loadVisual(descriptor.bundle);
  const animation = resources.createAnimation(
    owner.manifest.entities[0],
    owner.textures,
  );
  const effects = new SkillWorldEffects({});
  effects.records.set("Flying", {
    slots: [{ animation, remainingMs: 0 }],
    durationMs: descriptor.durationMs,
  });
  effects.play(4111006, { x: 131, y: 243, facing: 1 });
  effects.step(540);
  const first = resources.view(animation);
  expect(first.elapsedMs).toBe(540);
  // A second jump can arrive before the authored 600 ms effect expires.
  effects.play(4111006, { x: 402, y: 200, facing: -1 });
  const second = resources.view(animation);
  expect(second.id).toBe(first.id);
  expect(second.playbackId).not.toBe(first.playbackId);
  expect(second.elapsedMs).toBe(0);
  expect(second.position).toEqual({ x: 402, y: 200 });
  expect(second.scaleX).toBe(1);
  expect(() =>
    validate(
      { kind: "skill.visual", actorId: "player", visual: second },
      COMBAT_EVENT_SCHEMAS["skill.visual"],
    ),
  ).not.toThrow();
  animation.setAction("play", "once");
  animation.advance(90);
  expect(resources.view(animation).playbackId).toBe(second.playbackId);
  animation.container.destroy();
  owner.destroy();
});
