# Remote Source Verification Spike

## Purpose

This spike exists to decide which public ACC setup source(s) are safe and practical to integrate into **ACC Setup Manager v1** before any production scraper or adapter is implemented.

The output of this spike should let another agent or engineer answer:

1. **Which source should ship first?**
2. **Which sources should be excluded for v1?**
3. **What can each source actually support?**
   - list/search only
   - list + direct download
   - list + download + preview
4. **What adapter shape is required for each source?**

## Why this spike is required

The current app already has:

- built-in remote source tabs
- query boundaries for remote loading
- a normalized remote-source foundation

What it does **not** have yet is a real source adapter. The biggest risk is wasting implementation time on a source that is:

- not legally or ethically suitable to automate against
- too brittle to parse reliably
- too thin in ACC car/track coverage
- blocked behind login or anti-bot controls
- unable to provide usable download or preview behavior

This spike reduces that risk before production integration work starts.

## Product context

From the PRD and implementation plan:

- v1 uses a **fixed built-in allowlist** of remote sources only
- preferred sources are:
  - free
  - public
  - no-login
  - technically reliable
  - legally safe to consume
- remote results are fetched automatically when a user selects a car + track
- remote data is cached per `(source, car, track)` for 24 hours
- remote preview is preferred, but download-only is acceptable when preview is not technically possible

## Candidate source order

Evaluate in this order unless new evidence makes the order obviously wrong:

1. **ACCCarSetups**
2. **Parc Ferme**
3. **Simply Lovely Setups**
4. **Boosted Media** only if one of the top three is clearly unsuitable or too weak

## Spike goal

Produce a recommendation for **the first real v1 source adapter** and a go/no-go decision for each candidate.

The recommendation should be based on verified evidence, not assumption.

## Non-goals

This spike is **not** for:

- implementing production scraper code
- building the final adapter
- wiring Tauri or React UI changes
- adding custom user-defined sources
- solving long-term multi-source aggregation
- designing a backend service

Light throwaway probing scripts are acceptable if needed for verification, but the spike deliverable is a **decision document**, not production code.

## Questions the spike must answer

For each source:

1. Are the public pages reachable without login?
2. Are robots/terms obviously incompatible with the intended use?
3. Can car and track listings be discovered consistently?
4. Can a user-relevant listing be mapped to our local `(car, track)` model?
5. Is there a stable detail page or stable direct-download path?
6. Can the actual setup file be downloaded without auth/session tricks?
7. Is raw setup JSON preview possible before download?
8. Is useful metadata exposed?
   - setup name
   - source page URL
   - author
   - updated date
   - ranking/popularity/featured signal
9. Is the HTML structure likely stable enough for a v1 adapter?
10. Is the source broad enough to justify inclusion?

## Required evaluation dimensions

Each candidate must be evaluated across these dimensions.

### 1. Policy / terms / robots fit

Check for obvious blockers such as:

- explicit prohibition on scraping/automation
- robots exclusions on the relevant public listing/detail paths
- login walls or anti-bot interstitials on normal browsing paths

This is a practical product-level check, not legal advice. If the situation is ambiguous, mark it clearly as **uncertain** rather than assuming approval.

### 2. Public accessibility

Verify whether a normal unauthenticated user can:

- browse the source
- open a setup detail page
- reach the setup download

### 3. Car / track coverage

Estimate whether the source covers enough ACC combinations to be useful for v1.

The spike does **not** need exhaustive coverage, but it should sample enough combinations to judge whether the source is:

- broad enough
- patchy but usable
- too thin for v1

### 4. Metadata quality

Check what the source naturally exposes and how easy it is to normalize:

- setup title
- car
- track
- author
- updated/published date
- ranking signal
- setup type if present
- direct source page URL

### 5. Download feasibility

Verify whether the final setup file can be downloaded by a source adapter without a logged-in browser session.

Document:

- final file format
- whether the file is actually JSON
- whether redirects/cookies are required
- whether filenames are usable or need normalization

