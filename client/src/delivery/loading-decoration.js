import {
  boundedResponse,
  resourceByteLimit,
  validateDescriptor,
  verifyBytes,
} from "../../public/offline-manifest.js";

/** Decorative demand uses the selected release's existing hashes, never a mutable art URL. */
async function verified(info, signal) {
  validateDescriptor(info);
  const response = await fetch(info.url, { signal, redirect: "error" });
  const bytes = await boundedResponse(response, info.bytes, signal);
  await verifyBytes(bytes, info);
  return bytes;
}

/** Offline status is a projection; the controlling worker hash-verifies its pinned catalog. */
async function releaseCatalog(manifest, signal) {
  if (Array.isArray(manifest.resources)) {
    const info = manifest.resources.find(
      (entry) => entry.url === "/generated/catalog.json",
    );
    if (!info) {
      throw new Error("Loading artwork catalog is not packaged");
    }
    return JSON.parse(new TextDecoder().decode(await verified(info, signal)));
  }
  if (!navigator.serviceWorker.controller || !manifest.ready) {
    throw new Error("Loading artwork requires a verified installed release");
  }
  const response = await fetch("/generated/catalog.json", {
    signal,
    redirect: "error",
  });
  const bytes = await boundedResponse(
    response,
    resourceByteLimit("/generated/catalog.json"),
    signal,
  );
  await verifyBytes(bytes, {
    bytes: Number(response.headers.get("x-maple-bytes")),
    sha256: response.headers.get("x-maple-sha256"),
  });
  const catalog = JSON.parse(new TextDecoder().decode(bytes));
  if (catalog.buildId !== manifest.buildId) {
    throw new Error("Loading artwork catalog release mismatch");
  }
  return catalog;
}

/** Optional artwork cannot admit a map, report file progress, or fail/retry an installation. */
export class LoadingDecoration {
  constructor(parent, signal) {
    this.signal = signal;
    this.image = document.createElement("img");
    this.image.alt = "";
    this.image.className = "delivery-monster";
    this.image.hidden = true;
    parent.append(this.image);
    this.url = null;
    this.releaseId = null;
    this.pending = false;
    signal.addEventListener("abort", () => this.destroy(), { once: true });
  }

  load(manifest) {
    if (!manifest?.resources || this.pending || this.signal.aborted) {
      return;
    }
    if (this.releaseId === manifest.releaseId) {
      return;
    }
    this.releaseId = manifest.releaseId;
    this.pending = true;
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(10000)]);
    this.prepare(manifest, signal)
      .catch(() => {
        // The existing status/progress remains the complete loader when art is unavailable.
        this.releaseId = null;
      })
      .finally(() => {
        this.pending = false;
      });
  }

  async prepare(manifest, signal) {
    const catalog = await releaseCatalog(manifest, signal);
    const descriptor = catalog.loadingDecoration;
    if (!descriptor) {
      return;
    }
    const info = Array.isArray(manifest.resources)
      ? manifest.resources.find((entry) => entry.url === descriptor.url)
      : descriptor;
    if (
      !info ||
      info.sha256 !== descriptor.sha256 ||
      info.bytes !== descriptor.bytes
    ) {
      return;
    }
    await this.prepareArtwork(info, signal);
  }

  /** Online callers supply the catalog already verified against their server's identity. */
  loadCatalog(catalog) {
    if (!catalog.loadingDecoration || this.pending || this.signal.aborted) {
      return;
    }
    if (this.releaseId === catalog.buildId) return;
    this.releaseId = catalog.buildId;
    this.pending = true;
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(10000)]);
    this.prepareArtwork(catalog.loadingDecoration, signal)
      .catch(() => {
        // Decoration is optional; real loading and sanitized failures keep their owner.
        this.releaseId = null;
      })
      .finally(() => {
        this.pending = false;
      });
  }

  async prepareArtwork(info, signal) {
    const bytes = await verified(info, signal);
    signal.throwIfAborted();
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "image/svg+xml" }),
    );
    const previous = this.url;
    this.url = url;
    this.image.src = url;
    try {
      await this.image.decode();
      signal.throwIfAborted();
      this.image.hidden = false;
    } catch (error) {
      this.image.hidden = true;
      throw error;
    } finally {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
    }
  }

  destroy() {
    this.image.remove();
    if (this.url) {
      URL.revokeObjectURL(this.url);
    }
    this.url = null;
  }
}
