import { test, expect } from "bun:test";
import { decodeServer, PROTOCOL } from "../../shared/protocol.js";
import { OnlineTransport } from "../src/online/transport.js";

function transition(phase, fieldEpoch, eventSeq) {
  return decodeServer(
    JSON.stringify({
      v: 1,
      type: "transition",
      connectionEpoch: "connection",
      serverTick: 20,
      eventSeq,
      transitionId: "travel",
      phase,
      sourceEpoch: "source",
      destination: {
        instanceId: "instance",
        mapId: 100000000,
        fieldEpoch,
        spawn: { x: 0, y: 0 },
      },
      requiredContent: [],
      deadline: 1000,
      code: "OK",
    }),
  );
}

function connected() {
  const sent = [];
  const transport = new OnlineTransport();
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send(text) {
      sent.push(JSON.parse(text));
    },
    close() {
      this.readyState = WebSocket.CLOSED;
    },
  };
  Object.assign(transport, {
    socket,
    status: "active",
    connectionEpoch: "connection",
    expectedFieldEpoch: "source",
    baselineId: "source_snapshot",
    lastEventSeq: 1,
    limits: { maxMessageBytes: 65536 },
  });
  return { transport, sent };
}

function timing(fieldEpoch, serverTick) {
  return {
    connectionEpoch: "connection",
    fieldEpoch,
    serverTick,
    paused: false,
  };
}

function input(targetTick) {
  return { targetTick, horizontal: 1, vertical: 0, jump: false, attack: false };
}

// Returning to the same field retires its old baseline just like inter-map travel.
for (const destination of ["source", "destination"]) {
  test(`committed travel to ${destination} does not acknowledge a retired source baseline`, async () => {
    const { transport, sent } = connected();
    try {
      await transport.accept(transition("prepare", destination, 2), 100, 0, 0);
      expect(sent).toHaveLength(1);
      expect(sent[0].snapshotId).toBe("source_snapshot");
      await transport.accept(
        transition("committed", destination, 3),
        100,
        0,
        0,
      );
      expect(sent).toHaveLength(1);
      expect(transport.snapshot().status).toBe("synchronizing");
      expect(transport.snapshot().connectionEpoch).toBe("connection");
      expect(
        transport.sendInput({
          targetTick: 21,
          horizontal: 1,
          vertical: 0,
          jump: false,
          attack: false,
        }),
      ).toBeNull();
      await expect(
        transport.command({ kind: "revive.request", method: "return" }),
      ).rejects.toThrow("NOT_ACTIVE");
    } finally {
      transport.close();
    }
  });
}

test("inflated arrival timing and repeated neutral events cannot exceed authenticated input lead", () => {
  const { transport, sent } = connected();
  try {
    // Synthetic receive time zero keeps the inflated estimate ahead regardless of
    // test-runner scheduling; no sleeps or process-global clock replacement.
    transport.timing(timing("source", 13), 0, 300);
    for (let event = 0; event < 16; event++) transport.neutral();
    expect(sent.map((message) => message.targetTick)).toEqual([
      13 + PROTOCOL.INPUT_LEAD_TICKS,
    ]);
    expect(transport.sendInput(input(18))).toBeNull();
    transport.timing(timing("source", 14), 1);
    expect(transport.sendInput(input(18))).toBe(2);
    expect(sent[1]).toMatchObject({
      type: "input",
      fieldEpoch: "source",
      targetTick: 18,
      horizontal: 1,
    });
  } finally {
    transport.close();
  }
});

test("committed travel cannot use source timing or an unscoped heartbeat for destination input", async () => {
  const { transport, sent } = connected();
  try {
    transport.timing(timing("source", 100000), 0, 300);
    await transport.accept(transition("prepare", "destination", 2), 100, 0, 0);
    await transport.accept(
      transition("committed", "destination", 3),
      100,
      0,
      0,
    );
    // Baseline installation may activate the transport before destination motion.
    transport.setStatus("active");
    transport.neutral();
    transport.receive({
      data: JSON.stringify({
        v: 1,
        type: "ping",
        connectionEpoch: "connection",
        serverTick: 100001,
        nonce: "heartbeat",
        serverTime: 1000,
        roundTripMs: 300,
      }),
    });
    transport.neutral();
    expect(sent.filter((message) => message.type === "input")).toEqual([]);
    transport.timing(timing("destination", 13), performance.now(), 300);
    for (let event = 0; event < 16; event++) transport.neutral();
    const inputs = sent.filter((message) => message.type === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      fieldEpoch: "destination",
      targetTick: 13 + PROTOCOL.INPUT_LEAD_TICKS,
    });
  } finally {
    transport.close();
  }
});

test("a slow hello does not require network RTT before ordinary input can be sent", () => {
  const { transport, sent } = connected();
  try {
    const hash = "a".repeat(64);
    transport.connectionEpoch = null;
    transport.config = { rulesHash: hash, assetBuildId: hash };
    transport.welcome(
      {
        ...timing("source", 13),
        playSession: "play",
        rulesHash: hash,
        assetBuildId: hash,
        serverTime: 2500,
        tickMs: PROTOCOL.TICK_MS,
        inputLeadTicks: PROTOCOL.INPUT_LEAD_TICKS,
        inputBufferTicks: PROTOCOL.INPUT_BUFFER_TICKS,
        limits: {
          commandPerSecond: 12,
          inputPerSecond: 40,
          maxMessageBytes: PROTOCOL.MAX_MESSAGE_BYTES,
        },
      },
      2500,
    );
    transport.setStatus("active");
    expect(transport.sendInput(input(14))).toBe(1);
    expect(sent[0]).toMatchObject({ targetTick: 14, horizontal: 1 });
  } finally {
    transport.close();
  }
});

test("logout exposes sign-in only after HTTP revocation settles", async () => {
  const { transport } = connected();
  const statuses = [];
  transport.callbacks.onStatus = (value) => statuses.push(value);
  transport.config = { csrfToken: "session-csrf" };
  const gate = Promise.withResolvers();
  const response = Response.json({ code: "OK" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => gate.promise;
  let revocation;
  try {
    revocation = transport.revoke();
    // The authority closes the socket before its durable logout response.
    transport.disconnected("SESSION_EXPIRED");
    expect(transport.snapshot().status).toBe("signing-out");
    expect(statuses.some((value) => value.status === "disconnected")).toBe(
      false,
    );
    gate.resolve(response);
    await revocation;
    expect(
      statuses
        .filter((value) => value.status === "disconnected")
        .map((value) => value.code),
    ).toEqual(["SIGNED_OUT"]);
  } finally {
    gate.resolve(response);
    await revocation;
    globalThis.fetch = originalFetch;
    transport.close();
  }
});

test("a rejected logout releases sign-in and preserves the authority error", async () => {
  const { transport } = connected();
  const statuses = [];
  transport.callbacks.onStatus = (value) => statuses.push(value);
  transport.config = { csrfToken: "session-csrf" };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ code: "NOT_ALLOWED" }, { status: 403 });
  try {
    await expect(transport.revoke()).rejects.toThrow("NOT_ALLOWED");
    expect(statuses.at(-1)).toMatchObject({
      status: "disconnected",
      code: "NOT_ALLOWED",
    });
  } finally {
    globalThis.fetch = originalFetch;
    transport.close();
  }
});
