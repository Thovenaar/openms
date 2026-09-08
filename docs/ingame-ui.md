# In-game UI reconstruction

## Provenance and fidelity boundary

Implementation inputs are only the original `/Users/k/Development/tensorfish/Maplestory-Client` archives/executable, the lossless inventories in `docs/ingame-inventory`, and fresh decompilation of the isolated `/tmp/maple-ingame-ui.gpr` project. No third-party client, original C/C++ source, server, Windows execution, or original runtime recording was available.

This preserves original raster UI artwork and selected address-backed coordinate rules, while presenting durable local gameplay state through explicitly labeled native browser controls. It does not claim original runtime/server parity. HP, MP, EXP, class, inventory and quests come from the shared `ProfileStore` and quest/gameplay owners, not inferred artwork values. Original numeric gauge anchors, slot layout, character-instance formulas, scripts and remote operations remain unrecovered. Provisional local authority is never described as an original server.

`UI.json` currently enumerates **19 IMG entries and 110 UIWindow top-level branches**. The earlier research report's prose said 108 branches; the retained machine-readable list actually contains 110. `UI.tar.gz` preserves every inventoried node, not merely the packaged subset. The exact original IMG hashes remain in that index; `context.image` also records input hashes during normal extraction.

## Implemented modules and integration

- `client/tools/ui-data.js`: `extractGameUI(context)`. Requires the shared extraction context and its bounded, selected `mapIds` array. Uses the existing WZ parser, `at`/`resolveNode`/`value`, original `part`, and the shared `bundle` packer. There is no UI-specific pixel decoder or network/atlas implementation.
- `client/src/game-ui.js`: `new GameUI(app, services, hooks)`, `prepare(index, signal)`, `setProfile(store, quests)`, `refreshProfile()`, `setScene(scene)`, `update(ms)`, `resize(width, height)`, `snapshot()`, `destroy()`.
- `client/src/ui-surface.js`: bounded original-raster rendering, authored state selection, accessible DOM hit planes, borrowed-resource ownership, and explicit authored-delay animation.
- `client/src/ui-layout.js`: HUD, window, tab, menu, key-config, minimap and dialog composition.
- `client/src/ui-inspection.js`: event-driven local HUD/stat/inventory projections and native local-policy controls; original minimap canvas replacement, static reconstruction equipment inspection and original requirement glyph rendering.
- `client/src/camera.js`: `followCamera(camera, pose, physics, viewport)` updates top-left world coordinates from recovered VR center limits; immutable-manifest geometry is cached outside the frame loop.

`hooks` is `{clearInput, focusGame, onError, playSound, onSave?, onReset?, onRecover?, onNpcDialogue?, onQuestJournal?, onOfferItem?}`. Sounds remain `playSound("UI", "BtMouseOver")` and `playSound("UI", "BtMouseClick")` for actual original-control events. `onSave()` is awaited before `store.flush()` so integration can checkpoint the latest position/settings; `onReset()` is awaited after successful `store.reset()` so integration can reload the reset map. `onRecover()` queues field-authority recovery and returns its admission boolean. The audio owner retains its user-gesture and mute policies.

Additional public methods:

