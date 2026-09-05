# Feature Spec: ACC Manager Global Setup

**Status:** Superseded by `per-car-global-setup-plan.md` and `adr/0002-per-car-global-setup.md` (2026-09-05). Kept for history only — the fleet-wide single master described below was replaced by one master per car before this ever shipped.

## Summary

The user can define one "master" setup that is synced to **every car × track combination** in the ACC setups root as an owned file named `acc manager global setup.json`. In-app edits to the master require an explicit Push; in-game edits (made while the app is open) are promoted to the master and auto-fanned-out immediately. The same JSON lands in every combo — the user explicitly accepts that values tuned for one car are not car-specific.

## Glossary

| Term | Definition |
| --- | --- |
| **Master** | The canonical global setup file: `Setups\acc manager global setup.json` (loose file at the ACC setups root). |
| **Owned file** | A synced copy of the master written into `{root}/{car}/{track}/acc manager global setup.json`. Sync only ever writes this filename. |
| **Combo** | One car × track pair (a track folder inside a car folder). |
| **Fan-out** | Writing the master content to all owned files and updating the sync state. |
| **Promotion** | An in-game edit of an owned file being accepted as the new master content. |
| **Reconciliation** | Startup pass comparing every owned file hash against the SQLite `synced_hash` snapshot. |
| **Self-write** | A file change caused by the app's own fan-out; detected by matching hash and ignored by the watcher. |

## Behavior model

### Edit → distribution matrix (final, as agreed)

| Edit source | Master | Fleet (~870 copies) |
| --- | --- | --- |
| In-app master edit | Saved to master file | **Only on explicit Push click** |
| In-game edit (app open, watcher live) | **Auto-promoted immediately** | **Auto-fanned-out immediately, no click** |

### Sync triggers

1. **Startup reconciliation** — hash every owned file vs. SQLite snapshot. Catches in-game edits made while the app was closed.
2. **Filesystem watcher** (while app open) — `notify` crate, recursive on the setups root, debounced (~300–500 ms). Handles: owned-file modification (promotion), deletion (restore), new car/track folders (create track set + sync).
3. **Push button** — manual fan-out after in-app master edits.

### Target set

For **every car folder on disk** (including cars created mid-session by ACC):

- All 23 `KNOWN_ACC_TRACK_FOLDER_NAMES` folders (created if missing, reusing the existing backfill logic).
- Every other track folder that actually exists on disk (custom/odd folders included).

First enable therefore writes ~870 files (~30 cars × ~29 tracks) and creates the full known track-folder set.

### Sync state model

| State | Meaning |
| --- | --- |
| `disabled` | Feature off; no owned files exist. |
| `no_master` | Enabled but master file missing (deleted via Explorer). Error state in UI; user recreates via adopt or fresh edit. **No auto-restore** (explicit user decision). |
| `master_modified` | Master edited in-app; fleet stale until Push. |
| `synced` | Fleet matches master hash. |

Per-combo state (SQLite `global_sync_state`): `in_sync`, `missing` (restore scheduled by watcher), `diverged` (transient — resolved by promotion + fan-out).

### Conflict resolution

Multiple owned files diverged from the master at the same time (e.g., two in-game edits while the app was closed): **newest mtime wins**. The winning copy is promoted and fanned out; the others are silently overwritten. Accepted risk; a log entry records the decision.

### Reserved filename protection

The stem `acc manager global setup` (case-insensitive) is **blocked** in all write flows:

- create, rename, import, remote download, copy-to-tracks target names.
- Watcher never promotes non-owned files.

Rationale: a foreign file with that name would be treated as an in-game edit, hijacking the master and fanning out to the entire fleet.

## Edge cases (all decided)

| Case | Behavior |
| --- | --- |
| Owned file name already exists in a track folder at first sync | **Overwrite** (Q9). |
| User deletes an owned copy via app UI | **Blocked** — delete flow refuses the reserved filename. |
| User deletes an owned copy via Explorer (app open) | Watcher **restores instantly from master**. |
| User deletes an owned copy via Explorer (app closed) | Startup reconciliation restores it. |
| Master deleted via Explorer | `no_master` error state; no silent restore (Q24). |
| Feature disabled | **Delete all owned copies + master file from Documents** (Q10a, Q21). Undoable (staged). |
| ACC running during push/fan-out | **No detection, no warnings** (Q13). Accepted risk: ACC may overwrite fresh copies with stale in-memory state on its next save. |
| In-app master edit saved but not pushed | `master_modified` state; Global Setup view indicates stale fleet. |
| New car folder appears while app open | Watcher creates full known track set + owned files in it (Q15). |
| Master edited in-app, then in-game edit arrives before Push | In-game edit wins (promotion is newer); `master_modified` cleared by the auto-fan-out. |

