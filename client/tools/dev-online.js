import { resolve, dirname, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildOnlineBrowser } from "./browser-build.js";
import { PROTOCOL } from "../../shared/protocol.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BACKLOG = 1024 * 1024;
const MAX_PENDING_FRAMES = 8;
const MAX_RELAYS = 128;

function configuration(options) {
  const port = Number(options.port ?? Bun.env.ONLINE_PORT ?? 3102);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("ONLINE_PORT must be in 1..65535");
  }
  const upstream = upstreamOrigin(
    options.upstream ?? Bun.env.OPENMS_SERVER_URL ?? "http://127.0.0.1:3200",
  );
  return { port, upstream };
}

function upstreamOrigin(value) {
  const upstream = new URL(value);
  if (
    upstream.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(upstream.hostname) ||
    upstream.pathname !== "/" ||
    upstream.search ||
    upstream.hash ||
    upstream.username ||
    upstream.password
  ) {
    throw new Error(
      "Development API upstream must be an exact loopback HTTP origin",
    );
  }
  return upstream.origin;
}

function resource(path) {
  const shells = new Map([
    ["/", "online.html"],
    ["/index.html", "online.html"],
    ["/online.html", "online.html"],
    ["/online.css", "online.css"],
    ["/style.css", "style.css"],
  ]);
  if (shells.has(path)) {
    return { root: ROOT, name: shells.get(path), immutable: false };
  }
  if (path === "/generated/catalog.json") {
    return {
      root: resolve(ROOT, "public/generated"),
      name: "catalog.json",
      immutable: false,
    };
  }
  if (path === "/dist/atlas-worker.js") {
    return {
      root: resolve(ROOT, "dist/online"),
      name: "atlas-worker.js",
      immutable: false,
    };
  }
  if (/^\/dist\/online\/[A-Za-z0-9_.-]+\.(js|map)$/.test(path)) {
    return {
      root: resolve(ROOT, "dist/online"),
      name: path.slice("/dist/online/".length),
      immutable: false,
    };
  }
  if (
    /^\/generated\/(maps|regions|references|bundles|atlases|textures|audio)\/[a-f0-9]{64}\.(json|png|wav|mp3|bin)$/.test(
      path,
    )
  ) {
    return {
      root: resolve(ROOT, "public/generated"),
      name: path.slice("/generated/".length),
      immutable: true,
    };
  }
  return null;
}

