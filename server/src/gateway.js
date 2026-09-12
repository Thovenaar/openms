import {
  PROTOCOL,
  decodeClient,
  protocolError,
} from "../../shared/protocol.js";
import { opaqueId, RateLimit } from "./auth.js";
import { Publications } from "./publication.js";
import { currentInteractionRevision } from "./interactions.js";

const HELLO_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 15_000;
const PONG_TIMEOUT_MS = 30_000;
const LEASE_RENEW_MS = 15_000;
const MAX_PREAUTH_PER_ACCOUNT = 2;

/** Socket/session epochs fence admission; PostgreSQL separately fences all writes. */
export class GameplayGateway {
  constructor({ config, auth, database, world }) {
    this.config = config;
    this.auth = auth;
    this.database = database;
    this.world = world;
    this.publications = new Publications(world);
    this.sockets = new Set();
    this.accounts = new Map();
    this.characters = new Map();
    this.joining = new Set();
    this.lastPrune = 0;
    this.auth.onRevoke = this.revoke.bind(this);
    this.handlers = {
      maxPayloadLength: PROTOCOL.MAX_MESSAGE_BYTES,
      backpressureLimit: 1024 * 1024,
      closeOnBackpressureLimit: true,
      idleTimeout: 35,
      perMessageDeflate: false,
      open: this.open.bind(this),
      message: this.message.bind(this),
      close: this.closed.bind(this),
      drain: this.drain.bind(this),
    };
  }

  upgrade(request, server, address) {
    this.auth.origin(request);
    const session = this.auth.session(request);
    if (
      new URL(request.url).search ||
      request.headers.get("sec-websocket-protocol") !== PROTOCOL.SUBPROTOCOL
    ) {
      throw protocolError("PROTOCOL_MISMATCH");
    }
    if (this.sockets.size >= this.config.maxConnections) {
      throw protocolError("SERVER_BUSY");
    }
    let unauthenticated = 0;
    for (const socket of this.sockets) {
      if (
        socket.data.session.accountId === session.accountId &&
        !socket.data.actor
      ) {
        unauthenticated++;
      }
    }
    if (unauthenticated >= MAX_PREAUTH_PER_ACCOUNT) {
      throw protocolError("RATE_LIMITED");
    }
    const data = {
      session,
      address,
      epoch: opaqueId(),
      actor: null,
      closed: false,
      createdAt: Date.now(),
      helloPending: false,
      ready: false,
      sequence: 0,
      inputRate: new RateLimit(40, 8),
      commandRate: new RateLimit(12, 12),
      controlRate: new RateLimit(64, 128),
      devRate: new RateLimit(2, 4),
      baselines: new Map(),
      ackSnapshotId: null,
      ackEventSeq: 0,
      commandWork: 0,
      resyncAt: 0,
      pingAt: Date.now(),
      nonce: null,
      pongAt: Date.now(),
      pingMonotonic: null,
      roundTripMs: null,
    };
    if (
      !server.upgrade(request, {
        data,
        headers: { "Sec-WebSocket-Protocol": PROTOCOL.SUBPROTOCOL },
      })
    ) {
      throw protocolError("INVALID_MESSAGE");
    }
  }

  open(socket) {
    this.sockets.add(socket);
  }

  message(socket, bytes) {
    if (socket.data.closed) return;
    try {
      if (!this.auth.active(socket.data.session)) {
        throw protocolError("SESSION_EXPIRED");
      }
      if (typeof bytes !== "string") throw protocolError("INVALID_MESSAGE");
      const message = decodeClient(bytes);
      if (!socket.data.actor) {
        if (message.type !== "hello" || socket.data.helloPending) {
          throw protocolError("INVALID_MESSAGE");
        }
        socket.data.helloPending = true;
        this.hello(socket, message).catch((error) => this.fail(socket, error));
        return;
      }
      this.admit(socket, message);
      this.dispatch(socket, message);
    } catch (error) {
      this.fail(socket, error);
    }
  }

  async hello(socket, message) {
    const session = socket.data.session;
    const characterId = this.auth.consumeTicket(session, message.ticket);
    if (
      message.rulesHash !== this.world.content.rulesHash ||
      message.assetBuildId !== this.world.content.assetBuildId
    ) {
      throw protocolError("CONTENT_MISMATCH");
    }
    if (this.joining.has(session.accountId)) {
      throw protocolError("CHARACTER_BUSY");
    }
    this.joining.add(session.accountId);
    try {
      const actor = await this.obtainActor(socket, characterId, message.resume);
      if (socket.data.closed || !this.auth.active(session)) {
        if (!actor.connection) actor.disconnectedAt = Date.now();
        throw protocolError("SESSION_EXPIRED");
      }
      this.attach(socket, actor);
      this.welcome(socket, Boolean(message.resume));
      this.publications.snapshot(actor);
    } finally {
      this.joining.delete(session.accountId);
    }
  }

