import { expect, test } from "bun:test";
import { ContentHttp } from "../src/content-http.js";
import { OnlineHttp } from "../src/http.js";
import { protocolError } from "../../shared/protocol.js";

function fixture(role = "player") {
  const calls = [];
  const session = { accountId: "owner", role };
  const auth = fixtureAuth(session);
  const service = {
    async preview(owner, input) {
      calls.push({ owner, input, preview: true });
      return { kind: input.kind };
    },
    async registry(buildId) {
      calls.push({ buildId, registry: true });
      return {
        monsterDetail: (ref) => {
          calls.push({ ref, monsterDetail: true });
          return { name: "Snail", ref };
        },
      };
    },
    async save(owner, input, admit) {
      admit();
      calls.push({ owner, input });
      return { status: "draft", revision: 1 };
    },
    store: {
      async get(owner, ref) {
        calls.push({ owner, ref });
        return { status: "draft" };
      },
    },
  };
  const http = new OnlineHttp({
    config: {},
    content: {},
    gateway: {},
    auth,
    contentHttp: new ContentHttp({
      service,
      auth,
      activation: {
        async activate(owner, input, admit) {
          admit();
          calls.push({ owner, input, activation: true });
          return { generation: 1 };
        },
      },
    }),
  });
  return { http, calls };
}

function fixtureAuth(session) {
  return {
    session(request) {
      if (request.headers.get("cookie") !== "session") {
        throw protocolError("UNAUTHENTICATED");
      }
      return session;
    },
    origin(request) {
      if (request.headers.get("origin") !== "http://localhost") {
        throw protocolError("NOT_ALLOWED");
      }
    },
    csrf(_, token) {
      if (token !== "csrf") throw protocolError("NOT_ALLOWED");
    },
  };
}

test("private preview is available to ordinary authors but world activation requires developer admission", async () => {
  const player = fixture(),
    developer = fixture("developer");
  const activate = (csrfToken) =>
    new Request("http://localhost/api/v1/custom-content/world/activate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: "session",
      },
      body: JSON.stringify({ csrfToken, release: { projectId: "forest" } }),
    });
  expect((await player.http.handle(activate("csrf"))).status).toBe(403);
  expect((await developer.http.handle(activate("wrong"))).status).toBe(403);
  expect(player.calls).toHaveLength(0);
  expect(developer.calls).toHaveLength(0);
  expect((await developer.http.handle(activate("csrf"))).status).toBe(200);
  expect(developer.calls[0]).toEqual({
    owner: "owner",
    input: { projectId: "forest" },
    activation: true,
  });
  const preview = new Request(
    "http://localhost/api/v1/custom-content/preview",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: "session",
      },
      body: JSON.stringify({ csrfToken: "csrf", content: { kind: "map" } }),
    },
  );
  expect((await player.http.handle(preview)).status).toBe(200);
  expect(player.calls).toEqual([
    { owner: "owner", input: { kind: "map" }, preview: true },
  ]);
});

function request(body, headers = {}) {
  return new Request("http://localhost/api/v1/custom-content/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      cookie: "session",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("ordinary accounts author in their session owner scope", async () => {
  const { http, calls } = fixture();
  const result = await http.handle(
    request({ csrfToken: "csrf", content: { id: "mossback" } }),
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ status: "draft", revision: 1 });
  expect(calls).toEqual([{ owner: "owner", input: { id: "mossback" } }]);
});

test("authoring rejects foreign origins, missing sessions, CSRF failures and caller ownership", async () => {
  const { http, calls } = fixture();
  const body = { csrfToken: "csrf", content: {} };
  expect(
    (await http.handle(request(body, { origin: "http://foreign" }))).status,
  ).toBe(403);
  expect((await http.handle(request(body, { cookie: "" }))).status).toBe(401);
  expect(
    (await http.handle(request({ ...body, csrfToken: "wrong" }))).status,
  ).toBe(403);
  expect(
    (await http.handle(request({ ...body, owner: "victim" }))).status,
  ).toBe(400);
  expect(calls).toHaveLength(0);
});

test("monster detail is served through the bounded asset route", async () => {
  const { http, calls } = fixture();
  const ref = { source: "original", kind: "mob", id: "100100" };
  const result = await http.handle(
    new Request("http://localhost/api/v1/custom-content/assets/monster", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        cookie: "session",
      },
      body: JSON.stringify({ csrfToken: "csrf", buildId: "a".repeat(64), ref }),
    }),
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ name: "Snail", ref });
  expect(calls).toEqual([
    { buildId: "a".repeat(64), registry: true },
    { ref, monsterDetail: true },
  ]);
});

test("revision reads retain owner scope and JSON requests have a bounded size", async () => {
  const { http, calls } = fixture();
  const result = await http.handle(
    new Request(
      "http://localhost/api/v1/custom-content/revisions/forest/mossback/1",
      { headers: { cookie: "session" } },
    ),
  );
  expect(result.status).toBe(200);
  expect(calls).toEqual([
    {
      owner: "owner",
      ref: { projectId: "forest", id: "mossback", revision: 1 },
    },
  ]);
  const oversized = await http.handle(
    request({ csrfToken: "csrf", content: "x".repeat(512 * 1024) }),
  );
  expect(oversized.status).toBe(400);
  expect(calls).toHaveLength(1);
});
