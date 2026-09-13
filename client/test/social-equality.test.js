import { expect, test } from "bun:test";
import { socialEqual } from "../src/profile/social-equality.js";
import { SocialContext } from "../src/social/local-social-context.js";
import { validateSocialCommit } from "../src/profile/profile-social-transaction.js";
import { createProfile } from "../src/profile/profile-validation.js";

test("JSONB object order does not break mirrored group admission or commit", () => {
  const first = createProfile({
      mapId: "000050000",
      x: 167,
      y: 335,
      facing: 1,
    }),
    second = createProfile({ mapId: "000050000", x: 167, y: 335, facing: 1 });
  const group = { id: "party", leaderId: "one", members: ["one", "two"] };
  first.social.party = group;
  second.social.party = {
    members: ["one", "two"],
    leaderId: "one",
    id: "party",
  };
  const context = new SocialContext(
    new Map([
      ["one", first],
      ["two", second],
    ]),
    "one",
    {},
    0,
  );
  expect(context.group("party")).toEqual(group);
  const originals = [structuredClone(first), structuredClone(second)];
  originals[0].social.party = null;
  originals[1].social.party = null;
  expect(() =>
    validateSocialCommit(["one", "two"], originals, [first, second]),
  ).not.toThrow();
  second.social.party.leaderId = "two";
  expect(() => context.group("party")).toThrow("participants disagree");
  expect(() =>
    validateSocialCommit(["one", "two"], originals, [first, second]),
  ).toThrow();
});

test("social comparison retains nested values and ordered member/message arrays", () => {
  expect(
    socialEqual(
      { a: { x: 1, y: 2 }, b: [1, 2] },
      { b: [1, 2], a: { y: 2, x: 1 } },
    ),
  ).toBe(true);
  expect(socialEqual({ members: [1, 2] }, { members: [2, 1] })).toBe(false);
  expect(socialEqual({ name: "A" }, { name: "B" })).toBe(false);
  expect(socialEqual(null, {})).toBe(false);
});
