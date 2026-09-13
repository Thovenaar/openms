import { expect, test } from "bun:test";
import { OnlineHttp } from "../src/http.js";
import { developmentAction } from "../src/field-development.js";
import { developmentCanonical } from "../../shared/development.js";
import { createDefaultBindings } from "../../client/src/input/keymap.js";

function fixture(role = "developer") {
  const calls = [],
    audit = [];
  const session = { id: "session", accountId: "account", role };
  const actor = {
    id: "character",
    accountId: session.accountId,
    sessionId: session.id,
    field: { mapId: 50000 },
    revision: 1,
    connection: {
      data: { epoch: "epoch", ready: true, devRate: { take: () => true } },
    },
  };
  const http = new OnlineHttp({
    config: { development: true },
    content: {},
    auth: {
      origin() {},
      session: () => session,
      csrf: (_, token) => {
        expect(token).toBe("csrf");
      },
    },
    gateway: {
      accounts: new Map([[session.accountId, actor]]),
      database: { auditDevelopment: async (entry) => audit.push(entry) },
      world: {
        develop: async (_, body) => {
          calls.push(developmentAction(body.action));
          return { status: "committed", code: "OK" };
        },
      },
    },
  });
  return { http, calls, audit };
}

function request(action) {
  return new Request("http://localhost/api/v1/development", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      csrfToken: "csrf",
      connectionEpoch: "epoch",
      operationId: crypto.randomUUID(),
      action,
    }),
  });
}

test("audited profile requests admit89 keys and4096 bounded skill records", async () => {
  const probe = fixture();
  const skills = Object.fromEntries(
    Array.from({ length: 4096 }, (_, id) => [
      id,
      { level: 1, masterLevel: 1, expiresAt: null },
    ]),
  );
  const action = {
    kind: "profile",
    patch: { skills, keyBindings: createDefaultBindings() },
  };
  const response = await probe.http.handle(request(action));
  expect(response.status).toBe(200);
  expect((await response.json()).status).toBe("committed");
  expect(probe.calls).toEqual([action]);
  expect(probe.audit.map((entry) => entry.status)).toEqual([
    "requested",
    "committed",
  ]);
});

test("the larger development envelope grants no player privilege or unknown fields", async () => {
  const player = fixture("player");
  expect(
    (
      await player.http.handle(
        request({ kind: "conjure", itemId: 2000000, quantity: 1 }),
      )
    ).status,
  ).toBe(403);
  expect(player.calls).toHaveLength(0);
  const developer = fixture();
  const response = await developer.http.handle(
    request({ kind: "profile", patch: { role: "developer" } }),
  );
  expect(await response.json()).toMatchObject({
    status: "rejected",
    code: "INVALID_MESSAGE",
  });
});

test("same-operation identity includes learned skill IDs, ranks and expiry", () => {
  const action = {
    kind: "profile",
    patch: { skills: { 1000: { level: 1, masterLevel: 0, expiresAt: null } } },
  };
  const changed = structuredClone(action);
  changed.patch.skills[1000].level = 2;
  expect(developmentCanonical(action)).not.toBe(developmentCanonical(changed));
  expect(developmentCanonical(action)).toBe(
    developmentCanonical({ patch: action.patch, kind: "profile" }),
  );
});

test("post-commit audit failure stays ambiguous instead of reporting that a committed edit was rejected", async () => {
  const probe = fixture();
  probe.http.database.auditDevelopment = async (entry) => {
    if (entry.status === "committed") throw new Error("Audit connection lost");
    probe.audit.push(entry);
  };
  const response = await probe.http.handle(
    request({ kind: "profile", patch: { str: 15 } }),
  );
  expect(response.status).toBe(503);
  expect((await response.json()).status).toBeUndefined();
  expect(probe.calls).toHaveLength(1);
  expect(probe.audit.map((entry) => entry.status)).toEqual(["requested"]);
});
