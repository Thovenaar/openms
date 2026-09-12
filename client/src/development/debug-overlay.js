import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { createHitboxState, updateHitboxes } from "../physics/hitboxes.js";

// Inspection policies, not original physics constants.
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
  drawBounds(overlay.lines, scene);
  overlay.simulation = scene.simulation;
  overlay.manifest = scene.manifest;
}

/** Static field geometry is rebuilt on field/simulation replacement, never per frame. */
function drawBounds(lines, scene) {
  const render = scene.manifest.bounds;
  lines.rect(
    render.left,
    render.top,
    render.right - render.left,
    render.bottom - render.top,
  );
  lines.stroke({ color: 0x6699ff, width: 1 });
  const map = scene.manifest.physics.map;
  if (
    Number.isFinite(map.VRLeft) &&
    Number.isFinite(map.VRRight) &&
    Number.isFinite(map.VRTop) &&
    Number.isFinite(map.VRBottom)
  ) {
    lines.rect(
      map.VRLeft,
      map.VRTop,
      map.VRRight - map.VRLeft,
      map.VRBottom - map.VRTop,
    );
    lines.stroke({ color: 0xcc88ff, width: 1 });
  }
  const bounds = scene.simulation.bounds;
  lines.moveTo(bounds.left, bounds.bottom);
  lines.lineTo(bounds.left, bounds.top);
  lines.lineTo(bounds.right, bounds.top);
  lines.lineTo(bounds.right, bounds.bottom);
  lines.stroke({ color: 0xff8844, width: 2 });
  // Bottom participates in initialization only. At most 256 dashes per field.
  const step = Math.max(12, (bounds.right - bounds.left) / 256);
  for (let x = bounds.left; x < bounds.right; x += step) {
    lines.moveTo(x, bounds.bottom);
    lines.lineTo(Math.min(bounds.right, x + step * 0.5), bounds.bottom);
  }
  lines.stroke({ color: 0xff8844, width: 1, alpha: 0.5 });
}

/** Formatting occurs only on the throttled inspection sampler. */
function boundsReadout(scene) {
  const physical = scene.simulation.bounds;
  const render = scene.manifest.bounds;
  const map = scene.manifest.physics.map;
  return [
    `physical clip domain L=${physical.left} R=${physical.right} T=${physical.top} B=${physical.bottom}`,
    `render bounds L=${render.left} R=${render.right} T=${render.top} B=${render.bottom}`,
    `authored VR L=${map.VRLeft ?? "absent"} R=${map.VRRight ?? "absent"} T=${map.VRTop ?? "absent"} B=${map.VRBottom ?? "absent"} VRLimit=${map.VRLimit ?? "absent"}`,
    "orange=physical X/top clip; dashed bottom=initialization only, NOT an air floor",
    "blue=render bounds; purple=authored VR (zero edges do not restrict physics)",
  ].join("\n");
}

/** @param {object} overlay @param {object} scene */
function updateReadout(overlay, scene) {
  const sim = scene.simulation;
  overlay.readout.textContent = [
    `state=${sim.state} action=${sim.action} foothold=${sim.footholdId} prev=${sim.foothold?.prevId ?? "none"} next=${sim.foothold?.nextId ?? "none"} ladder=${sim.ladderId}`,
    `position=${sim.x.toFixed(3)},${sim.y.toFixed(3)} velocity=${sim.vx.toFixed(3)},${sim.vy.toFixed(3)} px/s`,
    `contact plane=${sim.contactLayer} group=${sim.contactGroup}; space group=${sim.spaceGroup}`,
    boundsReadout(scene),
    "body=cyan attack=amber damage=pink; white cross=feet; green=authored footholds/walls, NOT physical domain",
    `blocked=${JSON.stringify(sim.blocked)} original attack activation=unverified; geometry unresolved=${overlay.shapes.unknown}`,
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
  if (
    overlay.manifest !== scene.manifest ||
    overlay.simulation !== scene.simulation
  ) {
    drawFootholds(overlay, scene);
  }
  overlay.container.position.set(-scene.camera.x, -scene.camera.y);
  updateShapes(overlay, scene);
}

/** World-space geometry and side-panel diagnostic text; no guessed sprite hitboxes.
 * @param {import('pixi.js').Application} app initialized WebGL application
 * @param {HTMLElement} inspectionHost side-panel diagnostic destination
 */
export function createDebugOverlay(app, inspectionHost) {
  const container = new Container({ label: "physics-debug", zIndex: 1000000 });
  const lines = new Graphics();
  container.addChild(lines);
  const readout = document.createElement("pre");
  readout.className = "physics-debug-readout";
  readout.hidden = true;
  inspectionHost.appendChild(readout);
  app.stage.addChild(container);
  const overlay = {
    container,
    lines,
    readout,
    manifest: null,
    simulation: null,
    scene: null,
    shapes: createHitboxState(),
    context: { action: "", frame: 0, elapsedMs: 0, attacking: false },
    rectangles: SHAPE_COLORS.map((color) => rectangleSprites(container, color)),
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
