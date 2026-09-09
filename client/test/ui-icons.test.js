import { expect, test } from "bun:test";
import { replaceIcons } from "../src/ui-icons.js";

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
