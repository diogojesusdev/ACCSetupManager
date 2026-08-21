# Remote Source Verification Report

## Status

Completed on 2026-08-21 for ACC Setup Manager v1.

## Executive recommendation

- **Build next:** **Simply Lovely Setups**
- **Conditional later fallback:** **Parc Ferme** only if v1 is allowed to depend on an authenticated download flow and the public ACC catalog grows beyond the currently visible sample
- **Do not implement for v1:** **ACCCarSetups** and **Boosted Media**

## Decision matrix

| Source | Verdict | Why | Recommended adapter capability |
| --- | --- | --- | --- |
| Simply Lovely Setups | **go** | Verified public list/detail JSON API, broad ACC coverage, previewable detail payloads, no user login required | **list + download + preview** |
| Parc Ferme | **maybe** | Public listing/detail pages are good, but the current public ACC catalog is tiny and the client-side download flow requires sign-in | **list + preview** for research only; not v1 |
| ACCCarSetups | **no-go** | Strong catalog coverage, but rows are an aggregator layer that link out to third-party pages or blank targets instead of source-hosted setup files | **list only** |
| Boosted Media | **no-go** | No verified setup repository flow; direct fetches hit Cloudflare and the obvious ACC setup path returns 404 | none |

## Final recommendation

**Build Simply Lovely Setups next.**  
If that fails because the undocumented public API or bundled API key changes, do **not** automatically fall back to ACCCarSetups or Boosted Media. Revisit **Parc Ferme** only if product scope changes to allow authenticated downloads and the ACC inventory materially expands.

---

## Source 1: Simply Lovely Setups

- **Verdict:** **go**
- **Why:** This is the only candidate that exposed a practical, source-native no-login path for list, detail, preview, and download generation.
- **Public access status:** Public site pages are reachable without login. The JSON API rejects anonymous requests, but the site ships a public `X-API-Key` in its client bundle and accepts requests with that header.
- **Terms/robots confidence:** **medium**. `robots.txt` allows `/` and only blocks account/auth/community-write paths. No obvious prohibition was found on the public site surface I checked. The API is undocumented, so policy certainty is lower than a documented public API.
- **Coverage confidence:** **high**. The options endpoint exposed **54 cars** and **25 tracks**, and the list endpoint reported **2,353 setups** total.
- **Metadata quality:** **low to medium**. Usable core mapping fields exist, but author, updated date, and ranking/popularity are absent from the verified API responses.
- **Download support:** **supported**
- **Preview support:** **supported**
- **Ranking signal:** **none verified**
- **Integration risk:** **medium**. The site is adapter-friendly, but the API is undocumented and currently depends on a bundled public API key.
- **Recommended adapter capability:** **list + download + preview**

### Evidence

1. **Robots**
   - `https://simplylovelysetups.com/robots.txt`
   - Observed: `Allow: /`; disallows only `/auth/`, `/account/`, `/community/upload`, `/community/my-setups`, `/community/edit/`, `/user/`.

2. **Entry page**
   - `https://simplylovelysetups.com/setups`
   - Observed page title: `Free ACC Car Setups - All Cars & Tracks | Simply Lovely Setups`

3. **Public options API**
   - `GET https://simplylovelysetups.com/api/v1/acc/setups/options`
   - Without the site-bundled API key header: `401 {"detail":"Not authenticated"}`
   - With the site-bundled API key header: `200` plus cars/tracks/weather/setup-types

4. **Representative listing API**
   - `GET https://simplylovelysetups.com/api/v1/acc/setups/?car_name=bmw_m4_gt3&track_name=monza&size=3`
   - Observed: `200`, `total: 3`, sample filename `monza-bmw_m4_gt3-8d3ae65d-6c46-4f71-b308-b51b324f541e.json`

5. **Representative detail / preview API**
   - `GET https://simplylovelysetups.com/api/v1/acc/setups/?object_id=692db2890c9df3da0e743245&details=true`
   - Observed fields: `id`, `car_name`, `track_name`, `setup_type`, `weather`, `trackBopType`, `file_name`, `basicSetup`, `advancedSetup`
   - This payload is already suitable for a read-only JSON preview.

6. **Coverage samples**
   - `bmw_m4_gt3 + monza` -> `total: 3`
   - `ferrari_296_gt3 + spa` -> `total: 7`
   - `mercedes_amg_gt4 + hungaroring` -> `total: 1`
   - `maserati_mc20_gt2 + red_bull_ring` -> `total: 0`
   - Conclusion: broad, but not exhaustive.

7. **Download behavior**
   - Verified from the `/setups` client bundle: the site fetches the detail JSON for a selected setup and generates the downloadable `.json` client-side from that detail payload rather than redirecting to an opaque file URL.

### Adapter notes

- **How to search/list by car + track**
  - Call `GET /api/v1/acc/setups/?car_name={car_name}&track_name={track_name}&size={n}`
  - Optional filters seen in the shipped client bundle: `setup_type`, `weather`, `page`, `size`, `details=true`
- **Unique setup identifier**
  - `id`
