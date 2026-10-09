// Dev-only static server that injects the fake chrome API into the extension pages.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "../..");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
const port = Number(process.env.PORT || 5178);

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    let body = await readFile(join(root, path === "/" ? "popup.html" : path));
    if (extname(path) === ".html" || path === "/") body = body.toString().replace("<head>", '<head><script src="/dev/mock-chrome.js"></script>');
    res.writeHead(200, { "content-type": types[extname(path) || ".html"] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`preview on http://localhost:${port}`));
