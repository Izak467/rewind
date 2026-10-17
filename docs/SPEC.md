# Rewind: Project Spec

An advanced, interactive Spotify listening-history explorer: Spotify Wrapped available
any time, for any date range, and fully explorable. A phone-first web app built from the
user's Spotify Extended Streaming History export.

---

## 0. START HERE (instructions for Claude Code)

1. Create a new project folder and a git repo (personal GitHub account: Izak467).
2. Save this whole file as `docs/SPEC.md`.
3. Create `CLAUDE.md` at the repo root containing section 2 (Working rules) plus a
   "Current phase" line that you keep updated.
4. The real Spotify export is on this computer (ask me where). **Before writing app code,
   inspect it** (section 3.4) and report what's actually in it.
5. Then do Phase 0 (section 2.2) and report the findings. Update this spec where reality
   differs. Wait for my go-ahead before Phase 1.

---

## 1. Vision and privacy

### Vision
The app should feel like a music magazine laid out from the user's own data, not a
dashboard template. Every number can be tapped through to the plays behind it. Dark,
cinematic, smooth animations, with colors taken from the user's own album art. Built for
phones first; also works on desktop. Personal project, hosted on GitHub Pages. No backend.

### Analysis philosophy
Every visualization answers a question a real person would ask about themselves:
- **Identity**: "Who am I as a listener?"
- **Nostalgia**: "What was I listening to back then?"
- **Validation**: "Prove my obsession."
- **Change**: "How has my taste moved?"
- **Surprise**: "Tell me something I didn't know."
- **Bragging**: "Make it shareable."

Each viz has a takeaway headline generated from the data, written as a finding, not a
label. Example: "You discover most new artists in September", not "Discoveries by month".

### Privacy (hard requirement)
- All parsing and storage happen on the device. Listening history never leaves it.
- Drop `ip_addr` as soon as a file is read. Keep `conn_country` (used for the map).
- The only network calls are metadata lookups (see 3.6): Spotify oEmbed (track IDs), iTunes
  Search, Deezer and MusicBrainz (artist/album/track names), plus the optional Spotify API.
  They send only IDs or names, never plays, times or counts.
- Settings includes "Delete all my data", which clears IndexedDB and the image cache.
- Never commit the real export, or anything derived from it, to git. Add the export
  folder and patterns like `*Streaming_History*` to `.gitignore` from the first commit.

---

## 2. Working rules (copy into CLAUDE.md)

### 2.1 Process
- Build in phases. Don't start a later phase until I approve the current one.
- **v1 scope** = Get Your Data page (upload), Home, Library (top artists/tracks/albums with
  artwork), global date range + filters, and three visualizations done really well:
  weekday × hour heatmap, Nostalgia Scatter, Record Book.
  **Everything else in this spec is backlog.** Depth beats breadth.
- Correctness: build a hand-made test file of about 20 plays with known answers, and
  unit-test every metric (Vitest). If I upload Account data, compare yearly totals with
  its Wrapped file and explain any differences.
- Design: build `/styleguide` first and wait for my approval on my phone. After every
  screen, take Playwright screenshots at 390×844 and check them against the design rules
  and banned list (section 6) before telling me it's done.
- Voice for all text: specific, a bit dry, like a friend who knows music. Write findings
  with real numbers. No exclamation-point hype, no emoji in text, no "journey",
  "unlock", "dive in", or "insights".
- Every screen needs a loading state, an empty state and an error state. Nothing fails
  silently.
- Git: commit after each working step. Deploy to GitHub Pages early, and after each phase
  test the live site on my iPhone (Safari).
- **Done** means: works with my real export, tests pass, screenshots reviewed, works on my
  iPhone, no console errors.

### 2.2 Phases
- **Phase 0, technical checks** (throwaway code; report findings and update this spec):
  1. Inspect the real export: files, row counts, date span, which fields are actually
     filled in (podcasts? `offline_timestamp`? audiobooks?), platform strings seen.
  2. Spotify Web API from a dev-mode app: which lookup endpoints and batch sizes work
     (tracks, artists, albums), and whether responses still include `popularity` and
     `genres`. Spotify has restricted dev-mode apps repeatedly since late 2024. Audio
     features (energy/valence) are assumed unavailable.
  3. Can album-art pixels from i.scdn.co be read on a canvas (CORS) for color extraction?
  4. Does DuckDB-WASM load the real export in iPhone Safari without crashing? If not,
     use Arquero plus precomputed daily totals instead.
- **Phase 1**: fake data generator (exact schema, several years, realistic patterns, a
  few deliberately broken files), parsing in a background worker, IndexedDB,
  deduplication, every upload error case.
- **Phase 2**: `/styleguide` (wait for approval).
- **Phase 3**: Get Your Data page and upload flow.
- **Phase 4**: global date range and filters, Home.
- **Phase 5**: Spotify login (PKCE), metadata and artwork download with caching,
  album-art accent colors.
- **Phase 6**: Library and artist detail pages.
- **Phase 7**: the three v1 visualizations. **v1 is done after this phase.** I use it for a week.
- **Backlog, roughly in this order**: Visualizations hub with more charts, Explore
  (query builder), Timeline charts, Stories, Leaderboards, interactive games, dashboards,
  Visual Lab and the 3D galaxy, Account data extras, live sync.

---

## 3. Data

