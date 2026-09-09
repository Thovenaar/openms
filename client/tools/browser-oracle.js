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

/** Authored zero selects the source dimension; negative/nonfinite periods fail. */
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
  const width = draw.frame.sourceSize?.width ?? texture.width;
  const height = draw.frame.sourceSize?.height ?? texture.height;
  const authoredX = draw.entity.background?.cx ?? 0;
  const authoredY = draw.entity.background?.cy ?? 0;
  validateAuthoredPeriod(authoredX, authoredY);
  const cx = authoredX === 0 ? width : authoredX;
  const cy = authoredY === 0 ? height : authoredY;
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
  draw.position = cameraPosition(entity, draw.state, draw.manifest);
  if (![draw.position.x, draw.position.y].every(Number.isFinite)) {
    throw new Error("Invalid oracle draw position");
  }
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
