import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SessionAuthority } from "../src/auth.js";
import { serverConfig } from "../src/config.js";
import { OnlineHttp } from "../src/http.js";
import { GameplayGateway } from "../src/gateway.js";
import { PROTOCOL } from "../../shared/protocol.js";
import {
  powMessage,
  satisfiesProofOfWork,
} from "../../shared/proof-of-work.js";

const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

function config(
  origin = "http://127.0.0.1:3102",
  development = true,
  studioOrigin,
) {
  return serverConfig({
    OPENMS_MODE: development ? "development" : "production",
    OPENMS_ORIGIN: origin,
    OPENMS_STUDIO_ORIGIN: studioOrigin,
    OPENMS_POW_BITS: "8",
    OPENMS_RULES_HASH: "a".repeat(64),
    DATABASE_URL: "postgres://unused.invalid/origin_test",
  });
}

function request(origin, path, cookie = "", body = null) {
  return new Request(`http://127.0.0.1:3200/api/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(origin ? { Origin: origin } : {}),
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function solve(challenge) {
  for (let nonce = 0; nonce < 1000000; nonce++) {
    const digest = createHash("sha256")
      .update(powMessage(challenge.challengeId, String(nonce)))
      .digest();
    if (satisfiesProofOfWork(digest, challenge.bits)) return String(nonce);
  }
  throw new Error("Proof search bound exceeded");
}

async function fixture(settings = config()) {
  const passwordHash = await Bun.password.hash("password");
  const accounts = new Map([
    ["admin", { id: "admin", role: "developer", passwordHash }],
    ["player", { id: "player", role: "player", passwordHash }],
  ]);
  const database = {
    accountByName: async (name) => accounts.get(name),
    registerPlayer: async (name, hash) => {
      const account = { id: name, role: "player", passwordHash: hash };
      accounts.set(name, account);
      return account;
    },
  };
  const auth = new SessionAuthority(settings, database);
  const gateway = new GameplayGateway({ config: settings, auth, database });
  const http = new OnlineHttp({ config: settings, auth, gateway, content: {} });
  const server = { requestIP: () => ({ address: "127.0.0.1" }) };
  return { auth, gateway, http, server, accounts };
}

async function authenticate(f, origin, path, name) {
  // Same-origin browser GETs omit Origin; the proxy preserves it on the POST.
  const bootstrap = await f.http.fetch(request(null, "config"), f.server);
  const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
  const response = await f.http.fetch(
    request(null, "challenge", cookie),
    f.server,
  );
  expect(response.status).toBe(200);
  const challenge = await response.json();
  return f.http.fetch(
    request(origin, path, cookie, {
      name,
      password: "password",
      csrfToken: challenge.loginToken,
      challengeId: challenge.challengeId,
      nonce: solve(challenge),
    }),
    f.server,
  );
}

test("development login and registration accept exact loopback aliases through HTTP", async () => {
  const f = await fixture();
  for (const hostname of LOOPBACK) {
    const origin = `http://${hostname}:3102`;
    for (const name of ["admin", "player"]) {
      const reply = await authenticate(f, origin, "session", name);
      expect(reply.status).toBe(200);
      expect((await reply.json()).role).toBe(f.accounts.get(name).role);
      const cookie = reply.headers.get("set-cookie").split(";")[0];
      const upgrade = request(origin, "play", cookie);
      upgrade.headers.set("sec-websocket-protocol", PROTOCOL.SUBPROTOCOL);
      let upgraded = false;
      f.gateway.upgrade(
        upgrade,
        { upgrade: () => (upgraded = true) },
        "127.0.0.1",
      );
      expect(upgraded).toBe(true);
    }
    const reply = await authenticate(
      f,
      origin,
      "accounts",
      `new_${f.accounts.size}`,
    );
    expect(reply.status).toBe(200);
    expect((await reply.json()).role).toBe("player");
  }
});

test("loopback equivalence is symmetric and retains the configured scheme and port", () => {
  for (const configured of LOOPBACK) {
    const auth = new SessionAuthority(
      config(`http://${configured}:3122`),
      null,
    );
    for (const hostname of LOOPBACK) {
      expect(() =>
        auth.origin(request(`http://${hostname}:3122`, "session")),
      ).not.toThrow();
    }
    for (const origin of [
      null,
      "null",
      "http://localhost:3102",
      "https://localhost:3122",
      "http://localhost:3122/",
      "http://localhost:3122/path",
      "http://localhost.evil:3122",
      "http://evil.localhost:3122",
      "http://127.0.0.2:3122",
      "http://0.0.0.0:3122",
      "http://192.168.1.20:3122",
      "http://example.test:3122",
    ]) {
      expect(() => auth.origin(request(origin, "session"))).toThrow(
        "NOT_ALLOWED",
      );
    }
  }
});

test("production and non-loopback development origins remain exact", () => {
  for (const settings of [
    config("https://127.0.0.1:3102", false),
    config("https://maple.example", false),
    config("http://192.168.1.20:3102"),
  ]) {
    const auth = new SessionAuthority(settings, null);
    expect(() =>
      auth.origin(request(settings.origin, "session")),
    ).not.toThrow();
    for (const origin of ["http://localhost:3102", "https://localhost:3102"]) {
      expect(() => auth.origin(request(origin, "session"))).toThrow(
        "NOT_ALLOWED",
      );
    }
  }
});

test("Studio can sign in on its own port but cannot enter gameplay endpoints", async () => {
  const f = await fixture(config(undefined, true, "http://127.0.0.1:3103"));
  for (const hostname of LOOPBACK) {
    const origin = `http://${hostname}:3103`;
    const reply = await authenticate(f, origin, "session", "admin");
    expect(reply.status).toBe(200);
    const cookie = reply.headers.get("set-cookie").split(";")[0];
    expect(() =>
      f.auth.origin(request(origin, "custom-content/drafts", cookie)),
    ).not.toThrow();
    for (const path of [
      "accounts",
      "characters",
      "development",
      "play-ticket",
      "play",
    ]) {
      expect(() => f.auth.origin(request(origin, path, cookie))).toThrow(
        "NOT_ALLOWED",
      );
    }
    const upgrade = request(origin, "play", cookie);
    upgrade.headers.set("sec-websocket-protocol", PROTOCOL.SUBPROTOCOL);
    expect(() =>
      f.gateway.upgrade(upgrade, { upgrade: () => true }, "127.0.0.1"),
    ).toThrow("NOT_ALLOWED");
  }
  expect(() =>
    f.auth.origin(request("http://127.0.0.1:3104", "session")),
  ).toThrow("NOT_ALLOWED");
  const disabled = new SessionAuthority(config(), null);
  expect(() =>
    disabled.origin(request("http://127.0.0.1:3103", "session")),
  ).toThrow("NOT_ALLOWED");
});

test("production Studio requires its exact configured HTTPS origin", () => {
  const auth = new SessionAuthority(
    config("https://game.example", false, "https://studio.example"),
    null,
  );
  expect(() =>
    auth.origin(request("https://studio.example", "session")),
  ).not.toThrow();
  for (const origin of [
    "http://studio.example",
    "https://studio.example:3103",
    "https://other.example",
  ]) {
    expect(() => auth.origin(request(origin, "custom-content/drafts"))).toThrow(
      "NOT_ALLOWED",
    );
  }
  expect(() =>
    config("https://game.example", false, "http://studio.example"),
  ).toThrow("HTTPS OPENMS_STUDIO_ORIGIN");
  expect(() =>
    config(undefined, true, "http://localhost:3103/studio/"),
  ).toThrow("OPENMS_STUDIO_ORIGIN");
});
