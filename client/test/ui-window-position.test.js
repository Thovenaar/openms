import { expect, test } from "bun:test";
import { GameUI } from "../src/ui/game-ui.js";

function windowUi() {
  const ui = Object.create(GameUI.prototype);
  Object.assign(ui, {
    windows: new Map(),
    windowPositions: new Map(),
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    viewportWidth: 800,
    viewportHeight: 600,
  });
  return ui;
}

function panel(name, width = 200, height = 300) {
  return {
    name,
    width,
    height,
    x: 0,
    y: 0,
    layers: [],
    dragStrip: {},
    position(x, y) {
      this.x = x;
      this.y = y;
    },
  };
}

test("reconstructed windows retain independent positions and clamp at their current size", () => {
  const ui = windowUi();
  ui.positionWindow(panel("Item"), 510, 260);
  ui.positionWindow(panel("Stat"), 35, 80);
  const inventory = panel("Item", 300, 350);
  const stats = panel("Stat");
  ui.placeNewWindow(inventory);
  ui.placeNewWindow(stats);
  expect([inventory.x, inventory.y]).toEqual([500, 250]);
  expect([stats.x, stats.y]).toEqual([35, 80]);
  ui.viewportWidth = 400;
  ui.viewportHeight = 400;
  ui.positionWindow(inventory, inventory.x, inventory.y);
  expect([inventory.x, inventory.y]).toEqual([100, 50]);
  const reopened = panel("Item", 300, 350);
  ui.placeNewWindow(reopened);
  expect([reopened.x, reopened.y]).toEqual([100, 50]);
});

test("attached macro movement remembers its parent rather than creating an independent anchor", () => {
  const ui = windowUi();
  const skill = panel("Skill");
  const macro = panel("SkillMacro", 100, 100);
  ui.windows.set("Skill", skill);
  ui.windows.set("SkillMacro", macro);
  ui.positionWindow(macro, 450, 120);
  expect([skill.x, skill.y, macro.x, macro.y]).toEqual([250, 120, 450, 120]);
  ui.windows.clear();
  const reopened = panel("Skill");
  ui.placeNewWindow(reopened);
  expect([reopened.x, reopened.y]).toEqual([250, 120]);
  expect(ui.windowPositions.has("SkillMacro")).toBe(false);
});

test("invitations stay aligned with the centered HUD rather than the wide viewport edge", () => {
  const ui = windowUi();
  ui.viewportWidth = 1440;
  ui.viewportHeight = 900;
  ui.offsetX = 320;
  ui.offsetY = 300;
  ui.bounds = { right: 1120, bottom: 600 };
  const trade = panel("TradeInvitation", 208, 37);
  const social = panel("SocialInvitation", 208, 37);
  ui.placeNewWindow(trade);
  ui.placeNewWindow(social);
  const hudRight = ui.offsetX + 800 * ui.scale;
  const invitationRight = ui.offsetX + (trade.x + trade.width) * ui.scale;
  expect(invitationRight).toBe(hudRight - 6 * ui.scale);
  expect(social.x).toBe(trade.x);
  expect(social.y).toBe(508);
  expect(trade.y).toBe(social.y);
  expect(ui.offsetY + social.y * ui.scale).toBe(808);
  ui.scale = 0.5;
  ui.offsetY = 0;
  ui.placeNewWindow(social);
  expect(ui.offsetY + social.y * ui.scale).toBe(254);
  ui.scale = 1;
  ui.offsetY = 300;
  ui.positionWindow(trade, 140, 90);
  const reopened = panel("TradeInvitation", 208, 37);
  ui.placeNewWindow(reopened);
  expect([reopened.x, reopened.y]).toEqual([140, 90]);
});

test("revival and compact modals reopen at their dragged position after window retirement", () => {
  const ui = windowUi();
  const revival = panel("Revive", 286, 146);
  ui.placeNewWindow(revival);
  expect([revival.x, revival.y]).toEqual([257, 227]);
  ui.positionWindow(revival, 420, 320);
  ui.positionWindow(panel("NativePrompt", 266, 116), 35, 90);
  ui.windows.clear();
  const nextRevival = panel("Revive", 286, 146);
  const nextPrompt = panel("NativePrompt", 266, 136);
  ui.placeNewWindow(nextRevival);
  ui.placeNewWindow(nextPrompt);
  expect([nextRevival.x, nextRevival.y]).toEqual([420, 320]);
  expect([nextPrompt.x, nextPrompt.y]).toEqual([35, 90]);
});

test("an oversized window cannot restore its title above the desktop viewport", () => {
  const ui = windowUi();
  const journal = panel("Quest", 245, 900);
  ui.positionWindow(journal, -300, -200);
  expect(journal.x >= 0 && journal.y >= 0).toBe(true);
  const reopened = panel("Quest", 245, 900);
  ui.placeNewWindow(reopened);
  expect(reopened.x >= 0 && reopened.y >= 0).toBe(true);
});
