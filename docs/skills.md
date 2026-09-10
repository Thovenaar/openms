# Learned skills and original skill coverage

## Sources and coverage

The catalog is extracted from the original `Skill.wz`, `Sound.wz` and `String.wz` inputs associated with the unpacked PE SHA-256 `1198fa57ca5a7c489bae43ec13c69681d9cabe0f96762f3dc0357facf2e7d4df`. No third-party client source is used. The retained complete inventories are `docs/ingame-inventory/Skill.tar.gz` and `Sound.tar.gz`. Cosmic's `AssignSPProcessor`, `GameConstants`, `SkillFactory`, `StatEffect` and `Character` are **authorized emulator references**, not Nexon source.

`ui-item-data.js` visits **every numeric player/job IMG**, not a selected beginner book or a top-N list. Original inventory extraction measured **71 numeric books and 534 skills**. The five other images—`MobSkill`, `MCSkill`, `MCGuardian`, `BFSkill`, `ItemSkill`—remain separately named non-learnable domains, including their original metadata. Named safety bounds reject excess work rather than silently truncating records.

Each `catalog.ui.skills[id]` preserves the existing `descriptor`, `iconPath`, `iconMouseOverPath` and `iconDisabledPath` UI interfaces and adds:

- `bookId`/`jobId`, family and original source; missing original strings are explicit via `stringsPresent`.
- `maxLevel` from numeric rank children; `masterLevel` retains the original top-level scalar, **not** an automatic learned/mastery grant.
- `levels[rank]` with original flat `hp`, `mp`, `time`, `hpCon`, `mpCon`, `cooltime`, `damage`, `mobCount`, `x`, `y`, etc. `level` retains the original metadata tree, including aliases.
- Original `properties`, prerequisite edges, ordered actions (including original scalar-action forms), normalized flags and allocation-cost evidence.
- Every visual sequence, including nested rank, `CharLevel`, `finalAttack`, `prepare`, `affected`, `hit`, `ball`, `special`, and other authored branches. Original frame delay/origin/alpha and source identities flow through the existing atlas/part pipeline. Unresolvable aliases are explicit unavailable records.
- Every skill sound leaf, exact leaf name, alias and resolved source identity. Missing sound trees are explicit original absence. Sound payloads are original MP3s, not synthesized replacements.

`catalog.ui.coverage.skillCoverage` contains sorted `playerBooks`, separate `domains`, `total` and deterministic capability `counts`. The executed [complete controller/action audit](ghidra-client-corrections/expanded-skill-coverage.json) reclassified all **534** retained records with the current source classifier, increasing supported controllers from **16 to35**:

| Classification | Runtime-capable | Unavailable dependency |
| --- | ---: | ---: |
| Passive | 10 | 62 |
| Timed self/solo-party buff | 21 | 6 |
| Sword melee | 4 | 0 |
| Other weapon/projectile | 0 | 187 |
| Channel | 0 | 17 |
| Morph/mount | 0 | 5 |
| Teleport/impulse movement | 0 | 11 |
| Other attack | 0 | 56 |
| Special/party/target | 0 | 91 |
| Summon | 0 | 23 |
| Map/door | 0 | 1 |
| Magic | 0 | 16 |
| Item/projectile-consuming | 0 | 10 |
| GM/event/server | 0 | 14 |

These are capability classifications, **not a claim of complete native runtime fidelity**. The generated catalog computes them anew from the extraction input. Unavailable records state the missing controller/transaction/server prerequisite and remain visible in the full catalog.

The reusable audit command, from `client/`, is:

```sh
bun tools/skill-report.js public/generated/catalog.json default ../docs/ghidra-client-corrections/expanded-skill-coverage.json
```

An optional fourth argument accepts an exported schema4 profile and joins **every type-1 binding** to its learned/unexpired job ownership, current controller and missing actor actions. `default` resolves the current catalog's hashed default-map manifest; an explicit map manifest can instead audit another extracted actor. No extraction or browser startup is required. The report includes every record's authored action list, equipment fallback policy, missing actor actions/weapon rectangles, rank-field inventory, visual/sound leaves, unselected alternate visuals, admission flags and independently observed controller dependencies. This run found **103 records with absent extracted actor actions**, **zero unresolved visual sequences**, and **zero unavailable sound leaves**; assets being present does not establish their selection/controller semantics.

