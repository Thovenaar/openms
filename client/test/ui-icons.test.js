import { expect, test } from "bun:test";
import { replaceIcons } from "../src/ui-icons.js";
import { skillTooltip } from "../src/ui-tooltip.js";

// Network failure fixture; visibility and ownership are the renderer/DOM contract.
function layer() {
  return {
    owner: { bindingDrag: null },
    root: { visible: true },
    element: { hidden: false },
    disposed: false,
    destroy() {
      this.disposed = true;
      this.root.visible = false;
      this.element.hidden = true;
    },
  };
}

test("failed icon refresh retains the complete visible owner until a successful replacement", async () => {
  const previous = layer();
  const failures = [];
  const panel = {
    name: "Item",
    iconLayer: previous,
    cleanups: [],
    owner: {
      controller: new AbortController(),
      services: {
        network: {
          async json() {
            throw new Error("fixture descriptor unavailable");
          },
        },
      },
      report(error) {
        failures.push(error.message);
      },
    },
    layer,
  };
  await replaceIcons(panel, [{ template: { descriptor: {} } }], () => {});
  expect(failures).toEqual(["fixture descriptor unavailable"]);
  expect(previous.root.visible).toBe(true);
  expect(previous.element.hidden).toBe(false);
  expect(previous.disposed).toBe(false);
  await replaceIcons(panel, [], () => {});
  expect(previous.disposed).toBe(true);
  expect(panel.iconLayer.root.visible).toBe(true);
  expect(panel.iconLayer.element.hidden).toBe(false);
  panel.iconLayer.destroy();
  panel.owner.controller.abort();
});

test("skill tooltips use the live ID-keyed rank and authored current/next descriptions", () => {
  const template = {
    id: 1000,
    name: "Fixture skill",
    maxLevel: 3,
    strings: {
      h1: "First rank effect",
      h2: "Second rank effect",
      h3: "Third rank effect",
    },
    levels: { 1: { mpCon: 3 }, 2: { mpCon: 5 }, 3: { mpCon: 7 } },
    classification: { supported: true },
  };
  const owner = { store: { profile: { skills: {} } } };
  const descriptions = () =>
    skillTooltip(owner, template).lines.map((entry) => entry.text);
  expect(descriptions()).toContain(template.strings.h1);
  expect(descriptions()).not.toContain(template.strings.h2);
  owner.store.profile.skills[1000] = {
    level: 2,
    masterLevel: 0,
    expiresAt: null,
  };
  expect(descriptions()).toContain(template.strings.h2);
  expect(descriptions()).toContain(template.strings.h3);
  expect(descriptions()).not.toContain(template.strings.h1);
  owner.store.profile.skills[1000].level = 3;
  expect(descriptions()).toContain(template.strings.h3);
  expect(descriptions()).not.toContain(template.strings.h2);
});
