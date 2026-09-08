// @ts-check
import puppeteer from "puppeteer-core";
import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { inflateSync } from "node:zlib";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:3100" },
    chrome: {
      type: "string",
      default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    duration: { type: "string", default: "12" },
    output: { type: "string", default: "docs/validation" },
    headed: { type: "boolean", default: false },
  },
});
const duration = Number(values.duration);
if (!Number.isFinite(duration) || duration <= 0)
  throw new Error("--duration must be positive seconds");
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  url: values.url,
  measurementDurationSeconds: duration,
  scope:
    "Browser reconstruction self-consistency and independent manifest compositing; not original-client visual or timing parity.",
  originalReference: {
    available: false,
    reason:
      "No original-client reference capture or executable comparison is supplied to this command.",
  },
  checks: [],
  captures: [],
  errors: [],
  performance: null,
};
let browser;
let page;
let captureNumber = 0;

/** Decode 8-bit non-interlaced PNG screenshots, including PNG row filters. */
function decodePNG(input) {
  const bytes = Buffer.from(input);
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Not PNG");
  let width = 0,
    height = 0,
    color = 0,
    channels = 0;
  const chunks = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (data.length !== length) throw new Error("Truncated PNG");
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      color = data[9];
      if (data[8] !== 8 || data[12] !== 0 || ![0, 2, 4, 6].includes(color))
        throw new Error("Unsupported screenshot PNG encoding");
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
    } else if (type === "IDAT") chunks.push(data);
    offset += length + 12;
    if (type === "IEND") break;
  }
  if (!width || !height || !channels) throw new Error("Missing PNG header");
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1))
    throw new Error("Unexpected PNG scanline size");
  const decoded = new Uint8Array(height * stride);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error("Unknown PNG filter");
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? decoded[y * stride + x - channels] : 0;
      const b = y ? decoded[(y - 1) * stride + x] : 0;
      const c =
        y && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? a
            : filter === 2
              ? b
              : filter === 3
                ? Math.floor((a + b) / 2)
                : pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c;
      decoded[y * stride + x] =
        (raw[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  for (let i = 0; i < width * height; i++) {
    const source = i * channels,
      dest = i * 4;
    pixels[dest] = decoded[source];
    pixels[dest + 1] =
      color === 0 || color === 4 ? decoded[source] : decoded[source + 1];
    pixels[dest + 2] =
      color === 0 || color === 4 ? decoded[source] : decoded[source + 2];
    pixels[dest + 3] =
      color === 4
        ? decoded[source + 1]
        : color === 6
          ? decoded[source + 3]
          : 255;
  }
  return { width, height, pixels };
}

/** Pixel error is measured per pixel, not PNG byte lengths or compression. */
function comparePixels(a, b, tolerance = 0) {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error("Capture dimensions changed");
  let changed = 0,
    outsideTolerance = 0,
    maximumChannelError = 0,
    sum = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    let error = 0;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(a.pixels[i + channel] - b.pixels[i + channel]);
      error = Math.max(error, delta);
      sum += delta;
    }
    if (error) changed++;
    if (error > tolerance) outsideTolerance++;
    maximumChannelError = Math.max(maximumChannelError, error);
  }
  return {
    pixels: a.width * a.height,
    changed,
    outsideTolerance,
    maximumChannelError,
    meanAbsoluteChannelError: sum / a.pixels.length,
    tolerance,
  };
}

function statistics(samples) {
  if (!samples.length)
    return {
      samples: 0,
      min: null,
      mean: null,
      p50: null,
      p95: null,
      p99: null,
      max: null,
    };
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return {
    samples: sorted.length,
    min: sorted[0],
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1),
  };
}

