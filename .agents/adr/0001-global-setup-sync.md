# ADR 0001: ACC Manager Global Setup — owned-file sync architecture

**Status:** Superseded by `adr/0002-per-car-global-setup.md` (2026-09-05). Kept for history only.

## Context

The user wants one setup ("master") always present and up to date in every car × track combo in the ACC setups root. ACC setup JSON is car-specific — one file across all cars is intentionally accepted (values may be suboptimal for other cars). The app already owns the setups root layout (`{car}/{track}/*.json`), has a SQLite DB for settings/cache, session-scoped undo with staged copies, and a startup backfill for known track folders. No filesystem watcher exists today.

## Decision

1. **Master as a loose root-level file** — `Setups\acc manager global setup.json` — not appdata, not SQLite. User-visible, backupable, inside the ACC setups root. Depends on ACC ignoring root-level files (open verification item).
2. **Owned-file fan-out** — sync writes only `acc manager global setup.json` into every combo. Never touches user setups. Owned copies hidden from app setup lists.
3. **SQLite sidecar state** — per-combo `synced_hash` + feature meta. Enables self-write detection and startup reconciliation.
4. **Watcher-based bidirectional sync** (`notify`, debounced):
   - Owned file modified + hash mismatch → **promote** to master → **auto-fan-out** to all combos (in-game edits never wait for a click).
   - Owned file deleted → restore from master.
   - New car/track folder → full track set + owned files created.
5. **Asymmetric distribution** — in-app master edits fan out only on explicit Push; in-game edits fan out automatically. Rationale: app edits are deliberate authoring (user wants control); in-game edits are the source of truth for on-track tuning.
6. **Conflict rule: newest mtime wins** — no diff viewer, no prompts. Accepted silent-overwrite risk, logged.
7. **Reserved-name blocking** across all write flows — prevents foreign files hijacking the master via watcher promotion.
8. **No ACC-running detection, no warnings** — user accepted the stale-overwrite risk of pushing while ACC holds setups in memory.
9. **Full session undo for all sync writes** — previous content staged before overwrite (with single-representative staging optimization when fleet is in sync).
10. **Disable = delete everything** (owned copies + master), undoable. Master deleted via Explorer outside disable flow → `no_master` error state, **no** auto-restore.

## Alternatives considered

| Alternative | Rejected because |
| --- | --- |
| Overwrite-all sync (master replaces every setup) | Destroys user tuning; user chose owned file (Q3). |
| Master stored only in SQLite / appdata | Less transparent/backupable; user wanted the file in the ACC setups folder (Q6). |
| Diff viewer / prompt on divergent copies | User chose newest-mtime-wins for simplicity (Q5). |
| Auto-restore master from SQLite snapshot | User rejected silent resurrection (Q24). |
| Warn/detect ACC running before writes | User accepted the risk; no warnings wanted (Q13). |
| Owned copies visible in lists | ~870 entries of noise; hidden instead (Q22). |

## Consequences

- New Rust dependency: `notify`. New SQLite tables: `global_meta`, `global_sync_state`.
- First enable writes ~870 files and creates all known track folders — accepted, explicit user action.
- Every in-game edit triggers a fleet-wide write burst; debounce + staged-undo optimization required.
- Correctness of promotion depends entirely on the `synced_hash` snapshot being kept in lockstep with writes — single code path for all owned-file writes is mandatory.
- One behavior depends on unverified ACC behavior (root-level file ignored) — must be verified before release, fallback is master-in-appdata + visible path in UI.
