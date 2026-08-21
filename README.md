# ACC Setup Manager

Windows-first desktop app for browsing, editing, and organizing Assetto Corsa Competizione setup files.

## What is implemented

- Tauri 2 + React + TypeScript desktop shell
- auto-detection of the default ACC setups root
- manual root override stored in a local SQLite database
- filesystem scan for cars, tracks, and local setup files
- four-pane explorer layout with persistent in-memory selection state
- raw JSON editor with explicit save and syntax-only validation
- local create, rename, delete, and import flows
- session-scoped undo/redo for create, rename, and delete
- live **Simply Lovely Setups** adapter with preview and download into the selected local track folder
- SQLite-backed remote list and preview cache with stale fallback behavior
- built-in deferment notes for the other researched v1 sources

## Current remote-source status

The first remote adapter is now implemented for **Simply Lovely Setups**, based on the completed verification report in `.agents\remote-source-verification-report.md`.

- **Live in app:** Simply Lovely Setups (`list + download + preview`)
- **Deferred in app:** ACCCarSetups and Parc Ferme, with the report findings surfaced in their tabs
- **Current backend approach:** the Tauri service discovers the site-bundled public API key at runtime, fetches the verified JSON API directly, caches list/detail payloads in SQLite, and transforms detail payloads into the downloaded `.json` file format

## GitHub Pages

- Concise project site: `docs\index.html`
- Deployment workflow: `.github\workflows\deploy-pages.yml`
- Repository setting to enable once on GitHub: **Pages** -> **Build and deployment** -> **GitHub Actions**

## Local development

### Prerequisites

- Node.js 22+
- Rust 1.77+
- Windows

### Install dependencies

```powershell
npm install
```

### Run the desktop app

```powershell
npm run tauri:dev
```

### Frontend-only dev server

```powershell
npm run dev
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server on port 1420 |
| `npm run tauri:dev` | Full desktop app in Tauri |
| `npm run build` | Type-check and build the frontend |
| `npm run lint` | Run Oxlint |
| `npm run test` | Run Vitest |
| `npm run e2e` | Run Playwright tests |
| `cargo check --manifest-path src-tauri\Cargo.toml` | Validate the Rust backend |

## Project structure

```text
src/
  App.tsx
  lib/
  state/
  test/
  types/
src-tauri/
  src/
    commands.rs
    error.rs
    models.rs
    services/
    state.rs
```

## Notes

- The app works directly against the ACC setups folder but never applies a setup in-game.
- Delete operations keep undo support for the current session by staging a restore copy before moving the original file out of the ACC folder.
- Imported and saved files are validated as JSON syntax only, matching the v1 PRD.
- Remote Simply Lovely Setups downloads are transformed from the verified detail payload into pretty-printed JSON before being copied into the selected ACC track folder.
