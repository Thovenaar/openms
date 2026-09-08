import { FileReader } from "./file-reader.js";
import { Reader } from "./reader.js";
import { compact, wzString } from "./strings.js";

/** NameSpace.dll FUN_50811a8c. @param {number} version */
export function versionHash(version) {
  let hash = 0;
  for (const char of String(version)) {
    hash = (Math.imul(hash, 32) + char.charCodeAt(0) + 1) >>> 0;
  }
  return hash;
}
/** Original archive, directory metadata only; IMG payloads loaded on demand. */
export class WzArchive {
  /** @param {string} path @param {number} [version] */
  constructor(path, version = 83) {
    this.path = path;
    this.reader = new FileReader(path);
    this.hash = versionHash(version);
    try {
      const r = this.reader;
      if (r.take(4).toString("ascii") !== "PKG1") {
        throw new Error(`${path}: not a PKG1 archive`);
      }
      const size = r.u32() + r.u32() * 4294967296;
      this.base = r.u32();
      if (this.base < 16 || size + this.base !== r.end) {
        throw new Error(`${path}: inconsistent header size`);
      }
      r.pos = this.base;
      this.encryptedVersion = r.u16();
      const checksum =
        (this.hash ^
          (this.hash >>> 8) ^
          (this.hash >>> 16) ^
          (this.hash >>> 24)) &
        255;
      if (
        this.encryptedVersion !== checksum &&
        this.encryptedVersion !== (checksum ^ 255)
      ) {
        throw new Error(
          `${path}: version ${version} does not match archive header`,
        );
      }
      this.entries = new Map();
      this.directories = new Set();
      this.readDirectory("", r.pos, 0);
    } catch (error) {
      this.reader.close();
      throw error;
    }
  }
  /** Absolute-file adaptation of NameSpace.dll FUN_50811ed8.
   * @returns {number} */
  offset() {
    const r = this.reader;
    let value = (Math.imul(~(r.pos - this.base), this.hash) - 0x581c3f6d) >>> 0;
    const shift = value & 31;
    value = ((value << shift) | (value >>> ((32 - shift) & 31))) >>> 0;
    return ((r.u32() ^ value) + this.base * 2) >>> 0;
  }
  /** Traverse directories in original depth-first order with bounded explicit state.
   * @param {string} prefix @param {number} position @param {number} depth */
  readDirectory(prefix, position, depth) {
    const stack = [{ prefix, position, depth }];
    const maxDirectories = this.reader.end;
    for (let visited = 0; stack.length && visited < maxDirectories; visited++) {
      const frame = stack.pop();
      const children = this.directoryChildren(frame);
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        stack.push({
          prefix: child.path,
          position: child.offset,
          depth: frame.depth + 1,
        });
      }
    }
    if (stack.length) {
      throw new Error("WZ directory traversal exceeds file limit");
    }
  }
  /** Read one directory table before visiting any child offsets. */
  directoryChildren(frame) {
    if (frame.depth > 32 || this.directories.has(frame.position)) {
      throw new Error("Cyclic or too-deep WZ directory");
    }
    this.directories.add(frame.position);
    const r = this.reader;
    r.pos = frame.position;
    const count = compact(r);
    if (count < 0 || count > 100000) {
      throw new Error(`Invalid directory count ${count}`);
    }
    const children = [];
    for (let i = 0; i < count; i++) {
      const entry = this.directoryEntry(frame.prefix);
      if (this.entries.has(entry.path)) {
        throw new Error(`Duplicate WZ path ${entry.path}`);
      }
      this.entries.set(entry.path, entry);
      if (entry.type & 1) children.push(entry);
    }
    return children;
  }
  /** Directory name references are file-relative and restore the table cursor. */
  directoryName() {
    const r = this.reader;
    let type = r.u8();
    if (type === 3 || type === 4) return { type, name: wzString(r) };
    if (type !== 1 && type !== 2) {
      throw new Error(`Unsupported directory entry ${type}`);
    }
    const nameOffset = r.i32();
    const saved = r.pos;
    try {
      r.pos = this.base + nameOffset;
      type = r.u8();
      return { type, name: wzString(r) };
    } finally {
      r.pos = saved;
    }
  }
  /** Decode and validate one directory entry, preserving original offset arithmetic. */
  directoryEntry(prefix) {
    const r = this.reader;
    const { type, name } = this.directoryName();
    const size = compact(r);
    const checksum = compact(r);
    const offset = this.offset();
    if (
      size < 0 ||
      offset < this.base ||
      offset + size > r.end ||
      !name ||
      name.includes("/")
    ) {
      throw new Error(`Invalid WZ entry ${prefix}/${name}: ${offset}+${size}`);
    }
    const path = prefix ? `${prefix}/${name}` : name;
    return { path, name, type, size, checksum, offset };
  }
  /** Read and checksum one original IMG payload. @param {string} path @returns {Reader} */
  imageReader(path) {
    const entry = this.entries.get(path);
    if (!entry || entry.type & 1) {
      throw new Error(`Missing image ${this.path}:${path}`);
    }
    this.reader.pos = entry.offset;
    const bytes = Buffer.from(this.reader.take(entry.size));
    let checksum = 0;
    for (const byte of bytes) checksum = (checksum + byte) | 0;
    if (checksum !== entry.checksum) {
      throw new Error(`Checksum mismatch ${this.path}:${path}`);
    }
    return new Reader(bytes);
  }
  close() {
    this.reader.close();
  }
}