### 3.1 Extended streaming history (required)
User requests it at spotify.com/account/privacy → "Download your data" → "Extended
streaming history". They receive `my_spotify_data.zip`, containing the folder
`Spotify Extended Streaming History/` with
`Streaming_History_Audio_<years>_<n>.json` files (ignore `Streaming_History_Video_*`).
Each file is an array of plays:

```
ts (ISO UTC), platform, ms_played, conn_country, ip_addr,
master_metadata_track_name, master_metadata_album_artist_name,
master_metadata_album_album_name, spotify_track_uri,
episode_name, episode_show_name, spotify_episode_uri,
audiobook_title, audiobook_uri, audiobook_chapter_uri, audiobook_chapter_title,
reason_start, reason_end, shuffle, skipped, offline, offline_timestamp, incognito_mode
```

Rules:
- A play with a null track URI but an episode URI is a podcast; audiobook fields mark an
  audiobook. Music, podcasts and audiobooks are separate categories; podcasts can be
  switched on or off.
- A "stream" is a play with `ms_played` ≥ 30,000 (Spotify's own threshold). Minutes count
  every play.
- `ts` marks the END of a play (see 3.5). Convert to the device's time zone before any by-hour or by-day stats. Offline plays:
  `ts` may reflect when the play synced, so use `offline_timestamp` when it's present.
- Files can be very large. Parse one file at a time in a background worker.

### 3.2 Account data (optional, bonus features)
A separate export, often also named `my_spotify_data.zip`. Read ONLY these files, if
present: Wrapped, Playlist*, YourLibrary, Inferences, SearchQueries,
StreamingHistory_music_*. **Never read** payment, user data, location, voice, message or
customer service files. Check the real file formats before building on them (formats vary
by export date).
Features: official Wrapped vs our calculation, played-but-not-in-a-playlist,
liked-but-never-played, a "Spotify thinks you're…" card from Inferences, top searches.
If ONLY Account data is uploaded: limited mode (past year only; `endTime, artistName,
trackName, msPlayed`; no URIs, so artwork is matched by name; no skip/shuffle data).

### 3.3 Derived data
- **plays**: one row per play, in local time, plus derived columns (date, hour, weekday,
  month, year, kind = music | podcast | audiobook).
- **tracks / artists / albums**: from the Spotify API (duration_ms, popularity, images,
  genres, release_date, explicit, all credited artists). Cached permanently in IndexedDB.
- **completion %** = ms_played / duration_ms (needs API metadata).
- **sessions**: consecutive plays with gaps under 30 minutes count as one listening session.
- **Platform normalization**: group raw platform strings into iOS / Android / Desktop /
  Web / Car / Speaker / TV / Console / Other.
- **Deduplication**: plays whose whole row (minus `ip_addr`) is identical are duplicates (see 3.5; `(ts, uri, ms_played)` is NOT enough). Merging a
  newer export adds only the new plays and reports "added N, skipped M duplicates".
- **Genre source**: Spotify artist genres. If they're empty, fall back to MusicBrainz tags
  (free, no key, max 1 request/second, cached permanently).

### 3.5 Format facts from the real export (Phase 0.1, 2026-10-17)
Only general facts about the format go here. Nothing specific to the user's listening (counts,
names, countries) is ever written into the repo.
- **`ts` is when the play ENDED**, not when it started. For online plays, `ts − offline_timestamp`
  ≈ the play's length. Start time = `ts − ms_played`. Use the start time for hour/weekday stats.
- **`offline_timestamp` comes in mixed units**: epoch seconds in most rows, epoch milliseconds
  in others (seen as early as 2018). Normalize by size (> 1e11 → ms). Since about 2023 it's
  filled in for nearly every play, not just offline ones; before 2022 it's present only when
  `offline = true`.
- **Offline sync batches**: up to ~150 plays can share one identical `ts` (the moment they
  synced). For `offline = true` rows, use `offline_timestamp` as the play time.
- **Deduplication key is the whole row minus `ip_addr`**, not `(ts, uri, ms_played)`. In real
  data about a third of `(ts, uri, ms_played)` collisions are separate plays inside an offline
  batch (different `offline_timestamp`); the rest are byte-identical duplicates within one file.
- **Platform strings**: ~90 distinct values. Old ones carry OS version + hardware model
  (`iOS 13.3.1 (iPhone9,1)`, `OS X 10.14.6 [x86 8]`); since about 2023 they are plain (`ios`,
  `osx`, `windows`). `not_applicable` also appears. Normalization must handle both styles. The
  hardware model code also allows a backlog "phones you've owned" feature.
- **`skipped` is not the same as "under 30 s"**. Many plays under 30 s have `skipped = false`,
  and some long plays have `skipped = true`. Keep both concepts separate.
- `reason_start` values: trackdone, fwdbtn, clickrow, playbtn, appload, backbtn, remote,
  trackerror, unknown, reconnect, switched-to-audio. `reason_end` values: trackdone, fwdbtn,
  endplay, logout, unexpected-exit-while-paused, backbtn, remote, unknown, unexpected-exit,
  trackerror.
- `conn_country` includes `ZZ` (unknown); treat it as "Unknown" on the map.
- Audiobook fields exist but can be entirely null. Podcasts can be extremely rare. Rows with
  every metadata field null exist (label them "Unknown").
- No row had `ms_played` over 2 hours. Roughly 1% of rows have `ms_played = 0`.
- Exports can have multi-month gaps with no plays at all. Charts must show gaps honestly, not
  interpolate across them.
- Files are split by size (~12 MB, ~16k rows each), so a year can span several files and a
  file's name year can differ from its first row's UTC year. Never rely on file names for dates.
