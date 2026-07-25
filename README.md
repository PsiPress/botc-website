# botc-website

Psi Press Blood on the Clocktower player stats website. It uses plain HTML, CSS, browser JavaScript, PHP, and SQLite—Node.js and npm are not required.

## Quick Start

Requirements: PHP 8.1+ with the PDO SQLite extension.

```sh
php -S 127.0.0.1:5173
```

Open <http://127.0.0.1:5173/>. The PHP development server is for local use; deploy the same files to a PHP-capable web host for an always-online site.

The round **ST** button opens the password-protected game-entry flow. The current password is `psip`. New, edited, and deleted games are stored durably in `data/botc.sqlite`.

## Deployment

Upload the repository files to a web host with PHP and PDO SQLite enabled. Ensure PHP can write to `data/` (the application creates the directory and database when necessary). Point the site's document root at this directory and serve `index.html` normally. No URL rewriting, build command, package installation, or long-running application process is needed: the frontend calls `api.php` directly.

For production:

- Use HTTPS so the password and game data are encrypted in transit.
- Change `DEFAULT_PASSCODE` in `api.php` and `DEFAULT_ENTRY_PASSCODE` in `app.js` together before deployment.
- Prevent direct web access to `data/` in the host's control panel, or place an equivalent web-server rule around it.
- Back up `data/botc.sqlite`; it contains games entered through the website.

GitHub Pages remains an optional **read-only** deployment because Pages cannot execute PHP. Its workflow publishes the frontend and committed `games-sheet.json` snapshot; it intentionally cannot accept game changes.

## Repository Layout

```text
index.html                              Frontend shell and dialogs
styles.css                              Visual design and responsive layout
app.js                                  Browser state, stats, exports, and forms
api.php                                 PHP/SQLite API and Games Sheet importer
data/botc.sqlite                        Runtime database (ignored by Git)
Blood on the Clocktower - Games Sheet.csv  Archival game source
games-sheet.json                       Read-only Pages snapshot
.github/workflows/pages.yml             Optional static Pages deployment
AGENTS.md                               Implementation handoff
```

## Data and Persistence

On each API request, `api.php` creates the database schema if needed and checks the CSV content hash. When the archival Games Sheet changes, its rows are re-imported while separately entered website games are preserved. The frontend falls back to `games-sheet.json` in read-only environments where PHP is unavailable.

The following password-protected operations retain the existing UI and behavior:

- `POST api.php?route=unlock` validates `{ "passcode": "..." }`.
- `POST api.php?route=games` adds a game.
- `PUT api.php?route=games&id=<id>` edits a game.
- `DELETE api.php?route=games&id=<id>` deletes a game.
- `GET api.php?route=state` returns all normalized game data and headers.

Game entry supports new players and roles, automatic result suggestions, manual alignment/result overrides, and existing-game correction. Player statistics, game details, CSV exports, data QA, navigation, and responsive visual design remain frontend features in `app.js` and are unchanged by the backend migration.

## Development Checks

```sh
php -l api.php
php -S 127.0.0.1:5173
curl 'http://127.0.0.1:5173/api.php?route=state'
```

When changing the archival CSV, start the PHP site and load the state endpoint to synchronize SQLite. Also update the committed `games-sheet.json` snapshot if the read-only GitHub Pages copy must reflect that change.