- `showNpc({id, templateId, name, functionName, authority, canInteract})`: requires the life owner's live `canInteract()` admission, opens original `UtilDlgEx` chrome and delegates the intact record to `hooks.onNpcDialogue(panel, npc)`. The quest owner rechecks the same function before begin/complete because proximity/liveness can change while dialogue is open. Quest rules/dialogue come only from that owner; this is not arbitrary String.wz speech selection or script emulation.
- `setVisible(boolean)`: inspection-only world-compositing gate; hides Pixi and DOM UI and disables input capture without discarding window state. Restoration preserves open windows. Use it only for isolated world-oracle captures; real UI acceptance keeps the UI visible.
- `open(name)` / `close(name)`: asynchronous window demand and local close. Supported names are Item, Equip, Stat, Skill, GameMenu, ShortCut, KeyConfig, MiniMap, UtilDlgEx, GameOpt, SysOpt, EquipmentPreview, ToolTip and Quest. Quest is a **native local journal mounted inside original UtilDlgEx artwork**, not a reconstruction of the unrecovered UIWindow/Quest layout.
- `setProfile(store, quests)` requires `ProfileStore.subscribe(listener)`, subscribes once and unsubscribes on replacement/destruction. `refreshProfile()` updates actual changes only; it is available to integration for quest changes not accompanied by store notification. There is no profile polling or text generation in `update(ms)`.
- Dialogue hooks return a cleanup function with optional `.refresh()`. The UI calls it when the dialogue changes or its window is destroyed. `panel.content` is a scrollable native rectangle `(24,30,480,132)` inside the 529×206 UtilDlgEx surface; footer controls use y176. `panel.button()` returns an original-art `UIControl` with `.element`, `.setVisible(boolean)`, `.setDisabled(boolean)` and `.position(x,y)`; mount owners reuse footer controls, not allocate them on every refresh.
- `hooks.onOfferItem(itemId)` returns `{accepted:boolean, reason?:string}` or a promise for that result. The local inventory emits this intent without changing counts. Integration checks actual nearby reactor rectangles/requirements and consumes items only on acceptance.

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

EquipmentPreview includes exactly the reconstruction avatar's Coat/01040002, Pants/01060002, Shoes/01072001 and Weapon/01302000 `info/icon`, original String.wz names and authored requirement/increment/price/cash/upgrade-slot fields. These remain template metadata, distinct from possession in the profile. The 330×280 browser inspection surface holds all four items. ToolTip shows original `Can` requirement labels and digit rasters only as a static value display; that raster family name is **not** used to assert that a character meets requirements.

