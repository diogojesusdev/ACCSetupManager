# Implementation Plan: Per-Car Global Setup

**Status:** Agreed (post-grilling), not yet implemented
**Date:** 2026-09-05
**Supersedes:** `global-setup-spec.md`, `adr/0001-global-setup-sync.md` (both become historical)

## Summary

The single fleet-wide global setup is replaced by **one global setup per car**. Each car folder
owns a master file that is synced to every track folder of that car — and only that car. The
feature has **no on/off toggle**: every car folder on disk always has a master and a full set of
track copies, seeded eagerly at startup.

## Glossary

| Term | Definition |
| --- | --- |
| **Car master** | `Setups\{car}\acc manager global setup.json` — the canonical global setup for one car. |
| **Owned copy** | `Setups\{car}\{track}\acc manager global setup.json` — a synced copy of that car's master. |
| **Fan-out** | Writing a car master to all of that car's track folders. Always car-scoped. |
| **Promotion** | An in-game edit of an owned copy becoming that car's new master. |
| **Baseline** | The shipped sprint-optimised default JSON for a known car. |
| **Skeleton** | A schema-valid, neutral-value default for a car with no shipped baseline. |

## Decisions (all settled)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Master location | Loose file inside the car folder: `Setups\{car}\acc manager global setup.json` |
| D2 | Enable/disable toggle | **None.** The feature is always on. |
| D3 | When files are written | **Eager.** Startup seeds a master + full fan-out for every car folder found on disk. |
| D4 | Seeding source | Hand-crafted sprint baselines for the 8 known car folders; schema-valid skeleton (correct `carName`, neutral values) for any other car. |
| D5 | Baseline sourcing method | Derive each baseline from a real setup file already present in that car's folders (guarantees schema + value ranges), then apply sprint targets. |
| D6 | Master deleted via Explorer | Silently recreated from that car's baseline. |
| D7 | Recreate vs. surviving tuned copies | **Recreate wins** — baseline is written and immediately fanned out, overwriting the tuned copies. |
| D8 | Migration from the old feature | Delete the old root master and all existing owned copies, drop old state, reseed per car from scratch. |
| D9 | Push | **Removed.** Saving a car's master fans out to that car immediately. |
| D10 | In-game promotion | Kept, scoped per car. An in-game edit at one track becomes that car's master and overwrites its other track copies. |
| D11 | Undo | **Removed** for all global-setup writes. |
| D12 | UI | The dedicated Global Setup view is deleted. Each car's global setup appears as a pinned entry at the top of every track list for that car. |
| D13 | Adopt | Kept as a per-car context action: right-click any setup → "Set as this car's global setup". |

## Behaviour model

### Write triggers

| Trigger | Effect |
| --- | --- |
| Startup seeding | For every car folder: if no master, write baseline/skeleton. Then fan out to all known + existing track folders. |
| Startup reconciliation | Per car: hash owned copies vs. `synced_hash`. Diverged → promote newest, fan out. Missing → restore from master. |
| Watcher: owned copy modified, hash unknown | Promote to that car's master → fan out within that car. |
| Watcher: owned copy deleted | Restore from that car's master. |
| Watcher: car master deleted | Recreate from baseline → fan out (D7). |
| Watcher: new car folder appears | Seed skeleton (or baseline if known) → create known track set → fan out. |
| Watcher: new track folder appears | Write that car's master into it. |
| In-app save of a car master | Write master → immediate fan-out to that car. |
| Adopt | Copy chosen setup into that car's master → immediate fan-out. |

### Conflict rule

Unchanged, but **scoped per car**: if several of one car's copies diverged simultaneously,
newest mtime wins; the rest are overwritten. Logged. Cars never affect each other.

### Reserved filename

Unchanged. The stem `acc manager global setup` stays blocked in create / rename / import /
remote download / copy-to-tracks, and owned copies stay hidden from normal setup lists (the
pinned UI entry replaces them).

## Data model changes

Replace `global_meta` (single row) with a per-car table:

```sql
CREATE TABLE global_car_master (
  car_folder  TEXT PRIMARY KEY,
  master_hash TEXT NOT NULL,
  seeded_at   TEXT NOT NULL
);
```

`global_sync_state (car_folder, track_folder, synced_hash, synced_at)` is unchanged — it is
already car-keyed. Migration drops `global_meta` and clears `global_sync_state`.

## Baseline authoring (D4/D5)

Target cars (folders present on disk):

`bentley_continental_gt3_2018`, `bmw_m4_gt3`, `ferrari_296_gt3`, `ford_mustang_gt3`,
`lexus_rc_f_gt3`, `mclaren_720s_gt3_evo`, `porsche_991ii_gt3_cup`, `porsche_992_gt3_r`

For each car: pick a real setup from that car's folders as the structural template (field names,
array shapes, `trackBopType`), then apply the sprint targets below, clamped to that car's own
observed value ranges. The 991ii Cup is **not a GT3** — it gets its own value pass, not the GT3
numbers.

Sprint targets (15–20 min races):

