import { readFileSync } from "node:fs";

const GAMES_SHEET_BASE_COLUMN_COUNT = 8;
const NORMALIZED_HEADERS = ["", "Outcome", "Final Day", "Storyteller", "Player Count", "Format", "Script", "Win", "Loss"];

export function readGamesSheet(csvPath) {
  const rawRows = parseCsv(readFileSync(csvPath, "utf8"));
  return {
    headers: (rawRows[1] || []).map(clean),
    rows: rawRows.slice(2).filter(row => clean(row[0]) && clean(row[1])).map(row => [
      csvDateToDisplay(row[0]),
      ...row.slice(1).map(clean),
    ]),
  };
}

export function gamesSheetState({ headers, rows }) {
  const playerHeaders = headers.slice(GAMES_SHEET_BASE_COLUMN_COUNT);
  return {
    headers: NORMALIZED_HEADERS.concat(playerHeaders),
    games: rows.map((row, index) => rowToGame(row, index, playerHeaders)).filter(Boolean),
  };
}

function rowToGame(row, index, playerHeaders) {
  const date = clean(row[0]);
  const outcome = clean(row[1]);
  if (!date || !outcome) return null;
  const roles = {};
  playerHeaders.forEach((player, offset) => {
    const role = clean(row[offset + GAMES_SHEET_BASE_COLUMN_COUNT]);
    if (role && role.toLowerCase() !== "n/a") roles[player] = role;
  });
  return {
    id: `games-sheet-${index}`, source: "games-sheet", date, outcome,
    finalDay: finalDayValue(row[2]), storyteller: clean(row[3]), playerCount: numberOrZero(row[4]),
    format: "", script: clean(row[5]), winNames: splitNames(row[6]), lossNames: splitNames(row[7]),
    roles, alignmentOverrides: {},
  };
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (character !== "\r") {
      value += character;
    }
  }
  if (value || row.length) rows.push([...row, value]);
  return rows;
}

function clean(value) { return String(value ?? "").trim(); }
function csvDateToDisplay(value) {
  const date = clean(value);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  return match ? `${match[1]}/${match[2]}/${match[3].slice(-2)}` : date;
}
function finalDayValue(value) {
  const finalDay = clean(value).toLowerCase();
  return finalDay === "true" ? "1" : finalDay === "false" ? "0" : finalDay;
}
function splitNames(value) { return clean(value).split(",").map(name => name.trim()).filter(Boolean); }
function numberOrZero(value) { const parsed = Number.parseInt(clean(value), 10); return Number.isFinite(parsed) ? parsed : 0; }
