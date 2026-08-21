# ACC Setup Manager PRD

## Status
Shared understanding captured on 2026-08-21 and updated after implementation-planning clarifications. This PRD reflects the current agreed scope for v1 plus initial source research.

## Product Summary
ACC Setup Manager is a standalone **Windows desktop app for v1** for managing **Assetto Corsa Competizione** car setup files stored in the user's Documents area.

The app should feel like a file explorer for ACC setups:

1. **Cars** column
2. **Tracks** column
3. **Local Setups** column
4. **Remote Source Area** that shows either:
   - remote setups for the selected source, or
   - a setup editor / preview panel

The app manages setup files only. Selecting a setup in the app does **not** apply it in-game.

## Core Goals
1. Make local ACC setup browsing and editing easy.
2. Make it easy to discover and import remote setups from fixed built-in sources.
3. Preserve a familiar explorer-like workflow with strong state retention while the app is open.
4. Build a solid Windows-first foundation that can expand later.

## User and File Scope
- Primary use case: managing ACC car setups.
- Known Windows setup root:
  - `C:\Users\<user>\Documents\Assetto Corsa Competizione\Setups`
- The app should auto-detect the standard Windows ACC setup root and allow manual override in settings.
- On startup, the app should scan the detected root and populate cars/tracks from the local filesystem.
- If the root is missing, the app should prompt the user to choose it manually.

## Layout and Navigation
### Main layout
- Vertical side-by-side explorer layout:
  - Cars
  - Tracks
  - Local Setups
  - Remote Source Area
- Remote sources are shown as **browser-like horizontal tabs**.
- The user switches sources explicitly; remote results are **not** merged into one list.

### Selection behavior
- Single-click selects an item and keeps the selection visibly highlighted.
- Double-click opens a setup in the editor/preview.
- Selection is purely UI selection, not in-game activation.

### Editor / preview placement
- Opening either a local setup or a remote setup preview replaces the remote setups list area.
- Closing the editor/preview returns the user to the previous remote list state.

## Local Setup Management
### Local setup actions
- Browse local setups by car then track.
- Create a new local setup file.
- Read/view setup JSON.
- Edit setup JSON.
- Rename setup files.
- Delete setup files.
- Import an existing JSON file into the selected car/track.

### Create
- Users may create setups only inside existing car/track folders.
- Users may **not** create car folders or track folders in v1.
- New setup creation starts from **empty JSON only**.
- When creating a new setup:
  - prompt for filename first
  - then open the editor

### Import
- Import should support:
  - drag-and-drop
  - file-picker button
- Import copies the source file into the selected ACC folder and leaves the original untouched.

### Edit
- Local setup editing uses a **raw JSON editor** in v1.
- Save is **explicit**, not auto-save.
- The editor should support in-editor undo/redo.
- Save validation requires **valid JSON syntax only**.
- No ACC-specific schema validation is required in v1.

### Delete
- Deleting a local setup should remove it from the filesystem.
- Use Windows recycle bin behavior when possible.

### Undo / redo
- App-level undo/redo is required at least for:
  - create
  - rename
  - delete
- Undo/redo history only needs to last for the current app session.

### Local list UX
- Show a cleaner display name and hide the file extension in the list.
- Support:
  - name filter
  - alphabetical sort
  - ranking sort if a meaningful ranking exists
- Remember local list selection and scroll state while the app is open.

## Remote Setup Discovery
### Source model
- Remote sources are a **fixed built-in allowlist** only.
- No custom user-added source support in v1.
- Prefer sources that are:
  - free
  - no-login
  - public HTML pages
  - direct-download friendly
  - technically reliable
  - legally safe to consume

### Fetch behavior
- Remote setups are fetched automatically when the user selects a track.
- Cache remote results **per car + track + source**.
- Cache lifetime: **24 hours**.
- Provide a manual **Refresh** action that bypasses cache for the current car/track/source.
- Only remote-source data is cached.
- Cache should include:
  - remote list metadata
  - fetched raw setup JSON used for preview, when available

### Offline / failure behavior
- If a fetch fails or the user is offline, show the last cached results when available and mark them as stale.
- If a selected source has no setups for the chosen car/track, show a clear empty state.

