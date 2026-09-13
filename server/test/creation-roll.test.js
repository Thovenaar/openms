import { expect, test } from "bun:test";
import { issueCreationRoll, admitCreationRoll } from "../src/creation-roll.js";
import { validStartingStats } from "../../shared/starting-stats.js";
import { SessionAuthority } from "../src/auth.js";
import { OnlineHttp } from "../src/http.js";

test("server rolls conserve 25 integer points and retain only one unaliased result", () => {
  const session = {};
  const first = issueCreationRoll(session);
  expect(validStartingStats(first)).toBe(true);
  expect(() => admitCreationRoll(session, first)).not.toThrow();
  first.str = 999;
  expect(validStartingStats(session.creationRoll)).toBe(true);
  const second = issueCreationRoll(session);
  expect(second.rollId).not.toBe(first.rollId);
  expect(() => admitCreationRoll(session, first)).toThrow("INVALID_MESSAGE");
  expect(() => admitCreationRoll({}, second)).toThrow("INVALID_MESSAGE");
});

test("a legal forged distribution, nonintegers, absurd stats and old rolls are rejected", () => {
  const session = {};
  const roll = issueCreationRoll(session);
  const changed =
    roll.str < 13
      ? { str: 13, dex: 4, int: 4, luk: 4 }
      : { str: 4, dex: 13, int: 4, luk: 4 };
  expect(validStartingStats(changed)).toBe(true);
  for (const patch of [
    changed,
    { str: 999 },
    { str: "4" },
    { str: 4.5 },
    { rollId: null },
  ]) {
    expect(() => admitCreationRoll(session, { ...roll, ...patch })).toThrow(
      "INVALID_MESSAGE",
    );
  }
  expect(() => admitCreationRoll(session, roll)).not.toThrow();
});

test("rerolls are rate limited without erasing the last valid result", () => {
  const session = {};
  let roll;
  for (let index = 0; index < 3; index++) roll = issueCreationRoll(session);
  expect(() => issueCreationRoll(session)).toThrow("RATE_LIMITED");
  expect(() => admitCreationRoll(session, roll)).not.toThrow();
});

function httpFixture() {
  const config = {
    origin: "http://127.0.0.1:3110",
    maxSessions: 4,
    sessionMs: 60000,
  };
  const auth = new SessionAuthority(config, {});
  const login = auth.issueSession({ id: "account", role: "player" });
  const api = new OnlineHttp({
    config,
    content: {},
    auth,
    gateway: { database: {} },
  });
  const request = (path, body, headers = {}) =>
    new Request(`${config.origin}/api/v1/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: config.origin,
        cookie: login.cookie.split(";")[0],
        ...headers,
      },
      body: JSON.stringify({ csrfToken: login.session.csrfToken, ...body }),
    });
  return { api, request };
}

test("HTTP roll requires session, origin and CSRF, and creation rejects tampering before loading a map", async () => {
  const { api, request } = httpFixture();
  for (const headers of [
    { origin: "https://foreign.example" },
    { cookie: "" },
  ]) {
    expect(
      (await api.fetch(request("character-roll", {}, headers))).status,
    ).toBeGreaterThanOrEqual(400);
  }
  expect(
    (await api.fetch(request("character-roll", { csrfToken: "forged" })))
      .status,
  ).toBe(403);
  expect(
    (await api.fetch(request("character-roll", { str: 999 }))).status,
  ).toBe(400);
  const response = await api.fetch(request("character-roll", {}));
  expect(response.status).toBe(200);
  const roll = await response.json();
  expect(validStartingStats(roll)).toBe(true);
  const rejected = await api.fetch(
    request("characters", { ...roll, str: 999 }),
  );
  expect(rejected.status).toBe(400);
  expect(await rejected.json()).toEqual({ code: "INVALID_MESSAGE" });
});
