import { keyStream } from "./crypto.js";
/** @typedef {import('./reader.js').Reader | import('./file-reader.js').FileReader} Input */
/** Signed compact integer; NameSpace.dll FUN_5080db47.
 * @param {Input} reader */
export function compact(reader) {
  const n = reader.i8();
  return n === -128 ? reader.i32() : n;
}
/** PCOM.dll FUN_50c0707f: signed string length, AES stream, incrementing mask.
 * @param {Input} reader */
export function wzString(reader) {
  const prefix = reader.i8();
  if (!prefix) return "";
  const wide = prefix > 0;
  const length =
    prefix === -128 || prefix === 127 ? reader.i32() : Math.abs(prefix);
  if (length < 0 || length > 8191) {
    throw new Error(`Invalid WZ string length ${length}`);
  }
  const bytes = reader.take(length * (wide ? 2 : 1));
  const key = keyStream(bytes.length);
  if (wide) {
    let text = "";
    for (let i = 0; i < length; i++) {
      text += String.fromCharCode(
        bytes.readUInt16LE(i * 2) ^
          key.readUInt16LE(i * 2) ^
          ((0xaaaa + i) & 65535),
      );
    }
    return text;
  }
  const result = Buffer.alloc(length);
  for (let i = 0; i < length; i++) {
    result[i] = bytes[i] ^ key[i] ^ ((0xaa + i) & 255);
  }
  return result.toString("latin1");
}
/** String block relative to the IMG base. @param {Input} reader @param {number} base */
export function stringBlock(reader, base) {
  const tag = reader.u8();
  if (tag === 0 || tag === 0x73) return wzString(reader);
  if (tag === 1 || tag === 0x1b) {
    const offset = reader.i32();
    const saved = reader.pos;
    try {
      reader.pos = base + offset;
      return wzString(reader);
    } finally {
      reader.pos = saved;
    }
  }
  throw new Error(
    `Unsupported WZ string block tag 0x${tag.toString(16)} at 0x${(reader.pos - 1).toString(16)}`,
  );
}
