const PREFIX = "/api/v1/custom-content/";
const MAX_BYTES = 32 * 1024 * 1024;

/** Same-origin account sessions own authoring. No credentials or content drafts are persisted locally. */
export class StudioAPI {
  constructor() {
    this.config = null;
    this.settings = null;
  }

  async request(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      ...options,
    });
    const reader = response.body.getReader(),
      chunks = [];
    let length = 0,
      finished = false;
    try {
      for (let count = 0; count < 65536; count++) {
        const next = await reader.read();
        if (next.done) {
          finished = true;
          break;
        }
        length += next.value.byteLength;
        if (length > MAX_BYTES) {
          throw new Error("Response exceeds Studio's resource limit");
        }
        chunks.push(next.value);
      }
      if (!finished) throw new Error("Response chunk limit exceeded");
    } finally {
      if (!finished) await reader.cancel();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const value = responseJson(bytes);
    if (!response.ok) {
      throw Object.assign(
        new Error(
          value.message ??
            messages[value.code] ??
            value.code ??
            "Request failed",
        ),
        { code: value.code },
      );
    }
    return value;
  }

  async bootstrap() {
    this.settings ??= await this.request("/studio/settings.json");
    this.config = await this.request("/api/v1/config");
    return this.config;
  }
  get(path) {
    return this.request(PREFIX + path);
  }
  post(path, body) {
    return this.request(
      PREFIX + path,
      this.json({ ...body, csrfToken: this.config.csrfToken }),
    );
  }
  json(body) {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }
  upload(file) {
    return this.request(PREFIX + "images", {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-CSRF-Token": this.config.csrfToken,
      },
      body: file,
    });
  }
  resolve(ref) {
    return this.post("assets/resolve", {
      buildId: this.config.assetBuildId,
      ref,
    });
  }
}

/** Original manifests exceed command JSON limits. Bound bytes before parsing and tree work afterward. */
function responseJson(bytes) {
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  const queue = [{ value, depth: 0 }];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    if (node.depth > 32) throw new Error("Resource depth exceeds limit");
    if (node.value === null || typeof node.value !== "object") continue;
    for (const [key, child] of Object.entries(node.value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        throw new Error("Reserved resource key");
      }
      if (queue.length >= 2000000) {
        throw new Error("Resource node limit exceeded");
      }
      queue.push({ value: child, depth: node.depth + 1 });
    }
  }
  return value;
}

const messages = {
  UNAUTHENTICATED: "Sign in to continue.",
  SESSION_EXPIRED: "Your session expired. Sign in again.",
  NOT_ALLOWED: "This action is not allowed for this account.",
  CONTENT_CONFLICT: "Content changed. Reload before retrying.",
  SERVER_BUSY: "The server is busy. Please retry.",
};
