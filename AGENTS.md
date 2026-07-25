# Agent Handoff Notes

## Project

This repo is a Blood on the Clocktower stats website for Psi Press. The archival source of truth for played games is `Blood on the Clocktower - Games Sheet.csv`. The legacy Record and Player Stats CSVs remain as export references.

The app is now a small database-backed website, not a static-only page.

## Run Command

Use:

```sh
php -S 127.0.0.1:5173
```

Then open:

```text
http://127.0.0.1:5173/
```

Do not use `python3 -m http.server` for normal operation. The browser can render that way, but new game entries will not be durable because `api.php` will not execute.

## GitHub Pages

Current product direction: use the local PHP/SQLite full-feature app for now. GitHub Pages is optional/read-only infrastructure for later, not the primary target.

This repo includes `.github/workflows/pages.yml` for free GitHub Pages hosting. Pages deploys only static assets from `_site`: `index.html`, `styles.css`, `app.js`, `.nojekyll`, `Blood on the Clocktower - Games Sheet.csv`, and `games-sheet.json`. It intentionally does not deploy `api.php` or `data/botc.sqlite`.

The GitHub Pages site is read-only. When `api.php?route=state` is unavailable, `app.js` falls back to the `games-sheet.json` CSV snapshot, hides the `ST` entry button, and omits game deletion from game detail popups. Adding/deleting games still requires running `php -S 127.0.0.1:5173` locally or deploying a real backend elsewhere.

To enable Pages in GitHub: Settings -> Pages -> Build and deployment -> Source: GitHub Actions. Expected URL is `https://psipress.github.io/botc-website/`.

## Data Storage

Durable app data is stored in SQLite:

```text
data/botc.sqlite
```

`api.php` creates this DB and synchronizes Games Sheet rows from `Blood on the Clocktower - Games Sheet.csv` whenever its content changes. The server preserves separately entered database games.

`data/botc.sqlite` is local runtime state and is intentionally ignored by Git. Browser local storage is no longer used for game persistence; deploy a real backend or back up the SQLite file separately when app-entered games must be retained.

## Passcode Behavior

Adding a game requires the current passcode. The default/current passcode after testing is:

```text
psip
```

The passcode cannot be changed from the website. To change it, edit `DEFAULT_PASSCODE` in `api.php` and `DEFAULT_ENTRY_PASSCODE` in `app.js`, then restart the server. An older SQLite `settings.entry_passcode` value may exist in existing databases, but the current server code does not use it.

## Frontend Structure

- `index.html`: app shell, tabs, welcome Overview, Players table, Games ledger, player stats dialog, passcode dialog, entry dialog.
- `styles.css`: visual system and responsive layout.
- `app.js`: browser state, stat derivation, API calls, CSV export, entry form behavior.
- `api.php`: PHP/SQLite API, schema setup, Games Sheet synchronization, and password-protected game writes.
- `games-sheet.json`: committed browser-readable snapshot of the Games Sheet for read-only Pages fallback; update it after changing the CSV when the read-only Pages copy must change.
- `README.md`: human developer handoff with run instructions, API notes, persistence details, and development guidance.
- `.github/workflows/pages.yml`: deploys the read-only static GitHub Pages site.

The Overview tab was intentionally simplified. It should remain a minimal welcome page with links/buttons to Players and Games plus a compact stat strip. The leaderboard section was removed by request.

Player table rows are clickable and keyboard-accessible. Clicking any row opens a large player stats dialog showing every Player Stats spreadsheet metric for that player, plus role and recent-game context.

## Stat Logic

Stats are derived in `app.js` from Games Sheet rows supplied by `api.php?route=state` (or `games-sheet.json` when read-only):

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

Saving a game posts to `api.php?route=games` with the active passcode. If the server is unavailable or the passcode is wrong, the game is not saved.

Editing a game starts from that game's detail popup. The `Edit game` button sits next to `Delete game`, reuses the same entry dialog, preserves the existing game id, and saves through `PUT api.php?route=games&id=<id>` with the active passcode.

## API Notes

`GET api.php?route=state`

Returns record headers and all games from SQLite.

`POST api.php?route=unlock`

Body: `{ "passcode": "..." }`. Returns `200` for valid passcode, `401` otherwise.

`POST api.php?route=games`

Body: `{ "passcode": "...", "game": { ... } }`. Inserts a durable game row in SQLite.

`PUT api.php?route=games&id=<id>`

Body: `{ "passcode": "...", "game": { ... } }`. Updates an existing SQLite game row after passcode validation. The server preserves the row id and source, replacing date/outcome/storyteller/player count/format/script/winners/losers/roles/alignment overrides.

`DELETE api.php?route=games&id=<id>`

Body: `{ "passcode": "..." }`. Deletes a game row from SQLite after passcode validation. The Games tab exposes deletion only at the bottom of each game detail popup, followed by a passcode confirmation dialog.

## Verification Already Done

- `php -l api.php`
- PHP API create/edit/delete lifecycle checks
- API state returned 27 seeded games.
- Correct passcode unlock succeeded.
- Wrong passcode unlock failed.
- Controlled `/api/games` write/delete test inserted a row and restored DB count to 27.
- Controlled `/api/games` create/edit/delete test inserted a temp row, updated it through `PUT api.php?route=games&id=<id>`, deleted it, and restored DB count to 27.
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

## Website Reorganization (2026-07)

The primary navigation is now organized as Home, About, Roster, Awards, Games, Statistics, Events, and Gallery. Roster presents up to 16 active-player cards with image placeholders and profile buttons; profiles reuse the complete player-stat dialog. Awards, events, and gallery intentionally contain polished placeholder space that can be filled with final copy, winner lists, event metadata, and photography later. The Statistics page adds player and character record lookup controls derived from the live game data. The Games page retains the durable game ledger and identifies the Games Sheet as its archival source in the UI.

## PHP Backend Migration (2026-07)

The application no longer requires Node.js. `api.php` now provides the SQLite state, unlock, create, edit, and delete operations through query-string routes that work without web-server rewrite rules. Run locally with `php -S 127.0.0.1:5173`; deploy to a PHP host with PDO SQLite and a writable `data/` directory for password-protected online updates. GitHub Pages remains read-only because it cannot execute PHP.
