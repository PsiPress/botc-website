# botc-website

Psi Press Blood on the Clocktower player stats website.

This project displays player records, game history, and exported stats for a local Clocktower group. It also includes a passcode-protected game entry flow for adding new results.

## Quick Start

### Local Full-Feature Site

This is the primary way to run the app for now. It supports viewing stats, adding games, deleting accidental entries, and persisting data to SQLite.

Requirements:

- Node.js with the built-in `node:sqlite` module available. This was developed with Node `v25.8.0`.

Run the site:

```sh
node server.mjs
```

Open:

```text
http://127.0.0.1:5173/
```

Use the local Node server when you need passcode-protected adding/deleting games. Do not expect those write features to work on GitHub Pages.

### Optional Read-Only GitHub Pages Site

This repo includes a GitHub Actions workflow for free GitHub Pages hosting, but that is not the primary deployment target right now. GitHub Pages can only serve a static read-only version of the site: it displays stats from the committed CSV files, but it cannot add or delete games because GitHub Pages does not run the Node/SQLite backend.

If this becomes useful later:

1. Go to the repo's `Settings` tab.
2. Open `Pages`.
3. Under `Build and deployment`, set `Source` to `GitHub Actions`.
4. Push to `main`, or manually run the `Deploy GitHub Pages` workflow from the `Actions` tab.

Expected public URL:

```text
https://psipress.github.io/botc-website/
```

## Repository Layout

```text
index.html                                      Frontend shell and dialogs
styles.css                                      Layout, visual design, responsive behavior
app.js                                          Browser state, stat derivation, CSV export, form logic
server.mjs                                      Static server, SQLite setup, API endpoints
data/botc.sqlite                                Durable SQLite database
.github/workflows/pages.yml                     GitHub Pages static deployment
.nojekyll                                       Keeps GitHub Pages from applying Jekyll processing
Blood on the Clocktower - Master Sheet - Record.csv
Blood on the Clocktower - Master Sheet - Player Stats.csv
AGENTS.md                                       Agent-focused implementation handoff
```

## Data And Persistence

The durable source of truth is:

```text
data/botc.sqlite
```

On first startup, `server.mjs` creates the SQLite schema and seeds the `games` table from `Blood on the Clocktower - Master Sheet - Record.csv` if the table is empty.

New game entries are saved to SQLite through `POST /api/games`, and past games can be corrected through `PUT /api/games/:id`. They are not saved to browser local storage. If you want entered or edited games preserved when handing off or deploying from the repo, commit and push `data/botc.sqlite`.

The original CSV files are still useful as source references and export-format examples, but ongoing edits should go through the app/database unless you intentionally rebuild the seed data.

## Passcode-Protected Entry

The round `ST` button in the bottom-right opens the game entry flow.

Default/current passcode:

```text
psip
```

Adding games requires the current passcode. The passcode cannot be changed from the website. To change it, edit `DEFAULT_PASSCODE` in `server.mjs` and `DEFAULT_ENTRY_PASSCODE` in `app.js`, then restart the server.

## Main Features

- Minimal Overview page with links to Players and Games.
- Players tab with searchable/sortable player stats and row-click detail popups.
- Games tab with the game ledger, row-click detail popups, script filtering, CSV export, and data QA notes.
- Passcode-protected entry form for new games.
- Passcode-protected game deletion from the bottom of each game detail popup for correcting accidental entries.
- New player and new role support from the entry form.
- Player result fields auto-populate from game outcome plus player alignment, while still allowing manual edits.
- CSV exports for updated Record and Player Stats sheets.

## Stat Logic

The frontend derives player stats from game rows returned by `/api/state`.

Current behavior:

- Normal games count players with non-`n/a` role cells.
- Traveler roles are excluded from normal game totals and counted separately as good/evil travels.
- Overall wins/losses come from each game's `winNames` and `lossNames`.
- Good/evil team games are inferred from role alignment and game outcome.
- Existing traveler rows with missing Win/Loss membership use the `SEEDED_TRAVELER_ALIGNMENT` map in `app.js`.
- Data inconsistencies, such as a role cell without Win/Loss membership, are surfaced in the Games tab's Data QA panel.

If you change role alignment rules or add scripts with new roles, update the role sets in `app.js`.

## API Endpoints

`GET /api/state`

Returns:

- CSV-style record headers
- all games from SQLite
- storage mode metadata

`POST /api/unlock`

Request:

```json
{ "passcode": "psip" }
```

Returns `200` for a valid passcode and `401` otherwise.

`POST /api/games`

Request:

```json
{
  "passcode": "psip",
  "game": {
    "date": "6/13/26",
    "outcome": "Good",
    "finalDay": "TRUE",
    "storyteller": "Anika",
    "playerCount": 7,
    "format": "Online",
    "script": "Trouble Brewing",
    "winNames": ["Aden"],
    "lossNames": ["Rohan"],
    "roles": { "Aden": "Washerwoman", "Rohan": "Imp" },
    "alignmentOverrides": { "Aden": "Good", "Rohan": "Evil" }
  }
}
```

Inserts a durable game row in SQLite.

`PUT /api/games/:id`

Request:

```json
{
  "passcode": "psip",
  "game": {
    "date": "6/13/26",
    "outcome": "Evil",
    "finalDay": "FALSE",
    "storyteller": "Anika",
    "playerCount": 7,
    "format": "Online",
    "script": "Trouble Brewing",
    "winNames": ["Rohan"],
    "lossNames": ["Aden"],
    "roles": { "Aden": "Washerwoman", "Rohan": "Imp" },
    "alignmentOverrides": { "Aden": "Good", "Rohan": "Evil" }
  }
}
```

Updates an existing SQLite game row after validating the passcode.

`DELETE /api/games/:id`

Request:

```json
{ "passcode": "psip" }
```

Deletes a game row from SQLite after validating the passcode.

## Development Notes

There is no npm package setup currently. The app uses plain HTML, CSS, browser JavaScript, and Node built-ins.

Useful checks:

```sh
node --check app.js
node --check server.mjs
```

When editing the UI:

- Keep Overview minimal; the leaderboard was intentionally removed.
- Keep Players and Games focused on data review and export.
- Make sure mobile layouts do not clip text or buttons.
- Preserve the `ST` entry button and passcode gate for adding games.
- Keep game editing and deletion password-protected and scoped to the game detail popup.
- Do not add a website control for changing the passcode unless that product decision changes.
- Keep game entry ergonomic for new players and new roles; both should be addable without editing code or the database manually.

When editing persistence:

- Avoid browser-only storage for game results.
- Keep `data/botc.sqlite` as the durable repo-backed data store unless the architecture is intentionally changed.
- If the DB schema changes, add a migration path or document the rebuild procedure clearly.

## Handoff Notes

For deeper implementation context, read:

```text
AGENTS.md
```

That file is intended for future coding agents and should be updated alongside meaningful architecture, persistence, data model, or UI behavior changes.
