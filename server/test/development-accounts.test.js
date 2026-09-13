import { expect, test } from "bun:test";
import { bootstrapDevelopmentAccounts } from "../tools/development-accounts.js";

function fixture(accounts = []) {
  const rows = new Map(accounts.map((account) => [account.id, { ...account }]));
  const characters = new Map(
    accounts.map((account) => [
      account.id,
      [{ id: `${account.id}-character` }],
    ]),
  );
  const database = {
    accountByName: async (name) =>
      [...rows.values()].find((account) => account.name === name),
    createAccount: async (account) => {
      const row = { ...account, id: account.name };
      rows.set(row.id, row);
      return row;
    },
    listCharacters: async (id) => characters.get(id) ?? [],
    createCharacter: async (id, profile) => characters.set(id, [profile]),
    sql: async (_query, name, passwordHash, id) =>
      Object.assign(rows.get(id), { name, passwordHash }),
  };
  const content = {
    catalog: { defaultMap: "000010000" },
    map: async (id) => ({
      id,
      physics: {
        portals: [{ id: 0, type: 0, targetMap: 999999999, x: 0, y: 100 }],
      },
    }),
  };
  return { database, content, rows, characters };
}

test("development defaults remain usable after restart and preserve characters", async () => {
  const { database, content, rows, characters } = fixture();
  const first = await bootstrapDevelopmentAccounts(database, content, {});
  expect(first).toEqual([
    { name: "admin", password: "password" },
    { name: "player", password: "password" },
  ]);
  const original = characters.get("admin")[0];
  original.level = 7;
  await bootstrapDevelopmentAccounts(database, content, {});
  expect(characters.get("admin")[0]).toBe(original);
  expect(original.level).toBe(7);
  expect(rows.get("admin").role).toBe("developer");
  expect(rows.get("player").role).toBe("player");
  for (const account of rows.values()) {
    expect(await Bun.password.verify("password", account.passwordHash)).toBe(
      true,
    );
  }
});

test("renaming legacy development accounts retains account and character identities", async () => {
  const { database, content, rows, characters } = fixture([
    { id: "old-admin", name: "dev_developer", role: "developer" },
    { id: "old-player", name: "dev_player", role: "player" },
  ]);
  const before = structuredClone([...characters]);
  await bootstrapDevelopmentAccounts(database, content, {
    OPENMS_DEV_PASSWORD: "custom-pass",
  });
  expect(rows.size).toBe(2);
  expect(rows.get("old-admin").name).toBe("admin");
  expect(rows.get("old-player").name).toBe("player");
  expect([...characters]).toEqual(before);
  expect(
    await Bun.password.verify(
      "custom-pass",
      rows.get("old-admin").passwordHash,
    ),
  ).toBe(true);
});

test("bootstrap cannot promote an unrelated normal account named admin", async () => {
  const { database, content, rows } = fixture([
    {
      id: "unrelated",
      name: "admin",
      role: "player",
      passwordHash: "retained",
    },
  ]);
  await expect(
    bootstrapDevelopmentAccounts(database, content, {}),
  ).rejects.toThrow("Refusing to replace unrelated admin account role");
  expect(rows.get("unrelated").passwordHash).toBe("retained");
  expect(rows.get("unrelated").role).toBe("player");
});
