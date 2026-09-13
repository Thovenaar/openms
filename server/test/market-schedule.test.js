import { expect, test } from "bun:test";
import { advanceMarketSchedule } from "../src/market-schedule.js";

test("expiry continues after a vanished lot and backs off missing-participant rejections", async () => {
  const due = ["vanished", "missing-owner", "available"].map((id) => ({
    owner_id: "owner",
    summary: { id, bid: 0, bidderId: "owner", realm: "public" },
  }));
  const deferred = [],
    attempted = [],
    published = [];
  const actor = {
    id: "actor",
    state: "active",
    field: { epoch: "field" },
    realm: "public",
    revision: 0,
  };
  const database = {
    async sql(strings, ...values) {
      const query = strings.join("?");
      if (query.includes("ORDER BY GREATEST")) return due;
      if (query.startsWith("UPDATE market_listing")) {
        deferred.push(values[1]);
        return [];
      }
      const row = due.find((entry) => entry.summary.id === values[0]);
      return row?.summary.id === "vanished" ? [] : [row];
    },
  };
  const world = {
    database,
    actors: new Map([[actor.id, actor]]),
    now: 2000,
    publish(_actor, record) {
      published.push(record);
    },
    participants: {
      async commitProduced() {
        attempted.push(true);
        return attempted.length === 1
          ? { status: "rejected", code: "NOT_FOUND" }
          : {
              status: "committed",
              value: {
                kind: "mts.changed",
                action: "expire",
                listingId: "available",
              },
            };
      },
    },
  };
  advanceMarketSchedule(world);
  await world.marketTask;
  expect(attempted).toHaveLength(2);
  expect(deferred).toEqual(["vanished", "missing-owner"]);
  expect(published[0].event.listingId).toBe("available");
});
