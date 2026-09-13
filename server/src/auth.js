import { randomBytes, timingSafeEqual } from "node:crypto";
import { protocolError, closedRecord } from "../../shared/protocol.js";
import { ProofOfWorkAuthority, POW_TTL_MS } from "./proof-of-work.js";

const MAX_LOGIN_NONCES = 1024;
const MAX_TICKETS = 2048;
const MAX_RATE_KEYS = 2048;
const MAX_AUTH_WORK = 4;
const LOGIN_WINDOW_MS = 60_000;
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

/** Only local development aliases share admission; scheme and port stay exact. */
function browserOrigins(config) {
  const origins = new Set([config.origin]);
  if (config.development !== true) return origins;
  const url = new URL(config.origin);
  if (!LOOPBACK_HOSTS.includes(url.hostname)) return origins;
  for (const hostname of LOOPBACK_HOSTS) {
    url.hostname = hostname;
    origins.add(url.origin);
  }
  return origins;
}

export function opaqueId(bytes = 16) {
  return randomBytes(bytes).toString("base64url");
}

function equalToken(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function cookieValue(request, name) {
  const header = request.headers.get("cookie") ?? "";
  if (header.length > 4096) throw protocolError("INVALID_MESSAGE");
  let result = null;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (entry.slice(0, separator).trim() !== name) continue;
    if (result !== null) throw protocolError("INVALID_MESSAGE");
    result = entry.slice(separator + 1).trim();
  }
  return result;
}

