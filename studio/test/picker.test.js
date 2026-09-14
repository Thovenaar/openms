import { expect, test } from "bun:test";
import { assetLabel, matchRows } from "../src/picker.js";

const rows = [
  { ref: { source: "original", kind: "mob", id: "100100" }, name: "Snail" },
  {
    ref: { source: "original", kind: "mob", id: "100101" },
    name: "Blue Snail",
  },
];

test("picker matches readable names and stable ids within its result bound", () => {
  expect(matchRows(rows, "blue").map((row) => row.ref.id)).toEqual(["100101"]);
  expect(matchRows(rows, "100100").map((row) => row.name)).toEqual(["Snail"]);
  expect(matchRows(rows, "  ").length).toBe(2);
  expect(matchRows(rows, "missing")).toEqual([]);
  expect(matchRows(rows, "", 1).length).toBe(1);
});

test("asset labels resolve once per identity and tolerate missing names", async () => {
  let calls = 0;
  const app = {
    resolveName: async () => {
      calls++;
      return "Snail";
    },
  };
  const ref = { source: "original", kind: "mob", id: "label-once" };
  expect(await assetLabel(app, ref)).toBe("Snail");
  expect(await assetLabel(app, { ...ref })).toBe("Snail");
  expect(calls).toBe(1);
  expect(
    await assetLabel(app, {
      source: "original",
      kind: "mob",
      id: "label-none",
    }),
  ).toBe("Snail");
  expect(calls).toBe(2);
});
