import { createCipheriv } from "node:crypto";

// Original PCOM.dll table at 0x50c170b0: first DWORD from each 16-byte group.
// See docs/asset-evidence.md; direct Character.wz probe decodes 00002000.img.
const KEY = Buffer.from(
  "130000000800000006000000b40000001b0000000f0000003300000052000000",
  "hex",
);
const IV = Buffer.from("4d23c72b4d23c72b4d23c72b4d23c72b", "hex");
let stream = Buffer.alloc(0);
/** Original AES-256 output-feedback byte stream, shared read-only.
 * @param {number} length @returns {Buffer}
 */
export function keyStream(length) {
  if (!Number.isSafeInteger(length) || length < 0 || length > 16 * 1024 * 1024)
    throw new RangeError("Invalid cipher stream length");
  if (stream.length >= length) return stream;
  const next = Buffer.alloc(Math.ceil(length / 4096) * 4096);
  next.set(stream);
  const cipher = createCipheriv("aes-256-ecb", KEY, null);
  cipher.setAutoPadding(false);
  let block = stream.length ? stream.subarray(-16) : IV;
  for (let p = stream.length; p < next.length; p += 16) {
    block = cipher.update(block);
    next.set(block, p);
  }
  cipher.final();
  stream = next;
  return stream;
}
