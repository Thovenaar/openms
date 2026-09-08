import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { createHitboxState, updateHitboxes } from "./physics/hitboxes.js";

// Inspection policies, not original physics constants.
const LABEL_CAPACITY = 80;
const LABEL_CANDIDATE_CAPACITY = LABEL_CAPACITY * 8;
const READOUT_INTERVAL_MS = 200;
const VELOCITY_SCALE = 0.2;
const SHAPE_NAMES = ["body", "attack", "damage"];
const SHAPE_COLORS = [0x00ffff, 0xffbb00, 0xff55aa];

/** @param {Container} parent @param {number} color */
function lineSprite(parent, color) {
  const sprite = new Sprite(Texture.WHITE);
  sprite.tint = color;
  parent.addChild(sprite);
  return sprite;
}

/** @param {Container} parent @param {number} color */
function rectangleSprites(parent, color) {
  const edges = [];
  for (let index = 0; index < 4; index++) edges.push(lineSprite(parent, color));
  return edges;
}

/** @param {Sprite[]} edges @param {object} shape */
function placeRectangle(edges, shape) {
  const active = shape.active === true;
  for (let index = 0; index < edges.length; index++) {
    edges[index].visible = active;
  }
  if (!active) return;
  const width = shape.right - shape.left;
  const height = shape.bottom - shape.top;
  edges[0].position.set(shape.left, shape.top);
  edges[0].width = width;
  edges[0].height = 1;
  edges[1].position.set(shape.left, shape.bottom);
  edges[1].width = width;
  edges[1].height = 1;
  edges[2].position.set(shape.left, shape.top);
  edges[2].width = 1;
  edges[2].height = height;
  edges[3].position.set(shape.right, shape.top);
  edges[3].width = 1;
  edges[3].height = height;
}

/** @param {Container} parent */
function makeLabels(parent) {
  const labels = [];
  for (let index = 0; index < LABEL_CAPACITY; index++) {
    const label = new Text({
      text: "",
      style: {
        fontFamily: "monospace",
        fontSize: 10,
        fill: 0xffffff,
        stroke: { color: 0x001a08, width: 2 },
      },
    });
    label.visible = false;
    parent.addChild(label);
    labels.push(label);
  }
  return labels;
}

/** @param {object} overlay @param {object} scene */
function drawFootholds(overlay, scene) {
  const geometry = scene.manifest.physics;
  overlay.lines.clear();
  for (const foothold of geometry.footholds) {
    overlay.lines.moveTo(foothold.x1, foothold.y1);
    overlay.lines.lineTo(foothold.x2, foothold.y2);
  }
  overlay.lines.stroke({ color: 0x55ff66, width: 1 });
  for (const ladder of geometry.ladders) {
    overlay.lines.moveTo(ladder.x, ladder.y1);
    overlay.lines.lineTo(ladder.x, ladder.y2);
  }
  overlay.lines.stroke({ color: 0xffff99, width: 1 });
  overlay.manifest = scene.manifest;
}

/** @param {object} foothold @param {object} scene @param {object} screen */
function inView(foothold, scene, screen) {
  const left = scene.camera.x;
  const top = scene.camera.y;
  return (
    Math.max(foothold.x1, foothold.x2) >= left &&
    Math.min(foothold.x1, foothold.x2) <= left + screen.width &&
    Math.max(foothold.y1, foothold.y2) >= top &&
    Math.min(foothold.y1, foothold.y2) <= top + screen.height
  );
}

/** Reject overlapping label rectangles in world coordinates; camera translation is shared. */
function overlapsLabel(label, labels, count) {
  const right = label.x + label.width + 4;
  const bottom = label.y + label.height + 3;
  for (let index = 0; index < count; index++) {
    const previous = labels[index];
    if (
      label.x < previous.x + previous.width + 4 &&
      right > previous.x &&
      label.y < previous.y + previous.height + 3 &&
      bottom > previous.y
    ) {
      return true;
    }
  }
  return false;
}

/** At most three rows per candidate; text measurement stays in the inspection sampler. */
function placeLabel(overlay, foothold, count) {
  const label = overlay.labels[count];
  label.text = `${foothold.id} prev=${foothold.prevId} next=${foothold.nextId}`;
  label.x = (foothold.x1 + foothold.x2) / 2;
  const y = (foothold.y1 + foothold.y2) / 2 - label.height - 3;
  for (let row = 0; row < 3; row++) {
    label.y = y - row * (label.height + 3);
    if (overlapsLabel(label, overlay.labels, count)) continue;
    label.visible = true;
    return true;
  }
  label.visible = false;
  return false;
}

/** Label strings change only in the bounded inspection sampler, not physics ticks. */
function updateLabels(overlay, scene) {
  let visible = 0;
  let omitted = 0;
  let considered = 0;
  const current = scene.simulation.foothold;
  if (current && inView(current, scene, overlay.app.screen)) {
    placeLabel(overlay, current, visible++);
  }
  for (const foothold of scene.simulation.geometry.segments) {
    if (foothold === current || !inView(foothold, scene, overlay.app.screen)) {
      continue;
    }
    if (visible === LABEL_CAPACITY || considered >= LABEL_CANDIDATE_CAPACITY) {
      omitted++;
      continue;
    }
    considered++;
    if (!placeLabel(overlay, foothold, visible)) {
      omitted++;
      continue;
    }
    visible++;
  }
  for (let index = visible; index < LABEL_CAPACITY; index++) {
    overlay.labels[index].visible = false;
  }
  return omitted;
}

