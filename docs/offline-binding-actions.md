# Offline native binding actions

## Source and scope

The original unpacked v83 executable dispatches the packed type-4 binding through `00a07431` (range `0..27`) and `00a0773d`. This table follows the actual calls, **not keyboard icon captions**. `00a04f7a` toggles native window IDs; `00a05ab8` constructs them. UserList is a special branch in `00a04f7a`, not an ordinary constructor-switch case. Raw retained evidence:

- `ghidra-client-corrections/ui-binding-dispatch.txt`
- `ghidra-client-corrections/offline-binding-consumers.txt`
- `ghidra-client-corrections/local-window-constructors.txt`
- `ghidra-client-corrections/local-window-identities.txt`
- `ghidra-client-corrections/local-window-create.txt`
- `ghidra-client-corrections/local-window-tabs.txt`
- `ghidra-client/decoded-strings.txt`

Read-only Ghidra 12 analysis was executed on `/tmp/maple-ingame-life`, program `Maplestory_UNPACKED.exe`, with `-readOnly -noanalysis` and `docs/tools/clientFocus.java`. No original C/C++ source or Windows execution is claimed. Cosmic is not the authority for this client mapping.

## Complete type-4 mapping

All numeric entries below are **binding IDs**, not native window IDs.

| ID | Native consumer | Exact meaning / runtime route | Authority classification |
|---:|---|---|---|
| 0 | window 1 → `007fde7c` | Equip | Existing local equipment presentation |
| 1 | window 0 → `0081c414` | Item | Existing local inventory |
| 2 | window 2 → `008c4842` | Stat | Existing local profile/AP |
| 3 | window 3 → `008aa5ad`; special job remap to window 33 → `008b981d` | Skill | Existing local skills; native special-book distinction retained as evidence |
| 4 | window 7, tab 0 → `009196f2` | UserList: Friends | Zero remote friends/presence; explicit server-required operations |
| 5 | `009e9823` → `009eb366`, then `004edba1` | WorldMap | Original Map.wz world art, spots, field membership and navigation; never teleport |
| 6 | `0084dd25` → `0084d9ea` → `0084ddb0` | Messenger | Zero remote participants; server messenger session required |
| 7 | `008590f9` | MiniMap cycle | Existing resident local minimap |
| 8 | window 6 → `0087e8f3` | Quest | Existing journal and original-NPC quest authority |
| 9 | window 5 → `00832586` | KeyConfig | Existing durable local binding editor |
| 10 | key-up → `008d4d43(7)` | ChatAll | Local channel selection; no broadcast server |
| 11 | key-up → `009e85e7`, `008d4dbf` | ChatWhisper, mode 6 | Selects mode6 and focuses the local message editor; recipient/session admission and delivery remain unavailable |
| 12 | key-up → `008d4d43(2)` | ChatParty | Local channel selection; no party recipients |
| 13 | key-up → `008d4d43(0)` | ChatBuddy | Local channel selection; no buddy recipients |
| 14 | `00a06cbc` | ShortCut | Existing original shortcut popup |
| 15 | `008df4b1` | QuickSlot | Existing original quickslot visibility |
| 16 | `008d4a6d(3/1)`, `009e3264(0)` | ExpandChat | Chat expansion toggle, **not a channel selector** |
| 17 | window 7, tab 2 → `009196f2` | UserList: Guild | Zero membership; server guild registry required |
| 18 | key-up → `008d4d43(3)` | ChatGuild | Local channel selection; no guild recipients |
| 19 | window 7, tab 1 → `009196f2` | UserList: Party | Zero membership; server party registry required |
| 20 | resident singleton → `00888230` | QuestAlarm | Local active quest tracker with actual progress |
| 21 | key-up → `008d4d43(5)` | ChatSpouse | Local channel selection; no spouse recipient |
| 22 | window 9 → `00861b12` (475×349), create `00861e99` | MonsterBook | Zero registered cards; explicitly separate original current-field monster information |
| 23 | `00a04dca` (packet opcode `0x28`, cash-shop gates) | CashShop | Commerce/transition requires server; explicit refusal, no synthetic shop membership |
| 24 | key-up → `008d4d43(4)` | ChatAlliance | Local channel selection; no alliance recipients |
| 25 | window 22 → `0087781d`, literal `L"PartySearch"` | PartySearch | Zero search results; registration/matchmaking requires remote players |
| 26 | window 27 → `00808404` (224×392), create `0080862b` | Family | Zero family/reputation; server family service required |
| 27 | window 31 → `00840170` (260×374), create `0084056b` | Title / medal | Actual owned medals only; challenge ranking, claim/reissue require original authority |

