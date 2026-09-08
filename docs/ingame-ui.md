# In-game UI reconstruction

## Provenance and fidelity boundary

Implementation inputs are only the original `/Users/k/Development/tensorfish/Maplestory-Client` archives/executable, the lossless inventories in `docs/ingame-inventory`, and fresh decompilation of the isolated `/tmp/maple-ingame-ui.gpr` project. No third-party client, original C/C++ source, server, Windows execution, or original runtime recording was available.

This is original-artwork UI presentation with selected recovered coordinate rules, not an assertion of original runtime parity. It never supplies invented HP, MP, EXP, level, job, AP, SP, inventory contents, mesos, equipment-instance statistics, NPC speech or quest state. Resource availability is not evidence that a server operation can be performed. Unavailable operations either render disabled original states or open an explicitly worded unavailable-server inspection.

`UI.json` currently enumerates **19 IMG entries and 110 UIWindow top-level branches**. The earlier research report's prose said 108 branches; the retained machine-readable list actually contains 110. `UI.tar.gz` preserves every inventoried node, not merely the packaged subset. The exact original IMG hashes remain in that index; `context.image` also records input hashes during normal extraction.

## Implemented modules and integration

- `client/tools/ui-data.js`: `extractGameUI(context)`. Requires the shared extraction context and its bounded, selected `mapIds` array. Uses the existing WZ parser, `at`/`resolveNode`/`value`, original `part`, and the shared `bundle` packer. There is no UI-specific pixel decoder or network/atlas implementation.
- `client/src/game-ui.js`: `new GameUI(app, services, hooks)`, `prepare(index, signal)`, `setScene(scene)`, `update(ms)`, `resize(width, height)`, `snapshot()`, `destroy()`.
- `client/src/ui-surface.js`: bounded original-raster rendering, authored state selection, accessible DOM hit planes, borrowed-resource ownership, and explicit authored-delay animation.
- `client/src/ui-layout.js`: HUD, window, tab, menu, key-config, minimap and dialog composition.
- `client/src/ui-inspection.js`: original minimap canvas replacement, static reconstruction equipment inspection and original requirement glyph rendering.

`hooks` is `{clearInput, focusGame, onError, playSound}`. Sounds are requested only as `playSound("UI", "BtMouseOver")` and `playSound("UI", "BtMouseClick")` for actual control events. The audio owner retains its user-gesture and mute policies. There are no speculative sound names.

Additional public methods:

- `showNpc({id, templateId, name, functionName, authority})`: opens original `UtilDlgEx` chrome with an explicit server-unavailable inspection. It does not select a String.wz NPC line, start or advance a script, grant a quest, or simulate a server reply.
- `setVisible(boolean)`: inspection-only world-compositing gate; hides Pixi and DOM UI and disables input capture without discarding window state. Restoration preserves open windows. Use it only for isolated world-oracle captures; real UI acceptance keeps the UI visible.
- `open(name)` / `close(name)`: asynchronous window demand and local close. Supported names are Item, Equip, Stat, Skill, GameMenu, ShortCut, KeyConfig, MiniMap, UtilDlgEx, GameOpt, SysOpt, EquipmentPreview and ToolTip. The normal UI invokes these via pointer/keyboard, rather than requiring inspection calls.

The UI root belongs to `app.stage` above the world, never `scene.container`. Its owned DOM overlay is attached alongside the canvas. Original-UI local CSS is scoped under `.maple-ui-root` and removed by destruction. Browser audio/effect/life inspection controls instead flow inside the existing scrollable sidebar; they never overlay the WebGL viewport.

Native controls stay attached during pointerdown; bounded DOM z-indices follow the Pixi window order. Lower DOM captions/controls are clipped against the higher windows' rectangular envelopes, including alternate-skin extents, so they cannot bleed above higher raster artwork. Rectangle subtraction handles overlapping occluders rather than an XOR mask. The bounded four-window geometry is refreshed on stack, drag, resize and detail changes, not in the animation loop. This is explicit **browser window-occlusion policy**, not recovered original alpha-hit or global focus arbitration.

Equipment inspection backplates are browser-owned Pixi graphics below the original icon/requirement rasters. An opaque DOM backplate would cover those rasters. Static ToolTip inspection uses the existing browser help palette so the original white `Can` labels/digits remain readable; neither its plate nor its template-only values are claimed as an original live item tooltip. Lower windows reappear after native close. Alternate-skin notices hide with their corresponding skin.

## Catalog and visual bundle schema

`catalog.ui` is JSON-compatible:

