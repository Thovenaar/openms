import {
  CONTENT_LIMITS,
  canonical,
  contentError,
  sceneAssets,
} from "@openms/content";
import { closedRecord, decodeJson } from "../../shared/protocol.js";

export const CONTENT_HTTP_PREFIX = "/api/v1/custom-content/";
export const CONTENT_REQUEST_BYTES = CONTENT_LIMITS.uploadBytes;
const MAX_BODY_CHUNKS = 4096;
const STATUS = new Map([
  ["INVALID_CONTENT", 400],
  ["INVALID_MESSAGE", 400],
  ["CONTENT_CONFLICT", 409],
  ["CONTENT_NOT_FOUND", 404],
  ["ASSET_NOT_FOUND", 404],
  ["ASSET_BUILD_NOT_FOUND", 404],
  ["CONTENT_LIMIT", 429],
]);

function response(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function imageResponse(image) {
  return new Response(image.bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function regionResponse(row, hash) {
  const region = row.runtime.resources?.[hash];
  if (!/^[a-f0-9]{64}$/.test(hash) || !region) {
    throw contentError("CONTENT_NOT_FOUND", "Region was not found");
  }
  return new Response(canonical(region), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function bodyBytes(request, maximum) {
  const reader = request.body?.getReader();
  if (!reader) {
    throw contentError("INVALID_CONTENT", "Request body is required");
  }
  const parts = [];
  let bytes = 0,
    done = false;
  try {
    for (let index = 0; index < MAX_BODY_CHUNKS; index++) {
      const part = await reader.read();
      if (part.done) {
        done = true;
        return Buffer.concat(parts, bytes);
      }
      bytes += part.value.length;
      if (bytes > maximum) {
        throw contentError("INVALID_CONTENT", "Request body exceeds limit");
      }
      parts.push(part.value);
    }
    throw contentError("INVALID_CONTENT", "Request chunk limit exceeded");
  } finally {
    if (!done) await reader.cancel("Content request limit");
  }
}

/** Browser authoring uses the ordinary account session; it never grants gameplay developer authority. */
export class ContentHttp {
  constructor({ service, auth, activation = null }) {
    this.service = service;
    this.auth = auth;
    this.activation = activation;
    this.pending = 0;
  }

  async fetch(request, path) {
    if (this.pending >= 4) {
      return response(
        { code: "CONTENT_LIMIT", message: "Content service is busy" },
        429,
      );
    }
    this.pending++;
    try {
      const session = this.auth.session(request);
      if (request.method === "GET") {
        return await this.read(session.accountId, path);
      }
      this.auth.origin(request);
      if (request.method !== "POST") {
        return response({ code: "NOT_FOUND" }, 404);
      }
      if (path === "images") return await this.upload(request, session);
      if (
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
          request.headers.get("content-type") ?? "",
        )
      ) {
        throw contentError("INVALID_CONTENT", "Expected application/json");
      }
      const body = decodeJson(
        await bodyBytes(request, CONTENT_LIMITS.documentBytes),
        {
          maxBytes: CONTENT_LIMITS.documentBytes,
          maxNodes: CONTENT_LIMITS.documentNodes,
          maxDepth: 32,
        },
      );
      this.auth.csrf(session, body.csrfToken);
      return response(await this.write(session, path, body));
    } catch (error) {
      if (!STATUS.has(error.code)) throw error;
      return response(
        { code: error.code, message: error.message, path: error.path ?? "" },
        STATUS.get(error.code),
      );
    } finally {
      this.pending--;
    }
  }

  async write(session, path, body) {
    const owner = session.accountId;
    const admit = () => this.auth.csrf(session, body.csrfToken);
    if (path === "world/activate") {
      closedRecord(body, ["csrfToken", "release"]);
      if (session.role !== "developer" || !this.activation) {
        throw contentError(
          "NOT_ALLOWED",
          "Only developers can activate shared content",
        );
      }
      return this.activation.activate(owner, body.release, admit);
    }
    if (path === "save") {
      closedRecord(body, ["csrfToken", "content"]);
      return this.service.save(owner, body.content, admit);
    }
    if (path === "preview") {
      closedRecord(body, ["csrfToken", "content"]);
      return this.service.preview(owner, body.content);
    }
    if (path === "publish") {
      closedRecord(body, ["csrfToken", "ref"]);
      return this.service.publish(owner, body.ref, admit);
    }
    if (path === "list") {
      closedRecord(body, ["csrfToken", "projectId", "offset", "limit"]);
      return this.service.store.list(owner, body);
    }
    if (path.startsWith("assets/")) {
      return this.assets(path, body);
    }
    throw contentError("CONTENT_NOT_FOUND", "Content endpoint was not found");
  }

  async assets(path, body) {
    const query = path === "assets/search" || path === "assets/scene";
    closedRecord(body, ["csrfToken", "buildId", query ? "query" : "ref"]);
    const registry = await this.service.registry(body.buildId);
    if (path === "assets/search") return registry.search(body.query);
    if (path === "assets/scene") return sceneAssets(registry, body.query);
    if (path === "assets/resolve") return registry.resolve(body.ref);
    if (path === "assets/monster") return registry.monsterDetail(body.ref);
    throw contentError("CONTENT_NOT_FOUND", "Asset endpoint was not found");
  }

  async read(owner, path) {
    if (path === "world/status" && this.activation) {
      return response(this.activation.status());
    }
    const parts = path.split("/");
    if (parts[0] === "images" && parts.length === 2) {
      return imageResponse(await this.service.store.image(owner, parts[1]));
    }
    if (!["revisions", "published", "runtime", "regions"].includes(parts[0])) {
      throw contentError("CONTENT_NOT_FOUND", "Content endpoint was not found");
    }
    if (
      parts.length !== (parts[0] === "regions" ? 5 : 4) ||
      !/^[1-9]\d{0,4}$/.test(parts[3])
    ) {
      throw contentError("INVALID_CONTENT", "Invalid revision path");
    }
    const ref = {
      projectId: parts[1],
      id: parts[2],
      revision: Number(parts[3]),
    };
    if (parts[0] === "revisions") {
      return response(await this.service.store.get(owner, ref));
    }
    const row = await this.service.published(owner, ref);
    if (parts[0] === "published") return response(row);
    if (parts[0] === "runtime") return response(row.runtime);
    return regionResponse(row, parts[4]);
  }

  async upload(request, session) {
    const csrf = request.headers.get("x-csrf-token");
    this.auth.csrf(session, csrf);
    if (request.headers.get("content-type") !== "image/png") {
      throw contentError("INVALID_CONTENT", "Only PNG uploads are supported");
    }
    const bytes = await bodyBytes(request, CONTENT_LIMITS.uploadBytes);
    const result = await this.service.upload(session.accountId, bytes, () =>
      this.auth.csrf(session, csrf),
    );
    return response(result, 201);
  }
}