- **What should become `sourcePageUrl`**
  - `https://simplylovelysetups.com/setups?id={id}`
- **What should become `downloadUrl`**
  - Use the detail API URL for the selected setup:
    - `https://simplylovelysetups.com/api/v1/acc/setups/?object_id={id}&details=true`
  - Important: the adapter must attach the same public API header the site currently ships and transform the JSON response into the imported file content.
- **What should become `previewKey`**
  - `id`
- **Normalized metadata mapping**
  - `name` / `displayName`: `file_name` without `.json`
  - `carId`: map from `car_name`
  - `trackId`: map from `track_name`
  - `sourcePageUrl`: `/setups?id={id}`
  - `downloadUrl`: detail API URL above
  - `previewContent`: stringify the detail payload (or the transformed download payload if you want preview and download to match exactly)
  - `sourceMetadata`: retain `setup_type`, `weather`, `trackBopType`, and original `file_name`

### Notes for the follow-up implementation agent

- Prefer a direct adapter against the verified JSON API over DOM scraping.
- Treat the API key dependency as a risk and isolate it behind the adapter so it can be swapped quickly if the site changes.
- Do not promise ranking sort for this source; verified responses did not expose a meaningful ranking field.

---

## Source 2: Parc Ferme

- **Verdict:** **maybe**
- **Why:** The public pages are structurally much better than ACCCarSetups, and preview is practical, but the current public ACC inventory is too small and download is explicitly gated by sign-in.
- **Public access status:** Public listing and detail pages are reachable without login.
- **Terms/robots confidence:** **low to medium**. `robots.txt` allows `/`, but the site uses custom content-signal directives and explicitly disallows major AI bots. That is not a direct blocker for a product adapter, but it is enough to keep confidence below high.
- **Coverage confidence:** **low**. The verified ACC listing page currently exposed only **2 public setup entries**.
- **Metadata quality:** **high**
- **Download support:** **not suitable for v1**
- **Preview support:** **supported**
- **Ranking signal:** **supported** (`downloads`, `rating`, version metadata)
- **Integration risk:** **high** for current v1 scope because the useful download flow is authenticated
- **Recommended adapter capability:** **list + preview** only for future investigation; **not recommended for v1**

### Evidence

1. **Correct domain**
   - The current in-app scaffold pointed at `parcferme.co.uk`, which is unrelated.
   - Verified ACC setup site: `https://www.parcferme.cc`

2. **Robots**
   - `https://www.parcferme.cc/robots.txt`
   - Observed:
     - `Allow: /`
     - custom `Content-Signal: search=yes, ai-train=no, use=reference`
     - explicit bot blocks for `ClaudeBot`, `GPTBot`, and others

3. **Representative listing page**
   - `https://www.parcferme.cc/setups/acc`
   - Observed page text:
     - `Filter by car, track, or setup type`
     - `Car All cars`
     - `Track All tracks`
     - setup types `safe`, `aggressive`, `qualifying`, `endurance`
   - Observed only two public ACC setup links:
     - `/setups/8b3de1df-94fd-4666-a02c-4e47c8573125`
     - `/setups/e0e28ed9-6797-4ab4-8d14-5d5097cba70a`

4. **Representative detail page**
   - `https://www.parcferme.cc/setups/8b3de1df-94fd-4666-a02c-4e47c8573125`
   - Observed metadata in page payload:
     - name: `Barca Aggresive`
     - car: `Chevrolet Camaro GT4 R 2017`
     - track: `Barcelona`
     - tag: `aggressive`
     - version: `v1`
     - uploaded: `June 24, 2026`
     - downloads: `5`
     - uploader: `viik`
     - internal setup info visible in SSR payload: `uuid`, `setupId`, `fileKey`, `createdAt`, `updatedAt`, `downloads`, `rating`

5. **Download attempt**
   - Verified from the shipped `DownloadButton` client bundle for the detail page:
     - if there is **no authenticated user session**, the button triggers Discord sign-in instead of starting a public download
     - only authenticated users invoke the `downloadSetup(setupId)` server action that returns the signed URL
   - That fails the v1 `free / public / no-login` bar.

6. **Preview feasibility**
   - The detail page payload includes structured setup sections (for example `AERO`, `TYRES`, `DAMPERS`) and is already enough to render a read-only preview.

### Adapter notes

- **How to search/list by car + track**
  - Start from `https://www.parcferme.cc/setups/acc`
  - The page already exposes car, track, and setup-type filters in SSR output
  - Under the hood the site uses `/api/trpc`, but I did not need to finish reverse-engineering those queries because the download gate already blocks v1
- **Unique setup identifier**
  - Public UUID from `/setups/{uuid}`
  - Internal `setupId` is also present in the page payload
- **What should become `sourcePageUrl`**
  - `https://www.parcferme.cc/setups/{uuid}`
- **What should become `downloadUrl`**
  - Not usable for v1. The page uses an authenticated server action to mint the actual download URL.
- **What should become `previewKey`**
  - `uuid` or `setupId`
