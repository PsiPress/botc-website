# Agent Handoff Notes

## Project

This repo is a Blood on the Clocktower stats website for Psi Press: a static site on GitHub Pages (`https://thepsipress.github.io/botc-website/`) backed by a Supabase database. Editors sign in on the site to add, edit and delete games, player profiles, tier grades, events and photos.

`Blood on the Clocktower - Games Sheet.csv` is the archive of the first 30 games, regenerated in 2026-11 from the `Games` tab of the club's "Master Sheet with Elo" workbook (38 player columns ending in `Gack`), with the `Format` column (In-Person / Online) merged in from that workbook's `Record` tab. The CSV therefore uses the Record layout: `date, Outcome, Final Day, Storyteller, Player Count, Format, Script, Win, Loss, <players...>`. `games-sheet.mjs` and `app.js` also still accept a straight export of the Games tab (no `Format` column). Once Supabase is live it is the source of truth for games; the CSV seeds it and backs the read-only fallback.

Player columns must stay in the spreadsheet's column order: the rating model uses that order ("slot") to break ties, to decide which of two same-day debuts is newer, and to name duos (`Will + Ziad`, lower slot first). In Supabase this order is `players.slot`; new players get the next slot.

`README.md` is intentionally just the link to the live site. Developer notes live in this file.

## Run Locally

```sh
node server.mjs
```

Then open `http://127.0.0.1:5173/`. `server.mjs` only serves the static files. The page talks to whatever Supabase project `supabase-config.js` names, so a local copy edits the live data. With `supabase-config.js` empty, the site runs read-only from `games-sheet.json` and `site-data.json`.

## Supabase

