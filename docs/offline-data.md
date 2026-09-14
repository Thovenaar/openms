# Authorized offline server data

Cosmic is an authorized **server reference**, not original Nexon client source or a replacement for original WZ metadata. The historical inventory below was executed against `/Users/k/Development/tensorfish/Cosmic`; current conversion uses the repository-owned snapshots. No SQL, Cosmic JavaScript, Java server, Windows client, or full asset extraction was executed by the converter.

## Reproducible tool and output contract

```sh
bun tools/openms.js data server --help
bun tools/openms.js data server --output /tmp/maple-server-data-proof
bun tools/openms.js data server --output /path/to/generated
```

SQL comes from repository `infra/sql` (override with `--sql-root`); gameplay scripts and `policy.json` come from `infra/gameplay-definitions` (override with `--gameplay-definitions-root`). No external checkout, Java files/hashes or full server configuration is read. `--server-root` and `--server-reference` are removed and rejected. `--output` is required. Environment overrides are removed; unknown/duplicate flags and missing values fail explicitly. The copied SQL retains its original relative paths in generated provenance; see [SQL snapshot](../infra/sql/README.md) and [gameplay snapshot](../infra/gameplay-definitions/README.md). Script identities retain their logical `scripts/` prefix. Policy provenance now hashes only `scripts/policy.json`; existing historical report hashes below describe the original supplied source, not a new extraction.

- `sql-data.js` is the shared bounded reader. `drop-data.js` now uses it rather than scanning arbitrary six-number tuples. Drop extraction keeps its existing `mobs`, `itemIds`, `provenance`, and coverage contract and uses the selected reference SQL snapshot.
- `convertServerData({gameplayDefinitionsRoot?,sqlRoot?})` returns `{report,datasets}` without publishing. `extractServerData({output,gameplayDefinitionsRoot?,sqlRoot?})` publishes through the existing atomic, content-addressed `resource()` helper and returns `{schemaVersion:2,authority,datasets,report,summary,...}`. `datasets` maps `shops`, `drops`, `crafting`, `cards`, and `cash` to ordinary `{url,sha256,bytes}` resource descriptors. `report` is another such descriptor.
- Each domain JSON has `{schemaVersion:1,authority,domain,sources,tables}`. `sources` records relative source paths, SHA-256 and bytes; `tables` maps original SQL table names to arrays of literal row objects using the explicitly inserted column names. Omitted auto-increment IDs/defaults are **not synthesized**. Row order and duplicates are preserved. The shops domain additionally has `npcRoutes` with numeric-script presence, literal shop references, and a conservative route classification.
- The report includes every SQL file's hash, byte count, statement count, declared tables, explicit INSERT columns, authored/converted row counts, and unsupported statements. `tables` includes all column definitions and constraints as descriptive SQL, companion paths and row counts. `scripts.files` records JavaScript paths/hashes/bytes; NPC entries also retain source text and compilation results. Supported NPC programs are compiled into a closed data representation, and unsupported syntax blocks the route. Source JavaScript is never evaluated directly.
- No timestamps or machine-specific absolute paths enter output bytes. Descriptor URLs use the existing `/generated/references/{sha256}.json` convention; for a standalone output directory, replace `/generated` with that directory when opening files.

The parser supports `CREATE TABLE` declarations and explicit-column `INSERT INTO ... VALUES` containing finite numbers, safe integers, quoted strings, or NULL. It recognizes MySQL `#`, `-- `, and ordinary block comments; quoted separators are not statement boundaries. Nested parentheses are bounded and SQL expressions/subqueries are reported rather than evaluated. Executable comments, unsupported tokens, incomplete tuples, unknown schema columns, and limit exhaustion are explicit failures. Unsupported non-bootstrap statements prevent dataset publication. The five known unsupported admin-bootstrap expressions are report-only; bootstrap credentials and account/character/inventory/keymap/storage row values are never published.

Engineering bounds: 16,000,000 bytes per SQL file, 2,000,000 lexer matches per file, 4,096 statements per file, 100,000 rows per file, 200,000 total rows, 256 columns/list entries, nesting depth 32, 128 SQL files, 10,000 filesystem entries per source traversal, 1,000,000 bytes per script, and 64,000,000 aggregate bytes for each SQL/script source family. The filesystem walk is iterative and rejects symlinks. These are tool policy, not MapleStory constants.

## All 24 schema files

Every file below contains declarations and **zero INSERT rows**. In particular, `009-drop.sql` is not the drop catalog. The supplied 24 files declare **73 tables**; **55 tables have no companion seed rows**. Column definitions/defaults in an empty table are not world content.

