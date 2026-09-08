// Browser-only validation entry; never imported by the gameplay runtime.
const MAX_DRAW_CELLS = 100000;

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Oracle HTTP ${response.status}: ${url}`);
  return response.json();
}

async function originalScene(state) {
  const catalog = await json("/generated/catalog.json");
  const manifest = await json(catalog.maps[state.currentMap].url);
  const active = new Set(
    state.regions.filter((region) => region.ready).map((region) => region.id),
  );
  const entities = [...manifest.actors];
  for (const region of manifest.regions) {
    if (!active.has(region.id)) continue;
    const data = await json(region.url);
    entities.push(...data.entities);
  }
  return { manifest, entities };
}

async function loadImages(scene) {
  const images = new Map();
  const atlasIds = new Set();
  for (const entity of scene.entities) {
    for (const frames of Object.values(entity.actions)) {
      for (const frame of frames) {
        for (const part of frame.parts) {
          atlasIds.add(scene.manifest.textures[part.texture].atlas);
        }
      }
    }
  }
  for (const id of atlasIds) {
    const response = await fetch(scene.manifest.atlases[id].url);
    if (!response.ok) throw new Error(`Oracle atlas HTTP ${response.status}`);
    images.set(id, await createImageBitmap(await response.blob()));
  }
  return images;
}

function cameraPosition(entity, state, manifest) {
  let x = entity.x - state.camera.x;
  let y = entity.y - state.camera.y;
  const background = entity.background;
  if (!background) return { x, y };
  const autoX = background.type === 4 || background.type === 6;
  const autoY = background.type === 5 || background.type === 7;
  x += Math.trunc(
    ((manifest.camera.x - state.camera.x) * (autoX ? -100 : background.rx)) /
      100,
  );
  y += Math.trunc(
    ((manifest.camera.y - state.camera.y) * (autoY ? -100 : background.ry)) /
      100,
  );
  if (autoX) x += Math.trunc((entity.elapsedMs * background.rx) / 200);
  if (autoY) y += Math.trunc((entity.elapsedMs * background.ry) / 200);
  return { x, y };
}

function partAlpha(entity, frame, part) {
  const start = Math.round((part.opacity ?? 1) * 255);
  if (frame.alphaEnd === undefined) {
    return ((entity.opacity ?? 1) * start) / 255;
  }
  let frameStart = 0;
  for (let index = 0; index < entity.frame; index++) {
    frameStart += entity.actions[entity.action][index].delay;
  }
  const elapsed = entity.actionTimeMs - frameStart;
  const alpha =
    start +
    Math.trunc(
      ((Math.round(frame.alphaEnd * 255) - start) * elapsed) / frame.delay,
    );
  return ((entity.opacity ?? 1) * alpha) / 255;
}

function repeatAxes(background) {
  if (!background) return 0;
  if (background.type < 4) return background.type;
  if (background.type === 4) return 1;
  return background.type === 5 ? 2 : 3;
}

function repeatPeriod(draw, texture) {
  const width = draw.frame.sourceSize?.width ?? texture.width;
  const height = draw.frame.sourceSize?.height ?? texture.height;
  return {
    cx: draw.entity.background?.cx || width,
    cy: draw.entity.background?.cy || height,
  };
}

function repetition(draw, part, texture) {
  const repeat = repeatAxes(draw.entity.background);
  const { cx, cy } = repeatPeriod(draw, texture);
  const left = draw.entity.flip
    ? draw.position.x - draw.canvas.width
    : -draw.position.x;
  const right = draw.entity.flip
    ? draw.position.x
    : draw.canvas.width - draw.position.x;
  const result = {
    cx,
    cy,
    x0: repeat & 1 ? Math.floor((left - part.x - texture.width) / cx) : 0,
    x1: repeat & 1 ? Math.ceil((right - part.x) / cx) : 0,
    y0:
      repeat & 2
        ? Math.floor((-draw.position.y - part.y - texture.height) / cy)
        : 0,
    y1:
      repeat & 2
        ? Math.ceil((draw.canvas.height - draw.position.y - part.y) / cy)
        : 0,
  };
  if (
    (result.x1 - result.x0 + 1) * (result.y1 - result.y0 + 1) >
    MAX_DRAW_CELLS
  ) {
    throw new Error("Oracle repetition bound exceeded");
  }
  return result;
}

function drawPart(draw, part) {
  const texture = draw.manifest.textures[part.texture];
  const image = draw.images.get(texture.atlas);
  const cells = repetition(draw, part, texture);
  const context = draw.context;
  context.globalAlpha = partAlpha(draw.entity, draw.frame, part);
  for (let y = cells.y0; y <= cells.y1; y++) {
    for (let x = cells.x0; x <= cells.x1; x++) {
      context.save();
      context.translate(
        part.x + x * cells.cx + (part.flip ? texture.width : 0),
        part.y + y * cells.cy,
      );
      if (part.flip) context.scale(-1, 1);
      context.drawImage(
        image,
        texture.x,
        texture.y,
        texture.width,
        texture.height,
        0,
        0,
        texture.width,
        texture.height,
      );
      context.restore();
    }
  }
}

function drawEntity(draw, entity) {
  if (!entity.visible) return;
  draw.entity = entity;
  draw.frame = entity.actions[entity.action][entity.frame];
  draw.position = cameraPosition(entity, draw.state, draw.manifest);
  const context = draw.context;
  context.save();
  context.translate(draw.position.x, draw.position.y);
  if (entity.flip) context.scale(-1, 1);
  for (const part of [...draw.frame.parts].sort(
    (left, right) => left.z - right.z,
  )) {
    drawPart(draw, part);
  }
  context.restore();
}

/** Independent Canvas2D composition of exactly the region state captured by WebGL. */
export async function compose(state, size) {
  const scene = await originalScene(state);
  const images = await loadImages(scene);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas2D oracle unavailable");
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#101820";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const states = new Map(state.entities.map((entity) => [entity.id, entity]));
    const entities = scene.entities.map((entity) => ({
      ...entity,
      ...states.get(entity.id),
      actions: entity.actions,
    }));
    for (const entity of entities) {
      if (entity.kind === "character") {
        // Independently defend authored-left artwork against reversed input facing.
        entity.flip = state.simulation.facing > 0;
        entity.z =
          29997 +
          (state.simulation.contactLayer * 3000 -
            state.simulation.contactGroup) *
            10;
      }
    }
    entities.sort(
      (left, right) => left.z - right.z || left.order - right.order,
    );
    const draw = { canvas, context, state, images, manifest: scene.manifest };
    for (const entity of entities) drawEntity(draw, entity);
    return canvas.toDataURL("image/png");
  } finally {
    for (const image of images.values()) image.close();
  }
}
