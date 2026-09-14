import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadContent } from "../src/content.js";
import { OnlineWorld } from "../src/world.js";
import { disposeActorSkills } from "../src/field-skills.js";
import {
  classifyAdmission,
  evaluateSkill,
  preparePresetActor,
  skillAdmissionAudit,
  stagePresetProfile,
} from "../tools/check-skill-admission.js";

const GENERATED_ROOT = resolve(
  import.meta.dir,
  "../../client/public/generated",
);
const HAS_CATALOG = existsSync(resolve(GENERATED_ROOT, "catalog.json"));
// The packaged catalog is extraction output and absent from a bare checkout.
const packagedTest = HAS_CATALOG ? test : test.skip;

const AUDIT_TIMEOUT_MS = 120000;

/** Supported, learnable, job-appropriate combat skill that casts cleanly. */
function entry(overrides = {}) {
  return {
    id: 4201005,
    rank: 30,
    bookId: 420,
    supported: true,
    activation: "combat",
    flags: { disabled: false, timeLimited: false, invisible: false },
    reason: null,
    threw: null,
    ...overrides,
  };
}

test("a null refusal reason is the only ok outcome", () => {
  expect(classifyAdmission(entry())).toEqual({
    classification: "ok",
    refusalClass: null,
  });
});

test("a missing attack rectangle is a mechanical gap, not a by-design refusal", () => {
  // Savage Blow 4201005 lost its dagger rectangle here; this is the reported class.
  expect(
    classifyAdmission(
      entry({ reason: "Original skill attack rectangle is unavailable" }),
    ),
  ).toEqual({ classification: "gap", refusalClass: "attack-geometry" });
  expect(
    classifyAdmission(
      entry({ reason: "Original skill actor action/timing is unavailable" }),
    ),
  ).toEqual({ classification: "gap", refusalClass: "actor-timing" });
  expect(
    classifyAdmission(entry({ reason: "Actor lacks original action savage" })),
  ).toEqual({ classification: "gap", refusalClass: "actor-action" });
});

test("unmet requirements stay gaps for a supported, learned job skill", () => {
  expect(
    classifyAdmission(entry({ reason: "Requires skill 4201003 rank 5" })),
  ).toEqual({ classification: "gap", refusalClass: "prerequisite" });
  expect(
    classifyAdmission(entry({ reason: "Character level requirement not met" })),
  ).toEqual({ classification: "gap", refusalClass: "character-level" });
  expect(
    classifyAdmission(
      entry({ rank: 0, reason: "Skill has no learned rank in this job" }),
    ),
  ).toEqual({ classification: "gap", refusalClass: "unlearnable-rank" });
});

test("catalog and authority limits are by-design, never gaps", () => {
  expect(
    classifyAdmission(
      entry({
        supported: false,
        reason: "Disabled by the original skill record",
      }),
    ),
  ).toEqual({
    classification: "by-design",
    refusalClass: "catalog-unsupported",
  });
  expect(
    classifyAdmission(
      entry({
        reason: "Passive skill has no active cast",
        activation: "passive",
      }),
    ),
  ).toEqual({ classification: "by-design", refusalClass: "passive" });
  expect(
    classifyAdmission(entry({ flags: { disabled: true }, reason: "x" })),
  ).toEqual({ classification: "by-design", refusalClass: "disabled" });
  expect(
    classifyAdmission(
      entry({ bookId: 910, reason: "Guild skill authority is absent" }),
    ),
  ).toEqual({ classification: "by-design", refusalClass: "gm-book" });
});

test("situational and weapon refusals are by-design; unknown refusals fail closed", () => {
  expect(
    classifyAdmission(
      entry({ reason: "Skill requires its original weapon family" }),
    ),
  ).toEqual({
    classification: "by-design",
    refusalClass: "weapon-restriction",
  });
  expect(
    classifyAdmission(
      entry({ reason: "This skill requires a grounded placement" }),
    ),
  ).toEqual({ classification: "by-design", refusalClass: "map-placement" });
  expect(
    classifyAdmission(entry({ reason: "A brand new unclassified refusal" })),
  ).toEqual({ classification: "gap", refusalClass: "unclassified" });
  expect(classifyAdmission(entry({ threw: "boom" }))).toEqual({
    classification: "gap",
    refusalClass: "throws",
  });
});

packagedTest(
  "job 420 admits Savage Blow and a lost rectangle is detected end to end",
  async () => {
    const content = await loadContent({ root: GENERATED_ROOT });
    const world = new OnlineWorld({ content, database: {}, publish() {} });
    const field = await world.fieldFor(100000000);
    const { profile } = stagePresetProfile(
      content.catalog.ui,
      420,
      field.manifest.id,
    );
    const actor = await preparePresetActor({
      world,
      field,
      profile,
      job: 420,
    });
    try {
      const system = actor.skills;
      const skill = system.catalog[4201005];
      expect(system.level(4201005)).toBe(skill.maxLevel);
      const weapon = { type: actor.combat.weaponType };
      expect(evaluateSkill(system, skill, weapon).classification).toBe("ok");
      // Remove the prepared geometry exactly as the pre-fix production path left it.
      actor.skillField.skillCombat.prepared.get(4201005).rectangle = undefined;
      const broken = evaluateSkill(system, skill, weapon);
      expect(broken.reason).toBe(
        "Original skill attack rectangle is unavailable",
      );
      expect(broken.classification).toBe("gap");
      expect(broken.refusalClass).toBe("attack-geometry");
    } finally {
      disposeActorSkills(actor, true);
    }
  },
  AUDIT_TIMEOUT_MS,
);

packagedTest(
  "every packaged preset job skill is admitted or explicitly by-design",
  async () => {
    const content = await loadContent({ root: GENERATED_ROOT });
    const report = await skillAdmissionAudit({ content });
    expect(report.unevaluated).toEqual([]);
    expect(report.counts.throws).toBe(0);
    expect(report.gaps).toEqual([]);
    expect(report.skillsEvaluated).toBeGreaterThan(2000);
  },
  AUDIT_TIMEOUT_MS,
);