```js
{
  schemaVersion: 1,
  bundles: { StatusBar: descriptor, Basic: descriptor, /* named windows */ },
  minimaps: {
    "100000000": { available: true, descriptor },
    // or { available: false, reason } when the original map has no canvas
  },
  help: { Item: { title, description } },
  authority: "...",
  evidence: "docs/ingame-ui.md"
}
```

Every descriptor is the shared immutable `{url, sha256, bytes}` identity. Bundle manifests use the shared schema v1 Entity/Frame/Part contract. UI adds **no Frame extension fields**. Each original canvas is a single static entity keyed by its complete original branch path. Canvas dimensions/origins and optional normalized original delays live in `manifest.metadata.assets[path] = {id,width,height,origin,delay}`. Alias paths are retained; UOL resolution and the atlas packer preserve original pixels and shared hash identity. Canvas entities use delay `1` purely as a static storage sentinel. This is **not** an asserted original timing default.

The Basic bundle contains BtClose, BtCancel2 and the recovered compact Tab2 skin. It is owned by the HUD and borrowed by open windows. KeyConfig's actual constructor uses Basic/BtCancel2, not similarly named KeyConfig/BtCancel artwork. Inventory's type1 generic tab controller resolves `UI/Basic.img/Tab2`, not glyph-only labels or the taller Tab skin.

EquipmentPreview includes exactly the reconstruction avatar's Coat/01040002, Pants/01060002 and Shoes/01072001 `info/icon`, original String.wz names and authored requirement/increment/price/cash/upgrade-slot fields. These are template metadata, not server inventory, equipped instance state or possession claims. Its metadata contains `equipment`, `assets`, and an explicit authority statement. ToolTip shows original `Can` requirement labels and digit rasters only as a static value display; that raster family name is **not** used to assert that a character meets requirements.

Each selected map's `miniMap/canvas` and scalar miniMap properties are separately packaged. Runtime retrieves only the current opened minimap. Authored `centerX`, `centerY`, width/height/magnification properties, when present, remain metadata; no guessed player-marker transformation is applied.

## Recovered original consumers and coordinates

Fresh retained evidence:

- `docs/ghidra-ingame-ui/consumers.c`: address-directed decompilation of HUD, inventory, key-config, menu/shortcut, dialog, tooltip and minimap consumers.
- `windows.c`: stat/skill/equipment-related consumers and shared control construction paths. Some original x86 functions retain Ghidra stack/type-propagation warnings or begin at previously unknown tails; these are not silently promoted into verified layout semantics.
- `key-layout.c`: key drawing/initialization and inventory gather/sort consumers.
- `focus-refs.txt` and `button-focus.c`: a fresh 2,240,735-instruction PUSH-ID scan identifies keyFocused ID1441 at `004c04be`, inside `004c01ff`; the latter is decompiled with the other authored button-state loads.
- `key-instructions.txt`: direct x86 instructions for `00832979..00832c70`, used where decompiler stack recovery concealed button parameters.
- `equip-instructions.txt`: direct x86 evidence for `007fd000..007fe300`, retained to distinguish actual instructions from partial equipment-tail decompilation.
- `equipment.c`: reachable original equipment consumers `007fe02e` (BtPetEquipShow), `007ffe73` (pet/BtPetEquipHide), and `007fd5b4` (DragonEquip). A raw original-PE scan also found no `PUSH imm32` occurrences for background IDs5183/5184 or cash button ID5185; only ID5186 had the known `007fe1a4` PUSH. This narrow negative result is not a claim that the background resources are unused: indirect/generic lookup remains unresolved.
- Integration follow-up [base-window.c](ghidra-ingame-ui/base-window.c): `0092c2e8` proves `+0x590/+0x594` are close-control x/y. The earlier width interpretation was incorrect. [tab-control.c](ghidra-ingame-ui/tab-control.c), [tab-layout.c](ghidra-ingame-ui/tab-layout.c), [tab-draw.c](ghidra-ingame-ui/tab-draw.c), [tab-widths.c](ghidra-ingame-ui/tab-widths.c), and [tab-state-instructions.txt](ghidra-ingame-ui/tab-state-instructions.txt) recover generic tab variant, equal-width partitioning, separator states and centered glyph placement. These investigations ran read-only against the original executable after browser screenshots exposed the missing shared skin.
- `selected-strings.json` and `string-refs.txt`: exact decoded resource IDs and original instruction/function addresses.

The following constants are used as recovered rules, not guessed from texture names:

