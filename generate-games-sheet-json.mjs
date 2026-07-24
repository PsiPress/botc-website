import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { gamesSheetState, readGamesSheet } from "./games-sheet.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const state = gamesSheetState(readGamesSheet(join(root, "Blood on the Clocktower - Games Sheet.xlsx")));
writeFileSync(join(root, "games-sheet.json"), `${JSON.stringify(state, null, 2)}\n`);
console.log(`Wrote games-sheet.json with ${state.games.length} games.`);
