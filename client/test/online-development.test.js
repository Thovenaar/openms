import { expect, test } from "bun:test";
import { OnlineTransport } from "../src/online/transport.js";

function developer() {
  const transport = new OnlineTransport();
  transport.status = "active";
  transport.config = {
    development: true,
    role: "developer",
    csrfToken: "token",
  };
  transport.connectionEpoch = "epoch";
  return transport;
}

test("a definite HTTP refusal is a terminal development rejection, not an unknown operation", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ code: "INVALID_MESSAGE" }, { status: 400 });
  try {
    const transport = developer();
    const result = await transport.develop({
      kind: "profile",
      patch: { level: 2 },
    });
    expect(result).toMatchObject({
      status: "rejected",
      code: "INVALID_MESSAGE",
    });
    expect(transport.pending.size).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});

test("lost development responses recover the same operation, including conjured items", async () => {
  const original = globalThis.fetch;
  const ids = [];
  globalThis.fetch = async (_, options) => {
    const request = JSON.parse(options.body);
    ids.push(request.operationId);
    if (ids.length === 1) throw new TypeError("Connection lost");
    return Response.json({
      operationId: request.operationId,
      status: "committed",
      code: "OK",
    });
  };
  try {
    const transport = developer();
    const unknown = await transport.develop({
      kind: "conjure",
      itemId: 2000000,
      quantity: 1,
    });
    expect(unknown.status).toBe("unknown");
    expect(transport.pending.get(unknown.operationId).durable).toBe(true);
    const result = await transport.recover(unknown.operationId);
    expect(result.status).toBe("committed");
    expect(ids).toEqual([unknown.operationId, unknown.operationId]);
    expect(transport.pending.size).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});

test("a refused recovery attempt cannot turn an earlier unknown commit into a definite rejection", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError("Response lost");
    };
    const transport = developer();
    const result = await transport.develop({
      kind: "conjure",
      itemId: 2000000,
      quantity: 1,
    });
    const pending = transport.pending.get(result.operationId);
    globalThis.fetch = async () =>
      Response.json({ code: "NOT_ALLOWED" }, { status: 403 });
    await transport.sendDevelopment(pending);
    expect(transport.pending.get(result.operationId)).toBe(pending);
    expect(pending.unknown).toBe(true);
  } finally {
    globalThis.fetch = original;
  }
});
