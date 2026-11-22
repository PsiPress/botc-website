import { readFileSync } from "node:fs";

// The CSV may be exported straight from the spreadsheet's Games tab (8 base
// columns, no Format) or from the Record layout (9 base columns, Format at
// index 5). Both are accepted; player columns always follow the base columns.
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
  const hasFormat = clean(headers[5]).toLowerCase() === "format";
  const base = hasFormat ? 9 : 8;
  const playerHeaders = headers.slice(base).filter(Boolean);
  return {
    headers: NORMALIZED_HEADERS.concat(playerHeaders),
    games: rows.map((row, index) => rowToGame(row, index, playerHeaders, hasFormat)).filter(Boolean),
  };
}

function rowToGame(row, index, playerHeaders, hasFormat) {
  const date = clean(row[0]);
  const outcome = clean(row[1]);
  if (!date || !outcome) return null;
  const base = hasFormat ? 9 : 8;
  const at = column => clean(row[hasFormat || column < 5 ? column : column - 1]);
  const roles = {};
  playerHeaders.forEach((player, offset) => {
    const role = clean(row[offset + base]);
    if (role && role.toLowerCase() !== "n/a") roles[player] = role;
  });
  return {
    id: `games-sheet-${index}`, source: "games-sheet", date, outcome,
    finalDay: finalDayValue(row[2]), storyteller: at(3), playerCount: numberOrZero(row[4]),
    format: hasFormat ? at(5) : "", script: at(6), winNames: splitNames(at(7)), lossNames: splitNames(at(8)),
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