The remaining **499 records** are not all missing “server scripts.” Exact distinctions include slot-aware ammunition/items/mesos; held/release input transitions; projectile timing; summon lifetime/target ownership; combo/state transitions; mob status probability/expiry; morph movement; map/party authorization; and actor actions absent from the extracted avatar. Six scalar buff records have identifiable but **unconsumed** stats: Meditation `2101001/2201001/12101000` requires magic damage; Focus `3001003/13001002` and Bless `2301004` require accuracy/evasion hit-miss authority. They remain unavailable rather than spending resources for an inert derived flag. Original event/client script execution is not supplied; Cosmic is an authorized server reference, never a substitute Nexon client source tree.

The audit also corrected false passive labels: Three Snails has rank-nested `ball`/`hit` and fixed damage, while Teleport/Soul Rush have active resource rows even without top-level actions/effects. Three Snails now names its projectile controller dependency; eleven teleport/impulse skills identify relocation/foothold or swept-motion admission separately. No action/effect absence is treated as proof of passivity when authored active costs are present.

## Learning and admission

`SkillSystem(scene, store, catalog, hooks)` owns learned-skill admission. Schema4 profile records are `{level, masterLevel, expiresAt}`; `expiresAt` is `null` or an epoch-millisecond integer, and `remainingSp` has exactly ten pools. Learned rank and mastery are independently validated fields: **`level <= masterLevel` is not a universal profile invariant**. No job change or catalog membership grants ranks. Learning and persistent development edits use the same atomic profile transaction: gameplay mutations are excluded while `profileTransactionPending`, and consumers reacquire the replacement profile after success or failure. See [atomic ownership](offline-profile.md#atomic-ownership).

`await skills.learn(id)` runs eligibility again inside `await store.commitProfile(transform)`. The original Skill `BtSpUp` control is backed by current job-book membership, visible/enabled flags, available points and the prerequisite/max/master consumer `008ad7c9 → 00a08e05`; [interaction provenance](ghidra-client-corrections/interaction-skill-combat-provenance.json) retains the executable evidence. Admission rejects disabled, invisible, time-limited and GM/event books, unknown allocation-cost forms, unmet `reqLev`, unavailable next authored rank and unmet learned/unexpired prerequisite ranks. Any existing expiring record, including an already expired one, refuses allocation without expiration authority; an expired prerequisite contributes zero. Refusal does not spend SP or publish a partial rank.

Ordinary allocation spends exactly one point according to the authorized Cosmic **server reference**. `skillPointPool(book)` maps books2210–2218 to zero-based pools1–9; other books use pool0. Beginner IDs ending in1000..1002 instead share `min(characterLevel−1,6)` minus learned/unexpired ranks across **all twelve IDs** under roots0,10000000,20000000 and20010000. They do not spend ordinary SP, and changing job family cannot reset that entitlement. Native `00765e9e` takes precedence over Cosmic's current-family-only sum.

Mastery gates follow the shared executable-backed `requiresSkillMastery`: Evan books**2217/2218** require mastery, but2212 does not; other advanced books ending in2 require it. Such books cap allocation at `min(original maxLevel, saved masterLevel)`; ordinary books use original `maxLevel` independently of mastery. Allocation preserves the existing mastery value and initializes a newly learned ordinary skill with mastery0 rather than fabricating a grant. Native `004e8f04/004e8f66` takes precedence over Cosmic's selected late-Evan-ID predicate. Learning eligibility is separate from runtime capability: an allocated rank does not provide a missing attack, projectile, summon or other controller.

`skills.activate(id)` returns `{ok:true}` or `{ok:false,reason}`. It is synchronous and validates learned/unexpired rank, job, alive/modal/map state, cooldown, prepared resources, actor actions, field attack readiness, equipment and costs **before any gameplay mutation**. HP costs cannot kill the caster; exact MP equality is allowed. Unsupported casts do not spend HP/MP, start actions, start cooldowns or emit Use audio.

Type-1 key bindings use learned, unexpired ownership. They call `hooks.onSkill(id)` through the normal input authority; catalog membership is not ownership. KeyConfig uses its live nonmodal outer draft: explicit Save commits, and dirty close asks the original “Save changes?” question (Yes saves, No discards). Nested quick-slot edits have an isolated draft; see [UI](ingame-ui.md).

## Implemented consumers

- Warrior `1000000` exposes original rank `hp` to native recovery. `1000002` exposes original Endure `time`. Recovery cadence/conditions belong to the native recovery owner, not a second SkillSystem timer.
- Magician `2000000` supplies the recovered `trunc(characterLevel * learnedRank * 0.1)` MP bonus. Thief `4100002/4200001` supplies authored HP/MP/climbing recovery; knight `1110000/1210000/11110000` supplies authored MP recovery. These effects are classified supported rather than silently applying behind an unavailable label.
- Warrior `1000001` and Dawn Warrior `11000000` expose max-HP growth `x`/`y`. Cosmic `Character.java:6358–6360` consumes `x` at level-up; the implemented native Stat AP route consumes `y` through `CharacterDevelopment.spendAp` and its authorized Cosmic growth policy. AP updates base maxima and recalculates equipped vitals atomically. The field's provisional base progression remains separately labeled; see [AP/profile authority](offline-profile.md).
- Iron Body `1001003` rank 1 costs MP 8 and adds PDD 2 for original `time=75` seconds. The same strict self-stat shape supports `11001001`, Magic Armor `2001003` and `12001002`; unsupported additional rank fields or party/affected/weapon/special branches prevent false self-only admission.
- Power Strike `1001004` rank 1 costs MP 4 and supplies original `damage=165` to the sole field attack owner.
- Slash Blast `1001005` rank 1 costs HP 8 / MP 6 and supplies `damage=72`, `range=130`, `mobCount=6`. At the authored hit phase, the field first places the original weapon attack rectangle. Only an eligible target inside that basic rectangle unlocks the absolute forward extension to avatar X ±130; it is not a percentage scale or unconditional extra reach, and vertical bounds remain unchanged. The resulting selection is capped at the authored target count. Original consumer `00951571..0095165c` is retained in the [range instructions](ghidra-client-corrections/fidelity-slash-range-insns.txt). This source-backed contract does not by itself establish native browser multi-target coverage.
- Dawn Warrior Power Strike `11001002` and Slash Blast `11001003` use the same rank-authored sword controller. Native `00950921` explicitly compares both Slash Blast IDs `0x0f462d` and `0xa7dcab` in its shared range branch; [executed decompilation](ghidra-client-corrections/expanded-skill-controllers.txt) retains that comparison. Equipped sword/action/rectangle admission still applies; this does not unlock arbitrary weapon attacks.
- Recovery `1001/10001001/20001001` spends the **numeric WZ rank** cost and heals original `x` every5000ms for `time` seconds, capped by maxHP. Rank1 costs5MP, heals4HP six times over30seconds, and has120-second cooldown. Some original localized strings still claim10MP/ten minutes; they do not override numeric rank data. Cadence is the ordinary (non-ultra) authorized Cosmic `Character.java4492–4523` server rule, not the separate native natural-recovery timer. Arithmetic catch-up includes the final authored duration tick but never a tick at/after learned expiration. No authored action means no fabricated pose; original effect/Use assets still play.
- Nimble Feet/Agile Body `1002/10001002/20001002` and Haste `4101004/4201003/14101003` supply actual movement modifiers through `updateSkillMovement(sim, derived)`. Native player producer `0094d8f1..0094d9be` establishes normal speed80..140 and jump80..123 percentage clamps; this is not the unrelated Morph template clamp. Recovery, recast, expiry, job changes and death update the same cached stats; movement must sample them before integration.
- Rage `1101006/11101003` adds PAD and negative PDD; Iron Will `1301006` adds PDD/MDD. These and Haste use the authorized Cosmic `StatEffect.applyTo` primary-self consumer followed by optional party propagation. In the single-character offline field, the sole receiver is the caster; no remote party recipient or affected-target artwork is fabricated. Their entire scalar rank shape is validated before admission.
- Magic Guard `2001002/12001001` implements actual incoming-damage MP transfer. `absorbDamage(amount)` returns remaining HP damage and atomically spends `min(currentMP,trunc(amount*x/100))`; MP shortfall falls back to HP damage, never immunity. This follows Cosmic `TakeDamageHandler.java253–263`. Cast costs, duration, death and ordinary map inheritance use the same buff owner.
- Power Stance `1121002/1221002/1321002` exposes original `prop` as active `derived().stance`: rank1=42%,10seconds,30MP; rank30=90%,300seconds,50MP. Native [damage consumer](ghidra-client-corrections/expanded-stance-consumer.txt) `00958b8d` clamps the secondary percentage0..100 and compares unsigned random modulo100; a successful check negates displacement, **not damage**. These original records are invisible: ordinary allocation still requires unavailable quest/visibility authority, while an explicitly learned developer profile can exercise the real binding/cast controller. The retained `special`/`Use1` reaction alternatives are not automatically replayed on cast.

Cached `derived()` exposes `pad,pdd,mad,mdd,acc,eva,speed,jump,stance` modifiers. Every **admitted** buff has a gameplay consumer; unsupported accuracy/evasion/magic-stat buffs remain refused. Recasting refreshes duration without stacking. Different simultaneous scalar effects use a declared **local strongest-absolute-modifier policy**; original cross-skill overwrite precedence has not been recovered. Recovery, Magic Guard and Stance replace another active member of their own controller family. The field combines modifiers with its own stats/damage policy. WZ damage percentages and resource/effect timing are not a recovered original server damage formula.

Cooldowns use original rank `cooltime` seconds. Buffs and cooldowns belong to the character session and transfer across ordinary map commits, but are not silently persisted across reload. Death clears active buffs. Learned expiration is epoch-based and independent of cooldown duration; original cooldown persistence is not claimed.

## Resource ownership and integration contract

The field integration supplies:

```js
const skills = new SkillSystem(scene, store, catalog, {
  services, // shared hash-verified network + atlas leases
  audio, // shared AudioEngine, not a second output graph
  report, // accepts Error
  isBlocked,
  validateCast, // (skill, info) => null | reason, includes map/state/action readiness
  supportsAction, // action => boolean; never invent an absent actor pose
  validateAttack, // (skill, info) => null | reason, no mutation
  admitAttack, // (skill, info, onHit) => void; synchronous guaranteed admission
  startAction, // action => void; already admitted by validateCast
});
```

`admitAttack` is the existing field's sole combat authority, not a second attack path. Its immediately preceding `validateAttack` must guarantee admission without a later refusal or asynchronous boundary. It calls `onHit(skillId, target)` once per admitted target at the authored hit phase. `startAction` similarly cannot reject after validation. Passive recovery uses `skills.level(id)` and `skills.info(id, rank)`; damage/defense consumers read the cached `skills.derived()`.

Incoming damage calls `skills.absorbDamage(integerAmount)` exactly once after admission and before HP subtraction; it returns HP damage and owns MP debit/dirty notification. Physical resistance reads the cached `stance` percentage but preserves damage/protection on a successful roll. The simulation owner applies `updateSkillMovement(sim, skills.derived())` before advancing movement; it must not multiply an already modified base setting on successive ticks.

Call `await skills.prepare()` outside ticks after field entry and learned-profile changes. Call it again after enabling audio: audio cannot decode before the browser gesture creates the shared context. Preparation is serialized, bounded to64 resident learned skills and128 sequences per skill, and canceled on teardown. No-longer-owned skill leases are released before admitting a new learned batch, so job/profile changes cannot permanently exhaust the resident budget. New requests during preparation are coalesced into the same promise and drained within an explicit64-round admission bound. Casts refuse unprepared/unavailable original resources rather than silently casting invisibly. Visual-slot and Use-voice exhaustion also refuse before costs.

The owner preallocates display/animation slots, pins decoded Use/Hit entries, retains its started voices and aborts/releases all owned work on `destroy()`. `step(ms)` updates existing cooldown/buff/display state without snapshots, new arrays, text geometry or asynchronous loading. Run it once in the field's simulation order before combat/recovery; destroy it before releasing scene overlays and shared audio/atlas services.

Original `1001003` has `action/0=alert2` and a Use sound but **no skill effect canvases** in `100.img`; no substitute effect is fabricated. Power Strike and Slash Blast use their original baseline `effect` and `hit/0` sequences. Alternate hit and `CharLevel` assets are fully catalogued, but native selection of those alternatives is not recovered; the baseline presentation choice is explicit local policy. These three skills have no original Hit sound leaves; the skill owner does not replay Use as a fabricated Hit. Existing field mob-hit audio remains its own native event consumer.

## Verification boundary

The earlier expanded milestone passed147 tests/876 assertions; those counts are historical, not current source totals. Current gates and exact source identities are centralized in [validation](validation.md). The all-record audit uses the original catalog and actual default-map actor manifest. Its scoped production probes exercised Recovery duration/expiration, mutation-free cooldown refusal, Magic Guard shortfall/death, Stance expiry and Haste modifiers without visual/audio decoding. The [expanded native gameplay report](ingame-validation/expanded/gameplay/report.json) separately proves those selected bindings; [final native gameplay](native-ui-validation/final/gameplay/report.json) adds actual Stance expiry/recontact, visible effect cancellation, bound consumables and recovered combat timing on its stated build. These examples do not certify every controller or unavailable record.

The [earlier native-input report](ingame-validation/interaction-corrections/report.json) retains HP Recovery prerequisite unlock, ordinary mastery0 learning, maximum/expired disabling, job/book synchronization, Brandish mastery/SP gates and D-bound Power Strike cost4. Earlier allocation/buff/range evidence remains in the [fidelity report](ingame-validation/fidelity/report.json). Allocation does not make an unsupported cast available. No Windows-runtime or all-controller native-fidelity claim follows.
