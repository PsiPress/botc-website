// Local preview server: serves the site's static files. The live data lives
// in Supabase (see supabase-config.js); without it the site runs read-only
// from games-sheet.json and site-data.json.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 5173);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

createServer((request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = normalize(join(ROOT, requested));
  const inside = filePath.startsWith(ROOT) && !filePath.slice(ROOT.length).split(sep).some(part => part.startsWith("."));
  if (!inside || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] || "application/octet-stream", "cache-control": "no-store" });
  response.end(readFileSync(filePath));
}).listen(PORT, () => {
  console.log(`BOTC stats site running at http://127.0.0.1:${PORT}/`);
});