async function serveResource(request, path) {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method not allowed", { status: 405 });
  }
  const target = resource(path);
  if (!target) return new Response("Not found", { status: 404 });
  let filename;
  try {
    filename = await realpath(resolve(target.root, target.name));
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    return new Response("Content unavailable; use existing extraction setup", {
      status: 404,
    });
  }
  if (!filename.startsWith(target.root + sep)) {
    return new Response("Forbidden", { status: 403 });
  }
  const file = Bun.file(filename);
  return new Response(request.method === "HEAD" ? null : file, {
    headers: {
      "Content-Type": file.type,
      "Cache-Control": target.immutable
        ? "public, max-age=31536000, immutable"
        : "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** Development proxy changes transport routing only; the upstream remains sole authority. */
class OnlineProxy {
  constructor(config) {
    this.config = config;
    this.relays = new Set();
    this.handlers = {
      maxPayloadLength: PROTOCOL.MAX_MESSAGE_BYTES,
      backpressureLimit: MAX_BACKLOG,
      closeOnBackpressureLimit: true,
      idleTimeout: 35,
      perMessageDeflate: false,
      open: this.open.bind(this),
      message: this.message.bind(this),
      close: this.close.bind(this),
    };
  }

  async fetch(request, server) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/play") return this.upgrade(request, server);
      if (url.pathname.startsWith("/api/")) {
        const upstream = new URL(
          url.pathname + url.search,
          this.config.upstream,
        );
        const headers = new Headers(request.headers);
        headers.delete("host");
        return await fetch(upstream, {
          method: request.method,
          headers,
          body: ["GET", "HEAD"].includes(request.method)
            ? undefined
            : request.body,
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
      }
      return await serveResource(request, decodeURIComponent(url.pathname));
    } catch (error) {
      console.error("Online development request failed:", error.message);
      return Response.json(
        { code: "SERVER_BUSY" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  allowedOrigin(origin) {
    if (!origin) return false;
    const parsed = new URL(origin);
    return (
      parsed.origin === origin &&
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
      parsed.port === String(this.config.port)
    );
  }

  upgrade(request, server) {
    if (this.relays.size >= MAX_RELAYS) {
      return new Response("Busy", { status: 503 });
    }
    const origin = request.headers.get("origin");
    if (
      !this.allowedOrigin(origin) ||
      new URL(request.url).search ||
      request.headers.get("sec-websocket-protocol") !== PROTOCOL.SUBPROTOCOL
    ) {
      return new Response("Forbidden", { status: 403 });
    }
    const cookie = request.headers.get("cookie") ?? "";
    if (cookie.length > 4096) {
      return new Response("Invalid cookie", { status: 400 });
    }
    const relay = {
      client: null,
      upstream: null,
      pending: [],
      closed: false,
      timer: null,
    };
    const url = this.config.upstream.replace(/^http:/, "ws:") + "/api/v1/play";
    relay.upstream = new WebSocket(url, {
      protocols: [PROTOCOL.SUBPROTOCOL],
      headers: { Origin: origin, Cookie: cookie },
    });
    relay.upstream.binaryType = "arraybuffer";
    relay.upstream.onopen = () => this.flush(relay);
    relay.upstream.onmessage = (event) => this.receive(relay, event.data);
    relay.upstream.onclose = () => this.stop(relay);
    relay.upstream.onerror = () => this.stop(relay);
    relay.timer = setTimeout(() => this.stop(relay), 5000);
    this.relays.add(relay);
    if (
      server.upgrade(request, {
        data: relay,
        headers: { "Sec-WebSocket-Protocol": PROTOCOL.SUBPROTOCOL },
      })
    ) {
      return;
    }
    this.stop(relay);
    return new Response("Upgrade refused", { status: 400 });
  }

  open(socket) {
    socket.data.client = socket;
    if (socket.data.closed) socket.close(1011, "Upstream unavailable");
  }

  message(socket, data) {
    const relay = socket.data;
    if (relay.closed || typeof data !== "string") return this.stop(relay);
    if (relay.upstream.bufferedAmount > MAX_BACKLOG) return this.stop(relay);
    if (relay.upstream.readyState === WebSocket.OPEN) relay.upstream.send(data);
    else if (relay.pending.length < MAX_PENDING_FRAMES) {
      relay.pending.push(data);
    } else this.stop(relay);
  }

  flush(relay) {
    clearTimeout(relay.timer);
    if (relay.closed) return;
    for (const frame of relay.pending) relay.upstream.send(frame);
    relay.pending.length = 0;
  }

  receive(relay, data) {
    if (
      relay.closed ||
      !relay.client ||
      typeof data !== "string" ||
      Buffer.byteLength(data) > 64 * 1024
    ) {
      return this.stop(relay);
    }
    if (relay.client.getBufferedAmount() > MAX_BACKLOG) return this.stop(relay);
    if (relay.client.send(data) === 0) this.stop(relay);
  }

  stop(relay) {
    if (relay.closed) return;
    relay.closed = true;
    clearTimeout(relay.timer);
    relay.client?.close(1011, "Online connection closed");
    relay.upstream?.close();
    relay.pending.length = 0;
    this.relays.delete(relay);
  }

  close(socket) {
    this.stop(socket.data);
  }
}

export async function startOnlineDevServer(options = {}) {
  const config = configuration(options);
  const started = performance.now();
  const identity = await buildOnlineBrowser({
    development: true,
    progress: console.log,
  });
  const proxy = new OnlineProxy(config);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: config.port,
    maxRequestBodySize: 16 * 1024,
    fetch: proxy.fetch.bind(proxy),
    websocket: proxy.handlers,
  });
  console.log(
    `openms.dev online client ready at ${server.url} (${(performance.now() - started).toFixed(1)}ms); API ${config.upstream}`,
  );
  return {
    server,
    identity,
    close() {
      for (const relay of proxy.relays) proxy.stop(relay);
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  const runtime = await startOnlineDevServer();
  process.once("SIGINT", runtime.close);
  process.once("SIGTERM", runtime.close);
}
