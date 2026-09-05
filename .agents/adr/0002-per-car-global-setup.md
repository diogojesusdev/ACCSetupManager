# ADR 0002: Per-car global setup replaces the fleet-wide master

**Status:** Accepted and implemented
**Date:** 2026-09-05
**Supersedes:** `adr/0001-global-setup-sync.md`
**Implementation plan:** `../per-car-global-setup-plan.md`

## Context

ADR 0001 shipped a single fleet-wide master setup synced to every car × track combo
(~870 files across ~30 cars). The user found this too coarse: values tuned for one car
(brake bias, wheel rate, ARB, tyre pressures) are not meaningfully transferable to another
car, so a single JSON applied everywhere was, at best, a compromise and, at worst, actively
wrong for most cars.

## Decision

Replace the single fleet-wide master with **one master per car**, synced only to that car's
own track folders:

1. **Location**: `Setups\{car}\acc manager global setup.json`, one level down from where the
   old fleet-wide master lived (`Setups\acc manager global setup.json`).
2. **No enable/disable toggle**: the feature is always on. Every car folder found on disk
   gets a master and a full set of track copies, seeded eagerly at startup — no click.
3. **Seeding**: hand-crafted sprint-tuned baselines ship for the 8 car folders the author
   owns, derived from a real "copilot_fast" setup already in that car's folders (correct
   schema + value ranges), then adjusted for a ~20-minute sprint (aggressive ECU map, race
   brake pads, sized fuel load). Any other car folder gets a neutral, schema-valid skeleton
   (same structure, `carName` patched in) so it is always loadable in game even though it
   isn't tuned.
4. **No Push step**: saving a car's master (in-app, or via "Set as this car's global
   setup") fans out to that car's tracks immediately. There is no separate "master
   modified, click to push" state.
5. **In-game promotion, scoped per car**: editing the global setup file in game still
   promotes it to that car's master and fans out — but only within that car's own tracks.
   Other cars are never touched by another car's in-game edit.
6. **Recreate wins**: if a car's master is deleted outside the app, it is silently
   recreated from the baseline/skeleton and immediately fanned out, overwriting that car's
   owned copies even if they had diverged (e.g. from in-game tuning). This is destructive
   by design and intentionally has no confirmation, because the deletion itself happened
   outside the app.
7. **No undo**: all per-car global setup writes (seeding, fan-out, promotion, recreate) are
   unstaged and not undoable, unlike every other filesystem-mutating command in the app.
8. **UI**: the dedicated Global Setup view is gone. Each car's global setup is a pinned row
   at the top of that car's local setup list (any track), opened in the same editor as a
   normal setup. A "Set as this car's global setup" action on any setup row lets you adopt
   it directly.
9. **Migration**: on first startup after upgrade, any leftover fleet-wide state (the old
   root-level master, its owned copies, and the `global_meta` table) is deleted, then
   per-car seeding runs from scratch.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Per-car enable/disable toggle | User wants it always on; no on/off state to manage. |
| Push step preserved, scoped per car | User wants saves to apply immediately; no staged "modified" state. |
| Ship baselines for the full ~23-car ACC roster | Scoped to the 8 cars the author actually has; others get a safe skeleton, extended later. |
| Auto-restore master from an in-game-tuned copy on deletion | User chose "recreate wins": predictable over preserving tuning. |
| Keep undo for global setup writes | User dropped it entirely, consistent with "always on, no click" design. |

## Consequences

- SQLite: `global_meta` (single fleet-wide row) is dropped by the startup migration.
  `global_sync_state (car_folder, track_folder, synced_hash, synced_at)` is unchanged and
  now the only state the feature needs — no new tables were required.
- The reserved filename `acc manager global setup` (case-insensitive) is still blocked in
  all normal write flows and still hidden from setup lists; only its meaning changed (it
  now denotes a per-car master/owned-copy, not a fleet-wide one).
- Baselines are shipped as JSON assets (`src-tauri/src/services/global_baselines/*.json`,
  `include_str!`'d), not track-specific — the same values are fanned across all of a car's
  tracks, matching the accepted precedent from ADR 0001's fleet-wide baseline.
- Correctness still depends on the `notify` watcher grouping filesystem events by car
  folder and re-running the same self-healing reconciliation pass used at startup.
