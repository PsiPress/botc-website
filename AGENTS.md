# Agent Handoff Notes

## Project

This repo is a Blood on the Clocktower stats website for Psi Press. The archival source of truth for played games is `Blood on the Clocktower - Games Sheet.csv`.

As of 2026-11 the CSV was regenerated from the `Games` tab of the club's "Master Sheet with Elo" workbook (30 games, 38 player columns ending in `Gack`), with the `Format` column (In-Person / Online) merged in from that workbook's `Record` tab. The CSV therefore uses the Record layout: `date, Outcome, Final Day, Storyteller, Player Count, Format, Script, Win, Loss, <players...>`. `games-sheet.mjs` and `app.js` also still accept a straight export of the Games tab (no `Format` column), so a future re-export can be dropped in as-is.

Player columns must stay in the spreadsheet's column order: the rating model uses that order ("slot") to break ties, to decide which of two same-day debuts is newer, and to name duos (`Will + Ziad`, lower slot first).

The app is a small database-backed website, not a static-only page.

`README.md` is intentionally just the link to the live site (`https://psipress.github.io/botc-website/`). Developer notes live in this file.

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

Current product direction: use the local Node/SQLite full-feature app for now. GitHub Pages is optional/read-only infrastructure.

`.github/workflows/pages.yml` deploys only static assets from `_site`: `index.html`, `styles.css`, `app.js`, `ratings.js`, `.nojekyll`, `Blood on the Clocktower - Games Sheet.csv`, and `games-sheet.json`. It intentionally does not deploy `server.mjs` or `data/botc.sqlite`. Any new browser module must be added to that copy step.

The Pages workflow uses a single concurrency group and cancels an older in-progress run when a newer commit starts, so overlapping runs do not compete for the single Pages deployment slot.

The GitHub Pages site is read-only. When `/api/state` is unavailable, `app.js` falls back to `games-sheet.json` (then to the CSV), hides the `ST` entry button, and omits Edit/Delete from game popups.

To enable Pages in GitHub: Settings -> Pages -> Build and deployment -> Source: GitHub Actions. Expected URL is `https://psipress.github.io/botc-website/`.

## Data Storage

Durable app data is stored in SQLite:

```text
data/botc.sqlite
```

`server.mjs` creates this DB and synchronizes Games Sheet rows from the CSV whenever its content changes (it also rewrites `games-sheet.json`). The server preserves separately entered database games.

`data/botc.sqlite` is local runtime state and is ignored by Git. Back it up separately when app-entered games must be retained. After changing the CSV without running the server, regenerate the snapshot with `node generate-games-sheet-json.mjs`.

## Passcode Behavior

Adding, editing or deleting a game requires the passcode. The current passcode is:

```text
psip
```

The passcode cannot be changed from the website. To change it, edit `DEFAULT_PASSCODE` in `server.mjs` and `DEFAULT_ENTRY_PASSCODE` in `app.js`, then restart the server.

## Frontend Structure

- `index.html`: app shell, seven views (Home, Rankings, Tier Lists, Players, Games, Statistics, About) and all dialogs (player profile, game detail, duo/info, passcode, entry, delete).
- `styles.css`: night-sky visual system. Gold = Rohan / the Day, lavender = Natalie / the Night, blue = Good team, red = Evil team. Fonts: Cormorant Garamond (display), Cinzel (labels), Figtree (UI), loaded from Google Fonts with serif/sans fallbacks.
- `ratings.js`: pure ES module, the rating engine (see below). No DOM access, so it can be imported from Node for verification.
- `app.js`: ES module (`<script type="module">`). Loading, hash routing, derivation of the role-based "spreadsheet" stats, all rendering, hand-written SVG charts (Elo history, sparklines, chess-title ladder, forecast timeline, Oracle gauge), procedural SVG player sigils, CSV export, and the storyteller entry/edit/delete flow.
- `server.mjs`: static file server, SQLite synchronization, `/api/state`, `/api/unlock`, `/api/games`.
- `games-sheet.mjs`: dependency-free CSV reader and normalizer shared by the server and snapshot generator.
- `games-sheet.json`: committed browser-readable snapshot of the Games Sheet for the read-only Pages fallback.
- `.github/workflows/pages.yml`: deploys the read-only static site.

