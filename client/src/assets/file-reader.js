import { openSync, readSync, closeSync, fstatSync } from "node:fs";

/** Random-access archive reader with a bounded 64 KiB window, not a full-file copy. */
export class FileReader {
  /** @param {string} path */
  constructor(path) {
    this.fd = openSync(path, "r");
    this.end = fstatSync(this.fd).size;
    this.pos = 0;
    this.window = Buffer.alloc(65536);
    this.start = -1;
    this.length = 0;
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
        `Truncated archive at 0x${this.pos.toString(16)}: need ${size}, size ${this.end}`,
      );
    }
  }
  /** @param {number} size @returns {Buffer} */
  take(size) {
    this.require(size);
    if (size > this.window.length) {
      const result = Buffer.allocUnsafe(size);
      let n = 0;
      while (n < size) {
        const read = readSync(this.fd, result, n, size - n, this.pos + n);
        if (!read) throw new Error("Unexpected end of archive");
        n += read;
      }
      this.pos += size;
      return result;
    }
    if (this.pos < this.start || this.pos + size > this.start + this.length) {
      this.start = this.pos;
      this.length = readSync(
        this.fd,
        this.window,
        0,
        Math.min(this.window.length, this.end - this.pos),
        this.pos,
      );
      if (this.length < size) throw new Error("Unexpected short archive read");
    }
    const result = this.window.subarray(
      this.pos - this.start,
      this.pos - this.start + size,
    );
    this.pos += size;
    return result;
  }
  u8() {
    return this.take(1)[0];
  }
  i8() {
    return this.take(1).readInt8(0);
  }
  u16() {
    return this.take(2).readUInt16LE(0);
  }
  i16() {
    return this.take(2).readInt16LE(0);
  }
  u32() {
    return this.take(4).readUInt32LE(0);
  }
  i32() {
    return this.take(4).readInt32LE(0);
  }
  /** @param {number} size */
  skip(size) {
    this.require(size);
    this.pos += size;
  }
  close() {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }
}