/** Bounded wall-time token bucket. Input count never advances simulation time. */
export class RateLimit {
  constructor(rate, burst, now = performance.now()) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.updated = now;
  }
  take(now = performance.now()) {
    this.tokens = Math.min(
      this.burst,
      this.tokens + (Math.max(0, now - this.updated) * this.rate) / 1000,
    );
    this.updated = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

/** Sessions/tickets are process-local: restart revokes authentication, never economy. */
export class SessionAuthority {
  constructor(config, database) {
    this.config = config;
    this.origins = browserOrigins(config);
    this.database = database;
    this.sessions = new Map();
    this.logins = new Map();
    this.tickets = new Map();
    this.rates = new Map();
    this.authWork = 0;
    this.onRevoke = null;
    this.proofs = new ProofOfWorkAuthority(config.powBits ?? 15);
  }

  origin(request) {
    if (!this.origins.has(request.headers.get("origin"))) {
      const error = protocolError("NOT_ALLOWED");
      error.reason = "origin-mismatch";
      throw error;
    }
  }

  cookie(name, value, seconds) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${this.config.secureCookie ? "; Secure" : ""}`;
  }

  session(request, required = true) {
    const session = this.sessions.get(cookieValue(request, "openms_session"));
    if (session && session.expiresAt > Date.now()) return session;
    if (session) this.revoke(session);
    if (required) throw protocolError("UNAUTHENTICATED");
    return null;
  }

  active(session) {
    return (
      this.sessions.get(session.id) === session &&
      session.expiresAt > Date.now()
    );
  }

  csrf(session, value) {
    if (!this.active(session)) throw protocolError("SESSION_EXPIRED");
    if (!equalToken(session.csrfToken, value)) {
      throw protocolError("NOT_ALLOWED");
    }
  }

  bootstrap(request) {
    const session = this.session(request, false);
    this.prune();
    const previous = this.logins.get(cookieValue(request, "openms_login"));
    const nonce =
      previous && previous.expiresAt > Date.now()
        ? previous
        : this.issueLoginNonce();
    // The login nonce is independent of an existing session, so the sign-in form keeps working.
    const login = {
      loginToken: nonce.csrfToken,
      ...(nonce.cookie ? { cookie: nonce.cookie } : {}),
    };
    if (!session) return { ...login, csrfToken: nonce.csrfToken };
    return {
      ...login,
      csrfToken: session.csrfToken,
      role: session.role,
      expiresAt: session.expiresAt,
    };
  }

  issueLoginNonce() {
    if (this.logins.size >= MAX_LOGIN_NONCES) {
      throw protocolError("SERVER_BUSY");
    }
    const nonce = {
      id: opaqueId(32),
      csrfToken: opaqueId(32),
      expiresAt: Date.now() + POW_TTL_MS,
    };
    this.logins.set(nonce.id, nonce);
    return {
      ...nonce,
      cookie: this.cookie("openms_login", nonce.id, POW_TTL_MS / 1000),
    };
  }

  validateLoginBody(body) {
    if (
      typeof body.name !== "string" ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(body.name)
    ) {
      throw protocolError("INVALID_MESSAGE");
    }
    if (
      typeof body.password !== "string" ||
      body.password.length < 8 ||
      body.password.length > 256
    ) {
      throw protocolError("INVALID_MESSAGE");
    }
  }

  admitLogin(request, body, address) {
    this.origin(request);
    closedRecord(body, [
      "name",
      "password",
      "csrfToken",
      "challengeId",
      "nonce",
    ]);
    const nonce = this.logins.get(cookieValue(request, "openms_login"));
    this.proofs.consume(`${nonce?.id}\0${address}`, body);
    if (
      !nonce ||
      nonce.expiresAt <= Date.now() ||
      !equalToken(nonce.csrfToken, body.csrfToken)
    ) {
      throw protocolError("NOT_ALLOWED");
    }
    this.validateLoginBody(body);
    const rateKey = `${address}\0${body.name}`;
    let rate = this.rates.get(rateKey);
    if (!rate) {
      if (this.rates.size >= MAX_RATE_KEYS) throw protocolError("SERVER_BUSY");
      rate = new RateLimit(5 / 60, 5);
      this.rates.set(rateKey, rate);
    }
    if (!rate.take()) throw protocolError("RATE_LIMITED");
    if (
      this.authWork >= MAX_AUTH_WORK ||
      this.sessions.size >= this.config.maxSessions
    ) {
      throw protocolError("SERVER_BUSY");
    }
    return nonce;
  }

  async login(request, body, address) {
    const nonce = this.admitLogin(request, body, address);
    this.authWork++;
    try {
      const account = await this.database.accountByName(body.name);
      const valid =
        account &&
        (await Bun.password.verify(body.password, account.passwordHash));
      if (!valid) throw protocolError("UNAUTHENTICATED");
      return this.completeLogin(request, nonce, account);
    } finally {
      this.authWork--;
    }
  }

  completeLogin(request, nonce, account) {
    this.logins.delete(nonce.id);
    const previous = this.session(request, false);
    if (previous) this.revoke(previous);
    return this.issueSession(account);
  }

  async register(request, body, address) {
    const nonce = this.admitLogin(request, body, address);
    if (!/^[A-Za-z0-9_-]{3,16}$/.test(body.name)) {
      throw protocolError("INVALID_MESSAGE");
    }
    this.authWork++;
    try {
      const passwordHash = await Bun.password.hash(body.password);
      const account = await this.database.registerPlayer(
        body.name,
        passwordHash,
      );
      if (!account) throw protocolError("NAME_TAKEN");
      return this.completeLogin(request, nonce, account);
    } finally {
      this.authWork--;
    }
  }

  challenge(request, address) {
    // Same-origin browser GET omits Origin; nonce-cookie/address binding still gates issuance.
    if (request.headers.has("origin")) this.origin(request);
    this.prune();
    const nonce = this.logins.get(cookieValue(request, "openms_login"));
    if (!nonce || nonce.expiresAt <= Date.now()) {
      throw protocolError("NOT_ALLOWED");
    }
    const key = `challenge\0${address}`;
    let rate = this.rates.get(key);
    if (!rate) {
      if (this.rates.size >= MAX_RATE_KEYS) throw protocolError("SERVER_BUSY");
      rate = new RateLimit(10 / 60, 10);
      this.rates.set(key, rate);
    }
    if (!rate.take()) throw protocolError("RATE_LIMITED");
    const challenge = this.proofs.issue(`${nonce.id}\0${address}`);
    nonce.expiresAt = challenge.expiresAt;
    return {
      ...challenge,
      // Concurrent bootstrap responses can leave a tab holding another nonce's token.
      loginToken: nonce.csrfToken,
      cookie: this.cookie("openms_login", nonce.id, POW_TTL_MS / 1000),
    };
  }

  issueSession(account) {
    if (this.sessions.size >= this.config.maxSessions) {
      throw protocolError("SERVER_BUSY");
    }
    const session = {
      id: opaqueId(32),
      accountId: account.id,
      role: account.role,
      csrfToken: opaqueId(32),
      expiresAt: Date.now() + this.config.sessionMs,
      revoked: false,
    };
    this.sessions.set(session.id, session);
    return {
      session,
      cookie: this.cookie(
        "openms_session",
        session.id,
        this.config.sessionMs / 1000,
      ),
    };
  }

  async ticket(request, body) {
    this.origin(request);
    closedRecord(body, ["characterId", "csrfToken"]);
    const session = this.session(request);
    this.csrf(session, body.csrfToken);
    if (
      typeof body.characterId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(body.characterId)
    ) {
      throw protocolError("INVALID_MESSAGE");
    }
    this.prune();
    if (this.tickets.size >= MAX_TICKETS) throw protocolError("SERVER_BUSY");
    const character = await this.database.loadCharacter(
      session.accountId,
      body.characterId,
    );
    if (!character) throw protocolError("NOT_FOUND");
    this.csrf(session, body.csrfToken);
    const ticket = opaqueId(32);
    this.tickets.set(ticket, {
      sessionId: session.id,
      characterId: character.id,
      expiresAt: Date.now() + 30_000,
    });
    return { ticket };
  }

  consumeTicket(session, token) {
    const ticket = this.tickets.get(token);
    this.tickets.delete(token);
    if (
      !ticket ||
      ticket.sessionId !== session.id ||
      ticket.expiresAt <= Date.now() ||
      !this.active(session)
    ) {
      throw protocolError("UNAUTHENTICATED");
    }
    return ticket.characterId;
  }

  revoke(session) {
    session.revoked = true;
    this.sessions.delete(session.id);
    for (const [key, ticket] of this.tickets) {
      if (ticket.sessionId === session.id) this.tickets.delete(key);
    }
    this.onRevoke?.(session);
  }

  prune() {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= now) this.revoke(session);
    }
    for (const [key, nonce] of this.logins) {
      if (nonce.expiresAt <= now) this.logins.delete(key);
    }
    for (const [key, ticket] of this.tickets) {
      if (ticket.expiresAt <= now) this.tickets.delete(key);
    }
    for (const [key, rate] of this.rates) {
      if (performance.now() - rate.updated > LOGIN_WINDOW_MS * 2) {
        this.rates.delete(key);
      }
    }
  }
}