| Consumer                                                    | Observed rule used                                                                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `008d01b2`, calls `008d3283/330a/3391/3418/349f`            | Equip/Inven/Stat/Skill/KeySet controls at reference-screen x=618/648/678/708/738, y=515.                                                                                                                    |
| `008d2fc3/306b/3134` and immediately preceding resource IDs | Shop/ShortCut/Menu controls at x=573/629/685, y=543 respectively. Importantly, shortcut precedes menu.                                                                                                      |
| `008d359b`                                                  | Quick-slot toggle control at x=768, y=515. Assignment contents are unavailable.                                                                                                                             |
| `00849f3e`                                                  | GameMenu constructs Channel/GameOpt/SysOpt/Quit at x=6, y=24/50/76/102. It does not construct every button found in the archive, e.g. BtSkin.                                                               |
| `0084a6bc`                                                  | ShortCut constructs Item/Equip/Stat/Skill/Comm/Quest/Mobbook/Messenger at x=6 and y=24+26\*n. This is not an alphabetical or resource-tree order.                                                           |
| `0081c6c9`, `004dd790`, `004de15f`                          | Item tab control starts at (3,23), width170, type1 → Tab2, height19, left/right4 and separator8; five equal fill widths26. Skill reuse remains explicit browser composition, not proved Skill coordinates.  |
| `004dd903`, `004de572`, state instructions                  | Selected edge/fill state1; middle1 follows the selected tab, middle2 precedes it, otherwise0. Original glyphs center using integer half-widths; type1 y offset is `2 + floor(19/2) - floor(glyphHeight/2)`. |
| `0081e3a6`, `0092c2e8`, `0081c6c9`                          | Gather/sort at `(closeX-15,6)`; BtFull/BtSmall at `(closeX-30,6)`. `+0x590` is close X, **not window width**. Gather remains disabled; full/small controls only preview skins.                              |
| `008c79f5`                                                  | AP increment control positions `(153,117)`, `(153,135)`, `(153,247)`, `(153,265)`, `(153,283)`, `(153,301)`. These remain disabled without character state.                                                 |
| `00832a43/ac6/b4c/bd5/c5e`                                  | KeyConfig OK/BasicCancel2/Default/Delete/QuickSlot x=8/58/112/177/260, y=236. Direct instructions establish the carried `ESI=0xec` y value.                                                                 |
| `00858344`                                                  | Non-minimized minimap BtMap uses `(windowWidth-42,6)`; the type-2 variant is `(windowWidth-44,4)`. Current presentation uses only the former.                                                               |
| `00836619`                                                  | Initializes 40 key-config icon records, with first 28 type4, following five type5 and remaining seven type6. This does not establish live/default scan-code assignments.                                    |

Original WZ dimensions are not original window positions. In particular KeyConfig's background origin `(314,186)` is an asset anchor, not proof of screen centering. ShortCut's constructor also exposes a logical size differing from its 91x244 raster background; this implementation uses the raster extent for its bounded browser surface and does not claim that logical-window geometry is resolved.

Dialog consumers `009a4f1d`, `009a64fc`, `009a7c8b`, `009a8fef` and tooltip consumer `008e49b5` were decompiled and retained. They contain original scalable piece/resource use and server/instance-dependent paths, but the complete script layout/token parser and exact dynamic tooltip semantics are not reconstructed. Current dialog height, message placement and static tooltip arrangement are explicitly browser presentation decisions.

## Supported presentation versus unavailable behavior