| File under `src/main/resources/db/tables/` | Declared tables | Populated companion or meaning |
| --- | --- | --- |
| `001-account.sql` | accounts | Admin bootstrap only; excluded |
| `002-character.sql` | characters | Admin bootstrap only; excluded |
| `003-inventory.sql` | inventoryitems, inventoryequipment, inventorymerchant | First two bootstrap only; merchant empty |
| `004-skill.sql` | skills, cooldowns, skillmacros | Empty character-state schemas, not skill definitions |
| `005-pet.sql` | pets, petignores | Empty state |
| `006-quest.sql` | questactions, questprogress, questrequirements, queststatus, area_info, eventstats, medalmaps | All empty; no SQL quest content |
| `007-guild.sql` | guilds, bbs_replies, bbs_threads, alliance, allianceguilds | Empty social state |
| `008-keymap.sql` | keymap, quickslotkeymapped | keymap bootstrap only; not native default-key authority |
| `009-drop.sql` | drop_data, drop_data_global, reactordrops | Data files 152, 151, 131 |
| `010-storage.sql` | storages, fredstorage | storages bootstrap only |
| `011-shop.sql` | shops, shopitems | Data files 101, 102 |
| `012-character-state.sql` | playerdiseases, buddies, savedlocations, famelog, trocklocations, characterexplogs | Empty character state |
| `013-cashshop.sql` | wishlists, specialcashitems, nxcode, nxcode_items, nxcoupons | Data files 141, 142 for specialcashitems/nxcoupons; others empty |
| `014-gift.sql` | gifts, notes, newyear | Empty state |
| `015-marriage.sql` | marriages, rings | Empty state |
| `016-monsterbook.sql` | monsterbook, monstercarddata | monsterbook empty; card mappings in 121 |
| `017-family.sql` | family_character, family_entitlement | Empty state |
| `018-transfer.sql` | namechanges, worldtransfers | Empty requests |
| `019-mts.sql` | mts_cart, mts_items | Empty market state |
| `020-maker.sql` | makercreatedata, makerrecipedata, makerrewarddata, makerreagentdata | Data files 111–114 |
| `021-field-object.sql` | playernpcs, playernpcs_equip, playernpcs_field, plife | All empty; not authored NPC/monster placements |
| `022-ban.sql` | hwidaccounts, hwidbans, ipbans, macbans, macfilters, reports | Empty moderation state |
| `023-bosslog.sql` | bosslog_daily, bosslog_weekly | Empty attempt logs |
| `024-duey.sql` | dueypackages, dueyitems | Empty delivery state |

The related `changelog-data.xml` names all 13 companion files listed below. The converter inventories the actual trees, not just filenames presumed present from a manifest; it does not run Liquibase or MySQL.

## Actual companion rows

| File under `src/main/resources/db/data/` | Table / rows | Browser reference use |
| --- | --- | --- |
| `101-shops-data.sql` | shops: 110 | NPC-to-shop mapping |
| `102-shopitems-data.sql` | shopitems: 3,882 | Shop inventory and authored price/order |
| `111-makercreate-data.sql` | makercreatedata: 834 | Maker output requirements |
| `112-makerrecipe-data.sql` | makerrecipedata: 1,926 | Recipe input counts |
| `113-makerreward-data.sql` | makerrewarddata: 98 | Reward quantities/probabilities |
| `114-makerreagent-data.sql` | makerreagentdata: 45 | Reagent stat/value data |
| `121-monstercard-data.sql` | monstercarddata: 343 | Card-to-mob mapping |
| `131-reactordrops-data.sql` | reactordrops: 1,116 across four INSERTs | Reactor item/chance/quest configuration |
| `141-specialcashitems-data.sql` | specialcashitems: 1 | Server cash configuration only |
| `142-nxcoupons-data.sql` | nxcoupons: 40 | Server coupon schedules only |
| `151-global-drop-data.sql` | drop_data_global: 5 | Reference only; not automatically enabled |
| `152-drop-data.sql` | drop_data: 22,157 across three INSERTs | Existing selected-map offline mob drops |
| `161-admin-data.sql` | accounts: 1; characters: 1; inventoryitems: 5; inventoryequipment: 4; keymap: 40; storages: 1 | All 52 bootstrap rows excluded |

Total: **30,609 authored tuples**, of which **30,558** are wholly literal. Five admin INSERT statements containing subqueries account for the other **51 tuples**. The one literal account row is also excluded. The five published reference domains therefore contain **30,557 rows**. No database-generated account/character/item IDs are guessed.

## NPC/shop/quest configuration is not dialog scripting

The supplied tree contains **1,915 actual JavaScript files**: 708 NPC, 253 quest, 458 portal, 292 reactor, 108 event, 90 map, 2 item, and 4 root/template/dev files. All are individually hashed. Their presence is evidence of server script dependencies, not evidence that browser execution is available. Named/dynamic script references, Java host calls, event/party state and server conversation managers still require explicitly supported behavior.

Concrete shop data:

