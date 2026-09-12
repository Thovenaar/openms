import { protocolError, validUnicode } from "./schema.js";

const HARD_MAX_BYTES = 1048576;
const HARD_MAX_NODES = 65536;
const HARD_MAX_DEPTH = 32;
const NUMBER_TOKEN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

function decodeText(source, maxBytes) {
  if (typeof source === "string") {
    if (
      source.length > maxBytes ||
      !validUnicode(source) ||
      new TextEncoder().encode(source).byteLength > maxBytes
    ) {
      throw protocolError();
    }
    return source;
  }
  let bytes;
  if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
  else if (ArrayBuffer.isView(source)) {
    bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  } else throw protocolError();
  if (bytes.byteLength > maxBytes) throw protocolError();
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw protocolError();
  }
}

function stringToken(text, offset) {
  for (let i = offset + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] !== '"') continue;
    let value;
    try {
      value = JSON.parse(text.slice(offset, i + 1));
    } catch {
      throw protocolError();
    }
    if (!validUnicode(value)) throw protocolError();
    return { value, end: i + 1 };
  }
  throw protocolError();
}

function numberToken(text, offset) {
  NUMBER_TOKEN.lastIndex = offset;
  const match = NUMBER_TOKEN.exec(text);
  if (!match) throw protocolError();
  const value = Number(match[0]);
  if (
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))
  ) {
    throw protocolError();
  }
  if (value === 0 && /[1-9]/.test(match[0].split(/[eE]/, 1)[0])) {
    throw protocolError();
  }
  return offset + match[0].length;
}

function isWhitespace(char) {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function scanString(text, offset, stack) {
  const token = stringToken(text, offset);
  let lookahead = token.end;
  for (; lookahead < text.length && isWhitespace(text[lookahead]); lookahead++);
  if (text[lookahead] === ":") {
    const frame = stack[stack.length - 1];
    if (!frame || frame.char !== "{" || frame.keys.has(token.value)) {
      throw protocolError();
    }
    frame.keys.add(token.value);
  }
  return token.end;
}

function scanValue(text, offset, stack) {
  const char = text[offset];
  if (char === '"') return scanString(text, offset, stack);
  if (char === "-" || (char >= "0" && char <= "9")) {
    return numberToken(text, offset);
  }
  const literal =
    char === "t" ? "true" : char === "f" ? "false" : char === "n" ? "null" : "";
  if (!literal || !text.startsWith(literal, offset)) throw protocolError();
  return offset + literal.length;
}

function closeContainer(stack, char) {
  const frame = stack.pop();
  if (!frame || frame.char !== (char === "}" ? "{" : "[")) {
    throw protocolError();
  }
}

function scanJson(text, limits) {
  const stack = [];
  let nodes = 0;
  for (let i = 0; i < text.length; ) {
    const char = text[i];
    if (isWhitespace(char) || char === ":" || char === ",") {
      i++;
      continue;
    }
    if (char === "}" || char === "]") {
      closeContainer(stack, char);
      i++;
      continue;
    }
    if (++nodes > limits.maxNodes) throw protocolError();
    if (char === "{" || char === "[") {
      if (stack.length >= limits.maxDepth) throw protocolError();
      stack.push({ char, keys: new Set() });
      i++;
      continue;
    }
    i = scanValue(text, i, stack);
  }
  if (stack.length !== 0) throw protocolError();
}

function validateLimit(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw protocolError();
  }
}

/** Parse hostile JSON only after byte, encoding, depth, token and duplicate-key checks. */
export function decodeJson(
  source,
  { maxBytes = 16384, maxDepth = 8, maxNodes = 256 } = {},
) {
  validateLimit(maxBytes, HARD_MAX_BYTES);
  validateLimit(maxDepth, HARD_MAX_DEPTH);
  validateLimit(maxNodes, HARD_MAX_NODES);
  const text = decodeText(source, maxBytes);
  scanJson(text, { maxDepth, maxNodes });
  try {
    return JSON.parse(text);
  } catch {
    throw protocolError();
  }
}
