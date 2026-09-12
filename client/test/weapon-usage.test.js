import { expect, test } from "bun:test";
import {
  compatibleAmmunition,
  createWeaponUse,
  selectAmmunition,
  selectWeaponUse,
  validateWeaponCombat,
  applyWeaponAttackSpeed,
  projectileTargetDistance,
  weaponActionDuration,
  weaponActionAnimationMs,
  weaponActionRelease,
} from "../src/combat/weapon-usage.js";

const items = {
  2060000: { info: { reqLevel: 0, incPAD: 0 } },
  2061000: { info: { reqLevel: 0, incPAD: 0 } },
  2070000: { info: { reqLevel: 10, incPAD: 15 } },
  2070016: { info: { reqLevel: 50, incPAD: 29 } },
  2330000: { info: { reqLevel: 10, incPAD: 10 } },
  2331000: { info: { reqLevel: 0, incPAD: 20 } },
};

function ammunition(id, slot, count = 1) {
  return { uid: `ammo-${slot}`, id, slot, count };
}

test("ordinary ammunition honors ascending USE slots, empty stacks, level and skill-only capsule boundaries", () => {
  const profile = {
    level: 10,
    inventory: [
      ammunition(2070000, 5),
      ammunition(2070016, 1),
      ammunition(2070000, 2, 0),
      ammunition(2070000, 3),
      ammunition(2331000, 4),
      ammunition(2330000, 6),
    ],
  };
  expect(selectAmmunition(profile, items, 1472000)?.slot).toBe(3);
  profile.level = 50;
  expect(selectAmmunition(profile, items, 1472000)?.slot).toBe(1);
  expect(selectAmmunition(profile, items, 1492000)?.slot).toBe(6);
  expect(selectAmmunition(profile, items, 1452000)).toBeNull();
  expect(compatibleAmmunition(1472063, 2060000)).toBe(true);
  expect(compatibleAmmunition(1472063, 2070000)).toBe(false);
  expect(compatibleAmmunition(1462000, 2060000)).toBe(false);
  expect(compatibleAmmunition(1462000, 2061000)).toBe(true);
});

test("projectile search seeks short bodies in widening strips on both sides without crossing range or facing", () => {
  const origin = { x: 0, y: 0, facing: 1 };
  const short = { active: true, left: 100, right: 120, top: -12, bottom: 0 };
  expect(projectileTargetDistance(short, origin, 200, 65)).toBe(85);
  const reflected = {
    active: true,
    left: -120,
    right: -100,
    top: -12,
    bottom: 0,
  };
  expect(projectileTargetDistance(reflected, origin, 200, 65)).toBe(Infinity);
  origin.facing = -1;
  expect(projectileTargetDistance(reflected, origin, 200, 65)).toBe(85);
  expect(projectileTargetDistance(reflected, origin, 100, 65)).toBe(Infinity);
  reflected.top = -150;
  reflected.bottom = -120;
  expect(projectileTargetDistance(reflected, origin, 200, 65)).toBe(Infinity);
});

test("ranged arbitration retains the actual weapon's melee row without consuming close-range or prone ammunition", () => {
  const combat = { weaponType: 49, equipment: { attack: 9 } };
  const context = {
    items,
    ammunition: ammunition(2330000, 1),
    randomWord: 0,
    crouching: false,
    closeTarget: false,
  };
  const use = createWeaponUse();
  selectWeaponUse(combat, context, use);
  expect(use.action).toBe("shot");
  expect(use.projectilePAD).toBe(10);
  context.closeTarget = true;
  selectWeaponUse(combat, context, use);
  expect(use.action).toBe("swingT1");
  expect(use.ammunition).toBeNull();
  context.closeTarget = false;
  context.crouching = true;
  selectWeaponUse(combat, context, use);
  expect(use.action).toBe("proneStab");
  expect(use.ranged).toBe(false);
  context.crouching = false;
  context.ammunition = null;
  selectWeaponUse(combat, context, use);
  expect(use.action).toBe("swingT1");
  expect(use.projectilePAD).toBe(0);
});

test("authored per-frame speed truncation preserves gun zero-delay poses and refuses missing action timing before equipment admission", () => {
  const combat = {
    schemaVersion: 2,
    weaponId: 1492000,
    weaponType: 49,
    equipment: { attack: 9, attackSpeed: 5, incPAD: 13, sfx: "gun" },
    attacks: Object.fromEntries(
      ["swingT1", "swingT2", "proneStab", "shot"].map((name) => [
        name,
        {
          rectangle: { left: -44, top: -36, right: -1, bottom: -17 },
          timing: { duration: 600, release: 240 },
        },
      ]),
    ),
  };
  const actions = Object.fromEntries(
    Object.keys(combat.attacks).map((name) => [name, [{ delay: 150 }]]),
  );
  actions.shot = [{ delay: 90 }, { delay: 120 }, { delay: 0 }];
  applyWeaponAttackSpeed(actions, combat);
  expect(actions.shot.map((frame) => frame.delay)).toEqual([84, 112, 0]);
  const actor = { frames: actions.shot, duration: 196 };
  expect(weaponActionDuration(actor, 3)).toBe(170);
  expect(weaponActionRelease(actor, 170)).toBe(170);
  expect(weaponActionAnimationMs(actor, 3, 73)).toBe(84);
  expect(weaponActionDuration(actor, 5)).toBe(196);
  applyWeaponAttackSpeed(actions, combat);
  expect(weaponActionDuration(actor, 5)).toBe(196);
  delete combat.attacks.shot;
  expect(() => validateWeaponCombat(combat)).toThrow();
});

test("claw Booster advances complete action and release clocks without changing the baseline", () => {
  // Character.wz:00002000.img/swingO1, weapon1472000 speed6; Skill4101003 x=-2.
  const actor = {
    frames: [{ delay: 300 }, { delay: 150 }, { delay: 350 }],
    duration: 800,
  };
  const duration = weaponActionDuration(actor, 4);
  expect(duration).toBe(699);
  expect(weaponActionRelease(actor, duration)).toBe(393);
  expect(weaponActionAnimationMs(actor, 4, 262)).toBe(300);
  expect(weaponActionAnimationMs(actor, 4, 393)).toBe(450);
  expect(weaponActionAnimationMs(actor, 4, 699)).toBe(800);
  expect(weaponActionDuration(actor, 6)).toBe(800);
  expect(weaponActionRelease(actor, 800)).toBe(450);
});
