import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const WORKBOOK_BASE_COLUMN_COUNT = 8;
const NORMALIZED_HEADERS = ["", "Outcome", "Final Day", "Storyteller", "Player Count", "Format", "Script", "Win", "Loss"];

export function readGamesSheet(workbookPath) {
  const entries = readZipEntries(readFileSync(workbookPath));
  const sharedStrings = entries.get("xl/sharedStrings.xml")
    ? [...entries.get("xl/sharedStrings.xml").toString().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => readXmlText(match[1]))
    : [];
  const sheet = entries.get("xl/worksheets/sheet1.xml")?.toString();
  if (!sheet) throw new Error(`Missing first worksheet in ${workbookPath}`);

  const rawRows = [...sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(match => {
    const values = [];
    for (const cell of match[1].matchAll(/<c\b([^/>]*)(?:\/\>|>([\s\S]*?)<\/c>)/g)) {
      const reference = /\br="([A-Z]+)\d+"/.exec(cell[1])?.[1];
      if (!reference) continue;
      const type = /\bt="([^"]+)"/.exec(cell[1])?.[1];
      const contents = cell[2] || "";
      const value = /<v>([\s\S]*?)<\/v>/.exec(contents)?.[1] ?? readXmlText(contents);
      values[columnIndex(reference)] = type === "s" ? sharedStrings[Number(value)] ?? "" : decodeXml(value);
    }
    return values;
  });
  return {
    headers: (rawRows[1] || []).map(clean),
    rows: rawRows.slice(2).filter(row => clean(row[0]) && clean(row[1])).map(row => [excelDateToDisplay(row[0]), ...row.slice(1).map(clean)]),
  };
}

export function gamesSheetState({ headers, rows }) {
  const playerHeaders = headers.slice(WORKBOOK_BASE_COLUMN_COUNT);
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
    const role = clean(row[offset + WORKBOOK_BASE_COLUMN_COUNT]);
    if (role && role.toLowerCase() !== "n/a") roles[player] = role;
  });
  return {
    id: `games-sheet-${index}`, source: "games-sheet", date, outcome,
    finalDay: clean(row[2]), storyteller: clean(row[3]), playerCount: numberOrZero(row[4]),
    format: "", script: clean(row[5]), winNames: splitNames(row[6]), lossNames: splitNames(row[7]),
    roles, alignmentOverrides: {},
  };
}

function readZipEntries(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Invalid XLSX archive");
  const entries = new Map();
  let offset = buffer.readUInt32LE(end + 16);
  while (buffer.readUInt32LE(offset) === 0x02014b50) {
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString();
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const contents = buffer.subarray(dataOffset, dataOffset + compressedSize);
    entries.set(name, compression === 0 ? contents : inflateRawSync(contents));
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function readXmlText(xml) { return decodeXml([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join("")); }
function decodeXml(value) { return String(value ?? "").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); }
function columnIndex(reference) { return [...reference].reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1; }
function excelDateToDisplay(value) { const serial = Number(value); if (!Number.isFinite(serial)) return clean(value); const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000); return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${String(date.getUTCFullYear()).slice(-2)}`; }
function clean(value) { return String(value ?? "").trim(); }
function splitNames(value) { return clean(value).split(",").map(name => name.trim()).filter(Boolean); }
function numberOrZero(value) { const parsed = Number.parseInt(clean(value), 10); return Number.isFinite(parsed) ? parsed : 0; }