## Undo integration

- **Push**: full undo. Previous content of every overwritten owned file is staged before writing. Optimization: when all owned files are in sync (identical content), stage **one representative copy** instead of ~870 and restore all from it.
- **Initial enable fan-out and disable cleanup**: same staging mechanism, undoable within the session.
- Promotion-triggered auto-fan-out: same staging/undo semantics as Push.

## UI

Dedicated **Global Setup** view (left nav, per Q17 proposal):

- Setup editor (same structured editor + raw JSON fallback as local setups).
- **Push to all** button (enabled in `master_modified` state).
- **Enable / Disable** action. First enable creates the master from the built-in default baseline and runs the initial fan-out (the click satisfies the "writes happen on explicit user action" rule).
- **Adopt setup as master** — pick any existing setup file from the explorer; its content becomes the new master (then normal Push flow).
- Per-combo sync status, aggregated per car (not an 870-row list).
- `no_master` error state with recovery actions.
- Owned files are **hidden from all normal setup lists** (Q22) — visible only in the Global Setup view and in-game.

## SQLite sidecar state

Regardless of where the master file lives, sync metadata lives in SQLite (existing DB):

- `global_meta`: `feature_enabled`, `master_hash`, `master_mtime`.
- `global_sync_state`: one row per combo — `car_folder`, `track_folder`, `synced_hash`, `synced_at`.

Self-write detection: watcher event → hash owned file → matches `synced_hash` = our own write, ignore; mismatch = in-game edit → promote.

## Default baseline setup (first-run master)

Targets (safe but fast, works everywhere, per Q18):

| Parameter | Value | Rationale |
| --- | --- | --- |
| ECU map | 1 (most aggressive) | Fast map for sprints, as requested |
| Fuel | 40 L | Sprint margin, low mass |
| Brake power / bias | 100% / ~54.5 | Safe, predictable |
| ABS / TC | ABS 2, TC 4 / cut 3, power/slip 1 | Forgiving electronics |
| Aero | Moderate wing (~4–5), splitter 0 | Stable baseline, not drag-heavy |
| Ride height | Mid-high | Avoids floor strikes on all tracks |
| Dampers / ARB / wheel rate | Mid-range | Neutral, easy to control |
| Tyres / pressures | Medium compound, ~141–142 kPa hot target | All-round durability |

**Implementation note:** the shipped baseline JSON must be **schema-accurate** — capture the field structure from a real ACC-saved setup file and apply the target values, rather than hand-writing field names. The draft values above are the intent; the JSON template is verified by smoke-testing in game before release.

## Open verification items

1. **Root-level master file is invisible to ACC** — confirm ACC ignores loose files at `Setups\` root (5-minute in-game test). The app's own scanner already ignores non-directories, so app-side is safe either way.
2. **Baseline JSON smoke test** — load the default master in-game in one car, confirm ACC accepts it.
3. **~870-file fan-out performance** — acceptable on first enable; watcher must debounce bursts.

## Implementation touchpoints

**Backend (Rust):**
- New service: `src-tauri/src/services/global_setup.rs` (master I/O, fan-out, reconciliation, promotion, staging for undo).
- New dep: `notify` (watcher) — task started in `lib.rs` setup, debounced.
- New commands: `global_setup_get_state`, `global_setup_enable`, `global_setup_disable`, `global_setup_push`, `global_setup_adopt`.
- Reserved-name guard in `create/rename/import/copy/download` flows (`filesystem.rs`, `remote.rs`).
- Filter reserved name in `scan_track_setups` output (Q22 hiding).

**Frontend (React/TS):**
- Global Setup view + zustand state slice.
- Reserved-name guard mirrored in UI validation.
- Setup list filtering by reserved name (defense in depth; backend already filters).
