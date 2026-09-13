import { expect, test } from "bun:test";
import {
  createDevelopmentLog,
  logStage,
} from "../../shared/development-log.js";
import { OnlineHttp } from "../src/http.js";
import { admitDeveloper } from "../src/field-development.js";

function logger(enabled = true) {
  const lines = [];
  const log = createDevelopmentLog("probe", {
    enabled,
    write: (line) => lines.push(line),
    clock: () => 10,
  });
  return { log, lines };
}

test("development logs allow bounded metadata, excluding credentials and payloads", () => {
  const { log, lines } = logger();
  log("http", {
    method: "POST",
    status: 200,
    path: "a".repeat(250),
    reason: "one\ntwo",
    password: "secret",
    cookie: "secret",
    ticket: "secret",
    body: { secret: true },
  });
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain("secret");
  expect(lines[0].split("\n")).toHaveLength(1);
  const fields = JSON.parse(lines[0].slice(lines[0].indexOf("{")));
  expect(fields.path).toHaveLength(200);
  expect(fields.status).toBe(200);
  const quiet = logger(false);
  quiet.log("http", { status: 200 });
  expect(quiet.lines).toEqual([]);
});

test("stage failure logs its outcome and preserves the actual exception", async () => {
  const { log, lines } = logger();
  const failure = Object.assign(new Error("private details"), {
    code: "NOT_ALLOWED",
  });
  await expect(
    logStage(log, "startup", async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain('"phase":"failed"');
  expect(lines[1]).toContain("NOT_ALLOWED");
  expect(lines[1]).not.toContain("private details");
});

test("HTTP stdout includes actual status and excludes query contents", async () => {
  const { log, lines } = logger();
  const http = new OnlineHttp({
    config: {},
    auth: {},
    gateway: { database: {} },
    log,
  });
  const reply = await http.fetch(
    new Request("http://localhost/api/v1/config?token=private"),
    {},
  );
  expect(reply.status).toBe(400);
  expect(await reply.json()).toEqual({ code: "INVALID_MESSAGE" });
  expect(lines.at(-1)).toContain('"status":400');
  expect(lines.join("\n")).not.toContain("private");
});

test("shared-map developers retain commands without granting them to players", () => {
  const actor = {
    id: "developer",
    role: "developer",
    realm: "public",
    state: "active",
    field: { characters: new Map() },
  };
  actor.field.characters.set(actor.id, actor);
  expect(() => admitDeveloper({ development: true }, actor)).not.toThrow();
  expect(() => admitDeveloper({ development: false }, actor)).toThrow(
    "NOT_ALLOWED",
  );
  actor.role = "player";
  expect(() => admitDeveloper({ development: true }, actor)).toThrow(
    "NOT_ALLOWED",
  );
  actor.role = "developer";
  actor.field.characters.clear();
  expect(() => admitDeveloper({ development: true }, actor)).toThrow(
    "STALE_FIELD",
  );
});