`catalog.ui.itemLabels` retains the full original item-name table from String.wz Eqp, Consume, Ins, Etc and Cash images, keyed by numeric template ID. Extraction is bounded to 150,000 name-tree nodes, depth64 and 50,000 named entries, with explicit conflict/overflow errors. Names do not confer use rules or ownership. Local inventory IDs lacking authored labels remain visible by ID rather than being discarded. Separately packaged minimaps accept at most512 selected/closure map IDs; map images still load only when the current minimap is opened.

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
| `008d2fc3/306b/3134/31fc` and immediately preceding resource IDs | Shop/**NPT**/Menu/**ShortCut** controls at x=573/629/685/741, y=543. The former x629 ShortCut transcription was wrong; retained construction explicitly binds that address to BtNPT. |
| `008d36ab` | BtClaim at `(573,515)`, control1009, constructor mode2. It is not omitted or moved down into the base. |
| `008d359b` | Quick-slot toggle at `(768,515)`. `param+0xd10` selects QuickSlot/QuickSlotD resources; the meaning/transition timing of that state is not inferred. The browser toggle previews the skin only. |
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
| StatusBar | Original800×71 base at `(0,529)`, recovered top controls and four-button lower row, authored normal/hover/pressed/disabled/keyFocused branches; native local HUD, Stats/Inventory/Quests/Save/Reset controls. | Original numeric gauge/text positions, chat, quick-slot assignments and original visibility/slide timing. |
| Item | Original background, five raster tabs and full/small skins; scrollable native local inventory names/IDs/counts, nearby reactor offering intents. | Original slot geometry/order, sorting/gathering, arbitrary use/drop/move/cash actions. |
| Equip | Original skins; scrollable local equipped-template list and separate static artwork inspection. | Original equipment slot coordinates, equip operations, pets and instance upgrades. |
| Stat | Original skin and address-backed disabled AP controls; local HP/MP/EXP/mesos/fame/job/abilities; explicitly provisional class selector restricted to original Quest Check/job IDs. | Original text layout, AP/SP grants, job-advancement scripts, derived server formulas. The selector grants no skills. |
| Skill | Original skin and raster tabs; disabled SP control. | Learned ranks, SP, cooldowns, original skill-slot/action layout and advancement scripts. |
| GameMenu / ShortCut | Original constructed order/coordinates; local-window activation including the native quest journal. | Remote channel/community/party/guild/book/session operations. |
| KeyConfig           | Original skin, exact recovered bottom-control positions, BasicCancel2, authored focused/pressed/disabled states, all 40 icon and 70 key legend canvases in a labeled archive gallery. | The gallery is not an original keyboard layout. Live bindings, scan-code placement, remap rules, conflicts, default reset, drag assignment and persistence remain unavailable. |
| MiniMap             | Original nine-slice skin, recovered BtMap placement, current map's separately loaded original canvas.                                                                                 | Browser 260x216 composition/scaling is not a recovered minimap-size rule. No inferred live markers, routing or server authorization.                                           |
| UtilDlgEx | Original top/center/bottom slices and close states; scrollable native original-data quest dialogue, local journal and explicit reset confirmation. | Arbitrary NPC scripts, original dynamic text metrics and unavailable server response semantics. |
| ToolTip             | Control help and exact static equipment labels/digit canvases, authored requirements and template properties.                                                                         | Original text metrics, instance comparisons, eligibility colors, item-owner data and all dynamic information.                                                                  |
| GameOpt / SysOpt    | Exact original background with explicit unavailable-controls message.                                                                                                                 | Original slider/checkbox construction, preference semantics and persistence; browser audio controls live separately.                                                           |

### Complete remaining UIWindow branch ledger

The following inventoried branches remain unreconstructed as original window layouts. Native local features (such as the Quest journal inside UtilDlgEx) do not claim to implement their same-named original branch. Names below describe source resources, not inferred server behavior:

- Shared/auxiliary shells: BtUIClose, BtUIClose2, ContextMenu, FloatNotice, MultiLine, SoftKeyboard, FadeYesNo, Memo, Notice, IconBase, Reset, BetaEdition, QuestIcon, MobGage, TemporaryStatView, EnergyBar, Title, DualMobGauge, SlideMenu.
- Commerce/items/storage: Shop, TradingRoom, PersonalShop, ItemMove, Coupon, Trunk, EntrustedShop, ItemProtector, StoreBank, MemberShop, Incubator, itemSearch, Delivery, ExceptionItemSearch, TreasureBox, Maker, KarmaScissors, RemoteGachapon, ViciousHammer, CashGachapon, CashTradingRoom, VegaSpell.
- Social/identity/communication: Messenger, UserInfo, Channel, Megaphone, Teleport, Report, Admin, UserList, Claim, Wedding, MapleTV, AvatarMegaphone, MateMessage, CancelRequests, ItemMegaphone, NewYearsCard, ArtMegaphone, PartySearch, Ranking, Family, FamilyTree, CharacterClone, counsel, GMBoard, Radio.
- Quests/dialog/character/event/game branches: UtilDlgEx_Avatar, UtilDlgEx_Pet, WorldMap, Quest, QuestAlarm, Minigame, RpsGame, MinigameTable, Macro, Book, EnchantSkill, MonsterCarnival, plant, InitialQuiz, UtilDlgEx_MultiPetEquip, SpeedQuiz, SkillMacro, raise, MonsterBook, EventWindow, AriantMatch, Transform, muruengRaid, classMatch, AdminClaim, MacroSkill, createCygnus, AranSkillGuide, MonsterKilling, MapleEvent, SkillUp, PartyRace.

Other UI IMG families remain inventoried rather than silently ignored: Logo, GuildBBS, BuffIcon, Npt_GuideLine, CashShopPreview, ITCPreview, MapLogin, GuildMark, MapleTV, tutorial, DialogImage, CashShop, NameTag, Login, ChatBalloon and ITC. They encompass branding, login/commerce/community, alternate scene previews, name/chat decorations and tutorial/event artwork. No server/session behavior is inferred from those resources. StatusBar, the selected Basic controls, and the selected UIWindow branches are the packaged runtime subset.

## Browser policies, resource bounds and timing

- Four simultaneously open windows, at most512 raster animation objects and128 original controls per surface, at most128 explicit frames per control state. UI extraction traversals are bounded to16,000 nodes and depth64 per artwork branch. Local lists accept the store's4096 inventory entries; class choices accept at most1024 literal source-retained job IDs. Overflow fails explicitly, never silently truncates.
- HUD and Basic are the only startup UI resources. Window art, equipment inspection, tooltips and per-map minimaps are demand-loaded through `loadVisualBundle`; there is no second atlas/network path or decoded-image cache. AtlasStore owns decode/upload budgets and shared residency.
- Windows destroy DOM listeners and Pixi consumers before their resource owner. Minimap replacement destroys its previous sprite before releasing its lease. Stale/cancelled loads cannot attach to closed windows. Failed minimap replacement retains its last complete image and reports failure. Catalog refresh prepares a complete new HUD/Basic owner before replacing the existing UI; failure preserves the old UI.
- UI raster order follows explicit composition, not original asset-tree enumeration. All per-surface raster nodes use equal z so background skins cannot obscure later controls/glyphs. Window fronting updates bounded CSS z-indices without detaching DOM nodes during pointerdown; this preserves actual native click/focus. Expanded inventory updates raster/DOM controls and its drag strip together.
- Reference-plane scaling, initial centering, drag strips, browser text (`11px Tahoma, Arial`), tooltip layout, modal focus trapping, four-window policy and unknown skin placements are browser policies. Windows are restricted to800×515, above the complete HUD/button extent, and use the same initial/drag clamps; expanded inventory updates content and control extents together. Tooltips use measured bounds inside800×600. [Native expanded-inventory clamp replay](offline-validation/main/clamp-after.json) confirms the Stat button remains uncovered. Tahoma is original string ID8, not proof of browser font metrics.
- I/E/S/K static help labels are present in String.wz; actual browser capture uses those letters. S therefore opens Stat instead of the harness's WASD-down alias; arrow Down remains available. F10 key-config, M minimap, Escape menu/close, focus cycling and pointer-to-canvas focus are explicitly browser controls, not recovered original defaults.
- KeyConfig and UtilDlgEx use browser modal focus arbitration. Modal Tab trapping includes visible native selects/inputs as well as buttons. Native DOM controls remain attached during pointerdown; authored disabled controls remain focusable for unavailable explanations but never dispatch their action. Capture handlers clear gameplay input. Original normal-state geometry anchors every state and keyFocused overlay; no hover-art dimensions redefine the hit rectangle.
- I/E/S/K still toggle non-modal windows when their native buttons have focus; a modal dialog remains an input boundary. Closing the inventory hotkey and successful Recover restore canvas focus. Main replayed both paths through native controls in [hotkey-after.json](offline-validation/main/hotkey-after.json) and [recovery-reactor-after.json](offline-validation/main/recovery-reactor-after.json).
- Explicit authored numeric or numeric-string delays are normalized to finite positive milliseconds. Only fully timed authored state sequences advance. Missing timing stays static and is reported as unsupported; the generic renderer's 120ms default is not cited as UI evidence. The generic 120ms original loader chain recovered by the portal domain has not yet been connected to every UI consumer here.

## Durable local state and viewport integration

HUD text shows name/level, HP/MP, EXP/current local threshold and mesos from the profile. It is explicitly marked `LOCAL POLICY`; the threshold is shared with `offline-progression.js`, not a second UI formula. The native inventory list classifies original item-ID families across all five tabs; IDs outside those families remain visible under Etc with an unclassified label. Every retained item uses its authored name when available. Count changes invalidate the list; unchanged location checkpoints do not recreate its nodes. Stats and HUD compare relevant primitive fields before creating replacement text.

The local class selector's only choices are `quests.knownJobs()`, the literal source Check/job inventory. It changes only `profile.job`, calls `markDirty()`, and labels the operation “Local class policy — original job-advancement scripts unavailable; skills are not granted.” It is not disguised as NPC job advancement and does not weaken quest membership checks.

Save status/failures are visible on the HUD. Reset opens a native confirmation inside the original dialog skin and calls `store.reset()` only after explicit confirmation. A failed reset does not force a scene reload. Save/reset controls are mutually gated while pending. Null/corrupt loaded profiles show unavailable values rather than fabricated zeros and still permit an explicit recovery reset.

The native HUD Recover button is enabled only for local HP0 (and a connected recovery owner). It calls `hooks.onRecover()`; death-animation admission, HP restoration and respawn-map travel remain exclusively field/integration responsibilities. Rejected admission is visible, not silently converted into a heal.

`resize(width,height)` retains `scale=min(1,width/800,height/600)`, horizontal centering and bottom anchoring. The Pixi root and DOM overlay share that logical transform. DOM placement measures both canvas axes relative to its parent, including nonuniform CSS scale; dragging converts X/Y through their separate committed screen scales. ResizeObserver plus bounded ancestor mutation/window resize/scroll observation schedules layout commits outside RAF gameplay updates. `snapshot().layoutGeneration` advances after a committed layout, allowing input automation to wait for actual transforms. Rotated/skewed CSS embedding is not claimed supported.

`followCamera(camera, pose, manifest.physics, {width,height})` mutates and returns the same top-left camera object. Do **not** pass the simulation's physical `bounds`. Original `00641ef1` stores centers in `[VRLeft+400, VRRight-400]` and `[VRTop+300, VRBottom-300]` at800×600; equal/reversed intervals collapse to their signed-integer midpoint (`Math.trunc`). The source fallback offsets are left−20, top−60, right+20 and bottom+100. Mapping the source geometry globals to foothold extrema is the explicitly provisional interpretation, cached once per immutable physics manifest. Explicit VR zero values are retained; `VRLimit` is not a camera gate. Other viewport sizes generalize the half-viewport values without stretching world pixels, a browser extension rather than a recovered original-resolution mode. Empty geometry is usable only when all four VR values exist; nonfinite/unbounded metadata fails visibly.

## Evidence and acceptance status

Original decompilation and instruction-export investigations were executed successfully against `Maplestory_UNPACKED.exe` in the isolated UI project. The first `-process MapleStory.exe` attempt reported a missing project program; rerunning with the project's actual program selected completed. No executable bytes were modified. The produced C/text files are evidence, not hand-written runtime code.

The delegated isolated-browser pass is retained in [ui/results.json](ingame-validation/ui/results.json). It found real mouse activation, raster-depth and expanded-header geometry defects, not a clean pass. Main's corrected native-pointer evidence is [fixed-ui.json](ingame-validation/fixed-ui.json) and [fixed-ui-npc-close.json](ingame-validation/fixed-ui-npc-close.json): tab3 receives focus/selection, both NPC close controls close, and the expanded603px inventory has a579px drag strip with nonoverlapping controls at556/571/586. Original reference parity is still unverified. The following scenarios define the acceptance scope:

The offline implementation wave corrected the independently recovered HUD transcription and added the local state/camera integration above. No project-wide build, formatter, lint or test suite was run by the UI worker during concurrent mutation; current integrated browser acceptance is the integration owner's responsibility. The older captures in this section are historical, not evidence for the new profile controls or camera.

A scoped throwaway execution of the actual `followCamera` helper exercised original edge clamp `(0,600)`, reversed signed-midpoint collapse `(-449,-375)`, a1034×783 viewport `(483,208.5)`, and foothold-fallback geometry `(100,-230)`. Each returned the same camera reference and the expected coordinates. This is local algorithm smoke evidence, not an original-client recording or integrated visual parity claim.

1. HUD hover/press, I/E/S/K open/close, raster tab changes, menu construction order and original key-config control coordinates.
2. KeyConfig Tab/Enter focus overlays, modal gameplay-input suppression, Escape close and deliberately restored canvas focus; blur/visibility cleanup.
3. Actual NPC pointer interaction reaching original-data local quest dialogue; unsupported scripts remain explicit rather than fake speech.
4. Durable HUD/stat/inventory values surviving save/reload; explicit reset confirmation; equipment template inspection remaining distinct from possession; native item offers consumed only after owner acceptance.
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
