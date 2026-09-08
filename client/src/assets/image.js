import { Reader } from "./reader.js";
import { compact, stringBlock } from "./strings.js";

/** @typedef {{type:string, name:string, parent:WzNode|null, children:Record<string,WzNode>, value?:any, width?:number, height?:number, format?:number, scale?:number, data?:Buffer}} WzNode */
/** @param {Reader} reader @returns {WzNode} */
export function parseImage(reader) {
  /** @param {string} type @param {string} name @param {WzNode|null} parent */
  const node = (type, name, parent) => ({
    type,
    name,
    parent,
    children: Object.create(null),
  });
  /** @param {WzNode} parent @param {number} depth */
  function properties(parent, depth) {
    if (depth > 64) throw new Error("IMG property nesting exceeds limit");
    if (reader.u16() !== 0) throw new Error("Unsupported Property flags");
    const count = compact(reader);
    if (count < 0 || count > 100000)
      throw new Error(`Invalid property count ${count}`);
    for (let i = 0; i < count; i++) {
      const name = stringBlock(reader, 0);
      const type = reader.u8();
      if (Object.hasOwn(parent.children, name))
        throw new Error(`Duplicate property ${name}`);
      let child = node("value", name, parent);
      switch (type) {
        case 0:
          child.value = null;
          break;
        case 2:
        case 11:
          child.value = reader.i16();
          break;
        case 16:
        case 17:
        case 18:
          child.value = reader.u16();
          break;
        case 3:
        case 19:
          child.value = compact(reader);
          break;
        case 4: {
          const bits = compact(reader);
          const buffer = Buffer.alloc(4);
          buffer.writeInt32LE(bits);
          child.value = buffer.readFloatLE();
          break;
        }
        case 5:
        case 7:
          child.value = reader.f64();
          break;
        case 8:
          child.value = stringBlock(reader, 0);
          break;
        case 9: {
          const length = reader.u32();
          reader.require(length);
          const end = reader.pos + length;
          const savedEnd = reader.end;
          reader.end = end;
          child = extended(name, parent, depth + 1);
          if (reader.pos !== end)
            throw new Error(
              `IMG ${name} (${child.type}) consumed ${reader.pos}, expected ${end}`,
            );
          reader.end = savedEnd;
          break;
        }
        default:
          throw new Error(
            `Unsupported property type ${type} at ${name}, byte 0x${reader.pos.toString(16)}`,
          );
      }
      parent.children[name] = child;
    }
  }
  /** @param {string} name @param {WzNode|null} parent @param {number} depth @returns {WzNode} */
  function extended(name, parent, depth) {
    if (depth > 64) throw new Error("IMG object nesting exceeds limit");
    const type = stringBlock(reader, 0);
    const result = node(type, name, parent);
    if (type === "Property") properties(result, depth);
    else if (type === "Shape2D#Vector2D")
      result.value = { x: compact(reader), y: compact(reader) };
    else if (type === "Shape2D#Convex2D") {
      const count = compact(reader);
      if (count < 0 || count > 100000)
        throw new Error(`Invalid Convex2D count ${count}`);
      for (let i = 0; i < count; i++)
        result.children[i] = extended(String(i), result, depth + 1);
    } else if (type === "UOL") {
      if (reader.u8() !== 0) throw new Error("Unsupported UOL flags");
      result.value = stringBlock(reader, 0);
    } else if (type === "Canvas") {
      if (reader.u8() !== 0) throw new Error("Unsupported Canvas flags");
      const hasProperties = reader.u8();
      if (hasProperties) properties(result, depth);
      result.width = compact(reader);
      result.height = compact(reader);
      result.format = compact(reader);
      result.scale = compact(reader);
      if (
        ![1, 2, 513, 1026].includes(result.format) ||
        result.scale < 0 ||
        result.scale > 16
      )
        throw new Error(
          `Unsupported canvas format/scale ${result.format}/${result.scale}`,
        );
      for (let i = 0; i < 4; i++)
        if (compact(reader) !== 0)
          throw new Error("Unsupported Canvas reserved value");
      const length = reader.u32();
      if (length < 1) throw new Error("Empty Canvas data envelope");
      if (reader.u8() !== 0) throw new Error("Unsupported Canvas data marker");
      result.data = reader.take(length - 1);
    } else if (type === "Sound_DX8") {
      // Original 518070c0 + 51807511. Preserve encoded audio; do not invent a browser codec.
      if (reader.u8() !== 0) throw new Error("Unsupported Sound_DX8 flags");
      const length = compact(reader);
      const field30 = compact(reader),
        field34 = compact(reader);
      if (length < 0) throw new Error("Invalid Sound_DX8 payload length");
      const majorType = reader.take(16).toString("hex");
      const subType = reader.take(16).toString("hex");
      const sampleSize = compact(reader),
        formatFlags = compact(reader);
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
    } else throw new Error(`Unsupported extended IMG type ${type} at ${name}`);
    return result;
  }
  const root = extended("", null, 0);
  if (reader.pos !== reader.end)
    throw new Error(`Trailing IMG bytes: ${reader.end - reader.pos}`);
  return root;
}
/** Resolve original relative UOL references with cycle detection.
 * @param {WzNode} node @returns {WzNode} */
export function resolveNode(node) {
  const visited = new Set();
  while (node?.type === "UOL") {
    if (visited.has(node)) throw new Error(`Cyclic UOL ${node.name}`);
    visited.add(node);
    let current = node.parent;
    for (const part of node.value.split("/")) {
      if (part === "..") current = current?.parent;
      else if (part !== "." && part !== "") current = current?.children[part];
      if (!current)
        throw new Error(`Unresolved UOL ${node.name}: ${node.value}`);
    }
    node = current;
  }
  if (!node) throw new Error("Missing resource node");
  return node;
}
/** @param {WzNode} node @param {string} path @returns {WzNode} */
export function at(node, path) {
  for (const part of path.split("/").filter(Boolean))
    node = resolveNode(node).children[part];
  return resolveNode(node);
}
/** @param {WzNode} node @param {string} name @param {any} [fallback] */
export function value(node, name, fallback) {
  const child = resolveNode(node).children[name];
  return child ? resolveNode(child).value : fallback;
}
