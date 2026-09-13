import { expect, test } from "bun:test";
import { NativeMarket } from "../src/online/native-market.js";

function service(command) {
  return new NativeMarket({
    store: { subscribe: () => () => {} },
    transport: { command },
  });
}

test("market reads recover from transient contention without replaying a mutation", async () => {
  const requests = [];
  const market = service(async (action) => {
    requests.push(action);
    return requests.length < 3
      ? { status: "rejected", code: "SERVER_BUSY" }
      : { status: "committed", code: "OK", value: { balance: 10 } };
  });
  try {
    await market.read();
    expect(requests).toHaveLength(3);
    expect(requests.every((action) => action.kind === "mts.read")).toBe(true);
    expect(market.value.balance).toBe(10);
    expect(market.error).toBe("");
  } finally {
    market.destroy();
  }
});

test("the latest category survives an in-flight read, and closing prevents queued work", async () => {
  const head = Promise.withResolvers();
  const next = Promise.withResolvers();
  const requests = [];
  const market = service((action) => {
    requests.push(action);
    if (requests.length === 1) return head.promise;
    next.resolve(action);
    return { status: "committed", code: "OK", value: {} };
  });
  try {
    const reading = market.read();
    await market.read({ category: 1 });
    await market.read({ category: 2 });
    head.resolve({ status: "committed", code: "OK", value: {} });
    await reading;
    expect((await next.promise).category).toBe(2);
    expect(requests).toHaveLength(2);
    market.destroy();
    await market.read({ category: 3 });
    expect(requests).toHaveLength(2);
  } finally {
    market.destroy();
  }
});

test("market read retries stop at the budget and retain the last complete page", async () => {
  let calls = 0;
  const market = service(async () => {
    calls++;
    return { status: "rejected", code: "SERVER_BUSY" };
  });
  try {
    const previous = market.value;
    await market.read();
    expect(calls).toBe(3);
    expect(market.value).toBe(previous);
    expect(market.error).toBeTruthy();
  } finally {
    market.destroy();
  }
});
