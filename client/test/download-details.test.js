import { expect, test } from "bun:test";
import {
  downloadCountText,
  indicatorPresentation,
} from "../src/online/download-details.js";

const HINT = "Show download details";

test("an in-flight foreground transfer reads as downloading", () => {
  const { phase, label } = indicatorPresentation(
    null,
    true,
    "Map / monster artwork · henesys…",
  );
  expect(phase).toBe("downloading");
  expect(label).toBe(`Downloading Map / monster artwork · henesys…. ${HINT}`);
});

test("idle with no state never claims a download", () => {
  const { phase, label } = indicatorPresentation(null, false, "Region");
  expect(phase).toBe("idle");
  expect(label).toBe(`Region. ${HINT}`);
});

test("background status selects the symbol phase", () => {
  const cases = [
    [{ status: "downloading" }, "downloading"],
    [{ status: "downloading", paused: true }, "paused"],
    [{ status: "complete" }, "complete"],
    [{ status: "failed", error: "offline" }, "failed"],
    [{ status: "cache-unavailable" }, "cache-unavailable"],
    [{ status: "storage-full" }, "storage-full"],
  ];
  for (const [state, phase] of cases) {
    expect(indicatorPresentation(state, false, "Region").phase).toBe(phase);
  }
});

test("paused and terminal states describe themselves, not a fake transfer", () => {
  expect(
    indicatorPresentation({ status: "downloading", paused: true }, false, "R")
      .label,
  ).toBe(`Downloads paused. ${HINT}`);
  expect(indicatorPresentation({ status: "complete" }, false, "R").label).toBe(
    `Downloads complete. ${HINT}`,
  );
  expect(
    indicatorPresentation({ status: "failed", error: "offline" }, false, "R")
      .label,
  ).toBe(`Downloads stopped. ${HINT}`);
  expect(
    indicatorPresentation({ status: "cache-unavailable" }, false, "R").label,
  ).toBe(`Downloads unavailable. ${HINT}`);
});

test("saved members report the transfers that actually carried them", () => {
  expect(downloadCountText({ files: 6498, downloads: 304 })).toBe(
    " (304 downloads)",
  );
  // One request per member is not worth restating.
  expect(downloadCountText({ files: 12, downloads: 12 })).toBe("");
  expect(downloadCountText({ files: 12, downloads: 13 })).toBe("");
  expect(downloadCountText({ files: 12 })).toBe("");
  expect(downloadCountText(null)).toBe("");
});
