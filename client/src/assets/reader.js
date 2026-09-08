/** Bounds-checked little-endian reader. No guessed format fallbacks. */
export class Reader {
  /** @param {Buffer} bytes @param {number} [position] @param {number} [end] */
  constructor(bytes, position = 0, end = bytes.length) {
    if (
      !Number.isSafeInteger(position) ||
      !Number.isSafeInteger(end) ||
      position < 0 ||
      end < position ||
      end > bytes.length
    ) {
      throw new RangeError("Invalid reader range");
    }
    this.bytes = bytes;
    this.pos = position;
    this.end = end;
  }
  /** @param {number} size */
  require(size) {
    if (
      !Number.isSafeInteger(this.pos) ||
      this.pos < 0 ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      this.pos + size > this.end
    ) {
      throw new RangeError(
        `Truncated input at 0x${this.pos.toString(16)}: need ${size}, end 0x${this.end.toString(16)}`,
      );
    }
  }
  u8() {
    this.require(1);
    return this.bytes[this.pos++];
  }
  i8() {
    const value = this.u8();
    return value > 127 ? value - 256 : value;
  }
  u16() {
    this.require(2);
    const v = this.bytes.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  i16() {
    this.require(2);
    const v = this.bytes.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    this.require(4);
    const v = this.bytes.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  i32() {
    this.require(4);
    const v = this.bytes.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  f32() {
    this.require(4);
    const v = this.bytes.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }
  f64() {
    this.require(8);
    const v = this.bytes.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }
  /** @param {number} size */
  take(size) {
    this.require(size);
    const value = this.bytes.subarray(this.pos, this.pos + size);
    this.pos += size;
    return value;
  }
  /** @param {number} size */
  skip(size) {
    this.require(size);
    this.pos += size;
  }
}
