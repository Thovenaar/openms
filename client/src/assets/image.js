/** @typedef {import('./reader.js').Reader} Reader */
import { compact, stringBlock } from "./strings.js";

const MAX_IMG_DEPTH = 64;
const MAX_CHILDREN = 100000;
const MAX_UOL_HOPS = 100000;
/** @typedef {{type:string, name:string, parent:WzNode|null, children:Record<string,WzNode>, value?:any, width?:number, height?:number, format?:number, scale?:number, data?:Buffer}} WzNode */
/** @param {string} type @param {string} name @param {WzNode|null} parent */
function createNode(type, name, parent) {
  return { type, name, parent, children: Object.create(null) };
}
/** Read a validated finite child count. @param {Reader} reader @param {string} kind */
function childCount(reader, kind) {
  const count = compact(reader);
  if (count < 0 || count > MAX_CHILDREN) {
    throw new Error(`Invalid ${kind} count ${count}`);
  }
  return count;
}
/** Initialize the property continuation without descending into children. */
function startProperties(reader, frame) {
  if (frame.depth > MAX_IMG_DEPTH) {
    throw new Error("IMG property nesting exceeds limit");
  }
  if (reader.u16() !== 0) throw new Error("Unsupported Property flags");
  frame.remaining = childCount(reader, "property");
  frame.stage = "properties";
}
/** Read Canvas metadata after its optional property list has completed. */
function readCanvas(reader, result) {
  result.width = compact(reader);
  result.height = compact(reader);
  result.format = compact(reader);
  result.scale = compact(reader);
  if (
    ![1, 2, 513, 1026].includes(result.format) ||
    result.scale < 0 ||
    result.scale > 16
  ) {
    throw new Error(
      `Unsupported canvas format/scale ${result.format}/${result.scale}`,
    );
  }
  for (let i = 0; i < 4; i++) {
    if (compact(reader) !== 0) {
      throw new Error("Unsupported Canvas reserved value");
    }
  }
  const length = reader.u32();
  if (length < 1) throw new Error("Empty Canvas data envelope");
  if (reader.u8() !== 0) throw new Error("Unsupported Canvas data marker");
  result.data = reader.take(length - 1);
}
/** Original 518070c0 + 51807511; retain encoded audio and its original envelope. */
function readSound(reader, result) {
  if (reader.u8() !== 0) throw new Error("Unsupported Sound_DX8 flags");
  const length = compact(reader);
  const field30 = compact(reader);
  const field34 = compact(reader);
  if (length < 0) throw new Error("Invalid Sound_DX8 payload length");
  const majorType = reader.take(16).toString("hex");
  const subType = reader.take(16).toString("hex");
  const sampleSize = compact(reader);
  const formatFlags = compact(reader);
  const formatType = reader.take(16).toString("hex");
  let formatData = Buffer.alloc(0);
  if (
    formatType !== "00000000000000000000000000000000" &&
    formatType !== "d617640f18c3d011a43f00a0c9223196"
  ) {
    formatData = reader.take(compact(reader));
  }
  result.value = {
    field30,
    field34,
    majorType,
    subType,
    sampleSize,
    formatFlags,
    formatType,
    formatData,
  };
  result.data = reader.take(length);
}
/** Initialize one object. Frame end/savedEnd are present only for length-prefixed objects. */
function startExtended(reader, frame) {
  if (frame.depth > MAX_IMG_DEPTH) {
    throw new Error("IMG object nesting exceeds limit");
  }
  const result = frame.node;
  result.type = stringBlock(reader, 0);
  frame.stage = "done";
  frame.remaining = 0;
  switch (result.type) {
    case "Property":
      startProperties(reader, frame);
      break;
    case "Shape2D#Vector2D":
      result.value = { x: compact(reader), y: compact(reader) };
      break;
    case "Shape2D#Convex2D":
      frame.remaining = childCount(reader, "Convex2D");
      frame.index = 0;
      frame.stage = "convex";
      break;
    case "UOL":
      if (reader.u8() !== 0) throw new Error("Unsupported UOL flags");
      result.value = stringBlock(reader, 0);
      break;
    case "Canvas":
      if (reader.u8() !== 0) throw new Error("Unsupported Canvas flags");
      if (reader.u8()) startProperties(reader, frame);
      else readCanvas(reader, result);
      break;
    case "Sound_DX8":
      readSound(reader, result);
      break;
    default:
      throw new Error(
        `Unsupported extended IMG type ${result.type} at ${result.name}`,
      );
  }
}
/** Decode primitive properties without allocating per-type callbacks. */
function readScalar(reader, type, name) {
  if (type === 2 || type === 11) return reader.i16();
  if (type >= 16 && type <= 18) return reader.u16();
  if (type === 3 || type === 19) return compact(reader);
  switch (type) {
    case 0:
      return null;
    case 4: {
      const bits = compact(reader);
      const buffer = Buffer.alloc(4);
      buffer.writeInt32LE(bits);
      return buffer.readFloatLE();
    }
    case 5:
    case 7:
      return reader.f64();
    case 8:
      return stringBlock(reader, 0);
    default:
      throw new Error(
        `Unsupported property type ${type} at ${name}, byte 0x${reader.pos.toString(16)}`,
      );
  }
}
/** Consume one property header and return an object continuation, or null for a scalar. */
function readProperty(reader, frame) {
  const name = stringBlock(reader, 0);
  const type = reader.u8();
  if (Object.hasOwn(frame.node.children, name)) {
    throw new Error(`Duplicate property ${name}`);
  }
  const child = createNode("value", name, frame.node);
  frame.node.children[name] = child;
  if (type !== 9) {
    child.value = readScalar(reader, type, name);
    return null;
  }
  const length = reader.u32();
  reader.require(length);
  const next = {
    node: child,
    depth: frame.depth + 1,
    end: reader.pos + length,
    savedEnd: reader.end,
  };
  reader.end = next.end;
  return next;
}
/** Finish a suspended collection; Canvas payload follows its properties, not its header. */
function finishExtended(reader, frame) {
  if (frame.stage === "properties" && frame.node.type === "Canvas") {
    readCanvas(reader, frame.node);
  }
  if (frame.end === undefined) return;
  if (reader.pos !== frame.end) {
    throw new Error(
      `IMG ${frame.node.name} (${frame.node.type}) consumed ${reader.pos}, expected ${frame.end}`,
    );
  }
  reader.end = frame.savedEnd;
}
/** Select the next child without recursive object/property calls. */
function nextChild(reader, frame) {
  frame.remaining--;
  if (frame.stage === "properties") return readProperty(reader, frame);
  const name = String(frame.index++);
  const node = createNode("", name, frame.node);
  frame.node.children[name] = node;
  return { node, depth: frame.depth + 1 };
}
/** Parse IMG using a depth-bounded continuation stack and inherited child byte limits.
 * @param {Reader} reader @returns {WzNode} */