## Character bindings and map seats

`CharacterBindings` owns ephemeral expression and seat state; `ProfileStore` remains the inventory authority. Type6 IDs100–106 select `hit`, `smile`, `troubled`, `cry`, `angry`, `bewildered`, and `stunned` (native `0094f2ed`, expression table `0045e8c0`). Owned type3 cash516 items select `itemID % 100 + 8` without consumption. All23 authored face families are packaged. Face clocks advance independently from the body; original per-frame delays default to150ms, root lifetime defaults to5000ms (`00407a36`), and root overrides such as `oops=1640ms` remain intact. Native activation guard is2000ms (`00a24470`). Unsupported ownership or missing animation is rejected explicitly.

Type5 Sit uses native `0094e45f`/`00536517`: stationary ground contact, first authored map seat within half-open x±10/y±30, and200ms repeat guard. `physics.map.$seats` retains original vectors; the avatar moves to that vector and uses `sit` without synthesizing a foothold or changing authored artwork. Movement, attack, death and an admitted impulse release the seat; resisted hits do not. Relocation clears it. This is map-seat support, not an implementation of inventory-chair item controllers.

Type5 Talk uses native `006d9390`: nearest squared-origin distance among admitted NPCs intersecting the three expanded dc rectangles, excluding `talkMouseOnly`. Pointer interaction retains its own native eligibility. Other recovered binding routes select actual chat channels or open original-resource windows; Cash Shop explicitly refuses absent account-commerce authority. Item scripts, inventory-chair controllers and unassigned macro sequences remain separate unsupported dependencies, not successful no-ops.

The timing/admission evidence is retained under `ghidra-client-corrections/offline-character-actions.txt`, `offline-character-state.txt`, `offline-character-state-insns.txt`, `offline-expression-duration.txt`, and `offline-expression-map/`. These are decompiled binary evidence, not original source or Windows runtime parity. The [native gameplay replay](ingame-validation/expanded/gameplay/report.json) found and verified the expression-clock ownership fix: cooldown inheritance is valid only for the same ProfileStore, not a new temporary-profile clock.

Important correction: IDs **25/26/27 are PartySearch/Family/Title**, respectively, not Family/Medal/PartySearch. Family creation consumes decoded string IDs `0x11db..0x11e1` (`UI/UIWindow.img/Family/...`); Title creation consumes `0x142a/0x142c` (`UI/UIWindow.img/Title/backgrnd2/backgrnd4`). Messenger creation prints original messenger help lines. WorldMap initialization consumes `0x8e5` (`Map/MapHelper.img/worldMap/mapImage`).

## Local window integration

`ui-local-windows.js` exports `LOCAL_WINDOW_NAMES`, `localWindowSize(name, resource)` and `layoutLocalWindow(panel)`. Unknown names return `null` and `false`, respectively. All local windows use `UISurface`, its borrowed resource lifetime, DOM accessibility plane, bounded controls and normal GameUI close/drag/viewport management. There is no second texture decoder or independent window owner.

GameUI registers these eight names and their original bundles: `WorldMap`, `UserList`, `QuestAlarm`, `MonsterBook`, `PartySearch`, `Family`, `Title`, `Messenger`. Other than WorldMap and QuestAlarm, dimensions come from original `backgrnd`. WorldMap is 654×521 around original 640×470 art; QuestAlarm is a bounded 223×246 tracker using its authored 25/18/5-pixel chrome segments. Native artwork is retained; contextual text layout, scrolling, pagination and navigation controls are browser policies, **not recovered original font/layout parity**.