Files: `supabase/setup.sql` (schema, permissions, storage bucket; safe to re-run), `supabase/seed.sql` (generated: the 30 Games Sheet games with their awards and all players with profiles and grades; inserts skip existing rows, so re-running never overwrites site edits), `supabase.js` (browser data layer over Supabase's REST, Auth and Storage endpoints, no client library), `supabase-config.js` (project URL and publishable key; both public by design).

Setup for a new project:

1. Create a Supabase project. SQL Editor: run `supabase/setup.sql`, then `supabase/seed.sql`.
2. Authentication -> Users -> Add user for each editor (email + password, auto-confirm). Then in SQL: `select private.add_editor('their@email');` (`private.remove_editor` undoes it).
3. Authentication -> Sign In / Providers: turn off "Allow new users to sign up". (Accounts not in `private.editors` cannot edit anyway.)
4. Project Settings -> API: put the Project URL and the publishable key (or legacy anon key) in `supabase-config.js`. Never a secret / service_role key; `supabase.js` refuses one.

Tables (all public read; insert/update/delete only when `public.is_editor()` is true, enforced by row-level security):

- `games`: one row per game, same fields as the app's game objects in snake_case, plus `mango_nectar` / `mushroom_elixir` name arrays. `seq` keeps insertion order for same-date ties. Sheet rows have ids `games-sheet-N` and `source = 'games-sheet'`; site-entered rows get `game-<uuid>`.
- `players`: keyed by `name` (the name used in games, never renamed; unique ignoring case and spaces). Profile fields: `display_name`, `core`, `title`, `major`, `status`, `quote`, `photo_path`; tier grades `overall_skill`, `good_skill`, `evil_skill`, `game_impact` (S/A/B/C/D/F with optional + or -), `social_trust` (`+`, `-` or blank), `strengths`, `weaknesses` (one item per line).
- `events`: upcoming games (`title`, `starts_at`, `location`, `format`, `script`, `storyteller`, `notes`).
- `photos`: gallery rows pointing at files in the public `media` storage bucket (`gallery/...`; profile pictures live under `players/...`). The site re-encodes every upload as JPEG (max 2000 px for gallery, 640 px for profiles), which also strips EXIF/GPS.

Editors are Supabase Auth users listed in `private.editors` (the `private` schema is not exposed to the API). The session is kept in `localStorage` (`botc.supabase.session`) and refreshed automatically.

Loading order in `app.js`: Supabase (if configured and it has games) -> static `games-sheet.json` (then the CSV) plus `site-data.json`. The static fallback is read-only: the `ST` button and all editor controls are hidden.

`site-data.json` holds the profiles, grades and awards used for the seed and the fallback. Sources: profiles (major, status, quote) from the "Clocktower Website Stuff" doc; grades and strengths/weaknesses from the Player Rankings sheet's "Updated Profiles" tab, Social Trust from its older "Player Profiles" tab; awards from the doc's numbered lists (award N = game N in CSV order; every awardee was checked against that game's players). The sheet's storyteller Notes and Direction columns are deliberately not published. After editing the CSV or `site-data.json`, run `node generate-games-sheet-json.mjs` and `node generate-supabase-seed.mjs`. Once Supabase is live, edit on the site instead; `site-data.json` will go stale, which only affects the fallback.

## GitHub Pages

`.github/workflows/pages.yml` deploys `index.html`, `styles.css`, `app.js`, `ratings.js`, `supabase.js`, `supabase-config.js`, `.nojekyll`, the CSV, `games-sheet.json` and `site-data.json` from `_site`. Any new browser module or data file must be added to that copy step. One concurrency group; a newer run cancels an older in-progress one.

Pages setting: Settings -> Pages -> Build and deployment -> Source: GitHub Actions.

## Editors

The round `ST` button opens the sign-in dialog (email + password) and then the game entry dialog. Once signed in, controls marked `.editor-only` appear (hidden by CSS unless `body.is-editor`): Edit/Delete in game popups, Edit profile in player popups, Add player, Edit grades, Add/Edit event, Upload photos, caption/date/delete in the photo viewer. The footer shows "Signed in as … · Sign out". Clicks on `[data-action]` go through one delegated handler (`runAction`).

## Frontend Structure

- `index.html`: app shell, ten views (Home, Rankings, Tier Lists, Players, Awards, Games, Statistics, Upcoming, Gallery, About) and all dialogs (player profile, game detail, duo/info, sign-in, entry, delete, profile editor, grades editor, event editor, photo upload, photo viewer).
- `styles.css`: night-sky visual system. Gold = Rohan / the Day, lavender = Natalie / the Night, blue = Good team, red = Evil team, mango orange = Mango Nectar, mushroom purple = Mushroom Elixir. Fonts: Cormorant Garamond (display), Cinzel (labels), Figtree (UI), loaded from Google Fonts with serif/sans fallbacks.
- `ratings.js`: pure ES module, the rating engine (see below). No DOM access, so it can be imported from Node for verification.
- `app.js`: ES module. Loading, hash routing, derivation of the role-based "spreadsheet" stats, all rendering, hand-written SVG charts, procedural SVG player sigils (used when a player has no photo), CSV export, and every editor flow.
- `supabase.js`, `supabase-config.js`: see Supabase.
- `server.mjs`: local static preview server.
- `games-sheet.mjs`: dependency-free CSV reader shared by the generators. `generate-games-sheet-json.mjs` writes `games-sheet.json`; `generate-supabase-seed.mjs` writes `supabase/seed.sql`.

Routing is hash based: `#home`, `#rankings`, `#tiers`, `#players`, `#awards`, `#games`, `#stats`, `#events`, `#gallery`, `#about`. `#player/<Name>` and `#game/<id>` deep-link straight into a profile or game popup. Anything with `data-player`, `data-game` or `data-duo` opens the matching dialog.

## Pages

- **Home** is themed around Rohan and Natalie (constant `LEGENDS` at the top of `app.js`). Hero line "Natalie is god." plus a live line built from Rohan's chess title; animated SVG clocktower showing the real time; identity cards; a two-picker comparison panel with an Elo history chart; a stat strip; the latest game; links to other pages. The club plans to redesign the landing page later.
- **Rankings**: Elo ladder (chess scale / Base Elo) and Aura leaderboard, chess-title ladder chart, sortable full leaderboard.
- **Tier Lists**: "Players" (storyteller grades: S-F rows for Overall / Good / Evil / Game impact, plus a table with Social trust), then the computed Rookie, Upset and Duo lists.
- **Players**: core players (`players.core`) as profile cards (photo or sigil, display name, custom title, status, record, award pips). Everyone else as compact chips. Titled players (Anika, "Dictator of Ravenswood Bluff") sort first by default. Search covers names, statuses, titles and characters. The profile popup adds the quote, award badges ("5× Mango Nectar Awardee"), major, tier grades and strengths/weaknesses above the existing stats.
- **Awards**: Mango Nectar (MVP) and Mushroom Elixir (most responsible for their team losing) leaderboards, plus a by-game table. Awards are entered per game in the entry dialog (Nectar / Elixir toggles on each player row).
- **Games**: forecast-vs-result timeline, filters, ledger, CSV download, Data QA panel. Game popups show teams, Elo before/after and awards.
- **Statistics**: matchup forecast, player/character lookup, wins per script, most-played characters.
- **Upcoming**: future events (past ones collapsed). The nav link is hidden for visitors when nothing is scheduled.
- **Gallery**: photo grid with a viewer (arrow keys step through photos). The nav link is hidden for visitors until a photo exists.
- **About**: club copy (counts are live), facts, and "How the ratings work".

The 2026-11 placeholder Awards, Events and Gallery pages were removed by request; real versions were added on request 2026-11-26. Do not add placeholder content: empty states are one short line.

Copy style (requested 2026-11): keep UI text terse. No flavor sentences, no decorative eyebrow labels that repeat the heading, no sentences that restate numbers already shown, and no usage instructions beyond what a control needs. Keep short definitions where a metric needs one. The deliberate jokes are "Natalie is god.", the live "Rohan is merely a …" line, Natalie's ∞ divine rating, and Anika's "Dictator of Ravenswood Bluff" title.

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

New players: type a new name in a participant row, or use `New player` / `Add new`. Saving creates a `players` row for every unknown name first (in row order, so slots follow the spreadsheet convention). New roles: free-type or `New role` / `Add role`. Result fields store real `Win`/`Loss` values and auto-populate from the outcome plus alignment until edited by hand. The Final day select stores `1` / `0` / blank. The dialog shows a live Elo preview. Editing reuses the dialog and keeps the game id.

## Verification Already Done

- `node --check` on `app.js`, `ratings.js`, `supabase.js`, `server.mjs`.
- Rating engine compared value-by-value against the workbook (all checks passed); role-based stats against the Player Stats tab (only the three sheet inconsistencies differ).
- `supabase/setup.sql` and `seed.sql` run (twice) on a local Postgres 16 set up with Supabase's roles and auth/storage schemas. Row-level security checked for anonymous, signed-in non-editor and editor users on every table and on storage.
- Browser end-to-end test (headless Chromium, Pages file set, local stand-in for the Supabase REST/Auth/Storage endpoints running the real policies): load from Supabase, wrong password, non-editor refused, add a game with a new player and awards, edit it, profile edit with photo upload and replacement (old file deleted), add a player, grades editor, event add/edit/delete, photo upload (3200 px GPS-tagged JPEG stored as 2000 px with no EXIF), caption edit, photo delete, game delete, expired-token refresh, sign out, visitor view. No console errors.
- Read-only fallback (no Supabase): 30 games, profiles, grades and awards from the snapshots; `ST` and editor controls hidden.
- Not yet verified against a real Supabase project (none was reachable from the build environment).

## Worktree Notes

`.DS_Store` may exist locally and is ignored. `origin = https://github.com/ThePsiPress/botc-website`.

## Ongoing Instruction

Keep this file updated whenever implementation decisions, data flow, persistence, run commands, or major UI behavior changes.
