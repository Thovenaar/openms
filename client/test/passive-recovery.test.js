import { test, expect } from "bun:test";
import { PassiveRecovery } from "../src/character/passive-recovery.js";

test("moving resets HP recovery without resetting MP; full and dead reset independently", () => {
  const sim = { x: 0, y: 0 };
  const profile = { job: 0, level: 1, hp: 20, maxHP: 100, mp: 0, maxMP: 100 };
  const recovery = new PassiveRecovery(sim, { profile }, {}, {});
  for (let tick = 0; tick < 333; tick++) recovery.step(30, "stand1");
  expect(profile.hp).toBe(20);
  expect(profile.mp).toBe(0);
  sim.x = 1;
  recovery.step(30, "walk1");
  expect(profile.hp).toBe(20);
  expect(profile.mp).toBe(3);
  for (let tick = 0; tick < 333; tick++) recovery.step(30, "stand1");
  expect(profile.hp).toBe(20);
  recovery.step(30, "stand1");
  expect(profile.hp).toBe(30);
  expect(profile.mp).toBe(6);
  profile.hp = profile.maxHP;
  recovery.step(30, "stand1");
  profile.hp = 0;
  recovery.step(30, "dead");
  profile.hp = 20;
  for (let tick = 0; tick < 333; tick++) recovery.step(30, "stand1");
  expect(profile.hp).toBe(20);
  expect(profile.mp).toBe(6);
  recovery.step(30, "stand1");
  expect(profile.hp).toBe(30);
  expect(profile.mp).toBe(9);
});

test("job never grants recovery ranks; learned Endure admits only stationary climb", () => {
  const sim = { x: 0, y: 0 };
  const profile = {
    job: 110,
    level: 30,
    hp: 10,
    maxHP: 100,
    mp: 0,
    maxMP: 100,
  };
  let learned = false;
  const hooks = {
    skillLevel(id) {
      return learned && (id === 1000000 || id === 1000002) ? 1 : 0;
    },
    skillInfo(id) {
      return id === 1000000 ? { hp: 5 } : { time: 5 };
    },
  };
  const recovery = new PassiveRecovery(sim, { profile }, hooks, {
    recovery: 1.5,
  });
  for (let tick = 0; tick < 167; tick++) recovery.step(30, "stand1");
  expect(profile.hp).toBe(10);
  sim.y = 1;
  recovery.step(30, "ladder");
  learned = true;
  for (let tick = 0; tick < 166; tick++) recovery.step(30, "ladder");
  expect(profile.hp).toBe(10);
  recovery.step(30, "ladder");
  expect(profile.hp).toBe(32);
});
