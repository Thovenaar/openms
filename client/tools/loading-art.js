import { at, value } from "../src/assets/image.js";
import { decodeCanvas } from "../src/assets/canvas.js";
import { encodePNG } from "../src/assets/png.js";
import { hash, resource } from "./atlas.js";

const SOURCE = "Mob.wz:0120100.img/move";

/** Original move canvases only; no synthetic delay, origin, scaling or loop order. */
function originalFrames(image) {
  const move = at(image, "move");
  if (value(move, "zigzag", 0)) {
    throw new Error("Loading artwork requires an ordinary original move loop");
  }
  const keys = Object.keys(move.children).filter((key) => /^\d+$/.test(key));
  if (!keys.length || keys.length > 32) {
    throw new Error("Loading artwork frame bound exceeded");
  }
  return keys
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => {
      const node = at(move, key);
      const origin = value(node, "origin", null);
      const delay = value(node, "delay", null);
      if (!origin || !Number.isSafeInteger(delay) || delay <= 0) {
        throw new Error(
          "Loading artwork requires authored origin and positive delay",
        );
      }
      const { width, height, rgba } = decodeCanvas(node);
      const png = encodePNG(width, height, rgba);
      return {
        source: `${SOURCE}/${key}`,
        width,
        height,
        origin,
        delay,
        sha256: hash(png),
        png,
      };
    });
}

/** A self-contained immutable SVG carries lossless original PNGs and discrete frame timing. */
function animatedImage(frames) {
  const left = Math.min(...frames.map((frame) => -frame.origin.x));
  const top = Math.min(...frames.map((frame) => -frame.origin.y));
  const right = Math.max(
    ...frames.map((frame) => frame.width - frame.origin.x),
  );
  const bottom = Math.max(
    ...frames.map((frame) => frame.height - frame.origin.y),
  );
  const duration = frames.reduce((sum, frame) => sum + frame.delay, 0);
  let elapsed = 0;
  const times = frames.map((frame) => {
    const start = elapsed / duration;
    elapsed += frame.delay;
    return start;
  });
  const images = frames.map((frame, index) => {
    const values = frames.map((_, selected) => (selected === index ? 1 : 0));
    values.push(values[0]);
    return `<image x="${-frame.origin.x}" y="${-frame.origin.y}" width="${frame.width}" height="${frame.height}" href="data:image/png;base64,${frame.png.toString("base64")}"><animate attributeName="opacity" calcMode="discrete" values="${values.join(";")}" keyTimes="${[...times, 1].join(";")}" dur="${duration}ms" repeatCount="indefinite"/></image>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${right - left}" height="${bottom - top}" viewBox="${left} ${top} ${right - left} ${bottom - top}">${images.join("")}</svg>`;
}

/** Existing IMG provenance, PNG encoder and immutable publisher own the complete resource. */
export async function extractLoadingArt(context) {
  const frames = originalFrames(await context.image("Mob", "0120100.img"));
  const descriptor = await resource(
    context.output,
    "bundles",
    "svg",
    Buffer.from(animatedImage(frames)),
  );
  return {
    ...descriptor,
    source: SOURCE,
    frames: frames.map((frame) => ({
      source: frame.source,
      width: frame.width,
      height: frame.height,
      origin: frame.origin,
      delay: frame.delay,
      sha256: frame.sha256,
    })),
  };
}
