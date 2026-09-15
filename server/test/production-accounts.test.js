import { expect, test } from "bun:test";
import { startServer } from "../src/index.js";

test("production startup closes the database and fails before listening when password rotation fails", async () => {
  const failure = new Error("Password rotation transaction failed");
  let closed = false;
  const database = {
    transaction: async () => {
      throw failure;
    },
    close: async () => {
      closed = true;
    },
  };
  await expect(
    startServer({
      config: { development: false },
      content: {},
      database,
      log: () => {},
    }),
  ).rejects.toBe(failure);
  expect(closed).toBe(true);
});
