# Rewind

Phone-first Spotify listening-history explorer. Full spec: [docs/SPEC.md](docs/SPEC.md).

**Current phase:** Phase 1 (data pipeline). Built and tested with fake and real data; waiting on the
user's iPhone test with the real zip. Phase 0 findings are in SPEC 3.5–3.8; Phase 1 decisions in SPEC 3.9.

## Commands
- `npm test`: unit tests (Vitest). `npm run e2e`: browser test. Needs `npx vite preview --port 4173`
  running and `FAKE_DIR` set to fake files from `npm run fake -- <dir>`.
- `npm run check-real -- "<zip or folder>"`: run the importer on the real export (terminal output only).
- `npm run deploy`: build, then publish `dist/` to the gh-pages branch.

## Environment
- Personal Mac only, never the work machine. GitHub: Izak467. Git email: isaacschwartz707@gmail.com.
  Check `git config user.email` before the first commit in any new clone.
- Node is installed through nvm. Every non-interactive shell must first run
  `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.
- The real export lives OUTSIDE the repo, at `~/Downloads/Spotify Extended Streaming History/`.
  Never copy it into the repo. Never commit anything derived from it (counts, names,
  screenshots of real data).

## Working rules (SPEC section 2)

### Process
- Build in phases. Don't start a later phase until the user approves the current one.
- **v1 scope** = Get Your Data page (upload), Home, Library (top artists/tracks/albums with
  artwork), global date range + filters, and three visualizations done really well:
  weekday × hour heatmap, Nostalgia Scatter, Record Book.
  **Everything else in the spec is backlog.** Depth beats breadth.
- Correctness: build a hand-made test file of about 20 plays with known answers, and
  unit-test every metric (Vitest). If Account data is uploaded, compare yearly totals with
  its Wrapped file and explain any differences.
- Design: build `/styleguide` first and wait for approval on the user's phone. After every
  screen, take Playwright screenshots at 390×844 (Chromium; this Mac is on macOS 12) and check
  them against the design rules and banned list (SPEC section 6) before calling it done. The
  real Safari check happens on the user's iPhone against the live site.
- Voice for all text: specific, a bit dry, like a friend who knows music. Write findings
  with real numbers. No exclamation-point hype, no emoji in text, no "journey",
  "unlock", "dive in", or "insights".
- Every screen needs a loading state, an empty state and an error state. Nothing fails
  silently.
- Git: commit after each working step. Deploy to GitHub Pages early, and after each phase
  test the live site on the user's iPhone (Safari).
- **Done** means: works with the real export, tests pass, screenshots reviewed, works on the
  iPhone, no console errors.

### Phases
- **Phase 0**: technical checks (throwaway code; report findings, update the spec).
- **Phase 1**: fake data generator, worker parsing, IndexedDB, dedup, upload error cases.
- **Phase 2**: `/styleguide` (wait for approval).
- **Phase 3**: Get Your Data page + upload flow.
- **Phase 4**: global date range + filters, Home.
- **Phase 5**: metadata + artwork with caching, album-art accent colors.
- **Phase 6**: Library + artist detail.
- **Phase 7**: the three v1 visualizations. v1 is done after this phase.

## User
The user isn't a professional developer (business analytics background, some Python and SQL).
Explain technical choices plainly. Low-risk operations can run without asking; confirm
before anything destructive or public-facing.

## Deploy
GitHub Pages serves the `gh-pages` branch (the saved GitHub login can't push workflow files).
To publish a folder: `git push origin "$(git subtree split --prefix <folder> HEAD)":refs/heads/gh-pages`.
`npm run deploy` does this via a temporary git worktree (scripts/deploy.sh).
Python on this Mac needs `SSL_CERT_FILE=/etc/ssl/cert.pem` for HTTPS.