- **Normalized metadata mapping**
  - name, car, track, uploader, createdAt/updatedAt, downloads, rating, tags, currentVersion all appear recoverable from the page payload

### Why this is not the first v1 adapter

- Too few verified ACC setups right now
- Download requires sign-in
- Good future shape, bad current fit

---

## Source 3: ACCCarSetups

- **Verdict:** **no-go**
- **Why:** It is a useful public catalog, but it does not behave like a single source of downloadable setup files. The verified rows point to third-party product pages, YouTube videos, or blank links instead of source-hosted setup JSON.
- **Public access status:** Public browse pages are reachable without login.
- **Terms/robots confidence:** **medium**. `robots.txt` allows crawling and I found no obvious public access blocker.
- **Coverage confidence:** **medium to high** for discovery, **low** for actual importable-source coverage
- **Metadata quality:** **medium**
- **Download support:** **not supported as a source-native v1 flow**
- **Preview support:** **not practical**
- **Ranking signal:** **weak**
- **Integration risk:** **high**
- **Recommended adapter capability:** **list only**, which is below v1 needs

### Evidence

1. **Robots**
   - `https://acccarsetups.com/robots.txt`
   - Observed: no disallow rules for public content

2. **Catalog breadth**
   - `https://acccarsetups.com/page-sitemap.xml`
   - Observed counts from the page sitemap:
     - **36** car pages
     - **26** track pages
     - **5** class pages

3. **Representative car listing page**
   - `https://acccarsetups.com/setups/cars/bmw-m4-gt3/`
   - Observed public rows for multiple tracks including Monza, Valencia, Spa-Francorchamps, Imola, Nordschleife, Suzuka, Watkins Glen, and Paul Ricard

4. **Representative track listing page**
   - `https://acccarsetups.com/setups/track/monza`
   - Observed public rows for multiple cars including BMW M4 GT3, Ferrari 488 GT3 Evo, Ferrari 296 GT3, Aston Martin V8 Vantage GT3, Honda NSX GT3 Evo, Mercedes-AMG GT3 Evo, McLaren 720S GT3 Evo, and Ford Mustang GT3

5. **Representative "download" targets**
   - From the verified BMW M4 GT3 listing rows:
     - `https://simracingsetup.com/product/acc/setup-bundle-all-tracks-bmw-m4-gt3/?ref=...`
     - `https://www.youtube.com/watch?v=mmfzeeH4V7Y`
     - some rows had an empty outbound link
   - This means the source page is a directory of outbound links, not a stable source-hosted file flow.

6. **Structure**
   - The page uses a WordPress `ajax-load-more` / filter plugin and exposes list rows in `noscript` fallback HTML.
   - That is scrapeable for catalog metadata, but there is no verified stable per-setup detail page or direct file path on `acccarsetups.com`.

### Adapter notes

- **How to search/list by car + track**
  - Car-first pages: `https://acccarsetups.com/setups/cars/{car-slug}/`
  - Track-first pages: `https://acccarsetups.com/setups/track/{track-slug}`
  - The WordPress filter system also appears to use `wp-admin/admin-ajax.php`
- **Unique setup identifier**
  - No reliable source-native setup ID was verified
- **What should become `sourcePageUrl`**
  - At best, the listing page URL; individual setup pages were not verified
- **What should become `downloadUrl`**
  - Not reliable. Outbound targets vary by row and are often not setup files.
- **What should become `previewKey`**
  - none
- **Normalized metadata mapping**
  - car, track, lap time, date, author, and outbound link are available from listing rows

### Why this is not the first v1 adapter

- No source-native download path
- No realistic preview path
- Rows would require per-target logic for many downstream sites, which defeats the purpose of a single adapter

---

## Source 4: Boosted Media

- **Verdict:** **no-go**
- **Why:** I could not verify a real setup repository flow at all.
- **Public access status:** Weak. Direct fetches hit Cloudflare and the obvious ACC setup path returned 404.
- **Terms/robots confidence:** **low**
- **Coverage confidence:** **low**
- **Metadata quality:** **unknown**
- **Download support:** **not verified**
- **Preview support:** **not verified**
- **Ranking signal:** **unknown**
- **Integration risk:** **very high**
- **Recommended adapter capability:** none

### Evidence

1. **Robots**
   - `https://boostedmedia.net/robots.txt`
   - Observed: general crawling allowed, but that did not translate into reliable direct access

2. **Public reachability**
   - Direct browser-like fetch to `https://boostedmedia.net/` returned a Cloudflare block page (`403`, "Please enable cookies" / "Sorry, you have been blocked")

3. **Candidate ACC setup path**
   - `https://boostedmedia.net/assetto-corsa-competizione-setups/`
   - Observed: `404`

4. **Sitemap review**
   - `https://boostedmedia.net/page-sitemap.xml`
   - `https://boostedmedia.net/post-sitemap.xml`
   - Observed: product, review, support, and article pages; no verified ACC setup-library surface comparable to the other candidates

### Adapter notes

Do not spend implementation time here for v1.
