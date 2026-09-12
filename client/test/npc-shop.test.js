import { expect, test } from "bun:test";
import { NpcShop } from "../src/npc/npc-shop.js";

function unaffordableShop() {
  const shown = Promise.withResolvers();
  const response = Promise.withResolvers();
  const profile = Object.freeze({
    hp: 50,
    meso: 10,
    inventory: [],
    equipment: [],
  });
  const store = {
    profile,
    commits: 0,
    subscribe: () => () => {},
    async commitProfile() {
      this.commits++;
      throw new Error("Refusal cannot commit");
    },
  };
  const shop = new NpcShop(
    store,
    {
      ui: {
        items: {
          2000000: { id: 2000000, info: {}, source: "fixture", descriptor: {} },
        },
      },
    },
    {
      shopId: 1,
      npc: { id: 1, name: "Fixture shop" },
      rows: [
        {
          shopId: 1,
          itemId: 2000000,
          price: 50,
          pitch: 0,
          position: 0,
          sourceRow: 0,
        },
      ],
      isCurrent: () => true,
      isBusy: () => false,
      prompt(request) {
        shown.resolve(request);
        request.signal.addEventListener(
          "abort",
          () => response.resolve({ ok: false }),
          { once: true },
        );
        return response.promise;
      },
    },
  );
  return { shop, store, shown: shown.promise, answer: response.resolve };
}

test("unaffordable purchase holds its refusal modal without acquiring a commit lease", async () => {
  const { shop, store, shown, answer } = unaffordableShop();
  const purchase = shop.buy({ row: 0, count: 1 });
  const request = await shown;
  expect(request.kind).toBe("notice");
  expect(shop.snapshot().pending).toBe(true);
  expect(shop.pending).toBe(false);
  expect((await shop.buy({ row: 0, count: 1 })).code).toBe("shop-busy");
  answer({ ok: true });
  expect((await purchase).code).toBe("insufficient-mesos");
  expect(shop.snapshot().pending).toBe(false);
  expect(store.commits).toBe(0);
  expect(store.profile.meso).toBe(10);
  expect(store.profile.inventory).toEqual([]);
  shop.destroy();
});

test("closing a shop aborts its active refusal notice and cannot resurrect an operation", async () => {
  const { shop, store, shown } = unaffordableShop();
  const purchase = shop.buy({ row: 0, count: 1 });
  const request = await shown;
  expect(shop.close().ok).toBe(true);
  expect(request.signal.aborted).toBe(true);
  expect((await purchase).code).toBe("cancelled");
  expect((await shop.buy({ row: 0, count: 1 })).code).toBe("stale-shop");
  expect(store.commits).toBe(0);
  expect(store.profile.meso).toBe(10);
  shop.destroy();
});
