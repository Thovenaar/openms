# Modern combat formulas

Combat now uses the modern rules selected by the user from [StrategyWiki's MapleStory formulas](https://strategywiki.org/wiki/MapleStory/Formulas), reviewed on 14 September 2026. This intentionally replaces the recovered v83 damage equations. The original executable, Ghidra exports, WZ assets, and server scripts remain the references for movement, hit timing, skill eligibility, animation, costs, and effect lifetimes.

## Shared calculation

[`shared/combat-formulas.js`](../shared/combat-formulas.js) supplies weapon multipliers, job stat weights, mastery, damage ranges, percentage defense, resistance, level scaling, incoming damage, and dodge. [`character-stats.js`](../client/src/character/character-stats.js) and [`SkillDamage`](../client/src/skills/skill-damage.js) consume it in both the server authority and local simulation. The browser stat window consumes the same range calculation from server-published statistics.

The selected rules include rounded actual ranges, a 99% mastery ceiling, multiplicative final damage and remaining-defense stacking, additive normal/boss damage bonuses, and critical bonuses drawn separately per hit. Incoming attacks use linear monster ATT and unified defense. Ordinary outgoing accuracy rolls and flat monster defense subtraction have been removed. Damage over time uses the maximum actual range and excludes mastery, critical, damage bonuses, final damage, and monster defense.

The ordinary line limit is 150 billion; Arrow Bomb scales that limit by its skill percentage. Damage packets accept safe integers, and the existing WZ digit renderer has sixteen prepared glyph positions. Large stat ranges use compact labels with exact values in tooltips and accessible labels. HP accounting records the actual loss separately from the displayed hit. Shadow Partner applies its percentage before the cap and rolls each hit independently.

## Mapping the existing content

This is a modern combat ruleset running the existing v83 content. The following mappings are application policy, not claims about modern Nexon skill data:

| Existing input | Current interpretation |
| --- | --- |
| STR/DEX/INT/LUK, equipment ATT | Existing owned values; INT no longer contributes directly to Magic ATT. |
| Equipment `incPDD` and temporary PDD | Added DEF in the unified character defense formula. The old separate MDD contribution is superseded. |
| Weapon mastery field | Five percentage points per authored unit, added to modern job base mastery and capped at 99%. |
| Per-spell mastery | Strongest currently learned spell mastery becomes the magician's common mastery. |
| Legacy passive critical `damage` | Subtract 100 to obtain the additional critical-damage stat; the common base critical chance is 5%. |
| Skill `damage` | Skill percentage for each hit. |
| Legacy spell/summon `mad` or `pad` | Skill percentage when `damage` is absent. Heal's undead attack uses `hp`; Meso Explosion uses `x` when `damage` is absent. |
| `fixdamage` / `damagepc` | Fixed and maximum-HP-relative attacks keep their explicit skill semantics. |
| Monster `PDRate` / `MDRate` | Physical/magic defense percentages, including fractional results from debuffs. |
| Missing defense-rate fields | Explicit zero-percent defense. Legacy `PDDamage`/`MDDamage` are flat values and are never reinterpreted as percentages. |
| DOT `dot` | Per-tick skill percentage, falling back to the attack percentage above. Poison/ambush and venom snapshot it when the attack is generated. Venom keeps its three-stack effect. |
| Hypnotized monster | Linear monster ATT, modern target defense and level adjustment. |

Existing skill multipliers, status durations, poison's nonlethal HP floor, costs, ammunition, hit rectangles, attack delays and movement remain content rules. DOT receives no positive level bonus; its missing-level penalty uses the common 2.5% rate without the active-hit near-level bonus. This explicitly chosen adaptation fills the missing legacy DOT level data.

New authored equipment may supply `damagePercent`, `bossDamagePercent`, `normalDamagePercent`, `finalDamagePercent`, `ignoreDefensePercent`, `ignoreResistancePercent`, `evasionPercent`, `damageReductionPercent`, and `defensePercent`. Missing fields contribute zero. Final damage multiplies; ignore-defense, ignore-resistance and damage reduction combine on the remaining fraction. These inputs come from server-owned content and effects, never movement messages.

The current catalog supplies v83 jobs, skills, maps and equipment. Modern-only jobs, force maps, symbols, potentials, rings and their associated stat sources require corresponding content before those conditional systems can apply. Existing HP/MP limits and progression remain part of the retained content rules.

## Validation

- `client/test/physical-damage.test.js`: numeric examples, job/weapon weights, rounding, defense/level boundaries, critical hits, spells, summons, DOT, fixed damage, cap and random-window refill.
- `server/test/field-combat.test.js`: actual authority runtime with packaged WZ content, client/server agreement, incoming admission, dodge, and large-hit publication with correct HP loss.
- `client/test/skill-formula-context.test.js`: first-cast Poison Mist and Meso Explosion use freshly projected statistics.
- `client/test/combat-numbers.test.js`: every digit survives through the safe-integer boundary.
- Existing player-hit, skill lifecycle, projectile/status, movement and protocol tests cover the surrounding behavior.

The original damage evidence under `docs/ghidra-client-features/` remains historical evidence. It must not be used to change modern combat back to v83 equations without an explicit ruleset change.