- A full ~10-year export parses in about 3 s in Node on an old Mac (17 files, ~150 MB).
- The export zip also contains `ReadMeFirst_ExtendedStreamingHistory.pdf`; ignore it.

### 3.6 Metadata sources (Phase 0.2 / 0.3 findings, 2026-10-17)
The Spotify Web API is no longer the default. For Development Mode apps created after Feb 11,
2026: the owner needs Premium, there's a 5-user cap, the batch lookups (`GET /tracks`,
`/artists`, `/albums` with `ids=`) are removed (one item per request only), `popularity` is
removed from tracks, albums and artists, and search returns at most 10 results. Every call
needs a login token.

Keyless sources that work from a browser (all tested with an `Origin` header):

| Need | Source | CORS | Notes |
|---|---|---|---|
| Album art (exact match) | Spotify oEmbed `open.spotify.com/oembed?url=spotify:track:<id>` | yes `*` | One per request. Returns a 300px `thumbnail_url`; swap the hash prefix `ab67616d00001e02` → `ab67616d0000b273` for 640px. Works for any URI type. |
| Art pixels for accent color | i.scdn.co / image-cdn-ak.spotifycdn.com, mzstatic.com, dzcdn.net | yes `*` | Canvas reads are allowed with `crossOrigin="anonymous"`. Phase 0.3 passes. |
| Release date, genre, duration, explicit | iTunes Search API | yes `*` | Matched by artist + track name. Apple documents about 20 calls/min, so fetch by album, most-played first, and cache permanently. Returns one primary genre per item (coarse). |
| Artist photos | Deezer API search | **no** (JSONP only) | Use `output=jsonp`. The image CDN allows CORS. Matched by artist name. |
| Fallback dates/genres | MusicBrainz | yes `*` | 1 req/s with a User-Agent. Release dates are less reliable (one test returned a reissue date). |

The Spotify embed page (`open.spotify.com/embed/track/<id>`) has the exact release date,
duration and every credited artist with URIs, but it doesn't allow CORS, so the app can't read
it without a proxy. That's the strongest "exact data" option if a tiny stateless proxy is ever
allowed.