  async obtainActor(socket, characterId, resume) {
    const session = socket.data.session;
    const existing = this.accounts.get(session.accountId);
    if (existing) {
      return this.resumeActor(socket, existing, characterId, resume);
    }
    const actor = await this.database.acquireLease(
      session.accountId,
      characterId,
    );
    if (!actor) throw protocolError("NOT_FOUND");
    actor.role = session.role;
    actor.sessionId = session.id;
    actor.session = session;
    actor.playSession = opaqueId();
    actor.eventSeq = 0;
    actor.leaseRenewAt = Date.now();
    actor.disconnectedAt = Date.now();
    try {
      await this.world.join(actor);
      this.accounts.set(session.accountId, actor);
      this.characters.set(actor.id, actor);
      return actor;
    } catch (error) {
      await this.database.releaseLease(actor);
      throw error;
    }
  }

  async resumeActor(socket, actor, characterId, resume) {
    if (
      actor.id !== characterId ||
      !resume ||
      resume.playSession !== actor.playSession ||
      actor.sessionId !== socket.data.session.id
    ) {
      throw protocolError("CHARACTER_BUSY");
    }
    if (actor.pending || actor.retiring || actor.renewing) {
      throw protocolError("SERVER_BUSY");
    }
    if (resume.lastEventSeq > actor.eventSeq) {
      throw protocolError("INVALID_MESSAGE");
    }
    if (actor.connection) {
      this.publications.close(actor.connection, "STALE_CONNECTION");
    }
    await this.database.rotateLease(actor);
    return actor;
  }

  attach(socket, actor) {
    actor.connection = socket;
    actor.disconnectedAt = null;
    socket.data.actor = actor;
    socket.data.ready = false;
  }

  welcome(socket, resumed) {
    const actor = socket.data.actor;
    this.publications.send(socket, {
      type: "welcome",
      playSession: actor.playSession,
      fieldEpoch: actor.field.epoch,
      rulesHash: this.world.content.rulesHash,
      assetBuildId: this.world.content.assetBuildId,
      serverTime: Date.now(),
      tickMs: PROTOCOL.TICK_MS,
      inputLeadTicks: PROTOCOL.INPUT_LEAD_TICKS,
      inputBufferTicks: PROTOCOL.INPUT_BUFFER_TICKS,
      resume: resumed ? "continued" : "snapshot",
      limits: {
        inputPerSecond: 40,
        commandPerSecond: 12,
        maxMessageBytes: PROTOCOL.MAX_MESSAGE_BYTES,
      },
    });
  }

  admit(socket, message) {
    const data = socket.data;
    if (
      message.type === "hello" ||
      message.connectionEpoch !== data.epoch ||
      data.actor.connection !== socket
    ) {
      throw protocolError("STALE_CONNECTION");
    }
    if (message.seq !== data.sequence + 1) {
      throw protocolError("INVALID_MESSAGE");
    }
    data.sequence = message.seq;
    if (
      !["input", "command"].includes(message.type) &&
      !data.controlRate.take()
    ) {
      throw protocolError("RATE_LIMITED");
    }
    this.admitField(data, message);
  }

  admitField(data, message) {
    if (
      message.type !== "command" &&
      message.fieldEpoch !== undefined &&
      message.fieldEpoch !== data.actor.field.epoch
    ) {
      throw protocolError("STALE_FIELD");
    }
    if (["input", "command"].includes(message.type) && !data.ready) {
      throw protocolError("NOT_ALLOWED");
    }
    if (message.type === "input" && data.actor.state === "transitioning") {
      throw protocolError("NOT_ALLOWED");
    }
  }

  dispatch(socket, message) {
    switch (message.type) {
      case "input":
        return this.input(socket, message);
      case "command":
        return this.command(socket, message);
      case "ready":
        return this.ready(socket, message);
      case "ack":
        return this.publications.acknowledge(socket, message);
      case "resync":
        return this.resync(socket);
      case "pong":
        return this.pong(socket, message);
      default:
        throw protocolError("INVALID_MESSAGE");
    }
  }

  input(socket, message) {
    if (!socket.data.inputRate.take()) throw protocolError("RATE_LIMITED");
    this.world.input(socket.data.actor, message);
  }