### 6. Preview feasibility

Determine whether ACC Setup Manager can show the remote setup in read-only JSON preview before download.

Possible outcomes:

- **Supported** — raw content can be fetched before import
- **Possible with extra transformation** — content is fetchable but needs minor extraction
- **Not practical** — source only supports opaque download or blocked fetch

### 7. HTML / integration stability

Judge whether the site structure is likely to survive a lightweight v1 adapter.

Call out:

- stable semantic links or identifiable attributes
- fragile selectors
- JS-heavy rendering
- pagination complexity
- anti-bot friction

### 8. Ranking usefulness

Check whether the source exposes a meaningful ranking or popularity signal for the PRD’s “ranking sort if available” requirement.

Possible signals include:

- featured status
- popularity label
- likes/downloads
- lap times
- freshness/date

If no meaningful signal exists, say so plainly.

## Suggested verification method

For each source, try to identify:

1. **Entry page(s)**  
   The top-level browse/search/listing pages relevant to ACC setups.

2. **Car/track navigation pattern**  
   How a user narrows results to a given car and track.

3. **Representative listing page**  
   A real page that lists multiple setups.

4. **Representative detail page**  
   A real setup page.

5. **Representative download path**  
   The actual request or URL path used to get the setup file.

6. **Preview path if any**  
   Whether raw setup content can be fetched or viewed before download.

Do not stop at homepage-level impressions. The spike is only useful if it verifies real listing/detail/download flows.

## Minimum sample depth

For each candidate, test enough to avoid shallow false positives. At minimum:

1. one listing flow
2. one detail flow
3. one download attempt
4. one preview feasibility check
5. at least a small sample of multiple car/track combinations where practical

## Deliverable format

The spike should produce a markdown report with:

### 1. Executive recommendation

- recommended first source for v1
- optional second source for later
- rejected/deferred sources

### 2. Per-source findings

For each source include:

- **Verdict:** go / maybe / no-go
- **Why**
- **Public access status**
- **Terms/robots confidence**
- **Coverage confidence**
- **Metadata quality**
- **Download support**
- **Preview support**
- **Ranking signal**
- **Integration risk**
- **Recommended adapter capability**
  - list only
  - list + download
  - list + download + preview

### 3. Evidence

Include concrete links, sample paths, and brief notes on what was observed.

### 4. Adapter notes

For each viable source, document the likely mapping shape:

- how to search/list by car + track
- what identifies a setup uniquely
- what URL is stored as `sourcePageUrl`
- what should become `downloadUrl`
- what should become `previewKey`
- which fields map into normalized metadata

### 5. Final recommendation

Conclude with a single explicit recommendation:

- **Build source X next**
- **Build source Y only if X fails**
- **Do not implement source Z for v1**

## Acceptance criteria

The spike is complete only if all of these are true:

1. **Each candidate source has a clear verdict**  
   `go`, `maybe`, or `no-go` with reasoning.

2. **At least one candidate has a justified recommendation for first implementation**  
   If none qualify, the spike must explicitly say that and explain why.

3. **Download feasibility has been tested, not assumed**  
   There must be evidence that a real setup file can or cannot be fetched.

4. **Preview feasibility has been tested, not assumed**  
   The result must clearly say whether read-only JSON preview is practical.

5. **Terms/robots concerns are documented**  
   Even if inconclusive, the uncertainty must be called out.

6. **Coverage is judged from real source exploration**  
   Not just homepage claims.

7. **The report contains enough adapter detail for a follow-up implementation agent**  
   Another agent should be able to start writing the first adapter without redoing the whole discovery process.

## Handoff expectation for the next agent

The next implementation agent should be able to read the spike report and know:

- which source to integrate first
- whether preview should be supported
- what normalized fields can be extracted
- what the main risks are
- what selectors/endpoints/pages to start from

If the spike report does not provide that level of detail, it is not finished.
