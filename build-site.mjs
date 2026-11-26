// Copies the files the browser needs into _site/, which Vercel serves (see
// vercel.json). Add any new browser module or data file here.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const FILES = [
  "index.html",
  "styles.css",
  "app.js",
  "ratings.js",
  "supabase.js",
  "supabase-config.js",
  "games-sheet.json",
  "site-data.json",
  "Blood on the Clocktower - Games Sheet.csv",
];

const root = fileURLToPath(new URL(".", import.meta.url));
const out = join(root, "_site");
const missing = FILES.filter(file => !existsSync(join(root, file)));
if (missing.length) {
  console.error(`Missing site files: ${missing.join(", ")}`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
FILES.forEach(file => copyFileSync(join(root, file), join(out, file)));
console.log(`Copied ${FILES.length} files to _site/.`);
