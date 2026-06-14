# Agent Handoff Notes

## Project

This repo is a Blood on the Clocktower stats website for Psi Press. It started from two CSV exports:

- `Blood on the Clocktower - Master Sheet - Record.csv`: source ledger of played games.
- `Blood on the Clocktower - Master Sheet - Player Stats.csv`: spreadsheet rollup used to infer expected stat behavior.

The app is now a small database-backed website, not a static-only page.

## Run Command

Use:

```sh
node server.mjs
```

Then open:

```text
http://127.0.0.1:5173/
```

Do not use `python3 -m http.server` for normal operation. The browser can render that way, but new game entries will not be durable because the `/api/*` routes will be missing.

## GitHub Pages

Current product direction: use the local Node/SQLite full-feature app for now. GitHub Pages is optional/read-only infrastructure for later, not the primary target.

This repo includes `.github/workflows/pages.yml` for free GitHub Pages hosting. Pages deploys only static assets from `_site`: `index.html`, `styles.css`, `app.js`, `.nojekyll`, and the two CSV files. It intentionally does not deploy `server.mjs` or `data/botc.sqlite`.

The GitHub Pages site is read-only. When `/api/state` is unavailable, `app.js` falls back to the Record CSV, hides the `ST` entry button, and omits game deletion from game detail popups. Adding/deleting games still requires running `node server.mjs` locally or deploying a real backend elsewhere.

To enable Pages in GitHub: Settings -> Pages -> Build and deployment -> Source: GitHub Actions. Expected URL is `https://psipress.github.io/botc-website/`.

## Data Storage

Durable app data is stored in SQLite:

```text
data/botc.sqlite
```

`server.mjs` creates this DB and seeds it from `Blood on the Clocktower - Master Sheet - Record.csv` on first startup if the `games` table is empty.

Important: commit and push `data/botc.sqlite` whenever newly entered games should be preserved in the repo. Browser local storage is no longer used for game persistence.

## Passcode Behavior

Adding a game requires the current passcode. The default/current passcode after testing is:

```text
psip
```

The passcode cannot be changed from the website. To change it, edit `DEFAULT_PASSCODE` in `server.mjs` and `DEFAULT_ENTRY_PASSCODE` in `app.js`, then restart the server. An older SQLite `settings.entry_passcode` value may exist in existing databases, but the current server code does not use it.

## Frontend Structure

- `index.html`: app shell, tabs, welcome Overview, Players table, Games ledger, player stats dialog, passcode dialog, entry dialog.
- `styles.css`: visual system and responsive layout.
- `app.js`: browser state, stat derivation, API calls, CSV export, entry form behavior.
- `server.mjs`: static file server, SQLite schema/seed, `/api/state`, `/api/unlock`, `/api/games`.
- `README.md`: human developer handoff with run instructions, API notes, persistence details, and development guidance.
- `.github/workflows/pages.yml`: deploys the read-only static GitHub Pages site.

The Overview tab was intentionally simplified. It should remain a minimal welcome page with links/buttons to Players and Games plus a compact stat strip. The leaderboard section was removed by request.

Player table rows are clickable and keyboard-accessible. Clicking any row opens a large player stats dialog showing every Player Stats spreadsheet metric for that player, plus role and recent-game context.

## Stat Logic

Stats are derived in `app.js` from game rows:

- Normal games count players with non-`n/a` roles, excluding traveler roles.
- Overall wins/losses come from each game's `winNames` and `lossNames`.
- Good/evil team counts are inferred from role alignment plus game outcome.
- Traveler roles are excluded from normal game totals and counted separately as good/evil travels.
- A small `SEEDED_TRAVELER_ALIGNMENT` map preserves the alignment for existing traveler rows that were not listed in Win/Loss in the original CSV.

Known issue from source data: a few historical rows have role cells for players not listed in Win/Loss. The app surfaces these in the Games tab's Data QA section.

## Game Entry UX

The round `ST` button opens the passcode dialog. After a successful unlock, users can enter a game.

New players are supported in two ways:

- Type a new name directly in a participant row.
- Use the `New player` field and `Add new` button, which inserts a participant row and focuses the role field.

New role names are supported by free-typing in a role row or by using the `New role` field and `Add role` button. Added roles are included in the role suggestion datalist during the session and become part of the saved game data.

Participant result fields store real `Win`/`Loss` values. They auto-populate from game outcome plus resolved player alignment until a user manually edits that row's result field.

Saving a game posts to `/api/games` with the active passcode. If the server is unavailable or the passcode is wrong, the game is not saved.

Editing a game starts from that game's detail popup. The `Edit game` button sits next to `Delete game`, reuses the same entry dialog, preserves the existing game id, and saves through `PUT /api/games/:id` with the active passcode.

## API Notes

`GET /api/state`

Returns record headers and all games from SQLite.

`POST /api/unlock`

Body: `{ "passcode": "..." }`. Returns `200` for valid passcode, `401` otherwise.

`POST /api/games`

Body: `{ "passcode": "...", "game": { ... } }`. Inserts a durable game row in SQLite.

`PUT /api/games/:id`

Body: `{ "passcode": "...", "game": { ... } }`. Updates an existing SQLite game row after passcode validation. The server preserves the row id and source, replacing date/outcome/storyteller/player count/format/script/winners/losers/roles/alignment overrides.

`DELETE /api/games/:id`

Body: `{ "passcode": "..." }`. Deletes a game row from SQLite after passcode validation. The Games tab exposes deletion only at the bottom of each game detail popup, followed by a passcode confirmation dialog.

## Verification Already Done

- `node --check app.js`
- `node --check server.mjs`
- API state returned 27 seeded games.
- Correct passcode unlock succeeded.
- Wrong passcode unlock failed.
- Controlled `/api/games` write/delete test inserted a row and restored DB count to 27.
- Controlled `/api/games` create/edit/delete test inserted a temp row, updated it through `PUT /api/games/:id`, deleted it, and restored DB count to 27.
- Wrong passcode write test returned `401` and left DB count unchanged.
- Passcode was changed by user request from `psipress27` to `psip`.
- Website passcode-changing controls and the `/api/passcode` endpoint were removed by user request; passcode changes are code-only now.
- Successful new-game save now closes the entry dialog and switches directly to the Games tab.
- Game table rows are clickable and keyboard-accessible. Clicking a game opens a game detail popup with metadata, win/loss lists, role/player details, and a bottom `Delete game` button.
- Games can be deleted from the game detail popup with the passcode, for correcting accidental entries.
- Games can be edited from the game detail popup with the passcode, using the same entry form as new games.
- The new-game entry form suppresses Enter-key form submission so pressing Enter in inputs does not close the dialog accidentally.
- Desktop and mobile Chrome headless screenshots were taken after the Overview revamp; mobile wrapping was fixed.

## Worktree Notes

Current untracked files include the two CSVs, app files, `data/`, and `.DS_Store`. `.DS_Store` existed during development and was left untouched.

Local Git identity was set earlier for this repo:

```text
user.name = Psi Press
user.email = uchicagopsipress@gmail.com
origin = https://github.com/PsiPress/botc-website.git
```

## Ongoing Instruction

Keep this file updated whenever implementation decisions, data flow, persistence, run commands, or major UI behavior changes.
