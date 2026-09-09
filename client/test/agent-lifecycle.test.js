import { expect, test } from "bun:test";
import { GameUI } from "../src/game-ui.js";

test("a cancelled old reset cannot replace a restored human dialog or enable its pending reset", async () => {
  const reload = Promise.withResolvers();
  const view = {
    modal: "human dialog",
    focused: "human input",
    resetDisabled: true,
  };
  const ui = {
    store: { async reset() {} },
    epoch: 1,
    saving: false,
    resetting: false,
    controller: new AbortController(),
    ownsProfile: GameUI.prototype.ownsProfile,
    refreshProfile() {
      view.resetDisabled = this.resetting;
    },
    report() {},
    notice() {
      view.modal = "obsolete reset error";
    },
    closeAll() {
      view.modal = null;
    },
    hooks: {
      onReset: () => reload.promise,
      focusGame() {
        view.focused = "canvas";
      },
    },
  };
  const pending = GameUI.prototype.resetProfile.call(ui);
  await Promise.resolve();
  ui.store = {};
  ui.epoch++;
  // A newer human operation now owns the restored UI.
  ui.resetting = true;
  reload.reject(new Error("Temporary field load cancelled"));
  await pending;
  expect(view).toEqual({
    modal: "human dialog",
    focused: "human input",
    resetDisabled: true,
  });
});
