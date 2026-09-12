# Authoritative browser-game protocol

**Status: runtime contract with explicit validation gates.** The Bun server and separate online browser implement this web-native authority boundary; offline play remains independent. Start with `bun run server:dev` and `bun run client:dev:online`; see [configuration and production gates](index.md). This is not a claim of complete original-server fidelity or an anti-cheat certification. Development/reference rules are versioned policies, not recovered Nexon server equations. Required adversarial/durability checks below remain requirements unless the [measured validation record](../validation.md) reports their execution.

## Decisions and research

Use **HTTPS for authentication/content and one same-origin WSS connection for gameplay**, implemented with Bun and plain JavaScript/JSDoc. Start with a modular monolith and PostgreSQL, one authoritative owner per field instance and one writer lease per character. Do not begin with microservices, distributed simulation, peer authority, or a bespoke UDP stack.

| Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                     | Design consequence                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Fiedler: networking and client prediction](https://gafferongames.com/post/what_every_programmer_needs_to_know_about_game_networking/) explains why reporting client position permits teleporting and why replay follows authoritative correction. [Nakama authoritative multiplayer](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/) independently describes fixed-tick validation and single-node match ownership. | Send input/intent, not claimed results. Server simulates movement, mobs, hits, rewards and transitions. Prediction is disposable presentation.                                                                    |
| [Fixed timestep](https://gafferongames.com/post/fix_your_timestep/) explains variable-step instability and overload. The current [integration contract](../offline-integration-contract.md) uses a 30 ms simulation quantum.                                                                                                                                                                                                                 | Initially share the existing 30 ms quantum, not an invented 60 Hz rewrite. Network publishing cadence is separate. Profile before changing either.                                                                |
| [MDN WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) documents the absence of receive backpressure; [Bun WebSockets](https://bun.sh/docs/runtime/http/websockets) documents send outcomes and drain handling.                                                                                                                                                                                                         | Bound ingress, queues, snapshots, and buffered bytes explicitly. A successful send is not an application commit acknowledgement.                                                                                  |
| [MDN WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport) offers HTTP/3 reliable streams and datagrams.                                                                                                                                                                                                                                                                                                              | Consider it only after measuring WSS head-of-line delay under realistic loss and checking target browsers/proxies. It does not improve authority. Avoid WebRTC peer negotiation/ICE/TURN for a server-owned game. |
| [OWASP WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) covers origin checks, CSWSH, per-message authorization, limits, session revocation and safe logging.                                                                                                                                                                                                                          | Authenticate upgrades, validate every command, revoke live sessions, disable message compression initially, and never treat origin or content hashes as anti-cheat.                                               |
| [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) distinguishes Read Committed from Serializable, including serialization retries.                                                                                                                                                                                                                                                            | Economy writes use short transactions, explicit invariants, durable operation receipts and bounded whole-transaction retries. Never announce an economic success before commit.                                   |

The Valve developer networking page was blocked by its bot challenge during research; it is not cited as inspected evidence. No third-party-client implementation was used.

### What Cosmic contributes—and does not

The authorized reference tree was used as an **inventory of validation questions**, not a secure protocol, authoritative rulebook or original Nexon source. Concrete examples under `src/main/java/net/server/channel/handlers/`:

- `MovePlayerHandler.java:31–44` reads movement, updates position and broadcasts it. This design does **not** accept a client movement result as authority.
- `ChangeMapHandler.java:48–168` combines trade cancellation, death/revival, client target-map IDs, exceptional tutorial/GM branches, portal status and proximity. Here those become distinct server state-machine transitions; there is no general client target-map field.
- Handler families for attacks, pickup, scrolling, NPC conversations, quests, cash and trading identify domains requiring checks. Their presence is not a security audit or proof that their existing checks are sufficient.

Map topology, footholds, artwork and recoverable client mechanics come from original WZ/Ghidra evidence. Drop probabilities, economic policy, quest admission and other server-only rules require an explicitly reviewed, versioned ruleset. Importing reference content never implicitly imports trust decisions. The [reference-data contract](../offline-data.md) retains provenance; secrets and administrative bootstrap rows remain excluded.

## Threat model and non-negotiable invariants

Assume an attacker controls JavaScript, service workers, IndexedDB, clocks, input rate, message order/content, multiple accounts and socket reconnects. They can implement a new client and know all published assets/rules. TLS protects transport, not honesty. No browser-held secret, client signature, obfuscation, source hash or proof of asset loading grants authority.

1. Only the character bound to the authenticated connection may act. Payloads cannot choose the acting account, character, role or field owner.
2. The server owns position/velocity/foothold, HP/MP, job, stats, skills, cooldowns, mobs, damage, drops, inventory, currencies, quests and clocks.
3. A character has exactly one active field membership and one writer lease. Old connections and old field generations cannot mutate it.
4. Every item instance has one owner/location. No negative quantity/currency, duplicate UID, double pickup, repeated reward or partially committed trade.
5. A map transition has a server-established cause. A client cannot load map B and thereby enter B.
6. Random outcomes are generated by server-owned state and committed once. Client seeds, reported hits, claimed damage and local saves are never inputs to reward authority.
7. Online loss of connectivity freezes online command admission. It **never** silently switches the online character to local authority or later merges offline earnings.
8. Development grants, monster spawning, arbitrary map selection and profile edits have no gameplay protocol representation. Production bundles should omit their UI, but server rejection—not UI hiding—is the boundary.

Automation/bots, account abuse, denial of service and information leaks still require operational controls. Server authority prevents forged state; it cannot prove that input came from a human.

## Ownership and shared code

```mermaid
flowchart LR
  UI[Browser input and UI] --> Port[Intent and observation interface]
  Port --> Local[Offline authority]
  Port --> Network[Online transport]
  Network --> Gate[Authenticated bounded ingress]
  Gate --> Field[Single-owner field simulation]
  Field --> Rules[Shared pure rules]
  Local --> Rules
  Local --> IDB[IndexedDB offline save]
  Field --> Economy[Transactional economy]
  Economy --> DB[PostgreSQL and outbox]
  Field --> View[Recipient-filtered observations]
  View --> Network
```

The online entry uses separate transport, prediction, read models and presentation. `InGameSystems`, `NativeInterfaces`, `OfflineField` and `ProfileStore` remain offline authority owners and are not instantiated as online controllers.

| Share without browser/server forks                                                                                                                                           | Keep authority-specific                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Validated immutable content; foothold geometry, movement integration, item/skill/quest predicates, bounded command decoders, result codes, deterministic calculation kernels | Authentication, character leases, authoritative clocks/RNG, instance routing, database transactions, audit and abuse controls |
| UI/view models, animation/audio, native input mapping, asset delivery; the browser uses common movement kernels for prediction                                               | DOM/Pixi/audio and service worker only in browser; no server dependence on rendering or asset Canvas objects                  |
| Domain intents and observable outcomes for online and offline modes                                                                                                          | Local IndexedDB authority and development grants stay offline; online observations are server-owned read models               |

`shared/` owns closed protocol validation and capture/restore/single-quantum motion around the existing browser-independent physics kernel. Server adapters supply clocks, RNG, field ownership and durable commits; the browser supplies disposable prediction and read-only presentation. Reused rule modules retain their development/reference provenance. Clients may run checks for responsiveness, but the server independently admits every operation against current state. NPC execution uses bounded authored adapters, not arbitrary evaluation or client-selected function names; unsupported programs fail explicitly.

## Transport and session lifecycle

### HTTP endpoints

All authenticated responses use `Cache-Control: no-store`; service workers cache only public immutable shell/content, never session or online state. Same-origin policy and exact configured HTTPS origins apply.

| Endpoint                    | Request                                                | Response and authority                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/config`        | No credentials required                                | `{v:1,assetBuildId,rulesHash,catalogHash,development,csrfToken,loginToken}`; establishes prelogin HttpOnly SameSite CSRF cookie. Authenticated responses also include `role` and `expiresAt`. `loginToken` is the hashcash login-nonce token and stays independent of a surviving session cookie. |
| `GET /api/v1/challenge`     | Prelogin CSRF cookie                                   | `{challengeId,bits,expiresAt}` hashcash challenge for sign in or sign up: single use, 120 s lifetime, at most 4096 live, 10/60 s per address, bound to the login nonce cookie and client address. Read-only, so the browser's missing same-origin `Origin` header is not required. |
| `POST /api/v1/session`      | `{name,password,csrfToken,challengeId,nonce}`; credentials never in URLs | `{csrfToken,expiresAt,role}` and HttpOnly SameSite session cookie, Secure in production. The proof of work is consumed before any password work.                                      |
| `POST /api/v1/accounts`     | `{name,password,csrfToken,challengeId,nonce}`          | Same response as sign in; creates a player account (`3..16` name, `8..256` password) together with one default level-1 beginner character in a single durable operation. `NAME_TAKEN` when the name exists. |
| `GET /api/v1/characters`    | Session cookie                                         | Only account-owned character summaries `{id,name,level,job,gender,appearance,equipment}`: appearance and gender come from the stored profile, `equipment` from that character's authoritative equipped item rows (id plus signed slot, bounded to 32). No mutable profile upload. |
| `POST /api/v1/characters`   | `{csrfToken,name,gender,skin,face,hair,str,dex,int,luk,weapon,top,bottom,shoes}` | Creates one account-owned character and returns its summary: name `4..13` letters/digits unique on the account (`NAME_TAKEN`), each stat an integer `4..13` summing to 25 (the packaged baseline total). Appearance and the four always-present apparel choices are admitted only against the recovered original create sets in `Etc.wz:MakeCharInfo.img/Info` (`ui.characterCreate`): gender `0`/`1` selects its branch, `skin`/`face`/`top`/`bottom`/`shoes`/`weapon` must be members, and `hair` is a base id plus its colour suffix, split by the last decimal digit exactly as the reference validator does. Each admitted id must also be a rendered packaged catalog entry, so the endpoint can never grant unpainted art; starter apparel must be non-cash equipment of that slot group at level 10 or below, and the equip slot is derived server-side from `equippedSlots[0]`. Bounded per account (`CHARACTER_LIMIT`). Level 1, job 0, EXP 0, mesos 0 with vitals recomputed, inserted atomically. |
| `DELETE /api/v1/characters/:id` | `X-CSRF-Token` header (no body)                    | Soft-deletes one account-owned character: `{deleted:{id}}`. The row keeps its identity so the append-only `operation_receipt`, `character_op_log`, `character_snapshot` and `development_audit` records stay valid, while the character disappears from `GET /api/v1/characters`, stops counting against `CHARACTER_LIMIT`, frees its name on the account, and can never take a writer lease again (`NOT_FOUND` rather than `CHARACTER_BUSY`). A character whose lease is still live is refused (`CHARACTER_BUSY`) instead of being deleted out from under its session, and another account's character is `NOT_FOUND`. |
| `POST /api/v1/play-ticket`  | `{characterId, csrfToken}`                             | One-use opaque 256-bit ticket, 30 s expiration; binds session, owned character, protocol and account restrictions. Does not acquire the writer lease yet.                          |
| `DELETE /api/v1/session`    | Session plus `X-CSRF-Token`                            | Revoke session/tickets and close bound sockets immediately.                                                                                                                        |
| `GET /generated/...`        | Public immutable catalog descriptor URL                | Verified hashed resources; rules identity comes from the server.                                                                                                                   |
| `GET /api/v1/content/:hash` | Authenticated active actor                             | Authorized interaction content `{text,npcTemplateId}`; not an arbitrary file reader.                                                                                               |
| `POST /api/v1/development`  | Closed development envelope below                      | Development-only authenticated, role-scoped and audited authority request; absent in production.                                                                                   |

The online client presents a custom Windows 95 themed sign in / create account window rather than extracted original login artwork. It mines the hashcash challenge in the browser (SHA-256 over `challengeId.nonce` with the server-advertised `bits`), then presents the account's characters in a spotlight carousel and enters the world directly: there is no world or channel list. An account with no characters opens the creation wizard instead: roll the dice (four stats, each 4..13, totalling 25), review the composed avatar preview and its packaged look options, name the character, and it joins the carousel. Launcher-created development accounts stay available and are never produced by registration. Name uniqueness is per account because names live only inside the profile JSON; a global unique index is not part of this revision.

Ticket/session lifetimes and numeric limits here are **initial engineering policy**, not recovered MapleStory constants or measured capacity guarantees.

### Development requests

The separate HTTP envelope is `{csrfToken,connectionEpoch,operationId,action}`. It never accepts an acting character ID; the server selects the owned live actor. Exact configured Origin, developer role, current session/connection epoch, CSRF, bounded body/rate and audit are required. Every record is closed; unknown keys fail. This namespace is absent outside explicit loopback development. Hiding UI is not the security boundary.

| `action.kind` | Entire action payload after `kind`                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `map`         | `mapId:integer 0..999999998`; server resolves arrival and field admission.                                                                                                                                                                                                                                                            |
| `preset`      | `job:integer 0..9999`; server validates a supported preset and commits profile/loadout together.                                                                                                                                                                                                                                      |
| `profile`     | Nonempty `patch` with only `name,level,job,exp,hp,mp,baseMaxHP,baseMaxMP,str,dex,int,luk,meso,fame,remainingAp`. Name length `1..32`; scalar integers `0..2147483647` except fame may start at `-30000`. Character rules impose narrower semantic ranges. No inventory, quests, position, IDs or arbitrary nested object replacement. |
| `spawn`       | `templateId:integer 1..99999999,count:1..10`; server validates original content and legal spawn.                                                                                                                                                                                                                                      |
| `pause`       | `paused:boolean`; changes server simulation, not draw cadence.                                                                                                                                                                                                                                                                        |
| `step`        | `ticks:1..4`; field must already be paused.                                                                                                                                                                                                                                                                                           |
| `physics`     | Closed `globals` and `map` records with the allowlists below.                                                                                                                                                                                                                                                                         |

There is no generic gameplay `patch`, development WebSocket action or online save upload. Profile/physics allowlists and value ranges are validated by the server, not inferred from form inputs. No online reset is promised. Camera, geometry and visibility controls remain browser-local because they cannot change authoritative outcomes. A successful request is not permission to mutate the browser read model: subsequent server observations publish state.

Development characters enter account-private fields (`development:<accountId>`), separate from the public player realm. Spawn/pause/step/physics additionally refuse fields containing another account or nondeveloper. Spawning requires a living grounded character, an unpaused field, supported mob content, no more than 4096 total mobs and 128 development spawns per field.

Physics `globals` accepts only `walkForce,walkSpeed,walkDrag,slipForce,slipSpeed,floatDrag1,floatDrag2,floatCoefficient,swimForce,swimSpeed,flyForce,flySpeed,gravityAcc,fallSpeed,jumpSpeed,maxFriction,minFriction,swimSpeedDec,flyJumpDec`, each finite and greater than zero through `1000000`. `map` accepts only `fs`, finite `0..100`. The authority prepares replacement simulation settings before publication; the request cannot change the 30ms quantum. Other original physics options remain unavailable through this endpoint.

Physics development requests require a paused field. The authority snapshots the replacement effective coefficients before restoring the prior motion continuation, so restoring the checkpoint cannot overwrite the requested settings.

### WebSocket establishment

1. Upgrade only `/api/v1/play`, WSS, RFC 6455, subprotocol `openms.game.v1`, valid session cookie and exact allowlisted `Origin`. Reject missing/null origin for this browser-only endpoint. Origin is CSWSH protection, not authentication against custom clients.
2. Limit unauthenticated upgraded sockets; admit only `hello` for at most 5 s. Its one-use ticket is in the first message, never query strings or subprotocol tokens. Consume the ticket atomically and recheck ownership/session state.
3. Acquire a character writer lease with monotonically increasing fencing generation. An existing live owner yields `CHARACTER_BUSY`; resume is allowed only for that authenticated play session after the old socket is fenced. Never allow two tabs to advance one character.
4. Return `welcome`, then a full authoritative snapshot. Character membership is established by the server; the client cannot request an arbitrary starting map/XY. On a new login, nearest authored spawn is computed from the **server's** last persisted XY. A short reconnect resumes the existing live field state, not a fresh spawn exploit.
5. Client validates protocol, rules and content requirements before interactive rendering. `ready` acknowledges receipt/display preparation only; it cannot invent state, force a transition or extend an invulnerability window.
6. Heartbeats detect a dead connection; session revocation is checked on every admission and expiry is scheduled server-side. On disconnect, inputs become neutral after the bounded hold window; the avatar is not instantly safe or removed from combat.

## Wire schema v1

The following closed-record definitions are the wire contract, enforced by `shared/protocol.js`. Every property listed is required unless suffixed `?`. Reject unknown properties at every depth, unknown union tags, duplicate object keys, invalid UTF-8, overlong/deep collections and noncanonical numeric values. `null` is accepted only where explicitly listed. Do not coerce strings to numbers or use prototype-bearing dictionaries as dispatch tables.

### Primitive types and bounds

| Type                | Definition                                                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `U32`               | Integer 0…4,294,967,295; no fractional value or negative zero.                                                                                                                                                                      |
| `Seq`               | Integer 1…9,007,199,254,740,991; no wrap. A connection must restart before exhaustion.                                                                                                                                              |
| `Tick` / `Revision` | Safe nonnegative integer; tick units are 30 ms inside one field generation, revision is a domain commit counter, not wall time.                                                                                                     |
| `ServerTime`        | Safe nonnegative integer milliseconds since the server epoch. The only time base for anything that must survive a restart, a field handoff or a map transition.                                                                     |
| `Id`                | Opaque server-issued string `[A-Za-z0-9_-]{1,64}`, minted from at least 128 random bits so it is not enumerable or guessable; never a user-chosen object path.                                                                      |
| `Ticket`            | One-use base64url bearer credential, exactly 43 characters (256 bits). Deliberately not an `Id`: never logged, echoed in an observation, or stored in a receipt.                                                                    |
| `OperationId`       | Client-generated lowercase UUIDv4; idempotency key, not authorization.                                                                                                                                                              |
| `Hash`              | Exactly 64 lowercase hexadecimal SHA-256 characters.                                                                                                                                                                                |
| `TemplateId`        | `U32` additionally admitted against server rules; map IDs at most 999,999,998, sentinel excluded.                                                                                                                                   |
| `Quantity`          | Integer 1…2,147,483,647; per-item stack/transaction limits are stricter.                                                                                                                                                            |
| `Mesos`             | Integer 0…2,147,483,647; all totals/intermediates checked before conversion/storage.                                                                                                                                                |
| `Axis` / `Facing`   | Axis is -1, 0 or 1; facing is -1 or 1. Conflicting directions normalize before encoding.                                                                                                                                            |
| `Point`             | `{x:number,y:number}`; finite binary64 world pixels, absolute component ≤1,048,576. Only server observations use world position.                                                                                                    |
| `Target`            | `{kind:"entity",entityId:Id}` or `{kind:"aim",x:number,y:number}` where finite x/y are unit direction components in [-1,1], nonzero vector normalized by server. A target is a hint, never a confirmed hit or teleport destination. |
| `Text`              | Unicode text, at most 256 code points and 1,024 UTF-8 bytes; reject disallowed control characters. Render as text, not HTML or NPC markup.                                                                                          |

No client date, delta-time, damage, reward, position or acting-character field is accepted. Timing hints are explicitly bounded below. All array bounds apply before allocating decoded domain state; transport byte bounds apply before JSON parsing. Timers that must outlive a socket, a field generation or a process are `ServerTime`; field-local `Tick` values only order work inside one field generation and drive presentation, and may never express a cooldown, an effect expiry or a transition deadline.

### Client records

Before welcome:

`Hello = {v:1, type:"hello", ticket:Ticket, rulesHash:Hash, assetBuildId:Hash, resume?:{playSession:Id,lastEventSeq:Seq}}`

Hashes negotiate compatibility, not trust. Resume requires a fresh ticket/session; the play-session ID alone is not a bearer credential. A mismatched `v`, rules hash or asset build is refused before any field work with `UNSUPPORTED_VERSION` or `CONTENT_MISMATCH` plus `closing`, and the ticket is consumed either way; the server never silently downgrades or serves a partially compatible build.

After welcome every client record contains `{v:1, type, connectionEpoch:Id, seq:Seq}`. `seq` is strictly increasing across this socket, including control messages. WSS is ordered; a gap or repeat is a protocol fault: the server stops admitting gameplay for that socket, sends `closing` with `INVALID_MESSAGE`, and the client reconnects with a fresh ticket. It never speculatively replays or rewinds, and the fault alone does not end the account session or the character lease. `connectionEpoch` is server minted for each socket and revokes its predecessor.

| `type`    | Additional fields                                                                                            | Meaning                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `input`   | `fieldEpoch:Id, inputSeq:Seq, targetTick:Tick, horizontal:Axis, vertical:Axis, jump:boolean, attack:boolean` | One full held-input sample for a server tick. Separate `inputSeq` is acknowledged for reconciliation.     |
| `command` | `fieldEpoch:Id, operationId:OperationId, expectedRevision:Revision, action:Action`                           | One discrete intent. Revision is the domain revision named by the action table, not a general world tick. |
| `ready`   | `fieldEpoch:Id, snapshotId:Id`                                                                               | Exact offered snapshot has been installed locally.                                                        |
| `ack`     | `eventSeq:Seq, snapshotId:Id`                                                                                | Highest contiguous event and installed snapshot. Does not confirm economic success to the server.         |
| `resync`  | `fieldEpoch:Id, lastEventSeq:Seq, reason:"gap" or "baseline" or "prediction-overflow"`                       | Request a replacement snapshot; rate limited.                                                             |
| `pong`    | `nonce:Id`                                                                                                   | Echo current server heartbeat challenge only.                                                             |

If no events exist yet, omit resume entirely; subsequent cursors are positive sequences. A connection must receive the initial snapshot before commands. The server checks lease and field ownership on every command, even for actions affecting social/economic state. Commands admitted while transitioning are limited to acknowledgement/resync/pong.

### Closed action union and validation matrix

Each row defines the **entire** `Action` record. Literal tags are exact. No generic `set`, `patch`, script call, item grant, mob spawn or arbitrary warp exists. All rows also require active session, owned character, allowed lifecycle state, bounds, rate admission and current field epoch. Checks use authoritative state at execution, not only gateway receipt.

| Action record                                                                                                                        | Revision domain | Additional server checks and derived outcome                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{kind:"portal.enter",portalId:U32}`                                                                                                 | Character       | Resolve portal in current field; legal portal type, contact/activation geometry, facing/input if required, alive/state/cooldown, quest/event/ticket gates. Derive destination map, instance and spawn from server rules.                                                                     |
| `{kind:"revive.request",method:"return" or "consumable"}`                                                                            | Character       | Must be dead, permitted return rule; consumable ownership/use and spawn chosen by authority. Client never reports death or remaining HP.                                                                                                                                                     |
| `{kind:"skill.cast",skillId:TemplateId,target?:Target}`                                                                              | Character       | Learned rank/job/mastery, equipped weapon/ammo, MP/HP, cooldown, status/form, action timing and field restrictions; server chooses affected targets, hit geometry, RNG, damage/costs. Movement skills use server collision/landing, not client coordinates.                                  |
| `{kind:"buff.cancel",effectId:Id}`                                                                                                   | Character       | Owned, active and cancelable effect; recompute derived stats. Cannot clear hostile status or cooldown by ID.                                                                                                                                                                                 |
| `{kind:"drop.pickup",dropId:Id}`                                                                                                     | Inventory       | Live same-instance drop, authoritative pickup geometry, owner/party/time restrictions, capacity and currency ceiling. Consume drop and credit inventory exactly once.                                                                                                                        |
| `{kind:"inventory.move",itemId:Id,quantity:Quantity,to:{tab:"equip" or "use" or "setup" or "etc" or "cash",slot:U32}}`               | Inventory       | Own source instance, slot/tab bounds, stack compatibility, restrictions/locks; atomic split/merge/move and new UIDs chosen by server.                                                                                                                                                        |
| `{kind:"equipment.equip",itemId:Id,slot:U32}`                                                                                        | Inventory       | Owned equipment, compatible slot/job/level/stats/gender, two-hand/offhand conflicts, locks; atomic swap, derived appearance/stats.                                                                                                                                                           |
| `{kind:"equipment.unequip",itemId:Id,toSlot:U32}`                                                                                    | Inventory       | Actually equipped, removable and destination capacity; no special bypass via negative slot.                                                                                                                                                                                                  |
| `{kind:"item.use",itemId:Id,target?:Target}`                                                                                         | Inventory       | Owned quantity, template's use mode, restrictions/cooldown and valid effect target; consumed quantity and effects chosen by server.                                                                                                                                                          |
| `{kind:"equipment.scroll",scrollId:Id,equipmentId:Id,protectionId?:Id}`                                                              | Inventory       | Own scroll/target/protection, compatible equipped or inventory target, slot capacity and rule restrictions, no trade lock; server rolls and atomically consumes, updates or destroys target.                                                                                                 |
| `{kind:"item.drop",itemId:Id,quantity:Quantity}`                                                                                     | Inventory       | Own and droppable, not locked/quest-protected; atomic debit plus server-positioned drop entity.                                                                                                                                                                                              |
| `{kind:"mesos.drop",amount:Mesos}`                                                                                                   | Inventory       | Amount strictly positive and within drop/balance limits; atomic debit and server-created drop.                                                                                                                                                                                               |
| `{kind:"npc.open",npcId:Id}`                                                                                                         | Character       | Live same-instance NPC entity, supported route, exclusive conversation lease and current admission. The original client gates NPC interaction by rendered artwork and modal/lifecycle state, not by distance, so no invented reach limit is applied; template/name does not choose a script. |
| `{kind:"npc.answer",conversationId:Id,step:U32,answer:Answer}`                                                                       | Conversation    | Exact current dialogue step and allowed answer variant/choice/bounds, entity lifecycle and lease; run bounded server script capability with fresh state. Advancement is a script/domain result, never `setJob`.                                                                              |
| `{kind:"quest.accept",questId:TemplateId,conversationId:Id,step:U32}`                                                                | Character       | Matching NPC conversation offer, prerequisite/job/level/time/quest state and capacity.                                                                                                                                                                                                       |
| `{kind:"quest.claim",questId:TemplateId,conversationId:Id,step:U32,rewardChoice?:U32}`                                               | Character       | Active and all requirements still met, matching offer/NPC/step, valid reward choice and capacity; consume requirements and grant once in one transaction. A ready toast is not proof.                                                                                                        |
| `{kind:"quest.abandon",questId:TemplateId}`                                                                                          | Character       | Active and abandonable, atomically reset only authorized progress/items.                                                                                                                                                                                                                     |
| `{kind:"shop.buy",shopSession:Id,rowId:U32,quantity:Quantity}`                                                                       | Inventory       | Live admitted NPC shop/range, row from server-owned offer, stock, price/currency, quantity multiplication and capacity. Client never sends accepted price or output template.                                                                                                                |
| `{kind:"shop.sell",shopSession:Id,itemId:Id,quantity:Quantity}`                                                                      | Inventory       | Same shop lease, own sellable unlocked item, server price and balance capacity; debit/credit atomically.                                                                                                                                                                                     |
| `{kind:"shop.recharge",shopSession:Id,itemId:Id}`                                                                                    | Inventory       | Rechargeable owned stack, server maximum/current charges, full server-calculated price and capacity.                                                                                                                                                                                         |
| `{kind:"trade.invite",targetId:Id}`                                                                                                  | Character       | Same-field visible eligible character, range, invitation rate/consent rules and no conflicting trade.                                                                                                                                                                                        |
| `{kind:"trade.answer",invitationId:Id,accept:boolean}`                                                                               | Invitation      | Intended recipient, fresh invitation, both participants still eligible.                                                                                                                                                                                                                      |
| `{kind:"trade.offer",tradeId:Id,items:[{itemId:Id,quantity:Quantity}],mesos:Mesos}`                                                  | Trade           | At most nine distinct owned transferable unlocked item IDs; funds/capacity/participant membership; replace own offer, increment trade revision, invalidate both confirmations.                                                                                                               |
| `{kind:"trade.confirm",tradeId:Id}`                                                                                                  | Trade           | Exact observed trade revision; commit only once both participants confirm same revision and all locks/funds/capacity still validate.                                                                                                                                                         |
| `{kind:"trade.cancel",tradeId:Id}`                                                                                                   | Trade           | Participant and active session; release reservations without crediting escrow twice.                                                                                                                                                                                                         |
| `{kind:"stats.allocate",stat:"str" or "dex" or "int" or "luk" or "hp" or "mp",amount:Quantity}`                                      | Character       | Available AP, job and stat ceilings; compute HP/MP gains, never accept final stat.                                                                                                                                                                                                           |
| `{kind:"skills.allocate",skillId:TemplateId,amount:Quantity}`                                                                        | Character       | Correct SP pool, rank/mastery cap, prerequisites and available points.                                                                                                                                                                                                                       |
| `{kind:"chat.send",channel:"map" or "whisper" or "party" or "buddy" or "guild" or "alliance" or "spouse",recipientId?:Id,text:Text}` | Social          | Recipient required only for whisper; membership/mute/block/consent, rate and privacy. Sender and routing derived by server.                                                                                                                                                                  |

Each row's durability class is defined in [Durability classes](#durability-classes); the admission checks above are independent of whether the resulting effect is ephemeral, checkpointed or transactional.

`Answer` is exactly one of `{kind:"next"}`, `{kind:"previous"}`, `{kind:"cancel"}`, `{kind:"yesno",value:boolean}`, `{kind:"choice",choiceId:U32}`, `{kind:"number",value:integer}` (safe integer within current offered bounds), or `{kind:"text",value:Text}`. A choice ID is meaningful only in the current server-issued conversation step. Script text/artwork tokens come from trusted content; arbitrary chat/user names cannot be parsed as script markup.

Online text answers retain the `Text` ceiling of 256 Unicode code points and 1024 UTF-8 bytes even when the authored NPC VM permits 4096 characters. The server offers `maximum=min(authoredMaximum,256)` and retains the authored minimum; if that minimum exceeds 256, the step is unsupported and rejected rather than silently weakening its condition or widening the wire decoder.

Other currently offline features—guild administration, family, cash commerce, storage, mail and markets—are **not enabled online by this v1 schema**. They require explicit closed commands and equivalent membership/ledger/receipt contracts before online enablement; no generic RPC escape hatch fills the gap. Payment-provider confirmation must use a separately authenticated server-to-server webhook with a unique provider receipt, never a browser `paid:true`. This online boundary does not reduce offline gameplay.

### Server records

Every server record after establishment contains `{v:1,type,connectionEpoch:Id,serverTick:Tick}`. State/event IDs are minted by the authority and scoped to the play session/field as specified. The following records are closed; text errors are optional diagnostics, never executable client instructions.

| `type`       | Additional fields                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `welcome`    | `playSession:Id,fieldEpoch:Id,rulesHash:Hash,assetBuildId:Hash,serverTime:ServerTime,tickMs:30,inputLeadTicks:U32,inputBufferTicks:U32,resume:"continued" or "snapshot",limits:{inputPerSecond:U32,commandPerSecond:U32,maxMessageBytes:U32}` |
| `snapshot`   | `snapshotId:Id,fieldEpoch:Id,eventSeq:Seq,ackInputSeq:Seq or null,part:U32,parts:U32,view:SnapshotPart`                                                                                                                                       |
| `state`      | `snapshotId:Id,baseSnapshotId:Id,fieldEpoch:Id,eventSeq:Seq,ackInputSeq:Seq or null,changes:[EntityChange]`                                                                                                                                   |
| `motion`     | `fieldEpoch:Id,ackInputSeq:Seq or null,paused:boolean,motion:MotionCheckpoint`; private self continuation state, no event cursor.                                                                                                             |
| `result`     | `eventSeq:Seq,operationId:OperationId,status:"committed" or "rejected",code:ResultCode,domainRevision:Revision,transactionId:Id or null`                                                                                                      |
| `event`      | `eventSeq:Seq,fieldEpoch:Id,event:DomainEvent`                                                                                                                                                                                                |
| `transition` | `eventSeq:Seq,transitionId:Id,phase:"prepare" or "committed" or "aborted",sourceEpoch:Id,destination:FieldRef or null,requiredContent:[Hash],deadline:ServerTime,code:ResultCode`                                                             |
| `ping`       | `nonce:Id,serverTime:ServerTime,roundTripMs:U32 or null`; server-measured elapsed milliseconds from the previous ping to its pong, null before the first sample. No client timestamp or authority hint.                                       |
| `closing`    | `code:ResultCode,retryAfterMs:U32`                                                                                                                                                                                                            |

`FieldRef={instanceId:Id,mapId:TemplateId,fieldEpoch:Id,spawn:Point}` is **server-only**. `ResultCode` is one of `OK`, `INVALID_MESSAGE`, `UNAUTHENTICATED`, `CHARACTER_BUSY`, `STALE_CONNECTION`, `STALE_FIELD`, `STALE_REVISION`, `OPERATION_CONFLICT`, `OPERATION_EXPIRED`, `NOT_ALLOWED`, `NOT_IN_RANGE`, `REQUIREMENTS_NOT_MET`, `NOT_FOUND`, `INSUFFICIENT_FUNDS`, `INVENTORY_FULL`, `COOLDOWN`, `RATE_LIMITED`, `CONTENT_MISMATCH`, `PROTOCOL_MISMATCH`, `UNSUPPORTED_VERSION`, `RESYNC_REQUIRED`, `TRANSITION_FAILED`, `SERVER_BUSY`, `SESSION_EXPIRED`. Rejections must not disclose unseen entities/private state. Client presentation maps codes to native feedback without exposing stacks/secrets.

`SnapshotPart` is one of these closed records; pages assemble under one snapshot identity/revision vector:

- `{kind:"field",field:FieldRef,characterRevision:Revision,inventoryRevision:Revision,socialRevision:Revision,self:SelfState}`.
- `{kind:"entities",entities:[EntityState]}` with at most 128 entries per part.
- `{kind:"inventory",items:[ItemState],mesos:Mesos,capacities:{equip:U32,use:U32,setup:U32,etc:U32,cash:U32}}` with at most 128 entries per part; capacities come from the server, not browser defaults.
- `{kind:"progress",quests:[QuestState],skills:[SkillState]}` with at most 128 total entries per part.

`SelfState={entity:EntityState,hp:U32,mp:U32,maxHp:U32,maxMp:U32,job:TemplateId,level:U32,exp:Revision,ap:U32,sp:[U32],stats:{str:U32,dex:U32,int:U32,luk:U32},effects:[EffectState]}`; ten SP pools, at most 128 effects. `EntityState={id:Id,kind:"player" or "mob" or "npc" or "drop",templateId:TemplateId,position:Point,velocity:Point,foothold:U32 or null,facing:Facing,action:U32,actionStartTick:Tick,appearance:Appearance or null}`. Velocity components use world pixels/second with the same finite bound, not destination positions. `action` indexes the published animation schema. `Appearance={name:Text,skin:U32,face:TemplateId,hair:TemplateId,equipment:[{slot:U32,templateId:TemplateId}]}` is required only for players (null otherwise); at most 32 unique slots. Only public appearance templates are sent, never peer equipment UIDs, hidden inventory or stat rolls.

`Appearance` additionally requires `gender:0 or 1` for original avatar composition. Animation IDs use the shared published `ANIMATION_ACTIONS` ordering; an unknown name/ID is a content error, not a guessed animation.

`ItemState={id:Id,templateId:TemplateId,quantity:integer 0..2147483647,location:{kind:"inventory",tab:"equip" or "use" or "setup" or "etc" or "cash",slot:U32} or {kind:"equipped",slot:U32},revision:Revision,equipment:EquipmentState or null}`. `EquipmentState={upgradesRemaining:U32,upgradesUsed:U32,stats:[{key:"str" or "dex" or "int" or "luk" or "hp" or "mp" or "pad" or "mad" or "pdd" or "mdd" or "acc" or "eva" or "speed" or "jump",value:integer}]}`; at most 14 unique keys, safe integer values limited by rules.

**Server-only quantity extension:** `ItemState.quantity` is integer `0..2147483647`, rather than client `Quantity`. Zero represents a depleted original rechargeable-ammunition instance only; template-aware profile/database rules reject zero for other items. Every client command quantity and offered trade quantity remains strictly positive `1..2147483647`. An observed empty rechargeable is not permission to create, transfer or offer a zero-quantity item.

`QuestState={id:TemplateId,state:"active" or "claimed",ready:boolean,revision:Revision,objectives:[{kind:"item" or "kill",templateId:TemplateId,current:U32,required:U32}]}`; at most 128 objectives. `SkillState={id:TemplateId,rank:U32,mastery:U32,cooldownUntil:ServerTime}`. `EffectState={id:Id,templateId:TemplateId,expiresAt:ServerTime,cancelable:boolean}`. Cooldowns and effect expiries are absolute server time because both must survive a reconnect, a field handoff and a restart; a tick value restarts with the field generation. `EntityState.actionStartTick` and a combat event's `impactTick` stay field-local ticks: they order presentation inside one generation and are never used for admission or durability.

`EntityChange` is `{kind:"upsert",entity:EntityState}` or `{kind:"remove",entityId:Id}`. No arbitrary JSON Patch or object-path mutation is accepted. Progress/economy changes publish replacement snapshot parts with a new snapshot identity/revision vector; do not misuse entity deltas for inventory writes.

`DomainEvent` is a closed union:

- `{kind:"combat",actionId:Id,actorId:Id,skillId:TemplateId or null,hits:[{targetId:Id,damage:U32,outcome:"hit" or "miss" or "guard"}],impactTick:Tick}`; at most 32 hits. Actual HP stays authoritative; the event drives presentation only.
- `{kind:"quest.ready",questId:TemplateId,questRevision:Revision}`; notify on not-ready → ready, not on claim, deduplicate by event sequence/quest revision. Current readiness is also in the snapshot so reconnect does not replay old sounds.
- `{kind:"dialogue",conversationId:Id,step:U32,npcId:Id,contentId:Hash,choices:[U32],input:"next" or "yesno" or "choice" or "number" or "text",minimum:integer or null,maximum:integer or null}`; at most 128 choices; trusted content hash resolves authored text/markup, number/text bounds apply only to that input kind.
- `{kind:"dialogue.closed",conversationId:Id}`; explicit terminal observation for NPC/quest/shop completion, cancellation, expiry or transition. Clients close that conversation from the observation, never by inferring silence or a successful command alone.
- `{kind:"quest.offer",conversationId:Id,step:U32,npcId:Id,quests:[{questId:TemplateId,action:"accept" or "claim"}]}`; at most 128 current server-admitted offers, emitted only at the authored dialogue's final authorized confirmation page. Quest commands bind this same conversation and step; there is no direct accept/claim bypass.
- `{kind:"shop",shopSession:Id,npcId:Id,revision:Revision,part:U32,parts:U32,rows:[{rowId:U32,templateId:TemplateId,unitPrice:Mesos,stock:U32 or null}]}`; at most 128 rows/part, 64 parts/1 MiB total, same 5 s bounded assembly as snapshots. Parts share the admitted shop revision and session; rows become actionable only after complete assembly. Null stock means server-defined unlimited stock, not client permission. This v1 offer uses mesos; other currencies require a negotiated closed variant before online enablement. Reopening/closing/range loss revokes the prior shop session.
- `{kind:"chat",messageId:Id,senderId:Id,channel:"map" or "whisper" or "party" or "buddy" or "guild" or "alliance" or "spouse",text:Text}`.
- `{kind:"trade",tradeId:Id,revision:Revision,state:"invited" or "open" or "confirmed" or "committed" or "cancelled",participants:[Id],offers:[{ownerId:Id,items:[{item:ItemState,quantity:Quantity}],mesos:Mesos,confirmed:boolean}]}`; exactly two distinct participants, at most two offers, nine unique items per offer; only participants receive it. An invitation uses tradeId as invitationId until accepted.

`eventSeq` is an ordered publication cursor, not a count the client may use to infer other recipients' events: each play session receives its own contiguous event stream. `ackInputSeq` means the latest input applied or explicitly retired in the authoritative self state. Snapshot chunks carry the same cursor and are assembled before advancing it; ordinary events wait until snapshot assembly completes. Limits: 64 snapshot parts, 1 MiB total snapshot bytes, 5 s assembly deadline, one pending assembly per connection. Split frames must each fit the byte limit. Exceeding capacity fails admission/resync rather than truncating world state.

### Motion checkpoints

Position/velocity/foothold and presentation action are **not enough** to rewind the movement kernel. The server therefore publishes the explicit additional closed record `{v:1,type:"motion",connectionEpoch,serverTick,fieldEpoch,ackInputSeq,paused,motion}` immediately after the initial snapshot and at self tick cadence. `paused:boolean` is the server-owned field development pause observation; prediction holds scheduling while paused instead of advancing locally or repeatedly requesting resync. Only the affected character receives it; the client-to-server union has no motion/checkpoint record.

`MotionCheckpoint` is the closed continuation schema in [`shared/motion-schema.js`](../../shared/motion-schema.js), captured/restored by `shared/motion.js`. Protocol `v:1` versions this record; there is no independent nested `v` property. All fields below are required; unknown keys fail at every depth.

| Checkpoint fields                                                    | Types / constraints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x,y,vx,vy,previousX,previousY`                                      | Finite bounded coordinates/velocity scalars.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `state`                                                              | `"air"`, `"ground"`, `"ladder"`, `"swim"` or `"fly"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `facing,crouching,action`                                            | Facing `-1 or 1`, boolean; action one of `stand1,walk1,jump,prone,ladder,rope,fly,sit`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `footholdId,ladderId,ignoredFootholdId`                              | `U32`; `foothold,ladder` are nullable `U32` references; `seat` is nullable `Point`. References resolve against current immutable geometry.                                                                                                                                                                                                                                                                                                                                                                                            |
| `position,speed`                                                     | Finite scalar in `[-1048576,1048576]`, preserving ground-coordinate continuation.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `contactLayer,contactGroup,spaceGroup,fieldLimit,groundJumpSequence` | `U32`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `horizontalInput,verticalInput`                                      | `-1 or 0 or 1`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `accumulatorMs,accumulatorError`                                     | Exactly `0` at a whole-tick checkpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `jumpRepeatMs,movementLocked,movementMode,baseMode`                  | Repeat in `0..300`; boolean lock; each mode is `"air"`, `"swim"` or `"fly"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `held`                                                               | `{horizontal,vertical,jump,attack}` with the input enum/boolean bounds.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `worldMovement`                                                      | `{wingsX,form,equipmentFs,equipmentSwim}`; `form` null or `{speed,jump,swim,fs,riding}` with nullable speed/jump/fs, scalar swim and boolean riding. Equipment factors are nonnegative.                                                                                                                                                                                                                                                                                                                                               |
| `effectiveSettings`                                                  | Closed original settings keys: `mass,gravity,drag,forceScale,friction,quantumMs,avatar,walkForce,walkSpeed,walkDrag,slipForce,slipSpeed,floatDrag1,floatDrag2,floatCoefficient,swimForce,swimSpeed,flyForce,flySpeed,gravityAcc,fallSpeed,jumpSpeed,maxFriction,minFriction,swimSpeedDec,flyJumpDec,baseWalkSpeed,baseJumpSpeed,baseSwimSpeed,baseForceScale,baseFriction,baseDrag`. Numeric values are finite `0..1048576`; mass/fallSpeed positive, minFriction ≤ maxFriction; `quantumMs:30`, `avatar:"original-base-attributes"`. |
| `landing`                                                            | `{terminalTicks,thresholdTicks,forbidden,sequence,amount,facing}`; revision counters, boolean forbidden, U32 amount and facing.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `contactScratch`                                                     | `{previousX,previousY,x,y,fraction,segment,first,last,pendingAir,remainingMs,entryX,entryY,entryVx,entryVy}`; coordinates, fraction `0..2`, nullable U32 segment/first/last, boolean pendingAir, remainingMs `0..30`.                                                                                                                                                                                                                                                                                                                 |
| `diagnostics`                                                        | `{ticks,simulatedMs,backlogMs,overload,overloadCount,transitionLimit,fault,unsupportedLadderFlags,originalCadenceVerified}`; revision counters, `backlogMs:0`, `overload:false`, boolean flags, fault null or `"nonfinite-motion"` or `"foothold-transition-limit"`.                                                                                                                                                                                                                                                                  |

Restore validates reference IDs before installation. This is not arbitrary simulation-object serialization or a server-accepted browser profile.

Prediction must wait for a complete matching-epoch checkpoint, restore tick N, retire acknowledged inputs and replay only the bounded suffix through the same 30ms kernel. Missing/invalid checkpoints or history overflow freeze prediction and request resync; reconstructing hidden state from XY is not a fallback. Mid-motion ground transitions, ladders, down-jump, swim/fly, modifiers and locks require differential replay proof before claiming zero-divergence reconciliation.

Drawing is browser presentation policy and never authority: the browser presents the newest two kernel states interpolated between fixed-scheduler steps, anchored to when those steps actually ran, so scheduling jitter stretches one quantum instead of stalling the pose. A checkpoint restore reproduces states that were already presented and does not move that anchor. The presented pose is never an input to prediction, pacing, checkpoints or any server record. See [presented movement smoothness](../validation.md#presented-movement-smoothness) for the measured ratios.

### Example: a legal portal request

```json
{
  "v": 1,
  "type": "command",
  "connectionEpoch": "conn_4s7x",
  "seq": 93,
  "fieldEpoch": "field_2r8n",
  "operationId": "86d95e28-cb1a-42e0-a244-098cf0d8f2aa",
  "expectedRevision": 48,
  "action": { "kind": "portal.enter", "portalId": 3 }
}
```

There is deliberately no `targetMap`, `x`, `y`, `speed`, `job`, `mesos` result, or client-supplied portal script. `{kind:"portal.enter",portalId:3,targetMap:104000000}` is malformed even if that happens to be the legal destination. The server resolves portal 3 in the character's **current authoritative instance**, verifies contact and admission, then derives the destination.

## Time, prediction and combat

Runtime scheduling policy: simulate every **30 ms**, publish the acting character's own motion every tick and coalesce changed remote-entity state every **90 ms**. Retain 64 input samples and permit up to four ticks of input lead; presentation history is bounded. Self corrections arrive at tick cadence, not remote publish cadence. At most four catch-up ticks run per slice with time debt retained. These are engineering policies, not throughput results or recovered original server timing. Only server monotonic time creates ordinary ticks, never packet count or claimed client duration.

- At most one input is applied per character per tick. A sample targets the server-advertised tick schedule, must increase `inputSeq`, and may not exceed `currentTick + inputLeadTicks`. A late sample may still be admitted against a sliding-window distance budget (a token bucket over the last second, per character) and clamped per tick: the anti-cheat property is distance per unit time, not distance per tick. Never run unbounded catch-up steps, never synthesize movement for ticks already retired, and never let a burst buy more distance than the budget allows.
- Complete held-state input is sampled each tick; jump/attack edge transitions are derived by the server with action locks/repeat rules. Resending a held key cannot create another jump or bypass attack timing.
- Hold the last continuous input for at most three missing ticks, then neutralize it; never synthesize new rising edges. Browser blur/visibility sends neutral input when possible. Hidden tabs do not stop server time.
- Predict only local movement/action presentation using shared kernels. On an authoritative self update, rewind to its state, discard acknowledged inputs and replay the remaining bounded inputs. Effects/one-shot audio are keyed by action identity to avoid replay duplication. Overflow requests a full snapshot, not unlimited replay.
- Interpolate remote entities behind current server time; bounded extrapolation ends in a hold, not guessed damage. Arrival delays never alter economic/quest authority.
- Server owns mob AI/positions, contact damage, hitboxes, target caps, attack duration, ammunition, costs and RNG. Clients cannot report damage dealt/taken, a kill, a drop, a hit list or a mob movement result.
- Initial policy has **no historical hit rewind**. That avoids a client-controlled past-position exploit but adds latency to hit admission. If measurements require lag compensation, add a short bounded server-history window using server-observed timing, never accept arbitrary timestamps or rewind economic state. Keep it a separately reviewed rule/version.
- Cap catch-up at four ticks per scheduling slice while retaining elapsed-time debt, and hold **one** shared constant for both runtimes: the online client adopts the server-advertised schedule and never applies its offline browser catch-up allowance, which is not an online authority. Persistent debt triggers admission shedding and controlled field suspension/recovery, not silent time loss, faster client movement, infinite catch-up or an automatic player ban. Measure p95/p99 tick debt, corrections and input latency before increasing concurrency.

### Sync model and divergence budget

"In sync" means both sides hold the same state **for the same tick index**, verified by comparing state at tick `N`. It does not mean the same state at the same wall-clock instant, which no protocol can provide while `RTT > 0`; the client renders ahead of the authority and reconciles per tick.

1. **Tick timeline and offset.** `welcome` and every `ping` carry the server's absolute `serverTime`. The client estimates its offset from several samples of `(serverTime - localReceiveTime) + oneWayEstimate`, keeps the median, slews small corrections instead of jumping, and hard-resyncs only past a stated drift bound. It stamps each `input` with the `targetTick` that estimate predicts the sample will be applied at. A client-supplied absolute time is never accepted as authority.
2. **Server input buffer.** The server consumes tick `t` at a deadline of `oneWay + inputBufferTicks`; a sample arriving by its deadline is applied to its `targetTick`, and one arriving later is refused rather than re-timed onto another tick. A tick with no input holds the last continuous input for at most three ticks, then neutralizes. The buffer is the only defense against jitter starvation, and its cost is exactly `inputBufferTicks` of added latency for every player. Initial policy is one tick (30 ms), raised only from measured jitter.
3. **Client step rate.** The client emits exactly one sample and runs exactly one kernel quantum per server tick; per-frame sampling is coalesced into the held-state sample for the tick it will be applied at. A client that runs the kernel at its own rate diverges without bound: at twice the server rate the gap grows with every tick rather than settling. The online client follows the server-advertised schedule.
4. **One arithmetic.** The shared kernel uses one frozen formulation: integers and fixed-point where the original is integer, `+ - * / sqrt`, and no transcendental function or `Math.hypot`. `Math.hypot` and a hand-rolled `sqrt(x*x + y*y)` already disagree on roughly 1% of sampled inputs inside a single engine, so a kernel that mixes formulations cannot stay in sync across V8 and Bun. The differential harness in the proof list is the gate that settles it.
5. **Divergence budget.** Divergence is measured per recipient as divergence ticks (ticks where the client's replayed state differs from the authoritative state for that tick) plus correction magnitude and its convergence. Acceptance: zero divergence ticks and zero corrections on a clean link; bounded, non-growing corrections under stated jitter and loss; correction magnitude inside presentation tolerance. Correction distance alone is not a pass criterion without its tick count and convergence.

The alignment properties above are asserted against the real movement kernel in `client/test/sync-alignment.test.js`: stamped inputs reproduce the server state exactly per tick, rewind plus suffix replay restores the authoritative timeline, a one-tick buffer removes jitter starvation that a zero-tick buffer leaves standing, and per-frame stepping diverges with duration while coalescing stays exact.

## Map transition state machine

`active → validating → preparing → committed → active`, or `preparing → aborted → active`. The server serializes every phase under the character lease and source field generation.

1. Validate source membership, current position/foothold and exact portal interaction geometry, script/quest/item/party/event restrictions, destination availability and cooldown. Automatic portals are detected by the server simulation; client portal requests are hints for interactable portals.
2. Acquire a destination admission reservation with a bounded expiration. Freeze new character intents, neutralize input, and cancel conversation/trade leases as appropriate. This is not a client-invoked pause/invulnerability: the source simulation retains existing damage/timers until commit, or uses an explicitly server-defined transition rule. A player cannot indefinitely extend preparation.
3. Send `transition:prepare` with server-derived destination/content hashes and deadline. Browser prepares resources while retaining last complete visible field. `ready` proves neither downloaded content nor authority; server deadlines and rules decide progress even if the client lies or stalls.
4. Atomically persist destination membership, source exit, consumable/ticket debit if any, operation receipt and incremented fencing/field generation. The destination may admit the character only after commit. Old source commands/events are invalid after the epoch change.
5. Publish `transition:committed` and destination snapshot; release source membership exactly once. A connection break after commit reloads the destination from authoritative state, not a client-chosen rollback.
6. Failure before commit releases reservation and restores the live source lease without charging. Never compensate a committed debit by guessing; inspect the durable transition receipt. Worker crash recovery uses that receipt and fencing token to identify the sole owner.

Start with field owners in one process and a single database transaction. If field actors later move across machines, keep the same durable membership/receipt protocol and fenced reservation; do not substitute an unauthenticated browser handoff token or a distributed dual-writer window. Validate spawn availability at content admission. A map lacking legal spawn/transition rules is refused with an explicit content error, not arbitrary coordinates.

## Transactions, duplication and reconnect

### Durability classes

**The load-bearing rule: an economic effect is durable before it is observable.** Nothing grants, consumes, moves or destroys an item, currency or entitlement until the transaction that records it has committed. Flush frequency is therefore not a security parameter; the failure mode to design against is a _rollback_ that moves economic state backwards after an effect was already visible and consumed by someone else.

| Class               | State                                                                                                                                                                                                             | Storage                                                                                     | Durability                                                                                                                 | Crash behaviour                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 Ephemeral**     | position/velocity/foothold, mobs and AI, projectiles, hit timers, volatile ground-drop entities, dialogue continuations, uncommitted trade offers, prediction state                                               | field actor memory only                                                                     | never written                                                                                                              | discarded and rebuilt from authored content. Losing it grants nothing.                                                                                                                  |
| **2 Checkpointed**  | HP/MP, EXP, level, kill counters, quest kill progress, location, buff/cooldown state, AP/SP allocation                                                                                                            | memory plus coalesced character snapshot, excluding authoritative inventory/equipment/money | write-behind; at most one checkpoint per character per second (initial policy)                                             | loses at most the checkpoint interval of progression. It never rolls back a committed item quantity or entitlement; the client must never treat an uncommitted checkpoint as authority. |
| **3 Transactional** | item ownership/location/quantity, mesos, drop pickup, inventory/equipment moves, item use that grants or destroys, scrolling, quest accept/claim/abandon, shop buy/sell/recharge, terminal trade, map transitions | append-only op log, materialized rows, receipt                                              | commit before the effect is observable; all class-3 work queued for one character in a tick coalesces into one transaction | replay from the last snapshot. Because the effect was never observable, there is nothing to compensate and nothing to duplicate.                                                        |

Class assignment is part of the action definition. A new action may not join the class-1 or class-2 path without stating why losing it cannot create an entitlement.

- **Class 1/2:** `input`, `buff.cancel`, `skill.cast`, `stats.allocate`, `skills.allocate`, `chat.send`, `npc.open`, `npc.answer`, `trade.invite`, `trade.answer`, `trade.offer`, `trade.cancel`, `revive.request` with `method:"return"`.
- **Class 3:** `drop.pickup`, `inventory.move`, `equipment.equip`, `equipment.unequip`, `item.use`, `item.drop`, `mesos.drop`, `equipment.scroll`, `portal.enter`, `revive.request` with `method:"consumable"`, `quest.accept`, `quest.claim`, `quest.abandon`, `shop.buy`, `shop.sell`, `shop.recharge`, `trade.confirm`.
- Combat motion/hit resolution remains in memory and publishes authoritative `combat` events; durable HP/MP/EXP checkpoints and economic consequences have separate boundaries.
- Basic ranged ammunition consumption is stronger than the original write-behind design: the server commits its inventory debit through `database.commit` **before releasing the attack**. Profile hydration must not refill already-consumed ammunition. Explicit `item.use`, including potions, is likewise transactional. Creating an item, moving ownership or granting an entitlement always requires durable commit regardless of frequency.
- Whole-profile rewrites are not a durability mechanism. The character snapshot is a cache of the op log; no economic invariant may depend on snapshot cadence, and no two domains may be recovered from snapshots taken at different times.

Ordering rules that keep the classes composable:

1. **Grant:** commit first, then make the instance usable. Until commit it is `pending` and every consuming path (trade, drop, sell, enhance) rejects it.
2. **Removal/destruction:** commit first, then change what the player or another player can see.
3. **Created entity:** a ground drop, mob or other created entity becomes visible only after the debit that funds it has committed. Creating the entity first and debiting after is a duplication shape, not a latency of optimization.

### Per-tick commit loop

The field actor never awaits storage inside a tick.

1. Admit class-1 intents; they never touch storage.
2. Apply class-3 intents to a pending in-memory delta. Nothing is published, and granted instances stay `pending`.
3. At tick end, if the character has queued class-3 work, enqueue **one** transaction containing every queued effect, its receipts, its item/ledger rows and its op-log rows.
4. Do not await it. The tick continues; the client holds a pending presentation state.
5. On commit: publish effects to their recipients, clear `pending`/escrow on the affected instances, emit `result`. On failure: discard the pending delta and emit a stable rejection code.
6. One in-flight transaction per character, in queue order. Cross-character operations (trade, transition) take explicit locks in stable ID order and commit as one transaction.

```sql
-- One transaction per character per tick; every write carries the writer's fencing token.
BEGIN ISOLATION LEVEL SERIALIZABLE;
  -- Idempotency first: an existing receipt short-circuits before any revision check.
  SELECT 1 FROM operation_receipt WHERE character_id = $char AND operation_id = $op;
  INSERT INTO operation_receipt (character_id, operation_id, digest, status, code, domain_revision)
    VALUES ($char, $op, $digest, 'committed', 'OK', $next_revision)
    ON CONFLICT (character_id, operation_id) DO NOTHING;
  INSERT INTO character_op_log (character_id, operation_id, digest, kind, effect)
    VALUES ($char, $op, $digest, $kind, $effect);
  -- Escrow release is the authorization: a stale or duplicate attempt matches no row.
  UPDATE item_instance SET state = 'ready', locked_by = NULL WHERE id = $instance AND locked_by = $op;
  INSERT INTO ledger (transaction_id, character_id, kind, item_instance, delta, reason) VALUES ...;
  -- Fencing is enforced by the storage, not by the lease holder's own bookkeeping.
  UPDATE character SET revision = revision + 1 WHERE id = $char AND fencing_generation = $token;
COMMIT;
```

Short Serializable transactions remain the rule for multi-aggregate operations; retry the **whole** transaction at most three times on `40001` **and** `40P01`, then return `SERVER_BUSY`. Set `lock_timeout`, `statement_timeout` and `idle_in_transaction_session_timeout` so one stalled participant cannot pin an escrowed item. Never retry a domain rejection. Keep digest, operation identity and random outcome stable across internal retries; aborted attempts publish nothing. External effects use the transactional outbox after commit.

### Runtime persistence layout

The executable migration is [`server/sql/001-authority.sql`](../../server/sql/001-authority.sql), not the historical sketch below. `account` owns password hashes/roles; `character` carries fenced lease, domain revisions, durable field identity, scalar `meso` and non-economic profile projection. `item_instance` materializes owned inventory/equipment with global IDs and deferred occupied-slot uniqueness. The cached profile deliberately excludes inventory/equipment/money on write and restores them from authoritative rows on load.

`operation_receipt` stores one outcome per character/UUID operation, `character_op_log` stores typed effects, `character_snapshot` stores fenced profile checkpoints, `entitlement` tracks drop grant/consumption, and `ledger` balances asset deltas per transaction including world counterpart accounts. Append-only triggers protect receipt/log/snapshot/ledger/outbox/development audit history; a deferred constraint checks ledger balance at commit. `outbox` and `outbox_delivery` separate committed events from delivery cursor state.

The adapter uses Serializable commits with a maximum of three serialization/deadlock attempts and 45-second renewable leases. Receipt lookup precedes new-operation revision admission; digest conflicts do not rerun effects. Cross-character commits update both actors only after the database commits. Field membership is stored on `character` in this migration; there are no separate `field_membership`, `quest_progress` or `trade_offer_item` tables matching the sketch. Do not claim that historical SQL drills ran unchanged against this layout or that in-memory interaction state survives a process restart; durable items/funds/receipts are distinct from transient conversations/trade offers.

### Required tables and constraints {#proposed-tables-and-constraints}

| Record                                       | Required invariants                                                                                                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `character`                                  | Account FK, unique active lease, monotonic fencing generation, domain revisions, valid field membership and bounded stats/currency.                                                                                                                                  |
| `character_op_log`                           | Append-only class-3 truth between snapshots; unique `(character_id, operation_id)`; replay order is `seq`; typed effects, never raw requests.                                                                                                                        |
| `character_snapshot`                         | Class-2 cache with the highest materialized `seq`; never the authority for an entitlement; load is snapshot plus log replay only.                                                                                                                                    |
| `item_instance`                              | Global unique ID, exactly one owner/location, positive quantity except server-validated depleted rechargeables, unique occupied slot; `pending` until its granting transaction commits; `locked_by` while escrowed; template/rules version and enhancement revision. |
| `operation_receipt`                          | Unique `(character_id, operation_id)` with canonical action digest, outcome/revision/transaction ID; written in the same transaction as the effect; looked up before stale-revision rejection; torn down only inside the bounded retry window.                       |
| `trade` / `trade_offer` / `trade_offer_item` | Two participants, revision, explicit lifecycle, escrowed offer instances, exact confirmation revision. Both debits/credits, escrow release, ledger and one receipt per participant in a single transaction referencing one `transaction_id`.                         |
| `quest_progress`                             | Unique character/quest/cycle identity; claim receipt unique for that cycle, prerequisite consumption and reward commit together.                                                                                                                                     |
| `field_membership` / `transition_receipt`    | Exactly one live membership per character; fencing generation and idempotent transition outcome.                                                                                                                                                                     |
| `ledger` / `outbox`                          | Transaction-linked item and currency source and sink with a queryable conservation invariant; unique outbox event ID and post-commit delivery cursor; bounded retention/archive policy.                                                                              |

Inventory/economy invariant checks and unique constraints are defense in depth; a single field actor alone does not serialize another worker, admin process or reconnect. `ledger.item_instance` deliberately has no foreign key: destroyed instances keep their history after the instance row is removed.

### DDL design reference {#proposed-ddl-sketch}

The following sketch explains the required invariants; it is **not the executable migration**. The runtime migration under `server/sql/` and database adapter define actual table/column names. Adapt the audit queries below to that migration before running them. Wire-visible identifiers stay `text` to match `Id`.

```sql
CREATE TABLE character (
  id                 text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  account_id         text NOT NULL,
  rules_version      integer NOT NULL,
  revision           bigint NOT NULL DEFAULT 0,
  fencing_generation bigint NOT NULL DEFAULT 0,
  field_instance_id  text,
  lease_expires_at   timestamptz,
  mesos              integer NOT NULL CHECK (mesos BETWEEN 0 AND 2147483647),
  hp integer NOT NULL CHECK (hp >= 0), max_hp integer NOT NULL CHECK (max_hp >= 0),
  mp integer NOT NULL CHECK (mp >= 0), max_mp integer NOT NULL CHECK (max_mp >= 0),
  level integer NOT NULL CHECK (level >= 0),
  exp   bigint  NOT NULL CHECK (exp >= 0)
);

CREATE TABLE character_snapshot (         -- class-2 cache, never an entitlement source
  character_id text PRIMARY KEY REFERENCES character(id),
  snapshot_seq bigint NOT NULL,
  data         jsonb NOT NULL,
  taken_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE character_op_log (           -- class-3 append-only truth between snapshots
  seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  character_id text NOT NULL REFERENCES character(id),
  operation_id text NOT NULL,
  digest       text NOT NULL,             -- canonical schema-ordered fields, never raw JSON
  kind         text NOT NULL,
  effect       jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (character_id, operation_id)
);

CREATE TABLE operation_receipt (
  character_id    text NOT NULL REFERENCES character(id),
  operation_id    text NOT NULL,
  digest          text NOT NULL,
  status          text NOT NULL CHECK (status IN ('committed','rejected')),
  code            text NOT NULL,
  domain_revision bigint,
  transaction_id  bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, operation_id)
);

CREATE TABLE item_instance (
  id          text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  template_id integer NOT NULL CHECK (template_id BETWEEN 0 AND 999999998),
  quantity    integer NOT NULL CHECK (quantity > 0),
  owner_id    text NOT NULL REFERENCES character(id),
  location    text NOT NULL CHECK (location IN ('equip','use','setup','etc','cash','equipped')),
  slot        integer NOT NULL CHECK (slot >= 0),
  state       text NOT NULL DEFAULT 'ready' CHECK (state IN ('ready','pending')),
  locked_by   text,
  revision    bigint NOT NULL DEFAULT 0,
  equipment   jsonb,
  UNIQUE (owner_id, location, slot),
  CHECK (state = 'ready' OR locked_by IS NOT NULL)
);

CREATE TABLE ledger (
  entry_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id bigint NOT NULL,
  character_id   text REFERENCES character(id),   -- null marks the world/system counterpart
  kind           text NOT NULL CHECK (kind IN ('item','mesos')),
  item_instance  text,
  delta          bigint NOT NULL,
  reason         text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trade (
  id       text PRIMARY KEY,
  revision bigint NOT NULL,
  state    text NOT NULL CHECK (state IN ('invited','open','confirmed','committed','cancelled'))
);

CREATE TABLE trade_offer (
  trade_id           text NOT NULL REFERENCES trade(id),
  owner_id           text NOT NULL REFERENCES character(id),
  mesos              integer NOT NULL CHECK (mesos BETWEEN 0 AND 2147483647),
  confirmed_revision bigint,
  PRIMARY KEY (trade_id, owner_id)
);

CREATE TABLE trade_offer_item (
  trade_id      text NOT NULL,
  owner_id      text NOT NULL,
  item_instance text NOT NULL,
  PRIMARY KEY (trade_id, item_instance),
  FOREIGN KEY (trade_id, owner_id) REFERENCES trade_offer (trade_id, owner_id)
);
```

`quest_progress`, `field_membership`, `transition_receipt` and `outbox` follow the same pattern: append the effect and its receipt inside the one transaction, and keep the invariant in a constraint rather than only in code.

### Receipts and idempotency

- Same operation ID + same canonical action/domain context returns the original receipt without reapplying it, including after reconnect or a crash after commit but before acknowledgement.
- Same ID + different action is `OPERATION_CONFLICT`, even with a valid fresh sequence. Do not hash serialization-dependent raw JSON; validate first, then encode fields in schema order. Old expected revision is checked only for new operations.
- Retain full results at least as long as any client can retry them: session lifetime plus reconnect grace, **24 hours as an initial policy**. Keep compact `(character_id, operation_id, digest, status, code)` tombstones for a bounded window (90 days as an initial policy) rather than for the character's lifetime. A tombstoned operation returns `OPERATION_EXPIRED` and never executes again. Pruning is safe because the domain invariants below, not the receipt, are the durable guard; expiry must never turn a replay into a new grant.
- Two-participant operations write one receipt per participant in the same transaction and share one `transaction_id`, so a trade retried by either side resolves to the same committed outcome.
- Distinct operation IDs do not bypass domain rules: consumed drop, already-claimed quest cycle, insufficient balance, item revision, escrow ownership and trade lifecycle still prevent repeats.
- Inventory gains never rely solely on in-memory drop deletion: a durable reward or pickup entry identifies the unique entitlement. Ground entities are deliberately volatile: **player-dropped items and mesos vanish on server process restart**, even when their committed debit and unconsumed entitlement remain durable. They are not restored or refunded. Retrying the same operation returns its original receipt and never creates a second drop or grant. This is a stated ground-lifetime loss policy, not durable ground restoration or zero-loss crash replay.
- Scrolling targets an instance regardless of inventory/equipped location; destruction atomically removes the equipment and updates derived stats. Trading locks it out. Random rolls are server-owned and auditable by transaction identity, never supplied by the client.

### Recovery

Client receives an explicit committed/rejected result and authoritative observations; optimistic UI must not publish permanent funds/items. On timeout the outcome is **unknown**, not rejected: reconnect with a new ticket and retry the same operation ID to recover its receipt. Do not automatically retry a purchase under a fresh ID.

Resume rotates connection epoch, fences the old socket and reattaches to a surviving field actor. Replay only a bounded contiguous recipient-specific event window (2 MiB / 30 s initial bound); otherwise issue a fresh snapshot. Client discards prior-epoch prediction and pending visual baselines, reconciles pending economic receipts, and never uploads its last local position/profile. Disconnect leases expire on server time; death, cooldowns, summons and drop ownership timers do not stop while the browser is gone.

#### Process restart and replay

1. Acquire the character lease with a new fencing generation. Every subsequent write carries that token, and storage rejects a write whose token is not current.
2. Load the `character` row and the newest `character_snapshot`.
3. Replay `character_op_log` rows with `seq > snapshot_seq` in ascending order, applying typed effects. Applying is keyed on `seq`, so a partially materialized log cannot double-apply.
4. Rebuild class-1 mobs/spawns from authored placements. Ground drops expire on process loss without restoration or regranting; their durable debit/receipt is not a refund instruction.
5. Admit input only after replay completes, and only for a connection holding the current connection epoch.
6. Compact: write the next snapshot at the applied `seq` so the applied position cannot move backwards, then prune older snapshots and op-log rows already covered by a durable snapshot and outside the receipt retry window.

Crash-loss windows are a stated product property, not an implementation detail:

| Class           | Initial bound                                 | Consequence of loss                                                                                                                                                       |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Ephemeral     | not applicable                                | none; entities are rebuilt from content or expire                                                                                                                         |
| 2 Checkpointed  | ≤1 s of progression, best effort at page exit | the player loses recent EXP/kill progress; no item, currency or entitlement is created or destroyed                                                                       |
| 3 Transactional | zero committed database rollback              | committed debits/receipts/ledger survive; this does not preserve volatile ground entities. Player-dropped items/mesos expire on restart without refund or duplicate drop. |

Movement checkpoints may be asynchronous because they grant no inventory, but their crash-loss window must be stated and measured. Economic and transition acknowledgements require durable commit. After process loss, restore the append-only log and committed receipts before admitting input; never restore inventory to an earlier movement snapshot, and never recover two domains from snapshots taken at different times.

### Implemented interaction policy

These are bounded development/reference policies, not recovered native-server constants:

- NPC admission uses a180px range and120s conversation lease. Authored execution runs in real workers with1500ms termination, at most eight concurrent executions and4096 typed effects. Unsupported scripts fail rather than executing arbitrary server code.
- Private dynamic interaction content is actor-filtered with120s expiry: at most4096 entries,16MiB total and64KiB per entry at `/api/v1/content/:hash`.
- SQL shops support unlimited-stock mesos rows; unsupported pitch-currency rows reject with `CONTENT_MISMATCH`, not a guessed mesos conversion.
- Supported one-shot quest Check/Act uses the existing versioned progression policy with server clock/RNG. The server NPC choice menu selects a quest and executes the extracted original `QuestDialogue` branch machine, preserving native text pages and reward choices; only its final authorized confirmation can issue `quest.offer`. Abandon resets the actor's quest progress without granting/removing inventory; quest IDs1200..1399 are excluded from this abandonment policy.
- Two-player trade allows nine offered items,120s room lifetime,30s invitations and a3s invitation interval. Item locks and mesos reservations protect offers; final exchange uses stable actor lock order and one two-party durable commit.
- Chat admission is bounded to four messages per2s with reciprocal membership/privacy checks. Spouse chat has no guessed relationship fallback: missing durable relationship support rejects `CONTENT_MISMATCH`.

## Resource, privacy and operational policy

All starting limits require load testing before deployment:

| Boundary             | Initial bound / behavior                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbound JSON         | 16 KiB/message, depth 8, 256 nodes; reject before admission. Outbound frames ≤64 KiB. Snapshot total bound defined above.                                                                                                    |
| Input rate           | 40 messages/s, burst 8; at most four future ticks stored per character and one input per tick. Extra rate cannot create simulation time.                                                                                     |
| Discrete commands    | 12/s, burst 12; chat 2/s burst 4; invitations 1/s burst 2; resync 1 per 5 s. Per-domain work budgets also apply.                                                                                                             |
| Outstanding work     | 32 commands/socket, 1 economic mutation/character, bounded database pool; explicit busy/rate results. Never unbounded Promise fanout.                                                                                        |
| NPC script execution | Compiled step/turn limits plus a per-execution wall-clock budget with preemption; exhaustion aborts the step with a stable rejection and increments an observable counter.                                                   |
| Connections          | One gameplay writer per character/account; at most two pre-hello sockets per authenticated account. Login throttling is keyed by observed connection address and account name rather than a shared-proxy-wide login lockout. |
| Send backlog         | 256 KiB soft / 1 MiB hard per socket. Coalesce only unsent replaceable entity state. Never drop committed receipts silently; close/resume slow clients at hard bound.                                                        |
| Liveness             | Server ping every 15 s, close after 30 s without valid response; application activity does not override session expiration.                                                                                                  |
| Field population     | Initial 100 players/2,048 live entities per instance, plus content-specific spawn caps and per-tick spatial query bounds. Reject over-cap joins/spawns rather than truncate authoritative entities.                          |

Per-IP network abuse controls belong at the trusted upstream ingress. The runtime does not trust arbitrary forwarded-IP headers; a shared reverse proxy/NAT must not turn one account's login attempts into a global account lockout. Transient conversation/trade/invitation revision admission uses the current interaction-domain revision, not an unrelated durable character revision.

For WSS/TCP, coalescing cannot remove bytes already queued in the transport. Monitor Bun send return values and `drain`; `-1` is already enqueued and must **not** be resent. Browser `bufferedAmount` is a send-queue signal, not receive flow control. Maintain server-owned AOI subscriptions and bounded client decode queues. Baseline deltas reference the last **acknowledged installed** snapshot; on mismatch discard and resync. Interest changes send explicit entity removal; never let clients subscribe to arbitrary field IDs or invisible entities.

Server-only private data includes full inventories, quest/account state, RNG state, moderation flags and unpublished shop/reward logic. Broadcast only public appearance/nearby entity state; trade offers go to their two participants, chat only to authorized recipients. Do not put sensitive runtime responses into public content packages or offline caches.

Metrics: tick duration/debt, queue bytes, admission rejects by stable code, snapshot bytes, prediction correction distance and divergence ticks, input age, transaction latency/retries, duplicate receipt lookup, field handoff failures and reconnect completion. Logs retain operation IDs, rules version, actor/field epoch and bounded reason, not credentials or whole chat/payload dumps. Suspicious movement is rejected/corrected; lag alone is not a ban decision. Administrative grants use separate authenticated, role-scoped, audited server tooling—never a production gameplay message switch.

## Implementation order and required proof

These are release/adversarial gates, **not a list of performed checks**:

1. Review the versioned ruleset for each server-enabled field: mob stats, spawn caps, drops, shop prices/recharge and quest admission. Current development/reference policies are not original-server evidence and must not silently become approved production rules.
2. Keep one DOM/Pixi-free kernel implementation for shared behavior. Validate legal spawns and content provenance for every admitted field.
3. Replay recorded input in browser and Bun, importing real mid-motion checkpoints and comparing state at the same tick. Shared imports alone are not this proof.
4. Exercise strict decoding, authenticated sessions, fencing, two-player visibility and bounded prediction/reconciliation. Unknown commands fail closed; no gameplay profile upload or development action.
5. Exercise append-only typed economic effects, receipts, inventory/quest/shop/advancement, two-participant trade and fenced transitions. Handler presence does not prove crash consistency.
6. Exercise a malicious custom client, not only the official UI: forged XY/target map, excessive future ticks, input floods, forged damage/HP, unknown entity, stolen UID, negative/overflow quantities, wrong quest step, stale field/connection/revision, replayed rewards, conflicting operation IDs and client-controlled clocks/RNG.
7. Run the durability drills. Kill the process at each boundary, assert the post-conditions, then retry the **same** operation ID and assert the outcome cannot change. Each drill also runs the invariant queries below.
   1. **Before commit:** the pending delta is discarded; no `item_instance`, `character_op_log`, `ledger` or `operation_receipt` row exists; a retry executes exactly once.
   2. **After commit, before reply:** receipt and ledger entry exist; a retry returns the original outcome; exactly one grant.
   3. **Between trade confirmations and mid-transaction:** either both participants moved or neither; the offered instance leaves escrow exactly once.
   4. **During a transition:** exactly one live `field_membership`; the transition receipt is idempotent; no debit is charged twice.
   5. **With a queued old-socket command:** storage rejects the stale fencing generation, not only the live actor.
   6. **Duplicate delivery:** the same operation ID delivered twice produces one ledger entry and one grant.

   All of these must return zero rows after every drill:

   ```sql
   -- one live owner per instance
   SELECT i.id FROM item_instance i
     WHERE NOT EXISTS (SELECT 1 FROM character c WHERE c.id = i.owner_id);
   -- no negative or empty state
   SELECT id FROM item_instance WHERE quantity <= 0;
   SELECT id FROM character WHERE mesos < 0 OR hp < 0 OR exp < 0;
   -- escrow coherence: pending implies held, held implies pending
   SELECT id FROM item_instance WHERE (state = 'pending') <> (locked_by IS NOT NULL);
   -- every committed receipt has exactly one matching log row
   SELECT r.character_id, r.operation_id FROM operation_receipt r
     LEFT JOIN character_op_log l
       ON l.character_id = r.character_id AND l.operation_id = r.operation_id
     WHERE r.status = 'committed' AND l.seq IS NULL;
   -- double entry: item and mesos deltas balance per transaction, including the world counterpart
   SELECT transaction_id FROM ledger GROUP BY transaction_id, kind HAVING sum(delta) <> 0;
   ```

8. Test CSWSH, missing/expired tickets, logout on live sockets, another account's character, slow consumers, oversized/deep frames, shared-NAT rate limits and cross-instance/private subscription attempts.
9. Measure realistic latency/jitter/loss, browser backgrounding, 800×600 desktop UI, incomplete content, node overload and bounded recovery. Use matched source/rules/content identities and report observed tick and correction distributions. Choose WebTransport or sharding only if those measurements justify them.

The runtime and online browser are separate from offline development presets/spawning. This contract describes authority and required failure behavior; it does not imply that every production gate, feature, original policy or adversarial scenario has been verified. Consult [measured validation](../validation.md), retain missing authoritative content explicitly, and do not deploy development rules as native-server fidelity.
