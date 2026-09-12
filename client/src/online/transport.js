import {
  decodeClient,
  decodeServer,
  decodeJson,
  actionDomain,
  PROTOCOL,
} from "../../../shared/protocol.js";
import { MultipartAssembly } from "./transport-assembly.js";
import { freezeView, applyEntityChanges } from "./read-model.js";
import { ServerClock } from "./transport-clock.js";

const HTTP_BYTES = 1024 * 1024;
const HTTP_TIMEOUT_MS = 10000;
const COMMAND_TIMEOUT_MS = 10000;
const HEARTBEAT_TIMEOUT_MS = 35000;
const RESYNC_INTERVAL_MS = 5000;
const MAX_QUEUE = 256;
const MAX_QUEUE_BYTES = 1024 * 1024;
const SEND_SOFT_BYTES = 256 * 1024;
const MAX_PENDING = 64;
const SESSION_OPERATIONS = new Set([
  "npc.open",
  "npc.answer",
  "trade.invite",
  "trade.answer",
  "trade.offer",
  "trade.cancel",
  "chat.send",
]);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const encoder = new TextEncoder();

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** The bootstrap document is closed: hashes, both CSRF tokens and the development flag. */
function validConfig(config) {
  return (
    config.v === 1 &&
    HASH.test(config.assetBuildId) &&
    HASH.test(config.rulesHash) &&
    HASH.test(config.catalogHash) &&
    typeof config.csrfToken === "string" &&
    (config.loginToken === undefined ||
      typeof config.loginToken === "string") &&
    typeof config.development === "boolean"
  );
}

function requestHeaders(body, headers) {
  const merged = headers ?? {};
  if (body) merged["Content-Type"] = "application/json";
  return merged;
}

async function request(path, method = "GET", body, headers = null) {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    headers: requestHeaders(body, headers),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (Number(response.headers.get("content-length")) > HTTP_BYTES) {
    throw failure("HTTP_BYTE_LIMIT");
  }
  const reader = response.body?.getReader();
  if (!reader) throw failure("EMPTY_HTTP_RESPONSE");
  const chunks = [];
  let length = 0;
  for (let count = 0; count < 4096; count++) {
    const chunk = await reader.read();
    if (chunk.done) {
      return decodeResponse(chunks, length, response.ok, body?.operationId);
    }
    length += chunk.value.byteLength;
    if (length > HTTP_BYTES) break;
    chunks.push(chunk.value);
  }
  await reader.cancel();
  throw failure("HTTP_BYTE_LIMIT");
}

function decodeResponse(chunks, length, ok, operationId) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const value = decodeJson(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    { maxBytes: HTTP_BYTES, maxDepth: 16, maxNodes: 32768 },
  );
  const receipt =
    operationId &&
    value.operationId === operationId &&
    value.status === "rejected";
  if (!ok && !receipt) {
    throw failure(
      typeof value.code === "string" ? value.code : "HTTP_REJECTED",
    );
  }
  return value;
}