### Remote list UX
- Each setup row should show, when available:
  - name
  - source
  - last updated date
  - ranking
- Extra metadata such as author or download count may be shown only if the source naturally provides it.
- The source should be visibly labeled and link back to the original page when available.
- Support:
  - name filter
  - alphabetical sort
  - ranking sort if available
- Each source tab should remember its own scroll position, selection, and back-to-list position while the app is open.

### Remote interactions
- Single-click selects a remote setup.
- Double-click opens remote preview.
- Remote preview uses the same JSON editor UI in **read-only** mode.
- The preview must include a **Download** action.
- Each remote list row should also expose a one-click **Download** action.
- If preview is not technically possible for a source, that source may still be included as download-only.

### Download / import behavior
- Downloaded remote setups become local setups under the selected car/track.
- If a filename conflict occurs, prompt the user to:
  - rename, or
  - overwrite

## Ranking and “Best Setup” Strategy
### Agreed product direction
- Use **site-provided rating / popularity** when a source exposes a meaningful public signal.
- If a source has no useful ranking signal, do **not** add a custom hosted popularity database in v1.
- Do **not** use a Vercel-hosted download-count database in v1.

### Practical implication
Most likely sources do not expose consistent crowd ratings, likes, or public download counts. In practice, ranking may need to rely on:

- source-provided popularity if present
- lap times or featured status if present
- last updated date
- alphabetical sorting as fallback

## Research Summary: Candidate Remote Sources
Initial research found several practical candidates with public pages and no obvious login barrier:

### 1. ACCCarSetups
- Public site with browsing by car, class, track, and creator.
- Appears technically friendly for scraping public listings.
- Good candidate for v1.
- Public ranking signals are unclear.

### 2. Parc Ferme
- Public ACC setup listings with filtering by car, track, and setup type.
- Appears technically friendly for scraping public listings.
- Good candidate for v1.
- Public ranking signals are unclear.

### 3. Simply Lovely Setups
- Strong reputation and broad free coverage.
- Public landing page is visible.
- Need more implementation-level verification of scrapeable listing/detail structure.

### 4. Boosted Media
- Mentioned in broader search results as a free ACC setup source.
- Needs more direct verification before inclusion.

### Initial source recommendation
- Start with **one technically reliable source** if it has strong enough car/track coverage.
- Otherwise support **2-3 strong sources**.
- Current likely first-pass candidates: **ACCCarSetups** and **Parc Ferme**.

## Explicit v1 Decisions
- Standalone desktop app, not browser-only.
- Windows-only for v1.
- No telemetry/analytics in v1.
- Local preferences and cache only.
- No custom source authoring in v1.
- No persistent undo history across restarts.
- No requirement to support every remote source if a site blocks scraping or is unsafe to integrate.

## Key User Flow
1. App launches and auto-detects the ACC setup root.
2. User sees Cars, Tracks, Local Setups, and Remote Source tabs.
3. User selects a car.
4. User selects a track.
5. Local setups populate for that car/track.
6. The selected remote source auto-fetches setups for that car/track, using cache when fresh.
7. User single-clicks to select items in either local or remote lists.
8. User double-clicks a setup to open:
   - editable JSON for local setups
   - read-only preview for remote setups
9. From remote preview or row action, user downloads a setup into the local car/track folder.
10. From local list, user can create, rename, edit, delete, or import setups.
11. Closing the editor returns the user to the previous remote list state.

## Risks and Product Notes
1. Remote-source reliability is the biggest unknown because most candidates expose HTML, not official APIs.
2. Public rating/popularity data may be sparse or inconsistent across sources.
3. Source integration should be modular so weak sources can be replaced later without redesigning the app.
4. Preview capability may vary by source depending on whether raw setup files are directly retrievable.
5. Cross-platform support is deferred, so filesystem and shell abstractions should avoid making a later Linux/macOS port unnecessarily hard.

## Suggested Implementation Constraints
- Build source integrations behind a per-site adapter interface.
- Keep remote cache keyed by `(source, car, track)`.
- Separate explorer state from editor state so the app can restore list position cleanly.
- Treat filesystem actions as first-class operations with undo metadata recorded in memory for the current session.
