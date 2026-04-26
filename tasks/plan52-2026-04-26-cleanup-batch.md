# Plan 52 — 2026-04-26 cleanup batch (9 items)

## Items from user

1. Player photo DB — h2h-3 (and likely h2h-2/h2h-5) don't update photo when slug changes.
2. WIPE all match data — clear match_results, disciplinary_actions, standings, voids. KEEP match_days.
3. Players ↔ orgs — link existing players to existing orgs (or create orgs first).
4. Doc: overlay design change process — single source-of-truth workflow.
5. Transparent backgrounds — widget overlays (timer, score-bug, up-next) must show only the small widget, not full-screen bg.
6. Lower-thirds: 3 separate cards in broadcast control, each with own text + Trigger button (instead of one card with slot field).
7. WIPE disputes + appeals + announcements. Keep players + orgs + photos + match_days + fixtures + overlays.
9. ALL overlays default OFF — must show NOTHING until trigger button clicked. Even leaderboard.
10. Broadcast v2 = MAIN. Replace /admin/broadcast → /admin/broadcast/v2. Match-day select moves to v2.

## Wave plan

### Wave A — parallel non-destructive (NOW)
- Agent A: Overlay HTML edits. Default-OFF gating + transparent widget shells + h2h photo render handler fix. 16 files.
- Agent B: Lower-third UI split into 3 separate cards (slot 1/2/3) each with own text+trigger.
- Agent C: Broadcast v2 → main route. Move match-day picker to v2. Old /admin/broadcast/[id] route redirects or deletes.
- Agent D: Docs — `docs/superpowers/specs/2026-04-26-overlay-design-process.md` covering edit → sync → preview → deploy.

### Wave B — destructive (PAUSE for user OK)
- Wipe `match_results`, `disciplinary_actions`, `standings`, `voids`, related tournament state.
- Wipe `disputes`, `appeals`, `announcements`, related notifications.
- Confirm with user before TRUNCATE / soft-delete.

### Wave C — orgs linkage (after wipes)
- Pre-condition: orgs already populated? If not, seed 11 orgs from overlay-15 data.
- Bulk-link players via SQL UPDATE on `players.organization_id`.
- Mr Oga stays unaffiliated.

### Wave D — verify
- Claude-in-Chrome multi-instance smoke. Every control button on /admin/broadcast/v2 verified.
- Production re-deploy + alias swap.

## Acceptance

- [ ] All 16 overlays start hidden on prod page-load (no visual until trigger).
- [ ] Widget overlays (timer/score-bug/up-next) show only small box, transparent canvas around.
- [ ] H2H photos swap correctly when slug changes via dropdown.
- [ ] 3 lower-third cards in broadcast control, each independently triggerable.
- [ ] /admin/broadcast/v2 is the main broadcast page; old route redirects or removed.
- [ ] Match-day picker works on v2.
- [ ] Disputes + appeals + announcements wiped.
- [ ] Match results + sanctions wiped, match days + fixtures kept.
- [ ] Players linked to orgs (10/13 minimum, Mr Oga unaffiliated).
- [ ] Design change process documented.
- [ ] Claude-in-Chrome smoke covers every button on broadcast v2.