Routing is hash based: `#home`, `#rankings`, `#tiers`, `#players`, `#games`, `#stats`, `#about`. `#player/<Name>` and `#game/<id>` deep-link straight into a profile or game popup. Anything with `data-player`, `data-game` or `data-duo` opens the matching dialog through one delegated click handler.

## Pages

- **Home** is themed around Rohan and Natalie (constant `LEGENDS` at the top of `app.js`; change the names there to re-theme it). Hero line "Natalie is god." plus a live line built from Rohan's current chess title; an animated SVG clocktower whose clock shows the real time, with a sun and moon orbiting it. Below: a Day/Night diptych of the two (all facts computed live), their head-to-head rivalry with clickable game medallions, a two-player Elo history chart (pickers default to Rohan vs Natalie), a stat strip, the latest game, and links to the other pages.
- **Rankings**: Elo ladder (toggle chess scale / Base Elo, 95% range for provisional players) and Aura leaderboard side by side with equal weight, a chess-title ladder chart, and a sortable full leaderboard table.
- **Tier Lists**: Rookie, Upset and Duo tier lists as S-F rows of chips. Duo chips open a duo dialog with every shared game.
- **Players**: every participant as a card (sigil, chess Elo, title, sparkline, rank badges), searchable by name or character, sortable. Cards open the profile: rating tiles, distance to next title, Elo history chart, characters, most frequent teammates, all Player Stats spreadsheet metrics, and a game-by-game table with team win chance and Elo change.
- **Games**: forecast-vs-result timeline chart, filters (script, format, winner), ledger with an Elo forecast bar and Upset tag per game, CSV download, and a collapsible Data QA panel. Game popups show both teams with each player's Elo before/after.
- **Statistics**: matchup forecast (tap players into Good/Evil; uses `previewMatchup`, swing cap included), player/character record lookup, Good/Evil wins per script with the Elo expectation tick, and most-played characters.
- **About**: club copy (counts are live), facts, and "How the ratings work" with the formulas, title table and tier cutoffs.

The Awards, Events and Gallery placeholder pages and the roster photo placeholders were removed by request (2026-11). Do not reintroduce placeholder content.

Copy style (requested 2026-11): keep UI text terse. No flavor sentences, no decorative eyebrow labels that repeat the heading, no sentences that restate numbers already shown, and no usage instructions beyond what a control needs (for example "Tap a player to cycle Good → Evil → out"). Keep short definitions where a metric needs one (tier minimums, chart legends, rating formulas). The deliberate jokes are "Natalie is god.", the live "Rohan is merely a …" line, and Natalie's ∞ divine rating.

## Rating Engine (`ratings.js`)

A faithful port of the workbook's `Elo`, `Elo Calc`, `Elo Players`, `Elo Duos`, `Tier Lists` and `Aura` tabs. Settings live in `RATING_SETTINGS` (start 1000, K 100, Evil advantage 0, team-size scaling on, provisional below 5 games, RD0 150, leaderboard minimum 3 games, chess average 1500, chess stretch 3.96, chess target 2850, min underdog games 3, min duo games 4). Chess titles are `CHESS_TITLES`; tier cutoffs are `TIER_CUTOFFS`. Aura and Elo are treated as equally valid metrics.

