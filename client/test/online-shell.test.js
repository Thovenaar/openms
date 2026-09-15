import { expect, test } from "bun:test";
import { onlineShell } from "../tools/online-shell.js";

const source = await Bun.file(new URL("../index.html", import.meta.url)).text();

test("development preserves the authored sidebar and shell", async () => {
  expect(await onlineShell(source, true)).toBe(source);
});

test("production removes development chrome while preserving game entry and diagnostics", async () => {
  const html = await onlineShell(source, false);
  const counts = new Map();
  const selectors = [
    "#console-access, #gm-console, #console-toggle, #inspection-controls, #audio-controls",
    "#viewport",
    "#project-bar",
    'script[type="module"][src="/dist/online/main.js"]',
    "[hidden] #ui-status",
    "[hidden] #error",
  ];
  const reader = new HTMLRewriter();
  for (const selector of selectors) {
    counts.set(selector, 0);
    reader.on(selector, {
      element() {
        counts.set(selector, counts.get(selector) + 1);
      },
    });
  }
  await reader.transform(new Response(html)).text();
  expect([...counts.values()]).toEqual([0, 1, 1, 1, 1, 1]);
  expect(html).not.toContain("inspection-chrome");
});