- `shops` rows are `{shopid,npcid}`; `shopitems` rows are `{shopid,itemid,price,pitch,position}`. There are no orphan shop-item rows in this supplied snapshot. Example: shop 11000 offers item 1332005 for 500 mesos at position 104, then 1322005, 1312004, 1302000 for 50 mesos each at positions 108, 112, 116. `pitch` is retained as authored configuration, not silently treated as mesos.
- Cosmic `NPCTalkHandler.java:74–84` attempts the NPC script first and opens its SQL shop only when no script handles it. `NPC.java:37–42` and `ShopFactory.java:60–64` resolve this fallback by NPC ID. Therefore a SQL shop row does not authorize bypassing a script or quest gate.
- Actual numeric-script shop calls are `scripts/npc/11000.js` → shop 11000, `2100002.js` → shop 2100002, `2100003.js` → shop 2100003, and `9201099.js` → shop 9201099. The last is gated by quest 8224 completion. The report's scanner marks these as **lexical references**, not interpreted control flow.
- There are 110 shop rows but two target NPC 11000 (shop 11000 and shop 1337). Its actual script explicitly selects 11000. Do not collapse NPC-to-shop mappings with last-write-wins. Five shop rows have one of these four numeric scripts; the other 105 rows are only standard-fallback candidates, subject to named/original script overrides.
- `006-quest.sql` has no companion quest definitions, actions, requirements, or dialog rows. Original `Quest.wz` metadata and actual quest scripts are separate dependencies. `021-field-object.sql` similarly supplies no seeded placements; original map/NPC WZ data remains necessary.

## Integration, payoff, and limits

`client/tools/extract.js` imports `extractServerData` and publishes its result as `catalog.serverData`. The existing resource/release traversal follows these ordinary descriptors; no competing hash/publication convention is introduced. Consolidated extraction and complete-release installation now include all six reference resources. See [expanded acceptance](archive/validation-history.md#current-expanded-fidelity-acceptance).

Immediate payoff is the existing drop consumer: a provenance-checked, correctly located Cosmic drop source now uses a statement-aware parser, so commented tuples, unrelated six-column tables, malformed rows, and unsafe integer values cannot become drops. Its 22,157 full-source rows reproduce the domain drop table exactly; selected-map filtering and drop coverage remain in `drop-data.js`.

The shop dataset provides concrete NPC mapping, item ID, price, alternate-payment field and ordering for an offline standard-shop consumer without shipping SQL or running a server. Loading reference JSON **alone does not implement shop interaction**; purchases still need original item metadata/artwork, inventory capacity/payment checks, and script/quest routing. Global/reactor drops, Maker, card and cash tables are immutable research/reference inputs, not silently enabled new mechanics. Original chance meanings differ between server subsystems; publishing raw `chance` does not normalize them to mob-drop odds. Empty persistence/moderation/market schemas have no world-content payoff and are report-only.

Current native mob death/drop/pickup and durable reload passed in the [item report](ingame-validation/expanded/items/evidence.json). No shop runtime is enabled. A future supported shop controller must retain NPC11000's explicit11000 rather than1337 selection, native item/payment/capacity semantics, and9201099's quest gate; SQL presence alone cannot authorize interaction.

## Executed scoped proof

The standalone CLI completed on the supplied files. Its `--help` was executed. A throwaway Bun smoke program executed conversion twice and compared complete descriptors, rehashed and byte-checked all six published resources, matched all 22,157 migrated drop tuples to the published drop domain, checked absence of bootstrap password hashes/account tables, and exercised comments, quoted semicolons, doubled quotes, NULL-capable literal parsing, negative integers, rejected subqueries/UPDATE, duplicate case-insensitive INSERT columns, wrong drop tables, and unsafe drop integers. No project build, linter, formatter, test suite, or full extraction was run by this worker.

The currency metadata smoke additionally loaded the original `Item.wz:Special/0900.img` and exercised all 16 currency Canvas nodes without publishing an atlas. `extractDropArtwork` now uses client `00506e62` InsertCanvas delays from `docs/ghidra-drop-motion/drop-native-helpers.txt`: variants 0/1 `[80,80,80,80]` ms, variant 2 `[200,200,200,200]` ms, variant 3 `[4000,120,120,120]` ms. Both the returned animation frames and bundle asset metadata carry the native values rather than a guessed 120 ms fallback. This is metadata proof, not a browser-animation playtest.

Executed resource identities:

| Resource | Bytes | SHA-256 |
| --- | ---: | --- |
| shops | 305505 | `20d8ec0e58fcd854fce5cbbb864c927485ced8f8ada022bc941124ab22df2b7e` |
| drops | 2447259 | `1d00f77d513711baacca5d4e70652a089343964b50fa099632785e330cf4ec85` |
| crafting | 223259 | `94415c242c8d41947a443c131eaf1682d097156dde3cdb4c52540101cf9782d7` |
| cards | 12296 | `ef50bb78c07884cea87ae9da1b6e1e99d590951d320fb7ee27678fece579b59a` |
| cash | 3439 | `f003efbb6f4c48de75e53f644d45cd7f3846c0ce6b8e2a313d21faa3ce303b9c` |
| report | 359575 | `ea762ef1e2f4c980a64b134f60fc25bb9730323e20b077efc019665e85b31c63` |