- Teams come only from the Win/Loss lists (case-insensitive, spaces ignored, exact name match). Travellers and storytellers who are not in those lists are not rated.
- `P(Good) = 1 / (1 + 10^((EvilAvg + EvilAdvantage - GoodAvg) / 400))` using ratings going into the game.
- Good players get `+K * N/(2*#Good) * (S - P)`, Evil players `-K * N/(2*#Evil) * (S - P)`; if the largest raw change exceeds K, the whole game is scaled by `K / max`. Ratings stay zero-sum (total = 1000 x players).
- RD and 95% range, Chess Elo (`max(100, 1500 + 3.96 * (Elo - 1000))`), titles, Aura (`max(Elo - 1000, 0) * games`), Elo percentile, rookies (5 newest debuts, best Elo first), upsets (team chance < 50%), and duos (same nonzero side, expected % from the game's P) all match the workbook.
- Names in Win/Loss that are not player columns are appended as new slots, like adding a column after the last one.

Verification: every per-game value (team averages, P, changes, cap), every player's Elo/games/splits/peak/last swing/RD/range/upsets/Aura/percentile/chess/title, the leaderboard, Aura board, rookie, upset and duo lists, and the record block were compared against the workbook for all 30 games and matched (sum of ratings 38,000).

## Spreadsheet-Style Stats

Role-based stats (games, travels, wins, losses, Good/Evil splits, frequencies, Demon games, storyteller count) are derived in `app.js` (`computeStats`):

- Normal games count players with non-`n/a` roles, excluding traveller roles, which are counted separately as Good/Evil travels.
- A player's team comes from the Win/Loss lists first, then from role alignment (`GOOD_ROLES` / `EVIL_ROLES`) only when they are not listed. `SEEDED_TRAVELER_ALIGNMENT` fixes the alignment of unlisted traveller rows.
- These match the workbook's Player Stats tab except three loss counts where the sheet itself is inconsistent (Chris, Pavlik and Ren: the sheet's wins plus losses do not equal games played). The site's numbers agree with the Elo engine.

Known source-data issue: a few historical rows have role cells for players not listed in Win/Loss. The Games page Data QA panel lists them.

## Game Entry UX

The round `ST` button opens the passcode dialog. After a successful unlock, users can enter a game.

New players: type a new name in a participant row, or use the `New player` field and `Add new`. New roles: free-type in a role row or use `New role` / `Add role`. Participant result fields store real `Win`/`Loss` values and auto-populate from the outcome plus resolved alignment until edited by hand. The Final day select stores `1` / `0` / blank (CSV `TRUE` / `FALSE` are normalized to the same values).

The entry dialog shows a live Elo preview (forecast and swing per team) built from the Win/Loss results, exactly as the engine will read them.

Saving posts to `/api/games` with the active passcode, closes the dialog and switches to Games. Editing starts from a game popup (`Edit game`), reuses the entry dialog, keeps the game id, and saves through `PUT /api/games/:id`. `Delete game` in the popup asks for the passcode and calls `DELETE /api/games/:id`.

## API Notes

`GET /api/state` returns record headers and all games from SQLite.

`POST /api/unlock` body `{ "passcode": "..." }` returns `200` for a valid passcode, `401` otherwise.

`POST /api/games` body `{ "passcode": "...", "game": { ... } }` inserts a durable game row.

`PUT /api/games/:id` body `{ "passcode": "...", "game": { ... } }` updates a row, preserving id and source.

`DELETE /api/games/:id` body `{ "passcode": "..." }` deletes a row.

## Verification Already Done

- `node --check` on `app.js`, `ratings.js`, `server.mjs`.
- Rating engine compared value-by-value against the Master Sheet with Elo workbook (all checks passed).
- Role-based stats compared against the Player Stats tab (only the three sheet inconsistencies above differ).
- Old Games-tab CSV layout (no Format column) still parses to the same games.
- `/api/state` returns 30 games; correct passcode unlock returns 200, wrong returns 401.
- Browser end-to-end test through the UI: added a game with a brand-new player (Elo preview shown, count 30 -> 31, ratings and the home page updated), edited it via `PUT`, rejected a wrong delete passcode, deleted it (count back to 30). No console errors.
- Static read-only copy (same files as the Pages workflow) loads 30 games from `games-sheet.json`, hides `ST`, and shows no Edit/Delete.
- Desktop (1360px) and mobile (390px) headless Chromium screenshots of every page and the main dialogs.

## Worktree Notes

`.DS_Store` may exist locally and is ignored. Local Git identity used earlier:

```text
user.name = Psi Press
user.email = uchicagopsipress@gmail.com
origin = https://github.com/PsiPress/botc-website.git
```

## Ongoing Instruction

Keep this file updated whenever implementation decisions, data flow, persistence, run commands, or major UI behavior changes.
