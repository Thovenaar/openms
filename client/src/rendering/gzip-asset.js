/** Client-side counterpart of the extraction .gz sibling: URL derivation, inflate, storage labels. */
import { boundedResponse } from "../assets/resource-validation.js";

/** Compressed sibling identity; extraction writes it for exactly these resources. */
export const GZIP_EXTENSION = ".gz";
export const GZIP_ELIGIBLE = /\.json$/;
/** Same ceiling the startup pack uses, so one inflate cannot admit an unbounded payload. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/** Only /generated/*.json has a compressed sibling; streaming containers and artwork do not. */
export function gzipVariantURL(url) {
  // Without a native inflater the raw resource stays the only safe delivery path.
  if (typeof DecompressionStream !== "function") return null;
  return url.startsWith("/generated/") && GZIP_ELIGIBLE.test(url)
    ? `${url}${GZIP_EXTENSION}`
    : null;
}

/** Worst-case gzip expansion, so incompressible input still passes a declared raw byte bound. */
export function gzipCeiling(raw) {
  return raw + Math.ceil(raw / 16383) * 5 + 64;
}

/** Storage label for the cache owner: stored bytes plus the raw size they verify as. */
export function storedDescriptor(stored, raw) {
  return { stored, raw };
}

/** A fetched descriptor is already inflated for verification but caches its compact form. */
export async function inflatedDescriptor(descriptor, signal = null) {
  const { stored, raw } = descriptor;
  return {
    stored,
    raw,
    buffer:
      stored.byteLength === raw ? stored : await inflateGzip(stored, signal),
  };
}

/** Extraction records "gzip"; identity and pre-upgrade entries store raw bytes unchanged. */
export function storedEncoding(response) {
  return response.headers.get("x-maple-encoding") === "gzip"
    ? "gzip"
    : "identity";
}

/** Native inflate; the returned bytes satisfy the catalog's raw length and hash contract. */
export async function inflateGzip(buffer, signal = null) {
  const stream = new Blob([buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return boundedResponse(new Response(stream), MAX_INFLATED_BYTES, signal).then(
    (bytes) => bytes.buffer,
  );
}
