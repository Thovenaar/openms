import { expect, test } from "bun:test";
import {
  NativeSkillPresentation,
  skillEffectDepth,
} from "../src/online/native-skill-presentation.js";

/** Minimal native animation double; chase state lives on the presentation entry. */
function animationDouble() {
  const container = {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    alpha: 1,
    visible: true,
    zIndex: 0,
  };
  return {
    container,
    current: { ends: [10, 20] },
    setAction() {},
    seek() {},
    setTint() {},
    advance() {},
    setPosition(x, y) {
      container.position.x = x;
      container.position.y = y;
    },
  };
}

function visualState(position) {
  return {
    action: "default",
    playback: "loop",
    playbackId: 0,
    sourceFrame: null,
    elapsedMs: 0,
    position,
    tint: 0xffffff,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
    depth: 0,
  };
}

test("observed projectiles chase 11 Hz samples instead of snapping each publication", () => {
  const presentation = new NativeSkillPresentation({});
  const entry = {
    id: "projectile",
    state: visualState({ x: 100, y: 0 }),
    animation: animationDouble(),
    owners: [],
  };
  presentation.applyVisual(entry);
  expect(entry.animation.container.position.x).toBe(100);

  entry.state = visualState({ x: 200, y: 0 });
  presentation.applyVisual(entry);
  expect(entry.animation.container.position.x).toBe(100);
  presentation.chase(entry, 45);
  expect(entry.animation.container.position.x).toBeCloseTo(150);
  presentation.chase(entry, 45);
  expect(entry.animation.container.position.x).toBeCloseTo(200);
  // A completed chase stays put until the next authenticated sample.
  presentation.chase(entry, 90);
  expect(entry.animation.container.position.x).toBeCloseTo(200);
});

test("a new observed actor snaps to its first authenticated position", () => {
  const presentation = new NativeSkillPresentation({});
  const entry = {
    id: "fresh",
    state: visualState({ x: -40, y: 12 }),
    animation: animationDouble(),
    owners: [],
  };
  presentation.applyVisual(entry);
  expect(entry.animation.container.position).toEqual({ x: -40, y: 12 });
});

test("a consecutive pooled cast starts at its own origin even during an unfinished chase", () => {
  const presentation = new NativeSkillPresentation({});
  const entry = {
    state: visualState({ x: 131, y: 243 }),
    animation: animationDouble(),
  };
  presentation.applyVisual(entry);
  entry.state = visualState({ x: 150, y: 230 });
  presentation.applyVisual(entry);
  presentation.chase(entry, 30);
  entry.state = {
    ...visualState({ x: 402, y: 200 }),
    playback: "once",
    playbackId: 1,
    // Restart detection must survive a missed early sample, not infer elapsed rollback.
    elapsedMs: 90,
    scaleX: -1,
  };
  presentation.applyVisual(entry);
  expect(entry.animation.container.position).toEqual({ x: 402, y: 200 });
  expect(entry.animation.container.scale.x).toBe(-1);
  presentation.chase(entry, 30);
  expect(entry.animation.container.position).toEqual({ x: 402, y: 200 });
  // Subsequent updates in this playback still interpolate normally.
  entry.state = { ...entry.state, position: { x: 492, y: 110 } };
  presentation.applyVisual(entry);
  presentation.chase(entry, 45);
  expect(entry.animation.container.position).toEqual({ x: 447, y: 155 });
});

test("observed skill artwork draws on the native effect layer above actors", () => {
  expect(skillEffectDepth(0)).toBe(398500);
  expect(skillEffectDepth(420)).toBe(398920);
  expect(skillEffectDepth(undefined)).toBe(398500);
  const presentation = new NativeSkillPresentation({});
  const entry = {
    id: "effect",
    state: { ...visualState({ x: 0, y: 0 }), depth: 25 },
    animation: animationDouble(),
    owners: [],
  };
  presentation.applyVisual(entry);
  expect(entry.animation.container.zIndex).toBe(398525);
});