- Binding 4/17/19 opens UserList and calls `panel.selectLocalTab(0/2/1)`. Native `00a04f7a` closes the already selected tab, but selects another tab without closing. The routing owner must preserve this distinction.
- Other local binding routes use the normal GameUI open/toggle path.
- `panel.localRefresh()` refreshes contextual profile data. Invoke it on profile changes **and field changes**. WorldMap refresh is field-ID-gated; it does not rebuild every frame or every profile notification.
- QuestAlarm reads active persisted quest states, original completion conditions, kill counters and item inventory. It never accepts/completes a quest independently of its original NPC.
- MonsterBook clearly labels its field-information view separately from the unimplemented card registry. It does not grant cards or claim that encountering a monster unlocks a card.
- Title recognizes original medal family `Character.wz:Accessory/0114xxxx.img`; source spot-check `String.wz:Eqp.img/Eqp/Accessory/1142001/name` is `PQ Mania Medal`. Inventory/equipment is the only local ownership authority.
- Remote action buttons return a negative `server-required` outcome and visibly explain the precise dependency. Counts remain zero; opening a window is not membership, message delivery, matchmaking or commerce.

## World map data and reusable audit

`tools/worldmap-data.js` extracts original `Map.wz:WorldMap/*.img`, `MapHelper.img/worldMap` and `UI.wz:UIWindow.img/WorldMap` into one demand-loaded UI bundle. `extractWorldMaps(context, canvasRecord)` returns the bundle reference; `extractGameUI` assigns it to `bundles.WorldMap`. Metadata retains exact authored `mapNo`, `spot`, marker `type`, title/description, `parentMap`, `linkMap` and link canvas paths. Runtime current-field selection examines authored membership, never derives coordinates from a minimap. The original `curPos` sprite marks a matching authored node; unrepresented fields are explicitly identified as unrepresented.

Run the focused source audit without generating atlases or extracting playable maps:

```sh
bun client/tools/worldmap-data.js /path/to/Maplestory-Client
```

Executed audit results: **21 world maps, 586 map spots, 17 links, zero unresolved link targets**. A scoped original-canvas decode through the extraction traversal decoded **113 canvases / 7,097,914 pixels**. The authored `WorldMap031.info.parentMap` is **`WorldMap30`**, which is absent from the archive. This is preserved and reported; Parent visibly refuses it, rather than silently inventing `WorldMap030`. The region chooser and Current field action remain available. The audit rejects an unreviewed change to the archive's world-map inventory.

## Native-surface acceptance scenarios

The [expanded windows report](ingame-validation/expanded/windows/report.json) records executed native routes, refusals, captures and explicit limits; [gameplay](ingame-validation/expanded/gameplay/report.json) covers expressions, Sit and Talk. The list below remains a broader acceptance checklist, not a claim that every combination was exercised. In particular, quest/medal fixtures are labeled temporary setup, and the windows sweep records mixed-build scope.

1. Press W / binding 5 in Henesys. Verify original Victoria Island art and its actual `mapNo` current marker; click a node and inspect its original title/description and field IDs. Confirm no field transition occurred.
2. Hover/focus a link image and enter the original linked region; Parent returns to its authored parent. Select WorldMap031 and exercise its broken Parent: show an exact missing-source response and preserve the last complete map. Current field returns to a containing authored map.
3. Open UserList Friends, switch Party/Guild using both tabs and their bindings, then repeat the same binding to close. Lists remain empty. Create party/Add friend visibly refuse their server dependencies without modifying the profile.
4. Open QuestAlarm before accepting a quest (zero active), accept from the real NPC, reopen/refresh, kill an eligible monster or acquire a required item, then complete at the real NPC. Verify actual counts and removal after completion, including page bounds.
5. Open MonsterBook in a field with monsters, page through original current-field data, transition to a different field, and confirm refresh without awarding cards. Open in a monster-free field and verify the explicit empty state.
6. Open Family, Messenger and PartySearch. Verify the local character/field context, zero remote counts, and visible refusals for junior entry, messenger entry and party-search registration.
7. Open Title with no medals and with an actually owned `114xxxx` medal. Ownership must reflect the profile only. Claim must not grant an item or fake ranking state.
8. For all eight windows exercise close, reopen, Escape, drag to viewport edges, scale/resize, retained focus, field change while loading and window-residency limit. WorldMap must remain original art, not fall back to a minimap. Resource cancellation must not resurrect a closed panel.
