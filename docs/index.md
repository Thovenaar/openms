# Maple Mono documentation

Maple Mono reconstructs an original-asset browser client with plain JavaScript, JSDoc, Bun, and PixiJS. These pages distinguish recovered original behavior, provisional local offline authority, measured browser results, and remaining fidelity gaps. Start with the [project setup](README.md); the existing technical pages remain authoritative.

## Explore

- **Setup:** [run the project](README.md), identify the [original inputs](inputs.md), and follow the [coding style](coding-style.md).
- **Architecture:** [subsystem interfaces](reconstruction-contract.md), [scene and inspection APIs](scene-contract.md), and [offline integration](offline-integration-contract.md).
- **Asset decoding and streaming:** [decoder evidence](asset-evidence.md), [inventory coverage](ingame-inventory.md), [release delivery](asset-delivery.md), and [progressive streaming](streaming.md).
- **Physics:** [recovered motion](physics-evidence.md), [options](physics-options.md), [refinements](physics-refinements.md), [geometry](hitboxes.md), and [avatar actions](avatar-actions.md).
- **UI:** [in-game controls and windows](ingame-ui.md) and [audio/effects](ingame-audiovisual.md).
- **Offline gameplay:** [current gameplay and acceptance](offline-gameplay.md), with combat, quests, saves, portals, life, and reactors in the sidebar.
- **Reverse-engineering evidence:** [original client/rendering findings](client-evidence.md) and [missing Windows reference captures](windows-reference-captures.md).
- **Browser validation:** [reproduction method](validation-method.md), [integrated results](ingame-validation/results.md), [physics results](physics-validation/results.md), and the [rendering baseline](validation.md).

## Evidence and scope

Raw reports, source references, captures, and archives stay in their original repository locations. On this site, links to those files and directories open the exact GitHub repository path; Markdown pages stay within the site. No original Windows execution, missing server behavior, or unmeasured fidelity is implied by a documentation build.

## Run this site

From the repository root:

```sh
bun install
bun run docs:dev
```

For a production build and local inspection, run `bun run docs:build`, then `bun run docs:preview`. The site is rooted in `docs/`; generated output and cache live under `docs/.vitepress/`.