function check(name, pass, details = {}) {
  report.checks.push({ name, status: pass ? "pass" : "fail", ...details });
  if (!pass) throw new Error(`Invariant failed: ${name}`);
}
function skip(name, reason) {
  report.checks.push({ name, status: "not-exercised", reason });
}
const snapshot = () => page.evaluate(() => window.maple.snapshot());
const mutate = (method, ...args) =>
  page.evaluate(
    ({ method, args }) => {
      window.maple[method](...args);
      window.maple.step(0);
      return window.maple.snapshot();
    },
    { method, args },
  );
const entityState = (state, id) =>
  state.entities.find((entity) => entity.id === id);

async function capture(label) {
  const name = `${String(++captureNumber).padStart(3, "0")}-${label.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
  const canvas = await page.$("#scene-canvas");
  if (!canvas) throw new Error("Renderer canvas #scene-canvas missing");
  const bytes = await canvas.screenshot({
    type: "png",
    path: join(output, name),
  });
  await canvas.dispose();
  const image = decodePNG(bytes);
  const state = await snapshot();
  report.captures.push({
    file: name,
    label,
    width: image.width,
    height: image.height,
    state: {
      sceneId: state.sceneId,
      paused: state.paused,
      entities: state.entities,
      camera: state.camera,
      textureCount: state.textureCount,
      pendingLoads: state.pendingLoads,
    },
  });
  if (await page.evaluate(() => Boolean(window.__validationOracle))) {
    const expectedURL = await page.evaluate(
      ({ state, width, height }) => {
        const { scene, images } = window.__validationOracle;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas2D oracle unavailable");
        context.imageSmoothingEnabled = false;
        context.fillStyle = "#101820";
        context.fillRect(0, 0, width, height);
        const states = new Map(
          state.entities.map((entity) => [entity.id, entity]),
        );
        const entities = scene.entities.map((entity) => ({
          ...entity,
          ...states.get(entity.id),
          actions: entity.actions,
        }));
        entities.sort((a, b) => a.z - b.z);
        for (const entity of entities) {
          if (!entity.visible) continue;
          const frame = entity.actions[entity.action][entity.frame];
          context.save();
          let screenX = entity.x - state.camera.x,
            screenY = entity.y - state.camera.y;
          const bg = entity.background;
          if (bg) {
            const autoX = bg.type === 4 || bg.type === 6,
              autoY = bg.type === 5 || bg.type === 7;
            screenX += Math.trunc(
              ((scene.camera.x - state.camera.x) * (autoX ? -100 : bg.rx)) /
                100,
            );
            screenY += Math.trunc(
              ((scene.camera.y - state.camera.y) * (autoY ? -100 : bg.ry)) /
                100,
            );
            if (autoX) screenX += Math.trunc((entity.elapsedMs * bg.rx) / 200);
            if (autoY) screenY += Math.trunc((entity.elapsedMs * bg.ry) / 200);
          }
          context.translate(screenX, screenY);
          if (entity.flip) context.scale(-1, 1);
          for (const part of [...frame.parts].sort((a, b) => a.z - b.z)) {
            const texture = images[part.texture];
            if (!texture)
              throw new Error(`Oracle texture missing: ${part.texture}`);
            context.save();
            const startAlpha = Math.round((part.opacity ?? 1) * 255);
            const elapsed =
              entity.actionTimeMs -
              entity.actions[entity.action]
                .slice(0, entity.frame)
                .reduce((sum, f) => sum + f.delay, 0);
            const alpha =
              frame.alphaEnd === undefined
                ? startAlpha
                : startAlpha +
                  Math.trunc(
                    ((Math.round(frame.alphaEnd * 255) - startAlpha) *
                      elapsed) /
                      frame.delay,
                  );
            context.globalAlpha = ((entity.opacity ?? 1) * alpha) / 255;
            const repeat = !bg
              ? 0
              : bg.type < 4
                ? bg.type
                : bg.type === 4
                  ? 1
                  : bg.type === 5
                    ? 2
                    : 3;
            const cx = bg?.cx || texture.width,
              cy = bg?.cy || texture.height;
            const left = entity.flip ? screenX - width : -screenX,
              right = entity.flip ? screenX : width - screenX;
            const x0 =
              repeat & 1 ? Math.floor((left - part.x - texture.width) / cx) : 0;
            const x1 = repeat & 1 ? Math.ceil((right - part.x) / cx) : 0;
            const y0 =
              repeat & 2
                ? Math.floor((-screenY - part.y - texture.height) / cy)
                : 0;
            const y1 =
              repeat & 2 ? Math.ceil((height - screenY - part.y) / cy) : 0;
            for (let ty = y0; ty <= y1; ty++)
              for (let tx = x0; tx <= x1; tx++) {
                context.save();
                context.translate(
                  part.x + tx * cx + (part.flip ? texture.width : 0),
                  part.y + ty * cy,
                );
                if (part.flip) context.scale(-1, 1);
                context.drawImage(texture, 0, 0);
                context.restore();
              }
            context.restore();
          }
          context.restore();
        }
        return canvas.toDataURL("image/png");
      },
      { state, width: image.width, height: image.height },
    );
    const expectedBytes = Buffer.from(expectedURL.split(",")[1], "base64");
    const expectedName = name.replace(".png", "-oracle.png");
    await Bun.write(join(output, expectedName), expectedBytes);
    const difference = comparePixels(image, decodePNG(expectedBytes), 4);
    check(
      `manifest compositing pixels ${label}`,
      difference.outsideTolerance === 0,
      {
        actual: name,
        expected: expectedName,
        ...difference,
        note: "Independent Canvas2D composition of original extracted textures. Four channel levels allow 8-bit alpha rounding; no out-of-tolerance pixels are accepted. This is not original-client parity.",
      },
    );
  }
  return image;
}

async function restore(state) {
  await page.evaluate((state) => {
    const api = window.maple;
    api.pause(true);
    for (const entity of state.entities) {
      api.setAction(entity.id, entity.action);
      api.setVisible(entity.id, entity.visible);
      api.setLayer(entity.id, entity.z);
      api.setPosition(entity.id, entity.x, entity.y);
    }
    api.setCamera(state.camera.x, state.camera.y);
    api.step(0);
  }, state);
}

try {
  browser = await puppeteer.launch({
    executablePath: values.chrome,
    headless: !values.headed,
    args: [
      "--enable-precise-memory-info",
      "--force-color-profile=srgb",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  page.setDefaultTimeout(60000);
  page.on("pageerror", (error) =>
    report.errors.push({ source: "page", message: String(error) }),
  );
  page.on("requestfailed", (request) =>
    report.errors.push({
      source: "network",
      url: request.url(),
      message: request.failure()?.errorText,
    }),
  );
  await page.goto(values.url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() => Boolean(window.maple));
  await page.evaluate(() =>
    Promise.race([
      window.maple.ready,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Scene ready timed out after 60 seconds")),
          60000,
        ),
      ),
    ]),
  );
  await mutate("pause", true);
  const scene = await page.evaluate(async () => {
    const response = await fetch("/generated/scene.json", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    return response.json();
  });
  report.scene = {
    id: scene.id,
    source: scene.source,
    evidence: scene.evidence,
    entities: scene.entities.length,
    textures: Object.keys(scene.textures).length,
  };
  await page.evaluate(async (scene) => {
    const images = {};
    await Promise.all(
      Object.entries(scene.textures).map(async ([id, texture]) => {
        const response = await fetch(texture.url);
        if (!response.ok)
          throw new Error(
            `Oracle texture HTTP ${response.status}: ${texture.url}`,
          );
        images[id] = await createImageBitmap(await response.blob(), {
          premultiplyAlpha: "default",
          colorSpaceConversion: "none",
        });
      }),
    );
    window.__validationOracle = { scene, images };
  }, scene);
  const initial = await snapshot();
  await restore(initial);
  const baselineState = await snapshot();
  check(
    "ready scene has no pending asset loads",
    baselineState.pendingLoads === 0 &&
      baselineState.entities.length === scene.entities.length,
    { pendingLoads: baselineState.pendingLoads },
  );
  const baseline = await capture("baseline");
  await mutate("step", 0);
  check(
    "paused zero step preserves actual pixels",
    comparePixels(baseline, await capture("zero-step")).changed === 0,
  );

  // Keep other entities frozen while checking every exact boundary of selected actions.
  const animated = scene.entities.filter((entity) =>
    Object.values(entity.actions).some((frames) => frames.length > 1),
  );
  const subjects = animated.filter((entity) => entity.kind === "character");
  const mapSubject = animated.find((entity) => entity.kind !== "character");
  if (mapSubject) subjects.push(mapSubject);
  const alphaSubject = animated.find(
    (entity) =>
      entity.kind !== "character" &&
      Object.values(entity.actions).some((frames) =>
        frames.some(
          (frame) =>
            frame.alphaEnd !== undefined &&
            frame.parts.some((part) => (part.opacity ?? 1) !== frame.alphaEnd),
        ),
      ),
  );
  if (alphaSubject && !subjects.includes(alphaSubject))
    subjects.push(alphaSubject);
  report.animationCoverage = {
    animatedEntities: animated.length,
    checkedEntities: subjects.map((entity) => entity.id),
    policy:
      "Every character, first animated map entity, and first explicit-alpha-tween map entity; every action and frame boundary for those entities. Other map instances remain visible during scene/performance validation but are not individually boundary-tested.",
  };
  if (!subjects.length)
    skip(
      "animation delay boundaries",
      "Manifest contains no multi-frame entity actions.",
    );
  for (const subject of subjects) {
    // Isolate animation to prevent other sprites hiding its frame changes.
    await restore(baselineState);
    for (const entity of scene.entities)
      if (entity.id !== subject.id)
        await mutate("setVisible", entity.id, false);
    await mutate("setVisible", subject.id, true);
    await mutate(
      "setCamera",
      subject.x - Math.floor(baseline.width / 2),
      subject.y - Math.floor(baseline.height / 2),
    );
    for (const [action, frames] of Object.entries(subject.actions)) {
      if (!frames.length)
        throw new Error(`Empty action ${subject.id}/${action}`);
      await mutate("setAction", subject.id, action);
      check(
        `action reset ${subject.id}/${action}`,
        entityState(await snapshot(), subject.id).frame === 0,
      );
      if (
        frames.length === 1 &&
        (frames[0].alphaEnd === undefined ||
          frames[0].parts.every(
            (part) => (part.opacity ?? 1) === frames[0].alphaEnd,
          ))
      ) {
        const before = await capture(`static-${subject.id}-${action}`);
        await mutate("step", 10000);
        check(
          `static action retains pixels ${subject.id}/${action}`,
          entityState(await snapshot(), subject.id).frame === 0 &&
            comparePixels(
              before,
              await capture(`static-held-${subject.id}-${action}`),
            ).changed === 0,
        );
        continue;
      }
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
        const delay = frames[frameIndex].delay;
        if (!(Number.isFinite(delay) && delay > 0))
          throw new Error(
            `Nonpositive frame delay ${subject.id}/${action}/${frameIndex}`,
          );
        const label = `${subject.id}-${action}-${frameIndex}`;
        const before = await capture(`frame-${label}`);
        const epsilon = Math.min(0.25, delay / 2);
        let state = await mutate("step", delay - epsilon);
        const justBefore = await capture(`before-boundary-${label}`);
        const changingAlpha =
          frames[frameIndex].alphaEnd !== undefined &&
          frames[frameIndex].parts.some(
            (part) => (part.opacity ?? 1) !== frames[frameIndex].alphaEnd,
          );
        check(
          `frame remains before exact delay ${label}`,
          entityState(state, subject.id).frame === frameIndex &&
            (changingAlpha || comparePixels(before, justBefore).changed === 0),
          { delayMs: delay, elapsedMs: delay - epsilon, changingAlpha },
        );
        state = await mutate("step", epsilon);
        check(
          `exact delay advances frame ${label}`,
          entityState(state, subject.id).frame ===
            (frameIndex + 1) % frames.length,
          { delayMs: delay },
        );
        const after = await capture(`at-boundary-${label}`);
        report.checks.push({
          name: `boundary pixel observation ${label}`,
          status: "observed",
          ...comparePixels(before, after),
          note: "Identical adjacent artwork or offscreen artwork can legitimately have no changed pixels; frame index is checked separately.",
        });
      }
      // Advance through whole loops plus a partial cycle, not only one-frame increments.
      const cycle = frames.reduce((sum, frame) => sum + frame.delay, 0);
      await mutate("setAction", subject.id, action);
      const state = await mutate("step", cycle * 3 + frames[0].delay / 2);
      check(
        `large elapsed step wraps ${subject.id}/${action}`,
        entityState(state, subject.id).frame === 0,
        { stepMs: cycle * 3 + frames[0].delay / 2 },
      );
    }
  }

  await restore(baselineState);
  // Choose an actually contributing entity, not an arbitrary offscreen object.
  let visibleSubject;
  for (const entity of [...scene.entities]
    .reverse()
    .filter((entity) => entityState(baselineState, entity.id)?.visible)) {
    const state = await mutate("setVisible", entity.id, false);
    const hidden = await capture(`hidden-${entity.id}`);
    const difference = comparePixels(baseline, hidden);
    check(
      `visibility state ${entity.id}`,
      entityState(state, entity.id).visible === false,
    );
    await mutate("setVisible", entity.id, true);
    if (difference.changed) {
      visibleSubject = entity;
      check("visibility changes actual scene pixels", true, {
        entity: entity.id,
        ...difference,
      });
      break;
    }
  }
  check(
    "scene has at least one visible rendered entity",
    Boolean(visibleSubject),
  );
  const original = entityState(baselineState, visibleSubject.id);
  let state = await mutate(
    "setPosition",
    visibleSubject.id,
    original.x + 17,
    original.y + 11,
  );
  const moved = await capture("position-shift");
  check(
    "entity position changes state and pixels",
    entityState(state, visibleSubject.id).x === original.x + 17 &&
      entityState(state, visibleSubject.id).y === original.y + 11 &&
      comparePixels(baseline, moved).changed > 0,
    { entity: visibleSubject.id, ...comparePixels(baseline, moved) },
  );
  await restore(baselineState);
  const dx = 13,
    dy = 7;
  state = await mutate(
    "setCamera",
    baselineState.camera.x + dx,
    baselineState.camera.y + dy,
  );
  const cameraImage = await capture("camera-shift");
  check(
    "camera changes state and pixels",
    state.camera.x === baselineState.camera.x + dx &&
      state.camera.y === baselineState.camera.y + dy &&
      comparePixels(baseline, cameraImage).changed > 0,
  );
  // Parallax must not be mistaken for an ordinary world-translation error.
  await restore(baselineState);
  for (const entity of scene.entities)
    if (entity.background) await mutate("setVisible", entity.id, false);
  const worldBaseline = await capture("camera-world-baseline");
  await mutate(
    "setCamera",
    baselineState.camera.x + dx,
    baselineState.camera.y + dy,
  );
  const worldShift = await capture("camera-world-shift");
  let shiftMismatches = 0;
  for (let y = 0; y < baseline.height - dy; y++)
    for (let x = 0; x < baseline.width - dx; x++) {
      const a = ((y + dy) * baseline.width + x + dx) * 4;
      const b = (y * baseline.width + x) * 4;
      for (let c = 0; c < 4; c++)
        if (
          Math.abs(worldBaseline.pixels[a + c] - worldShift.pixels[b + c]) > 2
        ) {
          shiftMismatches++;
          break;
        }
    }
  check(
    "camera translates world pixels by requested offset",
    shiftMismatches === 0,
    {
      dx,
      dy,
      comparedPixels: (baseline.width - dx) * (baseline.height - dy),
      mismatchedPixels: shiftMismatches,
      channelTolerance: 2,
    },
  );
  await restore(baselineState);

  // Test layer extremes for each visible candidate until overlapping artwork is observed.
  let layerPixelEvidence = false;
  const layers = baselineState.entities.map((entity) => entity.z);
  for (const entity of [...scene.entities]
    .reverse()
    .filter((entity) => entityState(baselineState, entity.id)?.visible)) {
    await mutate("setLayer", entity.id, Math.min(...layers) - 1);
    const behind = await capture(`layer-back-${entity.id}`);
    state = await mutate("setLayer", entity.id, Math.max(...layers) + 1);
    const front = await capture(`layer-front-${entity.id}`);
    check(
      `layer state ${entity.id}`,
      entityState(state, entity.id).z === Math.max(...layers) + 1,
    );
    const difference = comparePixels(behind, front);
    await restore(baselineState);
    if (difference.changed) {
      layerPixelEvidence = true;
      check("layering changes overlapping rendered pixels", true, {
        entity: entity.id,
        ...difference,
      });
      break;
    }
  }
  if (!layerPixelEvidence)
    skip(
      "layering changes overlapping rendered pixels",
      "No visible candidate produced different pixels between extreme layers; scene cannot demonstrate occlusion ordering. State setter checks still ran.",
    );
  check(
    "restoring scene restores exact pixels",
    comparePixels(baseline, await capture("restored")).changed === 0,
  );

  // Artificially hold the manifest request to inspect atomic reload, not to claim loading performance.
  let heldRequest;
  const holdManifest = (request) => {
    if (
      new URL(request.url()).pathname === "/generated/scene.json" &&
      !heldRequest
    )
      heldRequest = request;
    else void request.continue().catch(() => {});
  };
  await page.setRequestInterception(true);
  page.on("request", holdManifest);
  try {
    await page.evaluate(() => {
      window.__validationReload = window.maple.reload();
      window.__validationReload.catch(() => {});
    });
    const deadline = performance.now() + 10000;
    while (!heldRequest && performance.now() < deadline) await Bun.sleep(10);
    if (!heldRequest)
      throw new Error(
        "Reload did not request the scene manifest within 10 seconds",
      );
    state = await snapshot();
    check(
      "reload retains committed scene while assets are pending",
      state.pendingLoads > 0 &&
        state.entities.length === baselineState.entities.length &&
        state.textureCount === baselineState.textureCount,
      { pendingLoads: state.pendingLoads },
    );
    check(
      "pending reload retains exact rendered pixels",
      comparePixels(baseline, await capture("reload-pending")).changed === 0,
    );
    await heldRequest.continue();
    heldRequest = null;
    await page.evaluate(() => window.__validationReload);
  } finally {
    if (heldRequest) await heldRequest.continue().catch(() => {});
    page.off("request", holdManifest);
    await page.setRequestInterception(false);
  }
  await restore(baselineState);
  state = await snapshot();
  check(
    "reload commits complete assets",
    state.pendingLoads === 0 &&
      state.textureCount === baselineState.textureCount,
  );
  check(
    "reloaded original assets reproduce exact pixels",
    comparePixels(baseline, await capture("reload-complete")).changed === 0,
  );

  // Swap real decoded artwork through an atomic manifest reload, not merely a setter.
  const replacement = structuredClone(scene);
  replacement.id += "-asset-swap-validation";
  const changedCharacter = replacement.entities.find(
    (entity) =>
      entity.kind === "character" &&
      entity.actions.walk1 &&
      entity.actions.stand1,
  );
  if (!changedCharacter)
    throw new Error("Asset swap requires stand1/walk1 decoded artwork");
  changedCharacter.actions.stand1 = changedCharacter.actions.walk1;
  const replaceManifest = (request) => {
    if (new URL(request.url()).pathname === "/generated/scene.json")
      void request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(replacement),
      });
    else void request.continue();
  };
  await page.setRequestInterception(true);
  page.on("request", replaceManifest);
  try {
    await page.evaluate(() => window.maple.reload());
  } finally {
    page.off("request", replaceManifest);
    await page.setRequestInterception(false);
  }
  await page.evaluate((scene) => {
    window.__validationOracle.scene = scene;
  }, replacement);
  await restore(baselineState);
  const swapped = await capture("asset-swap");
  check(
    "asset replacement commits new state and different original artwork",
    (await snapshot()).sceneId === replacement.id &&
      comparePixels(baseline, swapped).changed > 0,
  );
  await page.evaluate(() => window.maple.reload());
  await page.evaluate((scene) => {
    window.__validationOracle.scene = scene;
  }, scene);
  await restore(baselineState);
  check(
    "restoring asset references removes replacement textures without stale pixels",
    comparePixels(baseline, await capture("asset-swap-restored")).changed === 0,
  );

  await page.evaluate(() => {
    // Release the independent oracle's duplicate image storage before measurement.
    for (const image of Object.values(window.__validationOracle.images))
      image.close();
    delete window.__validationOracle;
    window.__validationMeasure = {
      started: performance.now(),
      timestamps: [],
      longTasks: [],
      active: true,
      observer: null,
    };
    const measurement = window.__validationMeasure;
    const tick = (time) => {
      if (measurement.active) {
        measurement.timestamps.push(time);
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      measurement.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          measurement.longTasks.push({
            start: entry.startTime,
            duration: entry.duration,
          });
      });
      measurement.observer.observe({ type: "longtask" });
    }
    window.maple.pause(false);
  });
  const performanceStart = await snapshot();
  await Bun.sleep(duration * 1000);
  const performanceEnd = await snapshot();
  const realtime = await page.evaluate(() => {
    const measurement = window.__validationMeasure;
    measurement.active = false;
    measurement.observer?.disconnect();
    return {
      started: measurement.started,
      ended: performance.now(),
      timestamps: measurement.timestamps,
      longTasks: measurement.longTasks,
      longTaskSupported:
        PerformanceObserver.supportedEntryTypes.includes("longtask"),
    };
  });
  const frameIntervals = realtime.timestamps
    .slice(1)
    .map((time, i) => time - realtime.timestamps[i]);
  check(
    "live scene produces requestAnimationFrame samples",
    frameIntervals.length > 0,
  );
  const reloadMeasurement = await page.evaluate(async () => {
    const start = performance.now();
    const timestamps = [];
    let active = true;
    const tick = (time) => {
      timestamps.push(time);
      if (active) requestAnimationFrame(tick);
    };
    await new Promise((resolve) =>
      requestAnimationFrame((time) => {
        tick(time);
        resolve();
      }),
    );
    const reloadStart = performance.now();
    await window.maple.reload();
    const reloadEnd = performance.now();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    active = false;
    return {
      start,
      reloadStart,
      reloadEnd,
      end: performance.now(),
      timestamps,
      state: window.maple.snapshot(),
    };
  });
  const reloadIntervals = reloadMeasurement.timestamps
    .slice(1)
    .map((time, i) => time - reloadMeasurement.timestamps[i]);
  const metrics = performanceEnd.metrics ?? {};
  const renderedFrames =
    metrics.renderedFrames - performanceStart.metrics.renderedFrames;
  const drawCpuSamples = (metrics.drawCpuTimes ?? []).slice(
    -Math.min(renderedFrames, metrics.drawCpuTimes?.length ?? 0),
  );
  check(
    "live renderer records draw CPU samples",
    performanceEnd.paused === false &&
      renderedFrames > 0 &&
      drawCpuSamples.length > 0 &&
      drawCpuSamples.every((value) => Number.isFinite(value) && value >= 0),
    { renderedFrames },
  );
  const graphics = await page.evaluate(() => {
    const canvas = document.querySelector("#scene-canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return null;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
      unmaskedVendor: debug
        ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
        : null,
      unmaskedRenderer: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : null,
    };
  });
  report.performance = {
    browserVersion: await browser.version(),
    viewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
    renderer: performanceEnd.renderer,
    measuredDurationMs: realtime.ended - realtime.started,
    graphics,
    raf: {
      intervalsMs: frameIntervals,
      statisticsMs: statistics(frameIntervals),
      note: "Observed real browser rAF timestamps while renderer animation is running. No synthetic frame timing.",
    },
    drawCpu: {
      renderedFrames,
      statisticsMs: statistics(drawCpuSamples),
      samplesMs: drawCpuSamples,
      sampleLimit: metrics.sampleLimit,
      note: "Renderer-reported bounded recent draw CPU window, restricted by rendered-frame counter to frames within the live measurement. Not GPU duration or total JavaScript work; older measured frames can be evicted from the bounded window.",
    },
    longTasks: {
      supported: realtime.longTaskSupported,
      entries: realtime.longTasks,
      note: "Browser Long Tasks API reports tasks of at least 50 ms; absence does not imply zero stalls.",
    },
    naturalReload: {
      durationMs: reloadMeasurement.reloadEnd - reloadMeasurement.reloadStart,
      rafIntervalsMs: reloadIntervals,
      rafStatisticsMs: statistics(reloadIntervals),
      pendingLoadsAfter: reloadMeasurement.state.pendingLoads,
      note: "Unthrottled reload under existing browser/Pixi cache state. rAF intervals include one bracketing frame on each side. Artificial atomicity hold is excluded.",
    },
    textureMemory: {
      approximateBytes: metrics.approximateTextureBytes ?? null,
      manifestRGBABytes: Object.values(scene.textures).reduce(
        (sum, texture) => sum + texture.width * texture.height * 4,
        0,
      ),
      note: "Uncompressed RGBA texture estimate, not measured GPU allocation; excludes driver overhead, render targets, and duplicate uploads.",
    },
    chromeHeap: {
      before: performanceStart.metrics?.browserHeap ?? null,
      after: metrics.browserHeap ?? null,
      afterReload: reloadMeasurement.state.metrics?.browserHeap ?? null,
      note: "Chrome performance.memory when available; not whole-browser RSS. Oracle ImageBitmaps are closed before measurement; previous validation allocations may remain until normal GC. No forced garbage collection.",
    },
    thresholds: null,
    note: "Measurements only. No invented FPS, memory, latency, or original-client performance target.",
  };
  check(
    "natural reload finishes without pending loads",
    reloadMeasurement.state.pendingLoads === 0,
  );
  await mutate("pause", true);
  await capture("live-measurement-end");
  check(
    "browser reports no page or request errors",
    report.errors.length === 0,
    { errors: report.errors },
  );
  report.status = "pass";
} catch (error) {
  report.status = "fail";
  report.failure = {
    message: String(error),
    stack: error instanceof Error ? error.stack : null,
  };
  process.exitCode = 1;
  if (page && !page.isClosed()) {
    try {
      await page.screenshot({
        path: join(output, "failure-page.png"),
        fullPage: true,
      });
    } catch {}
  }
} finally {
  report.finishedAt = new Date().toISOString();
  try {
    if (browser) await browser.close();
  } catch (error) {
    report.errors.push({ source: "cleanup", message: String(error) });
    report.status = "fail";
    process.exitCode = 1;
  }
  await Bun.write(
    join(output, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(
    `Browser validation ${report.status}: ${join(output, "report.json")}`,
  );
}