/** @param {object} overlay @param {object} scene */
function updateReadout(overlay, scene) {
  const omitted = updateLabels(overlay, scene);
  const sim = scene.simulation;
  overlay.readout.textContent = [
    `state=${sim.state} action=${sim.action} foothold=${sim.footholdId} ladder=${sim.ladderId}`,
    `position=${sim.x.toFixed(3)},${sim.y.toFixed(3)} velocity=${sim.vx.toFixed(3)},${sim.vy.toFixed(3)} px/s`,
    `body=cyan attack=amber damage=pink; white cross=feet; green=footholds; labels omitted=${omitted}`,
    `blocked=${JSON.stringify(sim.blocked)} combat activation=unknown; geometry unresolved=${overlay.shapes.unknown}`,
    `effective physics=${JSON.stringify(sim.effectiveSettings)}`,
  ].join("\n");
}

/** @param {object} overlay @param {object} scene */
function updateShapes(overlay, scene) {
  const context = overlay.context;
  const sim = scene.simulation;
  context.action = sim.action;
  context.attacking = sim.diagnostics.unsupportedAttack === true;
  for (const entity of scene.entities) {
    if (entity.id !== "character") continue;
    context.frame = entity.frame;
    context.elapsedMs = entity.actionTimeMs;
    break;
  }
  const pose = scene.presentation ?? sim;
  applyPreview(context, scene.hitboxPreview, pose);
  updateHitboxes(overlay.shapes, pose, context);
  for (let index = 0; index < SHAPE_NAMES.length; index++) {
    placeRectangle(
      overlay.rectangles[index],
      overlay.shapes[SHAPE_NAMES[index]],
    );
  }
  overlay.velocity.width = Math.hypot(sim.vx, sim.vy) * VELOCITY_SCALE;
  overlay.velocity.height = 2;
  overlay.velocity.rotation = Math.atan2(sim.vy, sim.vx);
  overlay.velocity.position.set(pose.x, pose.y);
  overlay.contact[0].position.set(pose.x - 3, pose.y);
  overlay.contact[1].position.set(pose.x, pose.y - 3);
}

function contactSprites(container) {
  const horizontal = lineSprite(container, 0xffffff);
  const vertical = lineSprite(container, 0xffffff);
  horizontal.width = 7;
  horizontal.height = 1;
  vertical.width = 1;
  vertical.height = 7;
  return [horizontal, vertical];
}

/** Preview placement follows the inspected actor; activation remains explicitly unknown. */
function applyPreview(context, preview, pose) {
  context.attack = preview?.attack ?? null;
  context.damage = preview?.damage ?? null;
  context.body = preview?.body ?? null;
  if (!context.damage) return;
  context.damage.x = pose.x;
  context.damage.y = pose.y;
  context.damage.facing = pose.facing;
}
/** @param {object} overlay @param {object} scene @param {boolean} enabled */
function updateOverlay(overlay, scene, enabled) {
  const visible = enabled && Boolean(scene?.simulation);
  overlay.scene = scene;

  overlay.container.visible = visible;
  overlay.readout.hidden = !visible;
  if (!visible) return;
  if (overlay.manifest !== scene.manifest) drawFootholds(overlay, scene);
  overlay.container.position.set(-scene.camera.x, -scene.camera.y);
  updateShapes(overlay, scene);
}

/** Reusable world-space geometry and bounded labels; no guessed sprite hitboxes.
 * @param {import('pixi.js').Application} app initialized WebGL application
 */
export function createDebugOverlay(app) {
  const container = new Container({ label: "physics-debug", zIndex: 1000000 });
  const lines = new Graphics();
  container.addChild(lines);
  const readout = document.createElement("pre");
  readout.className = "physics-debug-readout";
  readout.hidden = true;
  app.canvas.parentElement.appendChild(readout);
  app.stage.addChild(container);
  const overlay = {
    app,
    container,
    lines,
    readout,
    manifest: null,
    scene: null,
    shapes: createHitboxState(),
    context: { action: "", frame: 0, elapsedMs: 0, attacking: false },
    rectangles: SHAPE_COLORS.map((color) => rectangleSprites(container, color)),
    labels: makeLabels(container),
    velocity: lineSprite(container, 0xffffff),
    contact: contactSprites(container),
  };
  const sampler = setInterval(() => {
    if (overlay.container.visible && overlay.scene) {
      updateReadout(overlay, overlay.scene);
    }
  }, READOUT_INTERVAL_MS);
  return {
    snapshot() {
      return overlay.container.visible ? structuredClone(overlay.shapes) : null;
    },
    update(scene, enabled) {
      updateOverlay(overlay, scene, enabled);
    },
    destroy() {
      clearInterval(sampler);
      readout.remove();
      container.destroy({ children: true });
    },
  };
}