export function parseImage(reader) {
  const root = createNode("", "", null);
  const stack = [{ node: root, depth: 0 }];
  // Every child consumes bytes and each object is entered/finished once.
  const maxSteps = (reader.end - reader.pos) * 3 + 1;
  startExtended(reader, stack[0]);
  for (let step = 0; stack.length && step < maxSteps; step++) {
    const frame = stack[stack.length - 1];
    if (!frame.remaining) {
      finishExtended(reader, frame);
      stack.pop();
      continue;
    }
    const child = nextChild(reader, frame);
    if (!child) continue;
    startExtended(reader, child);
    stack.push(child);
  }
  if (stack.length) throw new Error("IMG traversal exceeds byte-derived limit");
  if (reader.pos !== reader.end) {
    throw new Error(`Trailing IMG bytes: ${reader.end - reader.pos}`);
  }
  return root;
}
/** Follow one relative UOL path; chained references are resolved by the caller.
 * @param {WzNode} node @returns {WzNode} */
function followUol(node) {
  let current = node.parent;
  for (const part of node.value.split("/")) {
    if (part === "..") current = current?.parent;
    else if (part !== "." && part !== "") current = current?.children[part];
    if (!current) {
      throw new Error(`Unresolved UOL ${node.name}: ${node.value}`);
    }
  }
  return current;
}
/** Resolve original relative UOL references with cycle detection.
 * @param {WzNode} node @returns {WzNode} */
export function resolveNode(node) {
  const visited = new Set();
  for (let hop = 0; node?.type === "UOL" && hop < MAX_UOL_HOPS; hop++) {
    if (visited.has(node)) throw new Error(`Cyclic UOL ${node.name}`);
    visited.add(node);
    node = followUol(node);
  }
  if (!node) throw new Error("Missing resource node");
  if (node.type === "UOL") throw new Error("UOL traversal exceeds limit");
  return node;
}
/** @param {WzNode} node @param {string} path @returns {WzNode} */
export function at(node, path) {
  for (const part of path.split("/").filter(Boolean)) {
    node = resolveNode(node).children[part];
  }
  return resolveNode(node);
}
/** @param {WzNode} node @param {string} name @param {any} [fallback] */
export function value(node, name, fallback) {
  const child = resolveNode(node).children[name];
  return child ? resolveNode(child).value : fallback;
}
