import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DB_DIR = join(ROOT, "data");
const DB_PATH = join(DB_DIR, "botc.sqlite");
const RECORD_CSV = "Blood on the Clocktower - Master Sheet - Record.csv";
const DEFAULT_PASSCODE = "psip";
const PORT = Number(process.env.PORT || 5173);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

mkdirSync(DB_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
setupDatabase();

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
}).listen(PORT, () => {
  console.log(`BOTC stats server running at http://127.0.0.1:${PORT}/`);
  console.log(`SQLite database: ${DB_PATH}`);
});

function setupDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      date TEXT NOT NULL,
      outcome TEXT NOT NULL,
      final_day TEXT,
      storyteller TEXT,
      player_count INTEGER NOT NULL,
      format TEXT,
      script TEXT,
      win_names TEXT NOT NULL,
      loss_names TEXT NOT NULL,
      roles TEXT NOT NULL,
      alignment_overrides TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const gameCount = db.prepare("SELECT COUNT(*) AS count FROM games").get().count;
  if (gameCount === 0) seedRecordCsv();
}

function seedRecordCsv() {
  const rows = parseCsv(readFileSync(join(ROOT, RECORD_CSV), "utf8"));
  const headers = rows[1];
  const insert = db.prepare(`
    INSERT INTO games (
      id, source, date, outcome, final_day, storyteller, player_count, format, script,
      win_names, loss_names, roles, alignment_overrides, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();

  rows.slice(2).forEach((row, index) => {
    const date = clean(row[0]);
    const outcome = clean(row[1]);
    if (!date || !outcome) return;

    const roles = {};
    headers.slice(9).forEach((player, offset) => {
      const role = clean(row[offset + 9]);
      if (role && role.toLowerCase() !== "n/a") roles[player] = role;
    });

    insert.run(
      `record-${index}`,
      "record",
      date,
      outcome,
      clean(row[2]),
      clean(row[3]),
      numberOrZero(row[4]),
      clean(row[5]),
      clean(row[6]),
      JSON.stringify(splitNames(row[7])),
      JSON.stringify(splitNames(row[8])),
      JSON.stringify(roles),
      JSON.stringify({}),
      now,
      now,
    );
  });
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, {
      headers: getRecordHeaders(),
      games: getGames(),
      storage: "sqlite",
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/unlock") {
    const body = await readJsonBody(request);
    sendJson(response, body.passcode === getPasscode() ? 200 : 401, {
      ok: body.passcode === getPasscode(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/games") {
    const body = await readJsonBody(request);
    if (body.passcode !== getPasscode()) {
      sendJson(response, 401, { error: "Passcode required." });
      return;
    }
    const game = normalizeGame(body.game);
    insertGame(game);
    sendJson(response, 201, { game });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/games/")) {
    const body = await readJsonBody(request);
    if (body.passcode !== getPasscode()) {
      sendJson(response, 401, { error: "Passcode required." });
      return;
    }
    const id = decodeURIComponent(url.pathname.slice("/api/games/".length));
    if (!deleteGame(id)) {
      sendJson(response, 404, { error: "Game not found." });
      return;
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function getRecordHeaders() {
  const rows = parseCsv(readFileSync(join(ROOT, RECORD_CSV), "utf8"));
  return rows[1];
}

function getPasscode() {
  return DEFAULT_PASSCODE;
}

function getGames() {
  return db.prepare("SELECT * FROM games ORDER BY rowid").all().map(row => ({
    id: row.id,
    source: row.source,
    date: row.date,
    outcome: row.outcome,
    finalDay: row.final_day || "",
    storyteller: row.storyteller || "",
    playerCount: row.player_count,
    format: row.format || "",
    script: row.script || "",
    winNames: JSON.parse(row.win_names),
    lossNames: JSON.parse(row.loss_names),
    roles: JSON.parse(row.roles),
    alignmentOverrides: JSON.parse(row.alignment_overrides),
  }));
}

function normalizeGame(game) {
  const roles = typeof game.roles === "object" && game.roles ? game.roles : {};
  const winNames = Array.isArray(game.winNames) ? game.winNames.map(clean).filter(Boolean) : [];
  const lossNames = Array.isArray(game.lossNames) ? game.lossNames.map(clean).filter(Boolean) : [];
  const alignmentOverrides = typeof game.alignmentOverrides === "object" && game.alignmentOverrides
    ? game.alignmentOverrides
    : {};

  if (!clean(game.date) || !["Good", "Evil"].includes(game.outcome)) {
    throw new Error("Invalid game payload");
  }

  return {
    id: `game-${randomUUID()}`,
    source: "database",
    date: clean(game.date),
    outcome: game.outcome,
    finalDay: clean(game.finalDay),
    storyteller: clean(game.storyteller),
    playerCount: Number.isFinite(Number(game.playerCount)) ? Number(game.playerCount) : Object.keys(roles).length,
    format: clean(game.format),
    script: clean(game.script),
    winNames,
    lossNames,
    roles,
    alignmentOverrides,
  };
}

function insertGame(game) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO games (
      id, source, date, outcome, final_day, storyteller, player_count, format, script,
      win_names, loss_names, roles, alignment_overrides, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    game.id,
    game.source,
    game.date,
    game.outcome,
    game.finalDay,
    game.storyteller,
    game.playerCount,
    game.format,
    game.script,
    JSON.stringify(game.winNames),
    JSON.stringify(game.lossNames),
    JSON.stringify(game.roles),
    JSON.stringify(game.alignmentOverrides),
    now,
    now,
  );
}

function deleteGame(id) {
  const existing = db.prepare("SELECT id FROM games WHERE id = ?").get(id);
  if (!existing) return false;
  db.prepare("DELETE FROM games WHERE id = ?").run(id);
  return true;
}

function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = normalize(join(ROOT, requested));
  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] || "application/octet-stream" });
  response.end(readFileSync(filePath));
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function clean(value) {
  return String(value ?? "").trim();
}

function splitNames(value) {
  return clean(value)
    .split(",")
    .map(name => name.trim())
    .filter(Boolean);
}

function numberOrZero(value) {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