  command(socket, message) {
    if (!socket.data.commandRate.take()) throw protocolError("RATE_LIMITED");
    if (socket.data.commandWork >= 32) throw protocolError("SERVER_BUSY");
    socket.data.commandWork++;
    const actor = socket.data.actor;
    this.world
      .command(actor, message)
      .then((receipt) => {
        this.publications.publish(actor, {
          type: "result",
          operationId: message.operationId,
          status: receipt.status,
          code: receipt.code,
          domainRevision: receipt.domainRevision,
          transactionId: receipt.transactionId ?? null,
        });
      })
      .catch((error) => {
        this.publications.publish(actor, {
          type: "result",
          operationId: message.operationId,
          status: "rejected",
          code: error.code ?? "SERVER_BUSY",
          domainRevision: currentInteractionRevision(
            actor,
            message.action,
            this.world,
          ),
          transactionId: null,
        });
      })
      .finally(() => {
        socket.data.commandWork--;
      });
  }

  ready(socket, message) {
    if (!socket.data.baselines.has(message.snapshotId)) {
      throw protocolError("INVALID_MESSAGE");
    }
    socket.data.ready = true;
    socket.data.ackSnapshotId = message.snapshotId;
  }

  resync(socket) {
    if (Date.now() - socket.data.resyncAt < 5000) {
      throw protocolError("RATE_LIMITED");
    }
    socket.data.resyncAt = Date.now();
    this.publications.snapshot(socket.data.actor);
  }

  pong(socket, message) {
    if (!socket.data.nonce || message.nonce !== socket.data.nonce) {
      throw protocolError("INVALID_MESSAGE");
    }
    socket.data.nonce = null;
    socket.data.pongAt = Date.now();
    socket.data.roundTripMs = Math.min(
      30_000,
      Math.max(0, Math.round(performance.now() - socket.data.pingMonotonic)),
    );
  }

  fail(socket, error) {
    this.publications.close(socket, error.code ?? "SERVER_BUSY");
    if (!error.code) console.error("Online gateway failure:", error.message);
  }

  closed(socket) {
    socket.data.closed = true;
    this.sockets.delete(socket);
    const actor = socket.data.actor;
    if (actor?.connection !== socket) return;
    actor.connection = null;
    actor.disconnectedAt = Date.now();
  }

  drain(socket) {
    if (socket.data.needsSnapshot && socket.data.actor && !socket.data.closed) {
      socket.data.needsSnapshot = false;
      this.publications.publish(socket.data.actor, {
        type: "snapshot-request",
      });
    }
  }

  revoke(session) {
    for (const socket of this.sockets) {
      if (socket.data.session === session) {
        this.publications.close(socket, "SESSION_EXPIRED");
      }
    }
  }

  maintain(now) {
    if (now - this.lastPrune < 1000) return;
    this.lastPrune = now;
    this.auth.prune();
    for (const socket of this.sockets) this.heartbeat(socket, now);
    for (const actor of this.characters.values()) {
      this.maintainActor(actor, now);
    }
  }

  heartbeat(socket, now) {
    if (!socket.data.actor && now - socket.data.createdAt > HELLO_TIMEOUT_MS) {
      return this.publications.close(socket, "UNAUTHENTICATED");
    }
    if (now - socket.data.pongAt > PONG_TIMEOUT_MS) {
      return this.publications.close(socket, "SESSION_EXPIRED");
    }
    if (
      !socket.data.actor ||
      now - socket.data.pingAt < PING_INTERVAL_MS ||
      socket.data.nonce
    ) {
      return;
    }
    socket.data.nonce = opaqueId();
    socket.data.pingAt = now;
    socket.data.pingMonotonic = performance.now();
    this.publications.send(socket, {
      type: "ping",
      nonce: socket.data.nonce,
      serverTime: now,
      roundTripMs: socket.data.roundTripMs,
    });
  }

  maintainActor(actor, now) {
    if (actor.retiring) return;
    if (
      actor.disconnectedAt !== null &&
      now - actor.disconnectedAt >= this.config.reconnectMs &&
      !actor.pending
    ) {
      actor.retiring = true;
      this.retire(actor).catch((error) =>
        console.error("Character retirement failed:", error.message),
      );
      return;
    }
    if (!actor.renewing && now - actor.leaseRenewAt >= LEASE_RENEW_MS) {
      actor.renewing = true;
      this.database
        .renewLease(actor)
        .then(() => {
          actor.leaseRenewAt = Date.now();
        })
        .catch((error) => {
          if (actor.connection) this.fail(actor.connection, error);
          actor.retiring = true;
          this.world.leave(actor);
          this.accounts.delete(actor.accountId);
          this.characters.delete(actor.id);
        })
        .finally(() => {
          actor.renewing = false;
        });
    }
  }

  async retire(actor) {
    try {
      await this.database.checkpoint(actor);
    } finally {
      this.world.leave(actor);
      await this.database.releaseLease(actor);
      this.accounts.delete(actor.accountId);
      this.characters.delete(actor.id);
    }
  }

  async close() {
    for (const socket of this.sockets) {
      this.publications.close(socket, "SERVER_BUSY");
    }
    for (const actor of this.characters.values()) await this.retire(actor);
    this.sockets.clear();
  }
}
