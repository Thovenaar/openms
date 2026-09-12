import { expect, test } from "bun:test";
import { speechLineEnd } from "../src/rendering/speech-bubbles.js";

const advances = new Uint16Array(95).fill(10);

test("ordinary word fitting keeps native punctuation at the overflowing boundary", () => {
  // Canvas.dll 50005430..500054a9 can include one overflowing glyph and its following punctuation.
  const text = "a bcd,ef";
  const end = speechLineEnd(text, 0, 40, advances);
  expect(text.slice(0, end)).toBe("a bcd,");
  expect(text.slice(end, speechLineEnd(text, end, 40, advances))).toBe("ef");
});

test("word fitting backs up at spaces but hard-splits an unbroken long word", () => {
  const words = "a bcdef";
  const end = speechLineEnd(words, 0, 40, advances);
  expect(words.slice(0, end)).toBe("a ");
  expect(words.slice(end, speechLineEnd(words, end, 40, advances))).toBe(
    "bcde",
  );
  // Without a prior word boundary, the final overflowing glyph is not retained.
  expect(speechLineEnd("WWWWW", 0, 40, advances)).toBe(4);
});
