import { expect, test } from "bun:test";
import { ContentService, validateDefinition } from "../src/index.js";
import { compileDialogue } from "../src/compile-dialogue.js";
import { validateRuntimeContent } from "../../server/src/content-authoring.js";
import {
  dialogueDefinition,
  draftRow,
  mobInput,
  originalFixture,
} from "./fixtures.js";

const npc = { source: "original", kind: "npc", id: 1012108 };

function withNodes(nodes, patch = {}) {
  return dialogueDefinition(npc, { nodes, ...patch });
}

test("dialogue definitions require dense node ids and resolvable option targets", () => {
  const definition = dialogueDefinition();
  expect(validateDefinition("dialogue", definition)).toEqual(definition);
  expect(() => validateDefinition("dialogue", withNodes([]))).toThrow(
    "has no nodes",
  );
  expect(() =>
    validateDefinition(
      "dialogue",
      withNodes([
        { id: 0, text: "First.", options: [] },
        { id: 0, text: "Second.", options: [] },
      ]),
    ),
  ).toThrow("dense and ordered");
  expect(() =>
    validateDefinition(
      "dialogue",
      withNodes([
        { id: 0, text: "First.", options: [{ label: "Next.", next: 2 }] },
        { id: 1, text: "Second.", options: [] },
      ]),
    ),
  ).toThrow("Integer outside allowed range");
  expect(() =>
    validateDefinition(
      "dialogue",
      withNodes([
        {
          id: 0,
          text: "First.",
          options: [{ label: "Nowhere.", next: null, effect: "warp" }],
        },
      ]),
    ),
  ).toThrow("Unknown field");
  expect(() =>
    validateDefinition("dialogue", { ...definition, start: 2 }),
  ).toThrow("Integer outside allowed range");
  expect(() =>
    validateDefinition(
      "dialogue",
      withNodes([
        { id: 0, text: "First.", options: [{ label: "Next.", next: "1" }] },
        { id: 1, text: "Second.", options: [] },
      ]),
    ),
  ).toThrow("Integer outside allowed range");
});

test("dialogue definitions keep plain text", () => {
  expect(() =>
    validateDefinition(
      "dialogue",
      withNodes([{ id: 0, text: "#bMarkup#k", options: [] }]),
    ),
  ).toThrow("markup is not an authoring operation");
  expect(() =>
    validateDefinition(
      "dialogue",
      withNodes([
        { id: 0, text: "Plain.", options: [{ label: "#L0#go", next: null }] },
      ]),
    ),
  ).toThrow("markup is not an authoring operation");
  expect(() =>
    validateDefinition(
      "dialogue",
      withNodes([{ id: 0, text: "", options: [] }]),
    ),
  ).toThrow("Invalid text length");
  expect(() =>
    validateDefinition(
      "dialogue",
      withNodes([{ id: 0, text: "x".repeat(513), options: [] }]),
    ),
  ).toThrow("Invalid text length");
});

test("dialogue definitions bound nodes, options and required fields", () => {
  expect(() =>
    validateDefinition(
      "dialogue",
      withNodes([
        {
          id: 0,
          text: "Plain.",
          options: Array.from({ length: 7 }, () => ({
            label: "go",
            next: null,
          })),
        },
      ]),
    ),
  ).toThrow("Array exceeds limit");
  expect(() =>
    validateDefinition(
      "dialogue",
      withNodes(
        Array.from({ length: 17 }, (_, id) => ({
          id,
          text: "Line.",
          options: [],
        })),
      ),
    ),
  ).toThrow("Array exceeds limit");
  expect(() =>
    validateDefinition("dialogue", withNodes([{ id: 0, text: "Plain." }])),
  ).toThrow("Missing required field");
  expect(() =>
    validateDefinition("dialogue", {
      ...dialogueDefinition(),
      target: { ...npc, source: "custom" },
    }),
  ).toThrow("Unsupported value");
  expect(() =>
    validateDefinition("dialogue", {
      ...dialogueDefinition(),
      target: { ...npc, id: 0 },
    }),
  ).toThrow("Integer outside allowed range");
});

test("dialogue compilation binds one admitted original NPC", async () => {
  const { registry } = await originalFixture();
  const definition = dialogueDefinition();
  const runtime = compileDialogue(
    draftRow(
      mobInput(registry.buildId, {
        id: "guide",
        kind: "dialogue",
        definition,
      }),
    ),
    registry,
  );
  expect(runtime).toEqual({
    kind: "dialogue",
    npcId: 1012108,
    start: 0,
    nodes: definition.nodes,
  });
  expect(() =>
    compileDialogue(
      draftRow(
        mobInput(registry.buildId, {
          id: "guide",
          kind: "dialogue",
          definition: dialogueDefinition({ ...npc, id: 999999999 }),
        }),
      ),
      registry,
    ),
  ).toThrow("unavailable in this build");
});

test("content service publishes an authored conversation without dependencies", async () => {
  const { original } = await originalFixture();
  const service = new ContentService({
    store: { build: async () => original.catalog },
    readJson: original.json.bind(original),
    validateRuntime: validateRuntimeContent,
    inspectImage: async () => ({
      width: 1,
      height: 1,
      pixels: new Uint8Array(4),
    }),
  });
  const runtime = await service.compile(
    "author",
    draftRow(
      mobInput(original.assetBuildId, {
        id: "guide",
        kind: "dialogue",
        definition: dialogueDefinition(),
      }),
      800000123,
    ),
  );
  expect(runtime.kind).toBe("dialogue");
  expect(runtime.schemaVersion).toBe(1);
  expect(runtime.identity).toMatchObject({
    id: "guide",
    revision: 1,
    runtimeId: 800000123,
  });
  expect(runtime.dependencies).toEqual([]);
  expect(runtime.nodes.map((node) => node.id)).toEqual([0, 1]);
});