| Parameter | Target | Rationale |
| --- | --- | --- |
| ECU map | Most aggressive map available for that car | Max power, fuel/wear irrelevant over a sprint |
| Fuel | ~1.15 × (fuel-per-lap × expected laps) | Light car, small margin |
| Brake pads | Compound 1 (race) front and rear | Best bite over a short run |
| Brake power / bias | 100% / car-typical mid-front | Predictable |
| TC / ABS | Mid-low TC, low ABS | Fast but still forgiving |
| Tyre pressures | Car's hot-target window (~26.5–27.0 psi GT3) | One-stint window |
| Tyre set | Fresh set | Sprint |
| Aero / ride height | Car-typical mid, slightly low ride height | Short-run pace over safety |
| Dampers / ARB / wheel rate | Car-typical mid-range | Neutral, drivable everywhere |

Baselines ship as JSON assets (one file per car folder name) rather than a single Rust string
constant, so adding cars later is a data change.

## Code changes

### Backend (`src-tauri`)

**`services/global_setup.rs` — largest change**
- Delete `enable`, `disable`, `push`, `set_feature_enabled`, `load_meta`/`GlobalMeta`.
- Add `car_master_path(root, car)`, `seed_all(state)`, `seed_car(state, car)`,
  `fan_out_car(state, car)`, `promote(state, car, content)`.
- `collect_combos` becomes `collect_track_folders(root, car)` — per-car, still creating the
  known-track set.
- `save_master(car, content)` → write + `fan_out_car`.
- `adopt(car, source_path)` → write + `fan_out_car`.
- `reconcile` loops over cars, each independently.
- Watcher batch handler groups events by car folder; promotion/restore/recreate all car-scoped.
- Baseline registry: `baseline_for(car_folder) -> Option<&str>` over the shipped JSON assets,
  plus `skeleton_for(car_folder)` that patches `carName` into the neutral template.
- Remove all `stage_file` / `UndoOperation::GlobalSync` calls.

**`models.rs`**
- `GlobalSetupState` / `GlobalSetupStatus` / `GlobalSetupCarStatus` are dropped, or reduced to a
  small per-car status attached to the existing `Car` model (`hasGlobalSetup`, `globalSetupPath`,
  `inSync`/`diverged` counts) so the browser can render the pinned entry.

**`commands.rs` / `lib.rs`**
- Remove `global_setup_get_state`, `_enable`, `_disable`, `_push`.
- Keep/retarget `global_setup_save_master(car_folder, content)` and
  `global_setup_adopt(car_folder, source_path)`.
- Startup: `seed_all` before `reconcile` in `state.rs`; watcher spawn unchanged.

**`services/undo.rs`**
- Delete `UndoOperation::GlobalSync` and `GlobalSyncMode` entirely.

**Migration (one-shot, at startup)**
- If `global_meta` exists: delete `{root}\acc manager global setup.json`, delete every owned copy
  listed in `global_sync_state`, drop `global_meta`, clear `global_sync_state`. Then seed.

### Frontend (`src`)

- **Delete `GlobalSetupView.tsx`** and its nav segment in `App.tsx` (`activeView` collapses to the
  library view only).
- `lib/tauri.ts`: drop `loadGlobalSetupState`, `enableGlobalSetup`, `disableGlobalSetup`,
  `pushGlobalSetup`; retarget `saveGlobalSetupMaster` / `adoptGlobalSetup` to take a car folder.
- Setup list: render a pinned, visually distinct "Global setup" row at the top of every track
  list, backed by the **car master path** (not the track copy). Opening it opens the master in the
  existing editor; saving calls the save command, which fans out.
- Context menu: add "Set as this car's global setup" on normal setups.
- The pinned row is not renameable, deleteable, or copyable-to-tracks.
- `lib/setup-list.ts`: reserved-name filtering stays as defence in depth.

### Docs
- Mark `global-setup-spec.md` and `adr/0001` superseded; add `adr/0002-per-car-global-setup.md`.
- Update `TODO.md` and the GitHub Pages copy that describes the global setup.

## Phasing

1. **Migration + data model** — new table, one-shot cleanup of the old fleet, no seeding yet.
2. **Backend core** — per-car master I/O, seeding, fan-out, promotion, reconciliation; undo removal.
3. **Baselines** — derive and author the 8 sprint JSON assets + neutral skeleton.
4. **Watcher rework** — car-scoped event grouping, recreate-wins rule.
5. **Frontend** — delete the view, add the pinned entry and the adopt context action.
6. **Verification** — see below.

## Verification

- ACC ignores a loose `.json` sitting directly in a car folder (**must be tested in game** — this
  is the one assumption the whole layout rests on; if it fails, fall back to masters in app data).
- Each of the 8 baselines loads in game without ACC clamping or rejecting values.
- Delete a master in Explorer → recreated + fanned out, tuned copies gone (D7 is destructive by
  design; confirm it feels right in practice).
- In-game edit at one track → that car's other tracks update, other cars untouched.
- New car folder created by ACC while the app runs → skeleton + full track set appear.

## Known risks

- **D7 is a data-loss path.** Deleting a car master intentionally discards that car's tuned copies.
  There is no undo (D11) and no confirmation, because the deletion happens outside the app.
- **D3 + D11 together mean the app writes to the user's Setups folder on first launch with no
  click and no way back.** Acceptable per the toggle-free design, but it should be called out in
  the UI/README so it is not a surprise.
- Baselines are only correct for the 8 known cars; everyone else gets a neutral skeleton that is
  loadable but not fast.
