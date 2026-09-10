# External game-master console

The header and sidebar are browser development tools, not reconstructed native MapleStory windows. Character changes use the existing validated local profile authority. Render previews do not grant rewards, inflict damage, or rewrite original WZ metadata.

## Workspace and themes

- **Console theme** selects Windows XP blue, Windows 95 classic, or Y2K midnight chrome. The choice persists under `maple-inspection-theme-v1` in browser local storage. Storage failures are reported and leave a usable session-only theme.
- Theme attributes and variables live only on the two `.inspection-chrome` roots (header and sidebar). No theme attribute, color-scheme, font, or control appearance is installed on the body, viewport, or `.maple-ui-root`. The viewport canvas retains its independent layout and pixel rendering.
- **Character**, **Entities**, and **Diagnostics** shortcuts reveal their enclosing details, scroll the section into view, and focus its first control. Character reports unavailable until its owner exists rather than silently doing nothing.
- Pause/resume, key bindings, map selection and reload remain immediately reachable. The sidebar scrolls independently on desktop; below 960px it moves underneath the game, with page scrolling and full-width controls.
- Original game windows and keyboard behavior remain owned by GameUI. Console controls use native HTML labels, focus outlines, status messages and disclosure controls; advanced skill pools, learned skills, geometry, diagnostics and destructive reset are collapsible.

## Character editing and presets

Open **Character editor & presets**. Scalar fields use a two-column form. Editing job or level does not perform a job advancement or grant automatic points/skills.

1. Choose a preset and press **Preview preset**.
2. Review the staged form values. The live profile has not changed.
3. Press **Apply character changes** to call the existing `onProfileEdit` hook and its `CharacterDevelopment.edit` / `ProfileStore.commitProfile` transaction. All normal schema, skill catalog, ownership and persistence checks remain in force.
4. **Discard unsaved edits** restores the current profile. An existing unsaved draft blocks another preset until explicitly applied/discarded. Failed saves retain the draft and show the failure.

Presets are explicit GM policies, not native game grants:

| Preset | Fields replaced |
| --- | --- |
| Restore resources | HP and MP become the current profile's maximum HP and MP. |
| Training budget | AP becomes 20; only SP pool 0 becomes 10. Other SP pools, learned skills, job and level are untouched. |
| Drop testing | Wallet becomes exactly 100,000 mesos; no drop is spawned. Use the native inventory meso-drop action to exercise drop authority separately. |

**Save checkpoint** retains the existing persistence action; **Revive character** retains its existing admission rules. Reset remains behind **Destructive actions** and uses the existing confirmation owner. Reactor offering uses an owned inventory item and the existing offering hook, not a fabricated inventory grant.

## Bounded entity inspection

The previous scene and life selectors appended every ID to an undifferentiated dropdown. Finding a late placement required manually traversing the entire option list. The console now provides bounded, reusable on-demand searches rather than scanning or rebuilding searchable strings every simulation frame.

- **Find entity by ID** matches case-insensitive kind and ID in the current render snapshot. Search, select an entity, then inspect its actual actions/visibility/layer or **Center camera** on its reported coordinates. Centering uses the existing camera API (which disables follow); Reset restores follow.
- Render action/visibility/layer changes are session-only previews. Layer controls reuse `setLayer`; they are not a replacement for the renderer's authored depth rules. Mob combat remains authoritative over its normal runtime animation.
- **NPC & mob placement inspector** searches authored placement ID, kind and original template name. It can reveal placement/body/interaction/foothold geometry and authored hidden placements. NPC actions are non-authoritative artwork previews. Mob action overrides remain disabled; eligible NPC gameplay dialogue still requires the normal world interaction path.
- Each search accepts at most 120 input characters, scans at most 16,384 records, and materializes at most 200 dropdown options. Excess matches report the total and ask the user to refine the search; they are not silently presented as the complete result. Exceeding the record budget reports an explicit failure. Empty results disable entity mutation controls.
- A world-requested life selection resolves that exact placement, even if its ID is a prefix of many other IDs. It reveals the offline details and geometry without routing an inspector click through NPC gameplay interaction.
- Listener ownership remains per control owner: `Controls.destroy()` aborts scene/theme listeners, and `LifeControls.destroy()` / `ProfileControls.destroy()` remove their handlers and roots.

