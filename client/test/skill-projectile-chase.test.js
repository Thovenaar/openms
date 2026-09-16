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

/** Reconcile scratch with no retained rows, as an older state snapshot produces. */
function emptyObservation() {
  return { retained: new Set(), retainedVoices: new Set(), pending: [] };
}

function visualEvent(id) {
  return {
    actorId: "peer",
    visual: {
      ...visualState({ x: 0, y: 0 }),
      id,
      bundle: { sha256: "bundle" },
    },
  };
}

test("an event-created skill visual survives the snapshot that predates it", () => {
  const presentation = new NativeSkillPresentation({});
  presentation.prepareVisual = async (entry) => {
    entry.animation = null;
  };
  const released = [];
  presentation.releaseVisual = (entry) => {
    released.push(entry.id);
    presentation.visuals.delete(entry.id);
  };
  // A `skill.visual` event arrives immediately, but the state frame naming it is acked and
  // can still be older than the event at high latency.
  const entry = presentation.retainVisual(visualEvent("v1"), null, false);
  expect(entry.unconfirmed).toBe(true);
  presentation.reconcileObservation(emptyObservation());
  expect(presentation.visuals.has("v1")).toBe(true);
  // One later snapshot has had the chance to confirm it; still absent, it is released.
  presentation.reconcileObservation(emptyObservation());
  expect(presentation.visuals.has("v1")).toBe(false);
  expect(released).toEqual(["v1"]);
});

test("a snapshot-confirmed skill visual releases as soon as its snapshot omits it", () => {
  const presentation = new NativeSkillPresentation({});
  presentation.prepareVisual = async (entry) => {
    entry.animation = null;
  };
  presentation.releaseVisual = (entry) => presentation.visuals.delete(entry.id);
  presentation.retainVisual(visualEvent("v1"), null, true);
  expect(presentation.visuals.get("v1").unconfirmed).toBe(false);
  presentation.reconcileObservation(emptyObservation());
  expect(presentation.visuals.has("v1")).toBe(false);
});

test("an observed projectile flies the published plan instead of chasing samples", () => {
  const presentation = new NativeSkillPresentation({});
  const entry = {
    id: "ball",
    state: {
      ...visualState({ x: 0, y: -28 }),
      flight: {
        startX: 0,
        startY: -28,
        endX: 150,
        endY: -21,
        durationMs: 1000,
        delayMs: 0,
      },
    },
    animation: animationDouble(),
    owners: [],
  };
  presentation.applyVisual(entry);
  expect(entry.animation.container.position.x).toBe(0);
  // The same linear progress the thrower's preview and the authority's flight slot use.
  presentation.chase(entry, 500);
  expect(entry.animation.container.position.x).toBeCloseTo(75);
  expect(entry.animation.container.position.y).toBeCloseTo(-24.5);
  presentation.chase(entry, 500);
  expect(entry.animation.container.position.x).toBeCloseTo(150);
  expect(entry.animation.container.position.y).toBeCloseTo(-21);
});

test("a delayed projectile is hidden until its authored launch", () => {
  const presentation = new NativeSkillPresentation({});
  const entry = {
    id: "ball",
    state: {
      ...visualState({ x: 0, y: 0 }),
      flight: {
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 0,
        durationMs: 200,
        delayMs: 120,
      },
    },
    animation: animationDouble(),
    owners: [],
  };
  presentation.applyVisual(entry);
  expect(entry.animation.container.visible).toBe(false);
  presentation.chase(entry, 60);
  expect(entry.animation.container.visible).toBe(false);
  presentation.chase(entry, 60);
  expect(entry.animation.container.visible).toBe(true);
  expect(entry.animation.container.position.x).toBeCloseTo(0);
  presentation.chase(entry, 100);
  expect(entry.animation.container.position.x).toBeCloseTo(50);
});

test("a completed projectile flight is retired at its authored endpoint", () => {
  const presentation = new NativeSkillPresentation({});
  presentation.scene = presentation.owner.scene;
  const released = [];
  presentation.releaseVisual = (entry) => {
    released.push(entry.id);
    presentation.visuals.delete(entry.id);
  };
  const entry = {
    id: "ball",
    state: {
      ...visualState({ x: 0, y: 0 }),
      flight: {
        startX: 0,
        startY: 0,
        endX: 100,
        endY: 0,
        durationMs: 200,
        delayMs: 0,
      },
    },
    animation: animationDouble(),
    owners: [],
  };
  presentation.visuals.set("ball", entry);
  presentation.applyVisual(entry);
  presentation.update(100);
  expect(released).toEqual([]);
  presentation.update(150);
  expect(released).toEqual(["ball"]);
});
