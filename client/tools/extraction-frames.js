import { at, value, resolveNode } from "../src/assets/image.js";

/** Original Gr2D preserves zero-delay frames as equal-time timeline entries. */
export function frameDelay(node, source) {
  const delay = Number(value(node, "delay", 120));
  if (!Number.isSafeInteger(delay) || delay < 0) {
    throw new Error(`Invalid frame delay at ${source}`);
  }
  return delay;
}

/** 006431e3: nonnegative repeat selects a frame index; -1/-2 start one-shot playback. */
function retainRepeat(node, frames, source) {
  const repeat = value(node, "repeat", undefined);
  if (repeat === undefined) return frames;
  if (!Number.isSafeInteger(repeat) || repeat < -2 || repeat >= frames.length) {
    throw new Error(`Invalid animation repeat at ${source}`);
  }
  frames[0].repeat = repeat;
  return frames;
}

/** Build original frame records using the caller's real decoded-canvas part loader. */
export async function originalFrames(node, part, nodePath) {
  node = resolveNode(node);
  if (node.type === "Canvas") {
    const frame = {
      delay: frameDelay(node, nodePath(node)),
      parts: [await part(node)],
    };
    const start = value(node, "a0", -1),
      end = value(node, "a1", -1);
    if (start >= 0 || end >= 0) {
      const a0 = start < 0 ? 255 : start;
      frame.parts[0].opacity = a0 / 255;
      frame.alphaEnd = (end < 0 ? a0 : end) / 255;
    }
    return retainRepeat(node, [frame], nodePath(node));
  }
  const result = [];
  let carriedAlpha = 255;
  for (const key of Object.keys(node.children)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))) {
    const frame = at(node, key);
    if (frame.type !== "Canvas") {
      throw new Error(`Expected Canvas animation frame: ${nodePath(frame)}`);
    }
    const delay = frameDelay(frame, nodePath(frame));
    const start = value(frame, "a0", -1),
      end = value(frame, "a1", -1);
    const a0 = start < 0 ? carriedAlpha : start,
      a1 = end < 0 ? a0 : end;
    result.push({
      delay,
      parts: [{ ...(await part(frame)), opacity: a0 / 255 }],
      alphaEnd: a1 / 255,
    });
    carriedAlpha = a1;
  }
  if (!result.length) throw new Error(`No canvas frames at ${nodePath(node)}`);
  return retainRepeat(node, result, nodePath(node));
}