| Surface             | Working presentation                                                                                                                                                                  | Unavailable / not asserted                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| StatusBar           | Original 800x71 base, original equipment/inventory/stat/skill/key controls, exact recovered button positions, quick-slot skin toggle, explicit offline status.                        | Numeric gauges, current values, chat history/commands, active flashes/hints triggered by unknown session state, quick-slot assignments and original visibility/slide timing.   |
| Item                | Original background and five raster tabs, local tab selection, original disabled gather, alternate full-size skin preview.                                                            | Whether any slot is empty, contents, quantities, sorting/gathering, use/drop/move/cash actions.                                                                                |
| Equip               | Original equipment skin and alternate detail skin; separate clearly labeled selected-artwork inspection list.                                                                         | Original live slot contents/coordinates, equip operations, pets, instance upgrades, ownership.                                                                                 |
| Stat                | Original skin and exact recovered disabled AP controls; alternate detail skin.                                                                                                        | All character/ability values, allocation and automatic distribution.                                                                                                           |
| Skill               | Original skin and raster tab presentation; disabled SP control.                                                                                                                       | Job, learned ranks, SP, cooldowns, casts, original action/slot layout and Skill tab coordinates.                                                                               |
| GameMenu / ShortCut | Original constructed button order and coordinates; supported window activation and explicit unavailable-operation dialogs.                                                            | Channel authorization, community/party/guild/quest/book/session actions, quitting a remote session.                                                                            |
| KeyConfig           | Original skin, exact recovered bottom-control positions, BasicCancel2, authored focused/pressed/disabled states, all 40 icon and 70 key legend canvases in a labeled archive gallery. | The gallery is not an original keyboard layout. Live bindings, scan-code placement, remap rules, conflicts, default reset, drag assignment and persistence remain unavailable. |
| MiniMap             | Original nine-slice skin, recovered BtMap placement, current map's separately loaded original canvas.                                                                                 | Browser 260x216 composition/scaling is not a recovered minimap-size rule. No inferred live markers, routing or server authorization.                                           |
| UtilDlgEx           | Original top/center/bottom slices and close-button states, pointer/keyboard close, actual NPC pointer integration through `showNpc`.                                                  | No scripted speech, String.wz random line selection, quest continuation or server response.                                                                                    |
| ToolTip             | Control help and exact static equipment labels/digit canvases, authored requirements and template properties.                                                                         | Original text metrics, instance comparisons, eligibility colors, item-owner data and all dynamic information.                                                                  |
| GameOpt / SysOpt    | Exact original background with explicit unavailable-controls message.                                                                                                                 | Original slider/checkbox construction, preference semantics and persistence; browser audio controls live separately.                                                           |

### Complete remaining UIWindow branch ledger

The following inventoried branches are retained in the lossless archive but are not operational reconstructed features. Names below describe source branches, not inferred behavior or permission to simulate them:

- Shared/auxiliary shells: BtUIClose, BtUIClose2, ContextMenu, FloatNotice, MultiLine, SoftKeyboard, FadeYesNo, Memo, Notice, IconBase, Reset, BetaEdition, QuestIcon, MobGage, TemporaryStatView, EnergyBar, Title, DualMobGauge, SlideMenu.
- Commerce/items/storage: Shop, TradingRoom, PersonalShop, ItemMove, Coupon, Trunk, EntrustedShop, ItemProtector, StoreBank, MemberShop, Incubator, itemSearch, Delivery, ExceptionItemSearch, TreasureBox, Maker, KarmaScissors, RemoteGachapon, ViciousHammer, CashGachapon, CashTradingRoom, VegaSpell.
- Social/identity/communication: Messenger, UserInfo, Channel, Megaphone, Teleport, Report, Admin, UserList, Claim, Wedding, MapleTV, AvatarMegaphone, MateMessage, CancelRequests, ItemMegaphone, NewYearsCard, ArtMegaphone, PartySearch, Ranking, Family, FamilyTree, CharacterClone, counsel, GMBoard, Radio.
- Quests/dialog/character/event/game branches: UtilDlgEx_Avatar, UtilDlgEx_Pet, WorldMap, Quest, QuestAlarm, Minigame, RpsGame, MinigameTable, Macro, Book, EnchantSkill, MonsterCarnival, plant, InitialQuiz, UtilDlgEx_MultiPetEquip, SpeedQuiz, SkillMacro, raise, MonsterBook, EventWindow, AriantMatch, Transform, muruengRaid, classMatch, AdminClaim, MacroSkill, createCygnus, AranSkillGuide, MonsterKilling, MapleEvent, SkillUp, PartyRace.

Other UI IMG families remain inventoried rather than silently ignored: Logo, GuildBBS, BuffIcon, Npt_GuideLine, CashShopPreview, ITCPreview, MapLogin, GuildMark, MapleTV, tutorial, DialogImage, CashShop, NameTag, Login, ChatBalloon and ITC. They encompass branding, login/commerce/community, alternate scene previews, name/chat decorations and tutorial/event artwork. No server/session behavior is inferred from those resources. StatusBar, the selected Basic controls, and the selected UIWindow branches are the packaged runtime subset.

## Browser policies, resource bounds and timing

