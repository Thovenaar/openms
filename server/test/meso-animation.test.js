import { expect, test } from "bun:test";
import { loadContent } from "../src/content.js";
import {
  AuthoritySkillResources,
  authorityLayer,
} from "../src/skill-resources.js";
import { SkillTargetController } from "../../client/src/skills/skill-target-controller.js";

const content = await loadContent();
const skill = content.catalog.ui.skills[4211006];

async function fixture(random = () => 0) {
  const events = [];
  const scene = {
    simulation: { x: 700, y: 800, facing: 1 },
    overlays: authorityLayer(),
  };
  const hooks = { random };
  const resources = new AuthoritySkillResources(
    { content, broadcast: (field, message) => events.push(message.event) },
    { id: "player", field: {} },
    scene,
    hooks,
  );
  hooks.createAnimation = resources.createAnimation.bind(resources);
  hooks.loadVisual = resources.loadVisual.bind(resources);
  hooks.drops = () => ({ consumeExplosion: () => {} });
  const system = {
    resources,
    hooks,
    hit: () => {
      throw new Error("Monster-centered explosion");
    },
  };
  const controller = new SkillTargetController(system);
  controller.field = {
    beginTargetSkill: (entry, info, onHit) => {
      expect(onHit).toBeNull();
    },
  };
  await controller.mesoPresentation.prepare(
    skill,
    content.catalog.ui.dropArtwork,
  );
  return { controller, resources, events, scene };
}

function cast(controller, count) {
  controller.count = count;
  for (let index = 0; index < count; index++) {
    controller.selected[index] = {
      x: index * 10,
      y: 303,
      groundX: index * 10,
      groundY: 300,
      quantity: 10,
    };
  }
  expect(controller.mesoPresentation.admissionError(count)).toBeNull();
  controller.cast(skill, skill.levels[30], 30);
}

test("twenty piles explode at their landing points without any monster target", async () => {
  const { controller, resources, events, scene } = await fixture();
  try {
    cast(controller, 20);
    const visuals = resources.views();
    expect(visuals).toHaveLength(20);
    expect(new Set(visuals.map((v) => v.bundle.sha256))).toEqual(
      new Set([skill.visuals["hit/0"].bundle.sha256]),
    );
    for (const [index, visual] of visuals.entries()) {
      expect(visual.position).toEqual({ x: (19 - index) * 10, y: 288 });
      expect(visual.scaleX).toBe(1);
    }
    expect(events.filter((event) => event.kind === "skill.sound")).toHaveLength(
      1,
    );
    scene.simulation.x += 100;
    scene.simulation.facing = -1;
    controller.piles[0].groundX = 900;
    resources.step(150);
    expect(resources.views().map((v) => v.position)).toEqual(
      visuals.map((v) => v.position),
    );
    resources.step(360);
    expect(resources.views()).toHaveLength(0);
    expect(controller.mesoPresentation.admissionError(20)).toBeNull();
  } finally {
    resources.destroy();
  }
});

test("the original nine hit variants are selected independently of caster facing", async () => {
  let index = 0;
  const { controller, resources } = await fixture(() => (index++ + 0.5) / 9);
  try {
    cast(controller, 9);
    const visuals = resources.views();
    for (let variant = 0; variant < 9; variant++) {
      const visual = visuals.find(
        (entry) =>
          entry.bundle.sha256 === skill.visuals[`hit/${variant}`].bundle.sha256,
      );
      expect(visual.position).toEqual({ x: variant * 10, y: 288 });
      expect(visual.scaleX).toBe(1);
    }
    const sequence = controller.mesoPresentation.sequences[0];
    sequence.freeCount = 0;
    expect(controller.mesoPresentation.admissionError(1)).toBe(
      "Meso Explosion visual slots are busy",
    );
  } finally {
    resources.destroy();
  }
});

test("currency thresholds select the native initial-canvas Y correction", async () => {
  const { controller, resources } = await fixture();
  try {
    const quantities = [49, 50, 99, 100, 999, 1000];
    controller.count = quantities.length;
    for (const [index, quantity] of quantities.entries()) {
      controller.selected[index] = {
        x: index * 10,
        y: 303,
        groundX: index * 10,
        groundY: 300,
        quantity,
      };
    }
    controller.cast(skill, skill.levels[30], 30);
    const visuals = resources.views();
    for (let index = 0; index < quantities.length; index++) {
      expect(
        visuals.find((visual) => visual.position.x === index * 10).position.y,
      ).toBe(index < 3 ? 288 : 285);
    }
  } finally {
    resources.destroy();
  }
});