## Agent experiments and record/replay

The redesigned header reuses the existing **Allow agent control**, **Stop agent**, ownership status, **Experimental · temporary profile**, and **Exit experiment** controls. Permission is never inferred from theme or profile state.

Use the existing [`maple.agent` and `maple.dev.scenarios` workflow](agent-interface.md#temporary-scenarios-and-recording) for bounded recording and replay. After a human grant and `maple.agent.acquire`, begin a scenario, immediately start recording, dispatch normal actions, advance up to eight 30ms ticks per step, stop recording, and pass that recording to `run`. Exit restores the retained baseline. No second simulation, direct profile mutation, or separate recording format was added.

There are deliberately no misleading native Record/Replay buttons: trusted pointer/key input anywhere revokes the agent lease before action handlers run. A console button must not bypass that takeover safeguard. Existing Exit remains usable after permission loss. Read-only paginated `maple.agent.observe` and `maple.dev.describe({entityId})` complement the visible search without requiring a lease.

## Executed scoped proof

An isolated local browser harness loaded the actual source modules and stylesheet without rebuilding the project. The profile editor used the real `CharacterDevelopment` authority and `ProfileStore.memory`; scene/life API fixtures supplied bounded inspection records. This is console proof, not a full field playtest or an IndexedDB durability claim.

- Native mouse/select actions staged the 100,000-meso preset while the live wallet stayed 0; Apply committed the wallet to 100,000 and displayed saved feedback.
- Training preview staged AP20/SP10 while both live values stayed 0; Apply committed AP20 and SP pool0=10 through the same authority.
- Restore preview staged HP50/MP30 while the live values remained HP10/MP0. Discard returned the form to HP10 without mutation; preview plus Apply then committed HP50/MP30.
- A 250-entity snapshot showed exactly 200 options with an explicit refinement message. Searching `mob:249` reached its single option; Center camera called the existing API with `(498, 50)`. Empty search results disabled camera focus.
- A 250-placement life fixture likewise capped at 200. Searching the NPC name selected `life:249`; previewing its move action and showing geometry updated the selected fixture. A missing name disabled inspection and explained the empty result.
- All three themes changed only external chrome. A button probe beneath `.maple-ui-root` retained the same font, foreground, background and border radius across all themes. Reload restored Windows95 on both external roots.
- Screenshots were inspected at 1440×1100 and 390×844. At 390px the document and sidebar measured exactly 390px with no horizontal page overflow.

## Integrated native acceptance scenarios

The [integrated item report](ingame-validation/expanded/items/evidence.json) now retains native XP/95/Y2K selection,390px layout, unchanged native artwork/fonts, wallet preview/Apply and durable loot/pickup. The [windows report](ingame-validation/expanded/windows/report.json) proves temporary-profile Exit/reload and presentation restoration. The following broader checklist does not imply that every preset/entity combination was exercised:

1. Load a field, open Inventory, Stats and Key Settings, then switch all three console themes. Native raster artwork, control hit targets and chat typography must remain unchanged. Reload and confirm the selected console theme persists.
2. Preview and discard each preset, confirming native stats/wallet remain unchanged. Apply the wallet/training presets, confirm the native windows update, then reload to verify the durable commit. Exercise invalid values and profile/map ownership changes while saving; rejected edits must retain a usable draft.
3. Use Entities to search a late resident ID, toggle a harmless artwork preview, change its layer, center the camera, then restore Follow. Search no matches and verify mutation controls cannot run. Confirm native mob combat still owns its animation.
4. Search an NPC by original name in the placement inspector. Reveal geometry and inspect a preview, then use the NPC's world target for actual dialogue. A mob selection must never offer an action override or trigger NPC dialogue.
5. At 390px width and with keyboard-only Tab/Enter navigation, reach theme selection, all workspace shortcuts, preset Apply/Discard, map selection, pause and diagnostics. Scroll the console without losing access to the game.
6. Exercise the existing agent recording/replay sequence on the integrated build. Confirm trusted human takeover still revokes the lease, temporary profile progress cannot become a durable save, and Exit experiment restores the retained baseline under every theme.

Integration requires no new Main hook: `createControls` imports and initializes the theme owner using its existing abort signal. Keep the existing `onProfileEdit` and agent integration unchanged.