- Four simultaneously open windows, at most 512 instantiated raster animation objects and 128 controls per surface, at most 128 explicit frames per control state. Extraction traversals are bounded to 16,000 nodes and depth64 per branch. These are engineering limits, not original constants.
- HUD and Basic are the only startup UI resources. Window art, equipment inspection, tooltips and per-map minimaps are demand-loaded through `loadVisualBundle`; there is no second atlas/network path or decoded-image cache. AtlasStore owns decode/upload budgets and shared residency.
- Windows destroy DOM listeners and Pixi consumers before their resource owner. Minimap replacement destroys its previous sprite before releasing its lease. Stale/cancelled loads cannot attach to closed windows. Failed minimap replacement retains its last complete image and reports failure. Catalog refresh prepares a complete new HUD/Basic owner before replacing the existing UI; failure preserves the old UI.
- UI raster order follows explicit composition, not original asset-tree enumeration. All per-surface raster nodes use equal z so background skins cannot obscure later controls/glyphs. Window fronting updates bounded CSS z-indices without detaching DOM nodes during pointerdown; this preserves actual native click/focus. Expanded inventory updates raster/DOM controls and its drag strip together.
- Reference-plane scaling, initial centering, drag strips, clamping, browser text (`11px Tahoma, Arial`), tooltip layout, modal focus trapping, four-window policy and unknown skin placements are browser policies. Tahoma is proved as decoded original string ID8, but this does not prove those per-component font metrics.
- I/E/S/K static help labels are present in String.wz; actual browser capture uses those letters. S therefore opens Stat instead of the harness's WASD-down alias; arrow Down remains available. F10 key-config, M minimap, Escape menu/close, focus cycling and pointer-to-canvas focus are explicitly browser controls, not recovered original defaults.
- KeyConfig and UtilDlgEx use browser modal focus arbitration. Other windows are locally focusable/draggable. Capture handlers clear held gameplay input when UI takes focus. Native DOM button accessibility supplies Tab/Enter/Space, with original state rasters layered separately. The original global focus/stacking rules are unresolved.
- Explicit authored numeric or numeric-string delays are normalized to finite positive milliseconds. Only fully timed authored state sequences advance. Missing timing stays static and is reported as unsupported; the generic renderer's 120ms default is not cited as UI evidence. The generic 120ms original loader chain recovered by the portal domain has not yet been connected to every UI consumer here.

## Evidence and acceptance status

Original decompilation and instruction-export investigations were executed successfully against `Maplestory_UNPACKED.exe` in the isolated UI project. The first `-process MapleStory.exe` attempt reported a missing project program; rerunning with the project's actual program selected completed. No executable bytes were modified. The produced C/text files are evidence, not hand-written runtime code.

The delegated isolated-browser pass is retained in [ui/results.json](ingame-validation/ui/results.json). It found real mouse activation, raster-depth and expanded-header geometry defects, not a clean pass. Main's corrected native-pointer evidence is [fixed-ui.json](ingame-validation/fixed-ui.json) and [fixed-ui-npc-close.json](ingame-validation/fixed-ui-npc-close.json): tab3 receives focus/selection, both NPC close controls close, and the expanded603px inventory has a579px drag strip with nonoverlapping controls at556/571/586. Original reference parity is still unverified. The following scenarios define the acceptance scope:

1. HUD hover/press, I/E/S/K open/close, raster tab changes, menu construction order and original key-config control coordinates.
2. KeyConfig Tab/Enter focus overlays, modal gameplay-input suppression, Escape close and deliberately restored canvas focus; blur/visibility cleanup.
3. Actual NPC pointer interaction reaching the server-unavailable dialog, with no fake speech or quest progression.
4. Equipment artwork inspection and original requirement glyphs without invented item possession or instance values.
5. Minimap demand load, map change while open, interrupted/rejected replacement, repeated close/reopen and catalog replacement without stale attachment or lease leaks.
6. UI-visible frame-time/stall/resident-memory evidence separately from the world-only compositing oracle that intentionally calls `setVisible(false)`.

## Original Windows capture requests

To close the unsupported behavior boundary, obtain authorized original-runtime captures with a documented version, resolution, map, character/session state and input timestamps:

- HUD at 800x600 and every supported original resolution; quick-slot show/hide transitions, HP/MP changes, EXP thresholds, chat and key hints, including timing and alpha.
- Fresh-open, dragged, clamped, overlapping and modal window positions; inventory full/small transitions; keyboard versus mouse focus visuals, tab hit rectangles and repeat behavior.
- KeyConfig initial mappings, physical-key legend coordinates, palette layout, drag/drop conflict behavior, reset/cancel/accept and persistence across reconnects. The recovered bottom control positions alone do not close this gap.
- Actual equipment, stats and skills with known server values: exact slot coordinates, tooltip eligibility, text metrics, quantity/glyph alignment, AP/SP enabling and expanded details.
- Minimap modes/sizes, center/magnification transforms, moving player/party/NPC/portal markers, button disabling and world-map behavior on several maps.
- NPC dialogs covering portraits, line wrapping, script tokens, choices, keyboard focus, quest buttons, next/previous, cancel and unavailable/denied server transitions.
- Commerce/community/quest/event branches from the complete ledger with corresponding authorized server state; static WZ branch names alone cannot establish their behavior.