/** Cookie-authenticated same-origin transport. All retained game state is observation-only. */
export class OnlineTransport {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.config = null;
    this.status = "disconnected";
    this.closingCode = null;
    this.retryAfterMs = null;
    this.model = null;
    this.field = null;
    this.self = null;
    this.inventory = null;
    this.progress = null;
    this.revisions = {
      character: 0,
      inventory: 0,
      social: 0,
      conversation: 0,
      trade: 0,
      invitation: 0,
    };
    this.conversationId = null;
    this.characterId = null;
    this.characters = [];
    this.connectionEpoch = null;
    this.playSession = null;
    this.serverTick = 0;
    this.lastEventSeq = 0;
    this.seq = 0;
    this.inputSeq = 0;
    this.lastInputTick = -1;
    this.socket = null;
    this.pending = new Map();
    this.queue = [];
    this.queueBytes = 0;
    this.deferred = [];
    this.deferredBytes = 0;
    this.draining = false;
    this.generation = 0;
    this.baselines = new MultipartAssembly();
    this.shops = new MultipartAssembly();
    this.clock = new ServerClock();
    this.helloSentAt = 0;
    this.lastMessageAt = 0;
    this.lastResyncAt = -Infinity;
    this.closed = false;
    this.checkTimer = setInterval(this.check.bind(this), 250);
    this.blurHandler = this.neutral.bind(this);
    this.visibilityHandler = this.visibility.bind(this);
    globalThis.addEventListener?.("blur", this.blurHandler);
    globalThis.document?.addEventListener(
      "visibilitychange",
      this.visibilityHandler,
    );
  }

  async initialize() {
    const config = await request("/api/v1/config");
    this.verifyCompiledIdentity(config);
    if (!validConfig(config)) throw failure("INVALID_CONFIG");
    if (
      this.config &&
      (this.config.assetBuildId !== config.assetBuildId ||
        this.config.rulesHash !== config.rulesHash ||
        this.config.catalogHash !== config.catalogHash)
    ) {
      throw failure("CONTENT_MISMATCH");
    }
    this.config = freezeView(config);
    return this.config;
  }

  verifyCompiledIdentity(config) {
    if (
      config.rulesHash !== import.meta.OPENMS_RULES_HASH ||
      config.assetBuildId !== import.meta.OPENMS_ASSET_BUILD_ID ||
      config.catalogHash !== import.meta.OPENMS_CATALOG_HASH
    ) {
      throw failure("CONTENT_MISMATCH");
    }
  }

  /** A login nonce is single-slot per browser, so one refresh retry covers a second tab. */
  async admitSession(path, { name, password, proof }) {
    const credentials = () => ({
      name,
      password,
      csrfToken: this.config.loginToken ?? this.config.csrfToken,
      challengeId: proof.challengeId,
      nonce: proof.nonce,
    });
    try {
      return await request(path, "POST", credentials());
    } catch (error) {
      if (error.code !== "NOT_ALLOWED") throw error;
      await this.initialize();
      return request(path, "POST", credentials());
    }
  }

  async login({ name, password, proof }) {
    await this.initialize();
    const session = await this.admitSession("/api/v1/session", {
      name,
      password,
      proof,
    });
    this.adoptSession(session);
    return this.listCharacters();
  }

  /** Registration is proof-of-work gated like sign in; success signs the browser in. */
  async register({ name, password, proof }) {
    await this.initialize();
    const session = await this.admitSession("/api/v1/accounts", {
      name,
      password,
      proof,
    });
    this.adoptSession(session);
    return this.listCharacters();
  }

  adoptSession(session) {
    if (
      typeof session.csrfToken !== "string" ||
      !["player", "developer"].includes(session.role) ||
      !Number.isSafeInteger(session.expiresAt)
    ) {
      throw failure("INVALID_SESSION");
    }
    this.config = freezeView({ ...this.config, ...session });
  }

  /** One bounded hashcash challenge per credential attempt. */
  async challenge() {
    const result = await request("/api/v1/challenge");
    if (
      typeof result.challengeId !== "string" ||
      !Number.isSafeInteger(result.bits) ||
      !Number.isSafeInteger(result.expiresAt)
    ) {
      throw failure("INVALID_CHALLENGE");
    }
    return freezeView(result);
  }

  /** Register one account-owned character with rolled stats, packaged look and starter gear. */
  async createCharacter(payload) {
    const result = await request("/api/v1/characters", "POST", {
      csrfToken: this.config.csrfToken,
      ...payload,
    });
    const character = result?.character;
    if (
      !character ||
      !ID.test(character.id) ||
      typeof character.name !== "string" ||
      !Number.isSafeInteger(character.level) ||
      !Number.isSafeInteger(character.job)
    ) {
      throw failure("INVALID_CHARACTER");
    }
    await this.listCharacters();
    return character;
  }

  /** Sign out the browser session; the account form owns the returned state. */
  async revoke() {
    if (!this.config || typeof this.config.csrfToken !== "string") return;
    await request("/api/v1/session", "DELETE", null, {
      "x-csrf-token": this.config.csrfToken,
    });
    this.disconnect();
    this.config = null;
    this.characters = null;
  }

  async listCharacters() {
    const result = await request("/api/v1/characters");
    if (!Array.isArray(result.characters) || result.characters.length > 64) {
      throw failure("INVALID_CHARACTERS");
    }
    const ids = new Set();
    for (const character of result.characters) {
      if (
        !ID.test(character.id) ||
        ids.has(character.id) ||
        typeof character.name !== "string" ||
        !Number.isSafeInteger(character.level) ||
        !Number.isSafeInteger(character.job)
      ) {
        throw failure("INVALID_CHARACTERS");
      }
      ids.add(character.id);
    }
    this.characters = freezeView(result.characters);
    return this.characters;
  }

  /** Credentials are proof-of-work gated in login()/register(); entry needs only a character. */
  async connect({ characterId } = {}) {
    if (this.closed) throw failure("TRANSPORT_CLOSED");
    if (this.socket || this.status === "connecting") {
      throw failure("ALREADY_CONNECTED");
    }
    await this.initialize();
    await this.listCharacters();
    this.selectCharacter(characterId);
    try {
      return await this.open();
    } catch (error) {
      if (!this.socket) {
        this.setStatus("disconnected", error.code ?? error.message);
      }
      throw error;
    }
  }

  selectCharacter(characterId) {
    const selected = characterId ?? this.characterId ?? this.characters[0]?.id;
    if (!this.characters.some((character) => character.id === selected)) {
      throw failure("CHARACTER_NOT_OWNED");
    }
    if (
      this.characterId &&
      this.characterId !== selected &&
      this.pending.size
    ) {
      throw failure("UNRESOLVED_OPERATIONS");
    }
    if (this.characterId !== selected) {
      this.playSession = null;
      this.lastEventSeq = 0;
      for (const domain of Object.keys(this.revisions)) {
        this.revisions[domain] = 0;
      }
    }
    this.characterId = selected;
  }

  async reconnect() {
    if (!this.characterId) throw failure("NO_CHARACTER");
    this.disconnect();
    return this.connect({ characterId: this.characterId });
  }

  async open() {
    const generation = ++this.generation;
    this.setStatus("connecting");
    const { ticket } = await request("/api/v1/play-ticket", "POST", {
      characterId: this.characterId,
      csrfToken: this.config.csrfToken,
    });
    if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw failure("INVALID_TICKET");
    if (generation !== this.generation || this.closed) {
      throw failure("CANCELLED");
    }
    const url = new URL("/api/v1/play", globalThis.location.href);
    if (
      url.protocol !== "https:" &&
      !(
        this.config.development &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    ) {
      throw failure("TLS_REQUIRED");
    }
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    this.resetConnection();
    const socket = new WebSocket(url, PROTOCOL.SUBPROTOCOL);
    this.socket = socket;
    this.lastMessageAt = performance.now();
    return new Promise((resolve, reject) => {
      this.openWaiter = {
        resolve,
        reject,
        deadline: performance.now() + HTTP_TIMEOUT_MS,
      };
      socket.addEventListener(
        "open",
        this.sendHello.bind(this, socket, ticket),
      );
      socket.addEventListener("message", (event) => {
        if (this.socket === socket) this.receive(event);
      });
      socket.addEventListener("close", () => {
        if (this.socket === socket) this.disconnected("CONNECTION_LOST");
      });
      socket.addEventListener("error", () => {
        if (this.socket === socket) this.fail(failure("SOCKET_ERROR"));
      });
    });
  }

  sendHello(socket, ticket) {
    if (this.socket !== socket) return;
    if (socket.protocol !== PROTOCOL.SUBPROTOCOL) {
      return this.fail(failure("PROTOCOL_MISMATCH"));
    }
    const hello = {
      v: 1,
      type: "hello",
      ticket,
      rulesHash: this.config.rulesHash,
      assetBuildId: this.config.assetBuildId,
    };
    if (this.playSession && this.lastEventSeq > 0) {
      hello.resume = {
        playSession: this.playSession,
        lastEventSeq: this.lastEventSeq,
      };
    }
    this.helloSentAt = performance.now();
    try {
      socket.send(JSON.stringify(decodeClient(JSON.stringify(hello))));
    } catch (error) {
      this.fail(error);
    }
  }

  resetConnection() {
    this.seq = 0;
    this.lastInputTick = -1;
    this.nextCommandAt = 0;
    this.connectionEpoch = null;
    this.baselineId = null;
    this.baselines.clear();
    this.shops.clear();
    this.queue.length = 0;
    this.deferred.length = 0;
    this.deferredBytes = 0;
    this.queueBytes = 0;
    this.resyncing = false;
    this.expectedFieldEpoch = null;
    this.clock.reset();
    this.lastResyncAt = -Infinity;
  }

  receive(event) {
    try {
      if (typeof event.data !== "string") throw failure("INVALID_MESSAGE");
      const bytes = encoder.encode(event.data).byteLength;
      const message = decodeServer(event.data);
      this.lastMessageAt = performance.now();
      const receivedAt = this.lastMessageAt;
      // A refused connection closes before any welcome; keep the server's code and hint.
      if (message.type === "closing") {
        this.closingCode = message.code;
        this.retryAfterMs = message.retryAfterMs;
      }
      if (message.type === "ping") {
        if (message.connectionEpoch !== this.connectionEpoch) {
          throw failure("STALE_CONNECTION");
        }
        this.send("pong", { nonce: message.nonce });
        this.timing(message, receivedAt, message.roundTripMs);
        return;
      }
      if (
        this.queue.length + this.deferred.length >= MAX_QUEUE ||
        this.queueBytes + this.deferredBytes + bytes > MAX_QUEUE_BYTES
      ) {
        throw failure("RECEIVE_BACKPRESSURE");
      }
      this.queue.push({ message, bytes, receivedAt });
      this.queueBytes += bytes;
      if (!this.draining) void this.drain();
    } catch (error) {
      this.fail(error);
    }
  }

  async drain() {
    this.draining = true;
    const generation = this.generation;
    try {
      for (let count = 0; count < MAX_QUEUE && this.queue.length; count++) {
        const entry = this.queue.shift();
        this.queueBytes -= entry.bytes;
        await this.accept(
          entry.message,
          entry.bytes,
          generation,
          entry.receivedAt,
        );
        if (generation !== this.generation) break;
      }
    } catch (error) {
      if (generation === this.generation) this.fail(error);
    } finally {
      this.draining = false;
    }
    if (this.queue.length && this.socket) queueMicrotask(this.drain.bind(this));
  }

  async accept(message, bytes, generation, receivedAt) {
    if (message.type === "welcome") return this.welcome(message, receivedAt);
    // A refused connection closes before any welcome; keep the server's own code and hint.
    if (message.type === "closing") {
      this.retryAfterMs = message.retryAfterMs;
      throw failure(message.code);
    }
    if (
      !this.connectionEpoch ||
      message.connectionEpoch !== this.connectionEpoch
    ) {
      throw failure("STALE_CONNECTION");
    }
    if (message.type === "snapshot") {
      return this.installPart(message, bytes, generation);
    }
    if (this.baselines.pending) {
      this.deferred.push({ message, bytes, receivedAt });
      this.deferredBytes += bytes;
      return;
    }
    if (message.type === "motion") return this.motion(message, receivedAt);
    if (!this.admitPublication(message)) return;
    this.publishOrdered(message, bytes);
  }

  publishOrdered(message, bytes) {
    this.lastEventSeq = message.eventSeq;
    this.serverTick = Math.max(this.serverTick, message.serverTick);
    if (message.type === "state") this.state(message);
    else if (message.type === "event") this.event(message, bytes);
    else if (message.type === "result") this.result(message);
    else if (message.type === "transition") this.transition(message);
    this.ack();
  }

  motion(message, receivedAt) {
    if (message.fieldEpoch !== this.expectedFieldEpoch || this.resyncing) {
      return;
    }
    this.serverTick = Math.max(this.serverTick, message.serverTick);
    this.timing(message, receivedAt);
    this.callbacks.onMotion?.(freezeView(message));
  }

  /** Admit an ordered publication against the fully installed baseline, never partial parts. */
  admitPublication(message) {
    if (!this.baselineId || this.resyncing) return false;
    if (message.eventSeq !== this.lastEventSeq + 1) {
      this.resync("gap");
      return false;
    }
    if (
      (message.type === "state" || message.type === "event") &&
      message.fieldEpoch !== this.expectedFieldEpoch
    ) {
      throw failure("STALE_FIELD");
    }
    if (
      message.type === "state" &&
      message.baseSnapshotId !== this.baselineId
    ) {
      this.resync("baseline");
      return false;
    }
    return true;
  }

  welcome(message, receivedAt) {
    if (
      this.connectionEpoch ||
      message.rulesHash !== this.config.rulesHash ||
      message.assetBuildId !== this.config.assetBuildId ||
      message.tickMs !== PROTOCOL.TICK_MS ||
      message.inputLeadTicks !== PROTOCOL.INPUT_LEAD_TICKS ||
      message.inputBufferTicks !== PROTOCOL.INPUT_BUFFER_TICKS
    ) {
      throw failure("CONTENT_MISMATCH");
    }
    if (
      message.limits.commandPerSecond < 1 ||
      message.limits.inputPerSecond < 1 ||
      message.limits.maxMessageBytes < 1
    ) {
      throw failure("INVALID_LIMITS");
    }
    this.connectionEpoch = message.connectionEpoch;
    if (this.playSession !== message.playSession) this.inputSeq = 0;
    this.playSession = message.playSession;
    this.expectedFieldEpoch = message.fieldEpoch;
    this.serverTick = message.serverTick;
    this.limits = message.limits;
    this.timing(message, receivedAt, receivedAt - this.helloSentAt);
    this.setStatus("synchronizing");
  }

  timing(message, receivedAt, roundTripMs = null) {
    const timing = this.clock.observe({
      connectionEpoch: message.connectionEpoch,
      fieldEpoch: message.fieldEpoch ?? this.expectedFieldEpoch,
      serverTick: message.serverTick,
      serverTime: message.serverTime,
      paused: message.paused ?? this.clock.paused,
      receivedAt,
      roundTripMs,
    });
    this.callbacks.onTiming?.(timing);
  }

  async installPart(message, bytes, generation) {
    if (message.fieldEpoch !== this.expectedFieldEpoch) {
      throw failure("STALE_FIELD");
    }
    const model = this.baselines.add(message, bytes, performance.now());
    if (!model) return;
    if (this.baselineId && model.eventSeq <= this.lastEventSeq) {
      throw failure("STALE_SNAPSHOT");
    }
    this.setStatus("synchronizing");
    const frozen = freezeView(model);
    await this.callbacks.onSnapshot?.(frozen);
    if (generation !== this.generation) return;
    this.publishModel(frozen);
    this.restoreInteractionRevisions(frozen);
    this.baselineId = model.snapshotId;
    this.lastEventSeq = model.eventSeq;
    this.serverTick = model.serverTick;
    this.resyncing = false;
    this.ack();
    this.send("ready", {
      fieldEpoch: model.fieldEpoch,
      snapshotId: model.snapshotId,
    });
    this.setStatus("active");
    this.openWaiter?.resolve(this.model);
    this.openWaiter = null;
    this.recoverPending();
    if (this.deferred.length) {
      this.queue.unshift(...this.deferred);
      this.queueBytes += this.deferredBytes;
      this.deferred.length = 0;
      this.deferredBytes = 0;
    }
  }

  publishModel(model) {
    this.model = model;
    this.field = model.field;
    this.self = model.self;
    this.inventory = model.inventory;
    this.progress = model.progress;
    this.presentation = model.presentation;
    for (const domain of ["character", "inventory", "social"]) {
      this.revisions[domain] = Math.max(
        this.revisions[domain],
        model.revisions[domain],
      );
    }
  }

  /** Full snapshots restore live leases without rerunning their scripts or mutating state. */
  restoreInteractionRevisions(model) {
    for (const domain of ["conversation", "trade", "invitation"]) {
      this.revisions[domain] = model.revisions[domain];
    }
    const conversation = model.presentation.interactions.find(
      (event) => event.kind === "dialogue" || event.kind === "shop",
    );
    this.conversationId =
      conversation?.conversationId ?? conversation?.shopSession ?? null;
  }

  state(message) {
    this.publishModel(applyEntityChanges(this.model, message));
    this.baselineId = message.snapshotId;
    this.callbacks.onState?.(freezeView(message));
  }

  event(message, bytes) {
    let observed = message;
    if (message.event.kind === "shop") {
      const shop = this.shops.add(message, bytes, performance.now(), true);
      if (!shop) return;
      observed = { ...message, event: shop };
    }
    const event = observed.event;
    if (event.kind === "dialogue" || event.kind === "quest.offer") {
      this.conversationId = event.conversationId;
      this.revisions.conversation = event.step;
    }
    if (event.kind === "shop") {
      this.conversationId = event.shopSession;
      this.revisions.conversation = event.revision;
    }
    if (event.kind === "dialogue.closed") {
      if (this.shops.pending?.identity === event.conversationId) {
        this.shops.clear();
      }
      if (this.conversationId === event.conversationId) {
        this.conversationId = null;
        this.revisions.conversation = 0;
      }
    }
    if (event.kind === "trade") {
      this.revisions.trade = event.revision;
      this.revisions.invitation = event.revision;
    }
    this.callbacks.onEvent?.(freezeView(observed));
  }

  result(message) {
    const pending = this.pending.get(message.operationId);
    if (pending) {
      this.pending.delete(message.operationId);
      if (pending.domain) {
        this.revisions[pending.domain] = Math.max(
          this.revisions[pending.domain],
          message.domainRevision,
        );
      }
      pending.resolve(freezeView(message));
      pending.recoverResolve?.(message);
    }
    this.callbacks.onEvent?.(freezeView(message));
  }

  transition(message) {
    if (message.sourceEpoch !== this.expectedFieldEpoch) {
      throw failure("STALE_FIELD");
    }
    if (message.phase === "prepare") {
      this.setStatus("transitioning");
      this.shops.clear();
    }
    if (message.phase === "committed") {
      if (!message.destination) throw failure("INVALID_TRANSITION");
      this.expectedFieldEpoch = message.destination.fieldEpoch;
      this.lastInputTick = -1;
      this.serverTick = 0;
      this.baselines.clear();
      this.setStatus("synchronizing");
    }
    if (message.phase === "aborted") this.setStatus("active");
    this.callbacks.onTransition?.(freezeView(message));
  }

  send(type, fields) {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      !this.connectionEpoch
    ) {
      throw failure("NOT_CONNECTED");
    }
    if (this.socket.bufferedAmount > SEND_SOFT_BYTES) {
      this.fail(failure("SEND_BACKPRESSURE"));
      throw failure("SEND_BACKPRESSURE");
    }
    if (!Number.isSafeInteger(this.seq + 1)) {
      throw failure("SEQUENCE_EXHAUSTED");
    }
    const message = {
      v: 1,
      type,
      connectionEpoch: this.connectionEpoch,
      seq: this.seq + 1,
      ...fields,
    };
    const text = JSON.stringify(message);
    decodeClient(text);
    if (encoder.encode(text).byteLength > this.limits.maxMessageBytes) {
      throw failure("MESSAGE_BYTE_LIMIT");
    }
    this.socket.send(text);
    this.seq++;
    return message;
  }

  sendInput(sample) {
    if (this.status !== "active") return null;
    if (
      !sample ||
      Object.keys(sample).some(
        (key) =>
          !["targetTick", "horizontal", "vertical", "jump", "attack"].includes(
            key,
          ),
      )
    ) {
      throw failure("INVALID_INPUT");
    }
    if (sample.targetTick <= this.lastInputTick) return null;
    const arrivalTick = this.clock.arrivalTick(performance.now());
    if (
      arrivalTick === null ||
      this.clock.paused ||
      sample.targetTick <= arrivalTick ||
      sample.targetTick > arrivalTick + PROTOCOL.INPUT_LEAD_TICKS
    ) {
      return null;
    }
    const message = this.send("input", {
      fieldEpoch: this.expectedFieldEpoch,
      inputSeq: this.inputSeq + 1,
      ...sample,
    });
    this.inputSeq = message.inputSeq;
    this.lastInputTick = sample.targetTick;
    return message.inputSeq;
  }

  command(action, expectedRevision) {
    if (this.status !== "active") return Promise.reject(failure("NOT_ACTIVE"));
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(failure("PENDING_OPERATION_LIMIT"));
    }
    const domain = actionDomain(action);
    const operationId = crypto.randomUUID();
    const fields = {
      fieldEpoch: this.expectedFieldEpoch,
      operationId,
      expectedRevision: expectedRevision ?? this.revisions[domain],
      action: structuredClone(action),
    };
    try {
      decodeClient(
        JSON.stringify({
          v: 1,
          type: "command",
          connectionEpoch: this.connectionEpoch,
          seq: this.seq + 1,
          ...fields,
        }),
      );
    } catch (error) {
      return Promise.reject(error);
    }
    const promise = new Promise((resolve) => {
      this.pending.set(operationId, {
        fields,
        domain,
        resolve,
        deadline: performance.now() + COMMAND_TIMEOUT_MS,
        unknown: false,
        sentEpoch: null,
        playSession: this.playSession,
        durable: !SESSION_OPERATIONS.has(action.kind),
      });
    });
    promise.operationId = operationId;
    this.callbacks.onCommand?.(freezeView(fields));
    this.sendPending(this.pending.get(operationId));
    return promise;
  }

  sendPending(pending) {
    if (!pending.durable && pending.playSession !== this.playSession) return;
    if (pending.development) {
      void this.sendDevelopment(pending);
      return;
    }
    const now = performance.now();
    if (now < this.nextCommandAt) return;
    try {
      this.send("command", pending.fields);
      pending.sentEpoch = this.connectionEpoch;
      this.nextCommandAt = now + 1000 / this.limits.commandPerSecond;
    } catch (error) {
      this.fail(error);
    }
  }

  recoverPending() {
    for (const pending of this.pending.values()) {
      if (pending.sentEpoch !== this.connectionEpoch) this.sendPending(pending);
    }
  }

  recover(operationId) {
    const pending = this.pending.get(operationId);
    if (!pending) return Promise.reject(failure("OPERATION_NOT_PENDING"));
    if (!pending.recovery) {
      pending.recovery = new Promise((resolve) => {
        pending.recoverResolve = resolve;
      });
      if (pending.unknown) {
        pending.sentEpoch = null;
        if (this.status === "active") this.sendPending(pending);
      }
    }
    return pending.recovery;
  }

  develop(action) {
    if (
      this.status !== "active" ||
      !this.config.development ||
      this.config.role !== "developer"
    ) {
      return Promise.reject(failure("NOT_ALLOWED"));
    }
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(failure("PENDING_OPERATION_LIMIT"));
    }
    const operationId = crypto.randomUUID();
    const promise = new Promise((resolve) => {
      this.pending.set(operationId, {
        fields: { operationId, action: structuredClone(action) },
        development: true,
        durable: ["map", "profile", "preset"].includes(action.kind),
        playSession: this.playSession,
        resolve,
        deadline: performance.now() + COMMAND_TIMEOUT_MS,
        unknown: false,
        sentEpoch: null,
        inFlight: false,
      });
    });
    promise.operationId = operationId;
    this.callbacks.onCommand?.(
      freezeView(this.pending.get(operationId).fields),
    );
    this.sendPending(this.pending.get(operationId));
    return promise;
  }

  async sendDevelopment(pending) {
    if (pending.inFlight) return;
    pending.inFlight = true;
    pending.sentEpoch = this.connectionEpoch;
    try {
      const result = await request("/api/v1/development", "POST", {
        csrfToken: this.config.csrfToken,
        connectionEpoch: this.connectionEpoch,
        ...pending.fields,
      });
      if (
        !["committed", "rejected"].includes(result.status) ||
        result.operationId !== pending.fields.operationId
      ) {
        throw failure("INVALID_DEVELOPMENT_RECEIPT");
      }
      this.pending.delete(result.operationId);
      const observed = freezeView(result);
      pending.resolve(observed);
      pending.recoverResolve?.(observed);
      this.callbacks.onEvent?.(observed);
    } catch (error) {
      pending.unknown = true;
      pending.resolve(
        freezeView({
          status: "unknown",
          operationId: pending.fields.operationId,
        }),
      );
      this.callbacks.onStatus?.({
        ...this.snapshot(),
        code: error.code ?? "OPERATION_UNKNOWN",
        operationId: pending.fields.operationId,
      });
    } finally {
      pending.inFlight = false;
    }
  }

  ack() {
    if (this.baselineId && this.lastEventSeq > 0) {
      this.send("ack", {
        eventSeq: this.lastEventSeq,
        snapshotId: this.baselineId,
      });
    }
  }

  resync(reason = "prediction-overflow") {
    if (
      !this.connectionEpoch ||
      !this.lastEventSeq ||
      performance.now() - this.lastResyncAt < RESYNC_INTERVAL_MS
    ) {
      return;
    }
    this.lastResyncAt = performance.now();
    this.resyncing = true;
    this.setStatus("synchronizing", "RESYNC_REQUIRED");
    this.send("resync", {
      fieldEpoch: this.expectedFieldEpoch,
      lastEventSeq: this.lastEventSeq,
      reason,
    });
  }

  neutral() {
    if (this.status !== "active") return;
    const arrivalTick = this.clock.arrivalTick(performance.now());
    if (arrivalTick === null) return;
    const targetTick = Math.max(
      arrivalTick + PROTOCOL.INPUT_BUFFER_TICKS,
      this.lastInputTick + 1,
    );
    try {
      this.sendInput({
        targetTick,
        horizontal: 0,
        vertical: 0,
        jump: false,
        attack: false,
      });
    } catch (error) {
      this.fail(error);
    }
  }

  visibility() {
    if (globalThis.document?.hidden) this.neutral();
  }

  check() {
    const now = performance.now();
    try {
      this.baselines.check(now);
      this.shops.check(now);
      if (this.openWaiter && now > this.openWaiter.deadline) {
        throw failure("CONNECT_TIMEOUT");
      }
      if (this.socket && now - this.lastMessageAt > HEARTBEAT_TIMEOUT_MS) {
        throw failure("HEARTBEAT_TIMEOUT");
      }
      if (this.status === "active") this.recoverPending();
      for (const [operationId, pending] of this.pending) {
        if (!pending.unknown && now > pending.deadline) {
          pending.unknown = true;
          pending.resolve(
            freezeView({ type: "operation", operationId, status: "unknown" }),
          );
          this.callbacks.onStatus?.({
            ...this.snapshot(),
            code: "OPERATION_UNKNOWN",
            operationId,
          });
        }
      }
    } catch (error) {
      this.fail(error);
    }
  }

  setStatus(status, code) {
    this.status = status;
    this.callbacks.onStatus?.({ ...this.snapshot(), code });
  }

  fail(error) {
    this.disconnected(error.code ?? error.message ?? "PROTOCOL_ERROR");
  }

  disconnected(code) {
    // A closing frame is authoritative for why this connection ended.
    const reason = this.closingCode ?? code;
    this.closingCode = null;
    const socket = this.socket;
    this.socket = null;
    this.generation++;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "resynchronize");
    }
    this.openWaiter?.reject(failure(reason));
    this.openWaiter = null;
    this.resetConnection();
    this.setStatus("disconnected", reason);
  }

  disconnect() {
    this.neutral();
    this.disconnected("DISCONNECTED");
  }

  close() {
    this.disconnect();
    this.closed = true;
    clearInterval(this.checkTimer);
    globalThis.removeEventListener?.("blur", this.blurHandler);
    globalThis.document?.removeEventListener(
      "visibilitychange",
      this.visibilityHandler,
    );
    for (const [operationId, pending] of this.pending) {
      const unknown = freezeView({ status: "unknown", operationId });
      pending.resolve(unknown);
      pending.recoverResolve?.(unknown);
    }
  }

  snapshot() {
    return Object.freeze({
      status: this.status,
      characterId: this.characterId,
      connectionEpoch: this.connectionEpoch,
      serverTick: this.serverTick,
      lastEventSeq: this.lastEventSeq,
      inputSeq: this.inputSeq,
      timing: this.clock.snapshot(),
      pendingOperations: this.pending.size,
      queuedMessages: this.queue.length + this.deferred.length,
      queuedBytes: this.queueBytes + this.deferredBytes,
      bufferedBytes: this.socket?.bufferedAmount ?? 0,
    });
  }
}