Consequences: no `popularity` from any source, so **Deep cuts (#2) and Mainstream score are
dropped**. "Credit features to each artist" needs either the Spotify API or the embed page.
Name-matching (iTunes, Deezer) needs a confidence check and a way for the user to fix a wrong
match.

### 3.7 iPhone engine check (Phase 0.4, 2026-10-17)
Tested on an iPhone running iOS 18.7, Safari, with 250k fake plays (the phase0/ page):
- Loading DuckDB-WASM takes **~12 s** on first load (mostly the ~30 MB download). Import of
  250k rows: 0.9 s. Queries: 22–149 ms. No crash.
- Album-art pixels can be read on a canvas in iOS Safari (confirms 0.3 on the real device).
- **Decision:** DuckDB is NOT on the critical path. Home, Library and the v1 visualizations
  read precomputed aggregates (daily totals per artist/track/album, weekday×hour cells,
  record-book stats) built by the parsing worker and stored in IndexedDB, with plain JS
  filtering. DuckDB lazy-loads in the background after first paint and powers only
  open-ended queries (Explore, backlog). The PWA service worker caches the DuckDB files so
  later loads skip the download.

### 3.8 Verified matching rules (Phase 0, tested on a 50-album / 30-artist sample)
Name-matching against iTunes and Deezer is cross-checked against facts we already know for
sure, and **a blank beats a wrong answer**: anything unverified shows a placeholder plus a
"fix this match" action.

Facts we already have for sure:
- **Exact Spotify cover art** (oEmbed, by track ID). Compare against the candidate's cover with
  a 64-bit perceptual difference hash (dHash, 9×8 grayscale). Hamming distance ≤ 10 = same
  cover. This was the strongest single signal in testing.
- **Song length from the export itself**: the median `ms_played` of that track's plays with
  `reason_end = trackdone`. Known for ~40% of tracks but **~99% of listening minutes**, so
  completion % needs no outside data at all. A candidate within ±3 s counts as a length match.

Album rules (iTunes):
1. Query strategies in order, stopping at the first VERIFIED: song search `"<artist> <top
   track>"` → album search `"<artist> <album>"` → song search by title only. Use normalized
   names in the query text (strip "(Deluxe)", "- 2011 Remaster", etc.).
2. Drop karaoke / tribute / "originally performed by" / cover / lullaby results before scoring.
3. Artist comparison splits credits on `, & and x with featuring feat. ft.`
   ("Akon featuring Eminem" contains Akon).
4. VERIFIED if album name ≥ 0.8 similar AND cover matches AND (artist ≥ 0.85 OR cover distance
   ≤ 4, which covers aliases like Jeezy / Young Jeezy). Also VERIFIED if artist ≥ 0.85, album ≥
   0.9 and length matches. LIKELY if artist and album names match but neither check confirms.
   Everything else is REJECTED.
5. Release date = the matched album's date. **Don't take the earliest date across candidates**:
   it produced a 1978 date for a 1985 song in testing. A date of Jan 1 is often a placeholder,
   so store it with year-only precision. Flag any date that's after the track's first play.

Artist photo rules (Deezer, JSONP):
- Anchor on songs, not names: search Deezer tracks for the user's top 3 songs by that artist
  (`artist:"X" track:"Y"`, loose query as fallback), and vote on the artist ID they belong to.
  VERIFIED with ≥ 2 votes (or all of the user's songs, if they played fewer than 2).
- Plain name search picked the wrong artist for same-name acts (a 4-fan "Nav" instead of NAV,
  a different "Bush", a different "Goose").

Test results on the sample (verified answers checked by hand):

| | Albums verified | Wrong but "verified" | Left blank | Artists verified |
|---|---|---|---|---|
| Naive top hit | (n/a) | 14 of 50 top hits were the wrong album | 0 | (n/a) |
| v1 rules | 40 | 1 | 8 | 24 / 30 |
| v2 rules (above) | **44** | **0** | 6 | **28 / 30** (+1 weak, correct) |

Throughput: Apple allows ~20 calls/min, and most albums verify on the first query. The top
250 albums (about 60% of a heavy listener's minutes) take ~15 min, and the top 1,000 (~94%)
take ~1 hour. Run it in the background in most-played order, resumable, cached permanently.
Prototype: `scripts/phase0/match_proto_v2.py` (port to TypeScript in Phase 5).

### 3.4 Inspect the real export first
Write a small script that summarizes the real export (file list, row count per file,
date range, null rate per field, distinct platforms and reason codes, a few sample rows
with ip_addr removed) and show me the summary. Don't commit its output.

---

## 4. Computed metrics (calculate once in the worker, reuse everywhere)

| Metric | Definition | Used for |
|---|---|---|
| Obsession index (track) | Highest share of a track's lifetime plays that fall in any single 7-day window | One-week obsessions, scatter plots |
| Staying power | Days from first to last play, or "still active" if played in the last 30 days | Survival curves, lifespan bars |
| Momentum | Minutes in the last 30 days ÷ minutes in the 30 days before that | Rising/falling lists |
| Love score | Plays × completion % × (1 − skip rate) | "Actually loves" vs "puts up with" |
| Concentration (Gini) | Inequality of minutes across artists | "Loyalist vs explorer" score |
| Novelty ratio | Share of minutes going to artists first heard within the past 90 days | Exploration phases |
| Nostalgia index | Average (listen date − release date) in years, weighted by minutes | Time Traveler personality |
| Mainstream score | Popularity of what you play, weighted by minutes (only if the API still returns popularity) | Deep cuts scatter |
| Binge length | Most plays of the same track in a row | Records |
| Album run | Consecutive plays from one album in album order | Album listener vs single listener |
| Shuffle dependence | Share of an artist's plays that started from shuffle vs a deliberate pick | "Intentional vs passive" |
| Seasonality | Strength of an artist's month-of-year pattern (peak month share vs a flat baseline) | Seasonal artists |
| Comeback | An artist has 90+ days with zero plays, then plays again at 50%+ of their previous level | Comeback detection |
| Gateway track | The first track heard by an artist who later reached your top 20 | Discovery stories |
| Incognito share | Share of plays in a private session | "Guilty pleasures" (can be turned off) |
| Listening sessions | Plays grouped by gaps under 30 minutes; length, track count, artist mix | Session explorer, habits |
| Transitions | Next-artist frequencies (which artist follows which) | Flow network, chord diagram |

---

## 5. Tech stack and libraries

| Purpose | Library | Why |
|---|---|---|
| App | Vite + React + TypeScript | Fast, standard |
| Styling | Tailwind CSS | Quick to theme, dynamic CSS variables for the accent color |
| State | Zustand | Global state for filters and date range |
| URL state | nuqs (or a custom hook) | Every view and filter is saved in the URL |
| Data engine | DuckDB-WASM (lazy-loaded) | SQL over hundreds of thousands of plays in the browser; powers Explore |
| Fallback engine | Arquero | If DuckDB-WASM struggles on iOS memory |
| Worker | Web Worker + Comlink | Parsing and queries off the main thread |
| Unzip | fflate (or JSZip) | Accept the raw Spotify zip |
| Storage | IndexedDB via Dexie | Plays, aggregates, metadata, image cache |
| Animation | Motion (formerly Framer Motion) | Page transitions, shared-element transitions, springs, layout animations |
| Gestures | @use-gesture/react | Swipe stories, drag the timeline brush, pinch to zoom |
| Standard charts | Apache ECharts (echarts-for-react) | Fast with large data, zoom and brushing, animated transitions, scatterGL |
| Custom viz | D3 (scales, shapes, hierarchy, force, d3-sankey, d3-delaunay) | Streamgraph, bump chart, radial clock, bubble pack, Sankey |
| 3D (backlog) | react-three-fiber + drei | Artist galaxy |
| Tables | TanStack Table + TanStack Virtual | Multi-column sort, 100k-row virtual scrolling |
| Search | Fuse.js | Fuzzy search across artists, tracks and albums |
| Command palette | cmdk | Desktop: Cmd+K jump to anything |
| Date picking | react-day-picker | Custom range picker |
| Colors | fast-average-color or node-vibrant | Accent colors from album art (depends on the Phase 0 CORS check) |
| Number animation | @number-flow/react | Numbers count up and morph when filters change |
| Celebration | canvas-confetti | Milestones, story reveals (sparingly) |
| Share cards | html-to-image or modern-screenshot | Export cards as PNG |
| Home-screen app | vite-plugin-pwa | Install to home screen, offline after first load |
| Tests | Vitest + Playwright | Metric unit tests, phone-size screenshots |

Load the heavy pieces (DuckDB, three.js, ECharts) only on the screens that need them.

---

## 6. Design direction: "Editorial"

Every screen gets ONE focal point (a huge number, a huge image, or one chart).
Everything else on the screen is quieter. References: Pitchfork, Apple Music editorial,
Wrapped's typography. I will also provide reference screenshots; treat them as the visual
benchmark.

### Type
- Display: "Bricolage Grotesque" (Google Fonts), weight 700–800, letter-spacing -0.03em.
  Used big: hero numbers 72–120px on phones, section titles 32–40px.
- UI/body: "Inter" or "Geist", 14–16px, weight 400/500.
- Numbers in tables and axes: "Geist Mono" or "JetBrains Mono", tabular numerals.
- Type scale (px): 12 / 14 / 16 / 20 / 28 / 40 / 64 / 96. Use only these sizes.
- Small labels: uppercase, 11–12px, letter-spacing 0.08em, muted color.

### Color
- Background near-black #0B0B0C (never pure #000). Raised surfaces: #151517, #1E1E21.
- Text: #F5F5F4 primary, #A1A1AA secondary, #52525B tertiary.
- ONE accent at a time, taken from the current hero album art (adjusted for minimum
  contrast against the background). Used sparingly: the active tab, the selected data,
  key numbers. Changes smoothly when the date range changes.
- Charts: data that isn't selected is drawn in neutral grays; selected or hovered data
  gets the accent. Category colors (genres) come from one restrained 8-color palette,
  tested for color-blind readability.

### Layout and spacing
- 4px grid. Spacing values: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96.
- 16–20px side margins on phones; content in a narrow column; images can run edge to edge.
- Separate sections with spacing and dividing lines, not boxes. Use cards only for things
  that are tappable.
- Corner radius: 12px for cards, 999px for chips; images are square or 8px.

### Imagery
- Album art and artist photos are the main imagery. Make them big, crop boldly, let them run to the edge.
- Hero areas: artwork blurred heavily (60px+) at low opacity behind the content, with
  subtle grain so the gradient doesn't band.
- Icons: Lucide or Phosphor, one weight throughout, 20px. No stock illustrations, no 3D
  blob shapes, no emoji as icons.

### Motion
- Purposeful only: animation explains a change (a list reordering, a number updating, a
  sheet opening). No animation used purely as decoration.
- Standard spring: stiffness 300, damping 30. Durations 150–300ms; story reveals up to 600ms.
- List items appear one after another, 30ms apart, capped at 10 items.
- Shared-element morph from list to detail sheet (Motion layoutId). Lists animate
  reordering when the sort changes. Charts animate between states instead of redrawing.
- Respect the "reduce motion" accessibility setting.

### BANNED (common AI-generated defaults)
- Purple/blue/pink gradient backgrounds
- Frosted-glass cards everywhere
- Every element in its own rounded card with a drop shadow
- Emoji in headings or used as icons
- Grids of identical cards where nothing stands out
- Default chart-library styling (gridlines on everything, boxed legends, default colors)
- Generic hero text ("Unlock your music insights ✨")
- Centered text everywhere. Default to left alignment.

### Chart styling rules
- Remove the chart borders and use at most 3 faint horizontal gridlines. Label lines
  directly at their ends instead of using legends.
- Axis text: mono 11px, tertiary color. Tooltips are custom components in the app's style.
- Every chart has a takeaway headline ("You listened 40% more after midnight in 2024").
- Every chart has a "how this is calculated" info toggle.

---

## 7. Navigation and screens

### 7.1 Global UI
- **Bottom tab bar** (phone) / side rail (desktop), five sections:
  Home · Library · Visualizations · Explore · Stories (Settings in a menu).
- **Global date range control**, pinned at the top of every screen:
  - Preset chips: 7D · 30D · 90D · YTD · each year · All time · Custom
  - A tiny all-time listening timeline with a draggable window; dragging updates every
    screen live.
  - "Compare" toggle: pick a second range; every stat shows the change (A vs B).
- **Global filters** (shrink to a pill): platform, music/podcasts, shuffle on/off,
  offline, incognito, include skipped, minimum play length, time of day, weekday vs weekend.
- **Tap anything**: any artist, track, album, bar or cell opens a detail sheet that slides up.
- **Long-press**: pin to compare, hide from stats, open in Spotify.
- Haptics where supported (Android only; iOS Safari doesn't support them).

### 7.2 Get Your Data page (onboarding and upload)
The first screen a new user sees; it can be reopened later from Settings → "Add or update
data". Three-step layout with a progress indicator: ① Request → ② Download → ③ Upload.
The user can jump to any step (returning users with files go straight to ③).

**Step ① Request your data**
Intro: "Spotify will send you your complete listening history. It's free and takes about
2 minutes to request, but Spotify can take a few days to a few weeks to send it."
Device tabs: [iPhone / Android] [Computer].
1. Go to **spotify.com/account/privacy** and log in (button opens it in a new tab).
   "This only works in a web browser, not in the Spotify app."
2. Scroll to **Download your data**.
3. Check the boxes:
   - **Extended streaming history**: REQUIRED. "Your whole listening history. This is
     what powers the app."
   - **Account data**: OPTIONAL. "Unlocks bonus features: your official Wrapped
     comparison, playlists, liked songs, and what Spotify thinks about you. It usually
     arrives first, within about 5 days."
   - **Technical log information**: SKIP. "Not used by the app."
   Show a mockup of Spotify's three cards with the right boxes highlighted and Technical
   log faded out.
4. Tap **Request data**.
5. Warning callout: "Spotify sends a confirmation email for each export. You must click the
   link in each one, or the request never starts. Check spam. If Spotify's page still says
   'Waiting for confirmation', the email hasn't been confirmed yet. That page has a
   'Resend email' link."
Then an **"I've requested it"** button saves the date on the device. Returning users see a
waiting card ("Requested 6 days ago. Account data usually arrives in about 5 days,
extended history up to 30.") with "Got it, upload now" and "Try demo data while you wait".

**Step ② Download the files**
1. Spotify emails "Your Spotify data is ready", one email per export, possibly days apart.
2. Tap **Download** in the email. "The link expires after 14 days."
3. Where it goes: iPhone → Files app → Downloads ("Don't unzip it"); Android → Files /
   My Files → Downloads; Computer → Downloads.
4. Both exports can be called `my_spotify_data.zip` (a computer may save the second one as
   "my_spotify_data (1).zip"). "That's fine, the app figures out which is which."

**Step ③ Upload**
- **A. Smart upload zone** (the focal point). Phone: a large "Choose your Spotify
  file(s)" button (file picker, multiple files allowed). Computer: "Drop your Spotify
  zip(s) here, or click to choose", and the whole page is a drop target.
  "Drop both zips at once, or one at a time. Zipped, unzipped, or individual JSON files
  all work."
- **B. Two slots** below the zone, showing what was detected:
  - EXTENDED STREAMING HISTORY · Required. "Looks like: my_spotify_data.zip with
    Streaming_History_Audio_*.json files inside". [Choose file]
  - ACCOUNT DATA · Optional (bonus features locked until added). "Looks like:
    my_spotify_data.zip with StreamingHistory_music_*.json, Playlist*.json, …". [Choose file]
  - Files are recognized by their contents, not their names. If the user picks a file
    in the wrong slot, it lands in the correct slot automatically, with a short note.
  - Slot states (animated): Waiting for file → Reading… (progress) → Recognized
    ("8 files · 248,301 plays · Mar 2014 – Oct 2026"; Account data: "Wrapped,
    Playlists, Library, Inferences, Searches") → or a Problem with a specific message and
    "How to fix". Replace / Remove once filled.
  - Ignored files are listed in a collapsed row ("Ignored 4 unrelated files").
- **C. Action button**: "Build my stats", disabled until Extended history is recognized.
  If only Account data is present, offer limited mode (section 3.2) with an explanation.
  Processing: named steps (Reading → Organizing → Indexing → Fetching artwork) with real
  percentages; the user can leave mid-way and resume. Ends with an animated reveal that
  goes to Home.
- **D. Reassurance strip**: "Your files never leave this device. Only song IDs are sent to
  Spotify, to get artwork." + "Delete all your data anytime in Settings."
- **E. Help FAQ** (collapsed): can't find the email; the link expired; I already unzipped it
  (fine, select all the JSONs, or the folder on a computer); I uploaded the wrong thing;
  my numbers don't match Wrapped (Wrapped covers Jan–mid-Nov with its own rules); I have a
  newer export (upload it, it merges with no duplicates).
- **Returning users**: both slots show as filled ("Last updated Sep 12") with an "Add newer
  export" button on each.
- **Demo mode**: a "Try with demo data" link on every step; a banner says "Viewing demo data ·
  Upload yours".

**Upload requirements**
- Accept the raw zip(s), an unzipped folder (desktop folder upload; iOS multiple
  selection), loose JSONs, or any mix; search inside zips at any folder depth.
- Process once and save on the device; later launches go straight to the stats.
- Test with: a 30 MB zip on an older iPhone, a pre-unzipped folder, both exports dropped
  together, a corrupted file, an unrelated zip.

### 7.3 Home
- Hero stats that count up: minutes · hours · days listened · streams · unique artists ·
  unique tracks · new artists discovered. Each shows the change vs the previous period
  of the same length (or vs the Compare range).
- Top 5 artists: horizontal cards with large photos and rank badges.
- Top 5 tracks / albums, with a toggle between ranking by minutes and by streams.
- Mini calendar heatmap of the period.
- Auto-generated highlight cards (swipeable): most obsessive day, longest session,
  biggest new discovery, forgotten favorite, the song you keep skipping and keep playing.

### 7.4 Library
- Artists / Tracks / Albums / Genres via a segmented control; search; a virtualized list
  sortable by minutes / streams / first heard / last heard / skip rate / momentum.
- **Artist detail page**: large header photo with parallax, genres, your rank (all-time
  and in the current range); minutes over time (brushable); first listen (track and
  date), peak month, longest streak, last played; top tracks and albums with completion
  and skips; an automatic relationship phase label (discovery → obsession → steady →
  fade → comeback); listening clock; compare with another artist.

### 7.5 Visualizations hub
A gallery screen. Each visualization appears as a large card with a live thumbnail of the
user's own data, grouped into collections: **Time · Habits · Taste · Places · Wild** (see
section 8). Each visualization opens full screen with a takeaway headline, the chart (zoom,
brushing, tap to isolate), a small controls row (metric, top N, grouping) that follows
the global date range, a Share button, and swipe left/right to move through the collection.

### 7.6 Explore (backlog): query builder
- **Group by**: artist · track · album · genre · platform · country · year · month · week
  · weekday · hour · session · reason_start · reason_end · release year · release decade
- **Metrics**: minutes · streams · plays · skips · skip rate · avg completion % · unique
  tracks · unique days · first/last played · days since last play · peak month · streak ·
  share of total · rank change vs compare range · momentum
- **Filters**: any field, combined with AND/OR. **Sort**: by multiple columns, by any
  metric. **Threshold**: top N, minimum streams to qualify.
- **Results**: switch between Table / Bar / Line / Treemap / Scatter, with the chart chosen
  automatically from the shape of the result. Rows open the detail sheet. Export to CSV.
- **Saved views** (prebuilt): Forgotten favorites · Rising · One-week obsessions · Night
  owl tracks · Skip but never quit · Album completionist · Deep cuts · Shuffle vs
  intentional · Discovery log. Users can save their own.
- **Advanced mode**: a raw SQL editor over `plays`.

### 7.7 Stories (backlog): Wrapped mode
- Choose any date range, then generate a swipeable full-screen story (tap or swipe,
  auto-advance, progress bar).
- Cards: total minutes → top genre → top 5 artists (one per card) → top song → biggest
  discovery → listening personality → busiest day → top era → summary card.
- Personalities, calculated from the data: Explorer, Loyalist, Night Owl, Skipper,
  Completionist, Time Traveler, Shuffler.
- Export cards as 9:16 PNGs; share with the phone's share sheet.

### 7.8 Settings
Add/update data, re-fetch metadata, delete everything; Spotify connect/disconnect;
default ranking (minutes vs streams), stream threshold (default 30s), include podcasts,
first day of week, time zone override, reduce motion.

---

## 8. Visualization catalog
v1 includes only #7 (weekday × hour), #3 (Nostalgia Scatter) and the Record Book
(section 9). Everything else is backlog.

### Scatter plots (each with labeled quadrants)
1. **Love vs tolerate**: x = total plays, y = skip rate. Quadrants: Loves / Puts up
   with / Background / Didn't stick. Dot size = minutes. Tracks or artists.
2. **Deep cuts**: x = Spotify popularity, y = your minutes. Top-left = hidden gems,
   bottom-right = hits you ignore. (Only if the API still returns popularity.)
3. **Nostalgia scatter**: x = when you listened, y = release date. Every play is a dot,
   drawn with WebGL. Diagonal = new music; horizontal bands = an old album you keep coming
   back to; vertical streaks = nostalgia binges.
4. **Obsession shape**: x = days from first play to peak, y = staying power. Flings vs
   slow burns.
5. **Completion vs plays**: spots songs you only play for the hook.
6. **Discovery timing**: x = first-listen date, y = lifetime minutes.

### Heatmaps
7. **Weekday × hour**: tap a cell for the top artists in that slot.
8. **Calendar**: a square per day, one row per year; colored by minutes or top genre.
9. **Artist × month**: rows = top 30 artists, columns = months; sortable by first listen,
   peak, total.
10. **Genre × hour of day**.
11. **Month × year**: seasonality.
12. **Weekday vs weekend difference** per artist.

### Time and change
13. **Streamgraph**: top artists over time, tap to isolate.
14. **Bump chart**: monthly rank of the top 10.
15. **Bar chart race**: animated all-time ranking, with play/pause and a scrubber.
16. **Lifespan bars**: one bar per artist from first play to last, shaded by intensity.
17. **Survival curve** (Kaplan–Meier): % of discovered artists still in rotation after N
    months; compare between years.
18. **Slope chart**: top 20 in period A vs period B.
19. **Year spiral**: one ring per year, angle = day of year, color = minutes.
20. **Ridgeline ("Unknown Pleasures" style)**: hour-of-day profile per year or month.
21. **Discovery curve**: cumulative unique artists; steep stretches labeled as exploration phases.
22. **Eras timeline**: detected eras as labeled bands, with album art and generated
    names ("The Phoebe Bridgers Winter '22").
23. **On this day**: what you played on today's date in past years.

### Taste and structure
24. **Concentration (Lorenz) curve**: "your top 10 artists = 48% of all listening".
25. **Genre sunburst**: genre → artist → album.
26. **Bubble pack / treemap**: artists by minutes, grouped by genre.
27. **Release decade waffle chart**.
28. **Album vs single listener** over time.
29. **Shuffle vs intentional**: diverging bars per artist.

### Flow and sessions
30. **Flow network**: artist nodes, "played after" links, force layout.
31. **Chord diagram**: transitions between genres.
32. **How songs start and end (Sankey)**: reason_start → reason_end.
33. **Session explorer**: a strip of every session; tap one to replay it track by track.
34. **Day barcode**: one stripe per play, colored by genre.

### Places and devices
35. **World map**: minutes by country, with a timeline to show trips.
36. **Platforms over time**: stacked area.
37. **Device × hour heatmap**.

### Art pieces
38. **Sound fingerprint**: a generated radial graphic from the user's metrics.
39. **Artist galaxy (3D)**: each artist is a star, sized by minutes, colored by genre,
    clustered by genre; pinch, rotate, tap; fly-through intro.

### Rendering notes
- Scatters with 10k+ points: WebGL (ECharts scatterGL, or regl/deck.gl); hover and tap use
  a nearest-point lookup (d3-delaunay).
- Big heatmaps/ridgelines: D3 + canvas. Small grids: SVG.
- Pinch-to-zoom and drag-to-select on every time axis; double-tap to reset.

---

## 9. Leaderboards and the Record Book

### Record Book (v1), styled like a baseball stats book
- **Season stat lines**: one row per year: minutes, streams, unique artists, new artists,
  top artist, top track, concentration, nostalgia index. Like a player's career stats.
- **MVP / Rookie of the Year / Comeback Player** per year: top artist / best new artist /
  biggest comeback.
- **Records**: most minutes in a day · longest session · longest daily streak · longest
  binge of one song · fastest to 100 plays · most artists in a day · longest gap
  between plays of the same artist · oldest song played · most countries in a year. Each
  record shows the date, and the user can jump to it.
- **Milestones**: first play ever, the 100,000th minute, and so on.
- **Artist baseball cards** (backlog): front = photo, rank, key stats; flip = stats by year.

### Leaderboards (backlog; each row has a rank-history sparkline)
Top artists/tracks/albums/genres (by minutes, streams or love score) · Rising and Falling ·
Hall of Fame (all-time top 25, with years each spent in the top 10) · One-hit wonders (one
track accounts for 80%+ of an artist's plays) · Skip Shame (minimum 20 plays) · Comebacks ·
Gateway tracks · Seasonal · Guilty pleasures (incognito; hidden unless turned on).

---

## 10. Interactive experiences (backlog)
- **Time machine**: a big scrubber; drag through your life and every panel shows what that
  week sounded like.
- **Annotate your life**: the user adds life events ("Moved to Chicago"); they show as
  markers on every time-based chart, and the app writes findings like "Your taste shifted
  most in the 3 months after Moved to Chicago".
- **Higher or Lower**: "Did you play X or Y more?" Streak counter and shareable result.
- **Guess your #1**: guess your top artist and track before the reveal.
- **Compare periods**: slope chart, difference in stats, new arrivals, artists that dropped off.
- **Tier list**: auto-built S–F from love score; rearrange by dragging; export.
- **Make it a playlist**: any list becomes a Spotify playlist (asks for the
  playlist-modify login permission only when this is used).
- **Compare with a friend**: exchange small summary files (totals only, no individual plays);
  overlap score, shared top artists.

## 11. Dashboards (backlog)
Year in review · Artist dossier · Habits · Taste · Custom (pin any viz or Explore result;
rearrangeable tiles saved on the device).

---

## 12. Errors and edge cases

### Upload / parsing
- **Wrong export type** (Account data only): detect it, explain, offer limited mode.
- Video history files: ignore, and mention it in the upload summary.
- A zip inside a zip, or extra folder levels: search the whole zip.
- Already unzipped: accept multiple files or a folder.
- Corrupt or truncated JSON: skip that file, report which one failed, continue with the rest.
- Non-Spotify JSON or zip: reject with a clear message.
- Very large exports (over 500k plays) on low-memory phones: one file at a time in the
  worker, show progress, save to IndexedDB in chunks.
- Overlapping uploads: deduplicate and report added vs skipped.
- An empty date range: a friendly empty state, not a broken chart.

### Data quirks
- Null track metadata (local files, removed tracks): label them "Unknown / Local file" and
  let the user hide them.
- `ms_played` = 0, or over 2 hours on one track: flag as outliers, with a setting to cap them.
- Incognito plays: included by default; can be turned off.
- Time zones / daylight saving: convert UTC to local; optional per-country time zone mode
  for travel.
- The export only names the album artist; get every credited artist from the API, with a
  setting for "credit features to each artist".
- Relinked tracks: the API may return a different ID. Map it back to the original.

### Spotify API
- User skips login: everything works except images and API-derived stats, which show
  placeholders and a "Connect to unlock" prompt.
- 403 (user isn't on the dev-mode allowlist): explain that the app owner has to add them.
- 429 rate limit: wait as long as Retry-After says, keep a queue that resumes if the app
  is closed, show download progress.
- Token expires (about 1 hour): refresh it silently.
- Endpoint restrictions: check at startup which lookups work and switch off unavailable
  features without breaking anything.
- Offline: use cached metadata; anything uncached shows a placeholder.

### Storage / platform
- iOS Safari can clear data for sites that haven't been opened in a while unless the site
  is installed to the home screen. Encourage installing, call `navigator.storage.persist()`,
  and if data is gone, ask the user to upload again.
- IndexedDB storage limit exceeded: warn, and offer to keep only the totals instead of
  every individual play.
- Private browsing: detect it, and run in memory with a warning.
- Every async step has a visible error message with a Retry button.

---

## 13. Performance targets
- First screen appears in under 2 seconds on a mid-range phone.
- Parse 250k plays in under 10 seconds, with visible progress.
- Filter and date-range changes update in under 150 ms (precompute daily totals per artist
  and per track; DuckDB for the open-ended Explore queries).
- Lists stay smooth (60fps) with virtual scrolling; the 3D galaxy caps how many stars it draws.

---

## 14. Backlog: live sync (deferred, not planned for now)
The export is a point-in-time snapshot. Options when we want fresher data:
- **Last.fm** (preferred): connect Last.fm to Spotify once; on app open, call
  user.getRecentTracks (username + API key, from = last sync, 200 per page). Names only,
  so match tracks to Spotify via Search and cache the matches. Mark these plays
  `source: "lastfm"` with estimated minutes.
- **Alternative**: an hourly GitHub Actions job (private repo) calls Spotify's Recently
  Played endpoint (last 50 tracks) and appends to a file the app syncs from.
- Either way: estimated ms_played = min(track duration, time until the next play); no
  skip/shuffle data. When a newer export is merged, it replaces estimated plays for the
  period it covers. Show a data-freshness line ("Exact through Oct 15 · Live since
  then"). A reminder appears when the export is over 90 days old.
