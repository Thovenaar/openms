/** Optional artwork cannot admit a map or own loading progress and failures. */
export class LoadingDecoration {
  constructor(parent, signal) {
    this.signal = signal;
    this.image = document.createElement("img");
    this.image.alt = "";
    this.image.className = "delivery-monster";
    this.image.hidden = true;
    parent.append(this.image);
    this.url = null;
    this.buildId = null;
    this.pending = false;
    signal.addEventListener("abort", () => this.destroy(), { once: true });
  }

  /** The caller supplies the catalog already verified against the server identity. */
  loadCatalog(catalog, network) {
    if (!catalog.loadingDecoration || this.pending || this.signal.aborted) {
      return;
    }
    if (this.buildId === catalog.buildId) return;
    this.buildId = catalog.buildId;
    this.pending = true;
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(10000)]);
    this.prepareArtwork(catalog.loadingDecoration, signal, network)
      .catch(() => {
        // Decoration is optional; real loading and sanitized failures keep their owner.
        this.buildId = null;
      })
      .finally(() => {
        this.pending = false;
      });
  }

  async prepareArtwork(info, signal, network) {
    const bytes = await network.load(info, signal);
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
