// Browser-only validation entry; never imported by the gameplay runtime.
const MAX_DRAW_CELLS = 100000;
const MAX_ENTITIES = 100000;
const MAX_REGIONS = 4096;
const MAX_PARTS = 1000000;
const MAX_ATLASES = 4096;
const MAX_RESPONSE_CHUNKS = 65536;
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 16777216;

/** Limits are validation resource policies, not original-game constants. */
function boundedArray(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error("Oracle collection bound exceeded");
  }
  return value;
}

async function responseBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Oracle HTTP ${response.status}: ${url}`);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (let count = 0; count < MAX_RESPONSE_CHUNKS; count++) {
      const { done, value } = await reader.read();
      if (done) return new Blob(chunks);
      length += value.byteLength;
      if (length > MAX_BYTES) {
        throw new Error(`Oracle response byte bound: ${url}`);
      }
      chunks.push(value);
    }
    throw new Error(`Oracle response chunk bound: ${url}`);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

async function json(url) {
  return JSON.parse(await (await responseBytes(url)).text());
}

async function originalScene(state) {
  const catalog = await json("/generated/catalog.json");
  const manifest = await json(catalog.maps[state.currentMap].url);
  const active = new Set(
    state.regions.filter((region) => region.ready).map((region) => region.id),
  );
  const entities = [...boundedArray(manifest.actors, MAX_ENTITIES)];
  for (const region of boundedArray(manifest.regions, MAX_REGIONS)) {
    if (!active.has(region.id)) continue;
    const data = await json(region.url);
    boundedArray(data.entities, MAX_ENTITIES - entities.length);
    for (const entity of data.entities) entities.push(entity);
  }
  appendDynamicArtwork(entities, manifest, state);
  boundedArray(entities, MAX_ENTITIES);
  return { manifest, entities };
}

/** Resolve dynamic mob artwork independently from its authored placement/template. */
function appendDynamicArtwork(entities, manifest, state) {
  const placements = new Map(
    boundedArray(manifest.life?.placements ?? [], MAX_ENTITIES).map(
      (record) => [record.id, record],
    ),
  );
  for (const live of state.entities) {
    if (live.kind !== "mob") continue;
    const placement = placements.get(live.id);
    const descriptor = manifest.life?.renderables?.[placement?.template];
    if (!descriptor) {
      throw new Error(`Oracle dynamic artwork unavailable: ${live.id}`);
    }
    // Local display ties follow authored placement order, not the shared template's first instance.
    entities.push({
      ...descriptor.entity,
      id: live.id,
      order: 100000 + Number(placement.id.slice(5)),
    });
  }
}

async function loadImages(scene) {
  let parts = 0;
  const images = new Map();
  const atlasIds = new Set();
  for (const entity of scene.entities) {
    const actions = Object.values(entity.actions);
    boundedArray(actions, MAX_PARTS);
    parts += actions.length;
    if (parts > MAX_PARTS) throw new Error("Oracle action bound exceeded");
    for (const frames of actions) {
      for (const frame of boundedArray(frames, MAX_PARTS)) {
        parts += boundedArray(frame.parts, MAX_PARTS).length + 1;
        if (parts > MAX_PARTS) throw new Error("Oracle artwork bound exceeded");
        for (const part of frame.parts) {
          atlasIds.add(scene.manifest.textures[part.texture].atlas);
        }
      }
    }
  }
  if (atlasIds.size > MAX_ATLASES) {
    throw new Error("Oracle atlas bound exceeded");
  }
  try {
    for (const id of atlasIds) {
      const blob = await responseBytes(scene.manifest.atlases[id].url);
      const image = await createImageBitmap(blob);
      images.set(id, image);
      if (image.width * image.height > MAX_PIXELS) {
        throw new Error("Oracle atlas pixel bound exceeded");
      }
    }
    return images;
  } catch (error) {
    for (const image of images.values()) image.close();
    throw error;
  }
}

/** Native00639708/00642890 starts from a zero camera origin and follows positive center. */
function cameraPosition(entity, state, size) {
  const cameraX = Math.trunc(state.camera.x);
  const cameraY = Math.trunc(state.camera.y);
  const background = entity.background;
  if (!background) return { x: entity.x - cameraX, y: entity.y - cameraY };
  const centerX = cameraX + Math.trunc(size.width / 2);
  const centerY = cameraY + Math.trunc(size.height / 2);
  const autoX = background.type === 4 || background.type === 6;
  const autoY = background.type === 5 || background.type === 7;
  const x = autoX
    ? entity.x + automaticOffset(entity.elapsedMs, background.rx)
    : entity.x +
      (autoY
        ? Math.trunc((centerX * (background.rx + 100)) / 100)
        : centerX + Math.trunc((centerX * background.rx) / 100));
  const y = autoY
    ? entity.y + automaticOffset(entity.elapsedMs, background.ry)
    : entity.y +
      (autoX
        ? Math.trunc((centerY * (background.ry + 100)) / 100)
        : centerY + Math.trunc((centerY * background.ry) / 100));
  return { x: x - cameraX, y: y - cameraY };
}

/** Native scrolling uses a signed100px vector and an integral movement period. */
function automaticOffset(elapsedMs, rate) {
  if (rate === 0) return 0;
  const period = Math.trunc(20000 / Math.abs(rate));
  if (period < 1 || !Number.isFinite(elapsedMs)) {
    throw new Error("Invalid oracle automatic background timing");
  }
  const distance = Math.sign(rate) * 100;
  return -distance + Math.trunc((elapsedMs * distance) / period);
}

function partAlpha(entity, frame, part) {
  const start = Math.round((part.opacity ?? 1) * 255);
  if (frame.alphaEnd === undefined) {
    return ((entity.opacity ?? 1) * start) / 255;
  }
  if (frame.delay === 0) {
    return (entity.opacity ?? 1) * frame.alphaEnd;
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
  if (
    !Number.isInteger(background.type) ||
    background.type < 0 ||
    background.type > 7
  ) {
    throw new Error("Invalid oracle background type");
  }
  if (background.type < 4) return background.type;
  if (background.type === 4) return 1;
  return background.type === 5 ? 2 : 3;
}

/** Authored zero selects the original scale-adjusted canvas period. */
function validateAuthoredPeriod(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new Error("Invalid oracle repeat period");
  }
}

/** Resolved periods must support finite, positive repetition spacing. */
function validateRepeatDimensions(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
    throw new Error("Invalid oracle repeat dimensions");
  }
}

function repeatPeriod(draw, texture) {
  const background = draw.entity.background;
  if (!background) {
    return {
      cx: draw.frame.sourceSize?.width ?? texture.width,
      cy: draw.frame.sourceSize?.height ?? texture.height,
    };
  }
  const canvas = background.canvas;
  if (
    !canvas ||
    !Number.isInteger(canvas.scale) ||
    canvas.scale < 0 ||
    canvas.scale > 30
  ) {
    throw new Error("Invalid oracle original background canvas");
  }
  validateAuthoredPeriod(background.cx, background.cy);
  //0063e397/0063e3aa: inclusive source dimension minus its reduced-pixel cell.
  const trim = 2 ** canvas.scale - 1;
  const cx = background.cx === 0 ? canvas.width - trim : background.cx;
  const cy = background.cy === 0 ? canvas.height - trim : background.cy;
  validateRepeatDimensions(cx, cy);
  return { cx, cy };
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
    ![result.x0, result.x1, result.y0, result.y1].every(Number.isSafeInteger) ||
    result.x0 > result.x1 ||
    result.y0 > result.y1 ||
    (result.x1 - result.x0 + 1) * (result.y1 - result.y0 + 1) > MAX_DRAW_CELLS
  ) {
    throw new Error("Oracle repetition bound exceeded");
  }
  return result;
}

/** Validate the selected atlas rectangle and part offsets before drawing. */
function partTexture(draw, part) {
  const texture = draw.manifest.textures[part.texture];
  if (
    !texture ||
    ![
      texture.x,
      texture.y,
      texture.width,
      texture.height,
      part.x,
      part.y,
    ].every(Number.isFinite) ||
    texture.width <= 0 ||
    texture.height <= 0
  ) {
    throw new Error("Invalid oracle texture geometry");
  }
  return texture;
}

function drawPart(draw, part) {
  const texture = partTexture(draw, part);
  const image = draw.images.get(texture.atlas);
  const cells = repetition(draw, part, texture);
  draw.cells += (cells.x1 - cells.x0 + 1) * (cells.y1 - cells.y0 + 1);
  if (draw.cells > MAX_PARTS) {
    throw new Error("Oracle total draw bound exceeded");
  }
  const context = draw.context;
  const alpha = partAlpha(draw.entity, draw.frame, part);
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error("Invalid oracle opacity");
  }
  context.globalAlpha = alpha;
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

function selectedPart(part, entity) {
  if (!part.expression) return true;
  if (part.expression !== entity.expression) return false;
  if (part.expressionStart === undefined) return true;
  if (
    !Number.isFinite(entity.expressionElapsedMs) ||
    !Number.isFinite(part.expressionLoopMs) ||
    part.expressionLoopMs <= 0
  ) {
    throw new Error("Invalid oracle expression clock");
  }
  const time = entity.expressionElapsedMs % part.expressionLoopMs;
  return time >= part.expressionStart && time < part.expressionEnd;
}

/** Independent Canvas composition of native final reflection, rotation and move branches. */
function avatarPose(context, frame) {
  const angle = frame.rotate ?? 0;
  if (angle === 0) {
    context.translate(frame.moveX ?? 0, frame.moveY ?? 0);
    if (frame.flip) context.scale(-1, 1);
    return;
  }
  if (frame.flip) context.scale(-1, 1);
  context.translate(frame.moveX ?? 0, frame.moveY ?? 0);
  if (angle === 90) context.transform(0, 1, -1, 0, 0, 0);
  else if (angle === 180) context.transform(-1, 0, 0, -1, 0, 0);
  else if (angle === 270) context.transform(0, -1, 1, 0, 0, 0);
  else throw new Error("Invalid original avatar rotation");
}

function drawEntity(draw, entity) {
  if (!entity.visible) return;
  const frames = entity.actions[entity.action];
  if (
    !frames ||
    !Number.isInteger(entity.frame) ||
    entity.frame < 0 ||
    entity.frame >= frames.length
  ) {
    throw new Error("Invalid oracle active frame");
  }
  draw.entity = entity;
  draw.frame = entity.actions[entity.action][entity.frame];
  draw.position = cameraPosition(entity, draw.state, draw.canvas);
  if (![draw.position.x, draw.position.y].every(Number.isFinite)) {
    throw new Error("Invalid oracle draw position");
  }
  const context = draw.context;
  context.save();
  context.translate(draw.position.x, draw.position.y);
  if (entity.flip) context.scale(-1, 1);
  if (entity.kind === "character") avatarPose(context, draw.frame);
  for (const part of [...draw.frame.parts].sort(
    (left, right) => left.z - right.z,
  )) {
    if (!selectedPart(part, entity)) continue;
    drawPart(draw, part);
  }
  context.restore();
}

/** Independent Canvas2D composition of exactly the region state captured by WebGL. */
export async function compose(state, size) {
  if (
    !Number.isSafeInteger(size.width) ||
    !Number.isSafeInteger(size.height) ||
    size.width <= 0 ||
    size.height <= 0 ||
    size.width * size.height > MAX_PIXELS
  ) {
    throw new Error("Invalid oracle surface dimensions");
  }
  boundedArray(state.entities, MAX_ENTITIES);
  boundedArray(state.regions, MAX_REGIONS);
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
      entity.order = entity.depthOrder;
      if (![entity.z, entity.order].every(Number.isFinite)) {
        throw new Error("Invalid oracle drawing order");
      }
    }
    entities.sort(
      (left, right) => left.z - right.z || left.order - right.order,
    );
    const draw = {
      canvas,
      context,
      state,
      images,
      manifest: scene.manifest,
      cells: 0,
    };
    for (const entity of entities) drawEntity(draw, entity);
    return canvas.toDataURL("image/png");
  } finally {
    for (const image of images.values()) image.close();
  }
}
