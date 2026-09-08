# Original in-game inventory

## Authority and priority

Only the supplied `/Users/k/Development/tensorfish/Maplestory-Client` installation is an implementation source. [Input identities](input-manifest.json), [consumer evidence](client-evidence.md), and the domain pages below distinguish original bytes/instructions from browser policy. No third-party client, original C/C++ source, Windows execution, gameplay capture, audio recording, or server session was supplied. Decompiled C is analysis output, not original source.

| Priority                | Original input and consumer evidence                                                                                                          | Delivered behavior                                                                                                                                       | Remaining authority boundary                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-game interface       | UI.wz, String.wz, selected Character info; HUD `008d01b2`, inventory `0081c6c9`, key configuration `00832a43` and related instructions        | Original skins/control states, recovered local coordinates, bounded windows, tabs, menus, current-map minimap canvas, static equipment requirements      | Live gauges, inventory/equipment instances, skills, scripts, full original text/layout/focus/keyboard mapping, commerce/community/event operations |
| Portals                 | Selected Map life-independent portal records, MapHelper game artwork; `00712313`, `00712d35`, `0071332c`, Up dispatch `0094c856` → `0094df9b` | pv loop, ph Start/Continue/Exit, original rectangle geometry, native Up, exact named packaged destinations                                               | Server authorization/scripts, automatic/impact types, original same-map motion, global pending-clock lifetime                                      |
| NPC/mob presentation    | Map life metadata, Npc.wz, Mob.wz, String.wz; NPC `006dce02`, omitted delay `0040de3a`, names `006d5c9a`, mob geometry `00664559`             | Original placement/action artwork, names, hide flags and explicitly labeled interaction/body/contact previews                                            | Map preload data is not live spawn/controller state; no invented AI, damage, dialogue, drops or respawn                                            |
| Sound and effects       | Sound.wz, Effect.wz, map bgm/effect; BGM `0064211e`, dispatch `00989588`/`009899b1`, Sound_DX8 `5180c8a7`                                     | Exact MP3 publication, native BGM/SE playback, separate volume/mute, selected accepted cues, original-frame effect previews and actual graph PCM capture | Original mixer/device parity, 600-argument transition interpolation, settings-slider mapping, server effects and automatic Aquarium emission       |
| Delivery and acceptance | Existing package-v2 scene/physics and shared atlas/network paths                                                                              | Demand-driven world regions, independent UI/effect bundles, separately bounded PCM, native-input browser evidence                                        | Browser budgets/camera/focus/preview scheduling are engineering policies; extracted-pixel comparisons are not original-runtime parity              |

Full domain ledgers and exact limitations: [UI](ingame-ui.md), [portals](ingame-portals.md), [life](ingame-life.md), [audio/effects](ingame-audiovisual.md). Their `ghidra-ingame-*` directories retain address-bearing decompilation and instruction output.

## Inventory coverage, not decode or runtime coverage

[`ingame-inventory/index.json`](ingame-inventory/index.json) is the executed metadata traversal. Each archive index records original IMG identities, SHA-256, counts and retained roots. Compressed JSON members retain original paths, scalar types/values, vectors, UOL references, canvas dimensions and sound-envelope metadata. They do not copy encoded artwork/audio payloads.

| Archive   | IMG visited | Nodes visited | Canvas nodes | Sound nodes |
| --------- | ----------: | ------------: | -----------: | ----------: |
| UI        |          19 |        33,037 |       10,839 |           0 |
| Map       |          11 |        45,379 |        1,818 |           1 |
| Mob       |       1,568 |       329,100 |       50,787 |           0 |
| Npc       |       1,620 |        76,352 |       15,453 |           0 |
| Sound     |          44 |        10,745 |            0 |       3,956 |
| Effect    |          17 |        27,092 |        5,114 |          23 |
| String    |          20 |        97,771 |            0 |           0 |
| Etc       |          22 |       110,107 |           10 |           0 |
| Item      |         155 |       147,961 |       16,843 |           0 |
| Skill     |          76 |       124,484 |       15,738 |           0 |
| Character |       7,201 |     3,432,840 |      391,184 |           0 |

Map coverage is the eight selected acceptance maps plus MapHelper, Effect and Physics; **5,591 other Map IMG files are explicitly omitted**. Character traversal visits every selected tree but retains only roots/info metadata (**115,532 retained nodes**), not all animation subtrees. Other listed archives retain every visited metadata node. These counts do not establish successful pixel/audio decode, live spawn availability, supported mechanics or original-reference parity.

The UI inventory contains **110 UIWindow top-level branches**; [the full branch ledger](ingame-ui.md#complete-remaining-uiwindow-branch-ledger) classifies unsupported families instead of treating the packaged subset as all original UI.

## Packaged acceptance selection

The eight maps are `100000000`, `100000001`, `103040000`, `108000500`, `120000000`, `200090500`, `211040000`, and `230000000`.

- Portals: **131 records**, including 18 pv and eight ph visual entities; all 105 nonvisual records remain explicit metadata. The original connected pair is Henesys `in02` ↔ Maya's House `out02`.
- Life: **112 authored placements**, 63 NPC and 49 mob, covering 53 NPC and three mob templates. These are metadata previews, not server spawns.
- Audio: eight map bindings, **seven distinct BGM tracks**, all 31 UI and 27 Game sound nodes; **65 nodes / 61 distinct encoded hashes** including BGM.
- Effects: **14 selected original bundles**. Every activation is a labeled local preview unless independently tied to a recovered accepted event; automatic map emitters are not invented.
- UI: HUD/Basic at startup; supported windows, tooltips, static equipment information and current-map minimap assets on demand. Unpackaged branches remain available in the inventory, not falsely operational.

[`extraction.json`](extraction.json) records actual shared lossless packaging, input hashes, byte comparisons and current build identity. Domain extraction probes describe their own isolated decode coverage; those are not measurements of live resident GPU or PCM memory.

## Reproduction and lookup

```sh
bun client/tools/ingame-inventory.js
bun client/tools/ingame-inventory.js /path/to/original/client /path/to/output
```

The first form uses the supplied installation path and `docs/ingame-inventory`. The inventory does not alter original inputs. Use the per-archive JSON index to locate a root, then read a compressed member:

- `UI.tar.gz:UIWindow.img/Item.json`
- `Map.tar.gz:MapHelper.img/portal.json`
- `Map.tar.gz:Map/Map1/100000000.img/life.json`
- `Sound.tar.gz:Bgm00.img/FloralLife.json`

A missing property remains missing; a familiar branch name does not supply a default or activation rule. Resolve consumers in the original executable before implementing behavior.

## Acceptance and missing references

[Integrated evidence](ingame-validation/) records native-input play, screenshots, runtime lifecycle checks and actual graph audio. [Validation method](validation-method.md) separates full in-game UI acceptance from the world-only extracted-art oracle. Dedicated browser processes prevent sibling tab visibility from pausing scenarios; parallel playtest timing is not used for performance claims.

[Windows reference requests](windows-reference-captures.md) specify version-hashed captures, resolutions, character/server state, input timestamps and synchronized lossless audio needed to close the remaining fidelity boundaries. Until those inputs exist, original-client visual/audio parity and a complete game reconstruction remain unverified.
