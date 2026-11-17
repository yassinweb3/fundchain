import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
const root = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL(".vite/manifest.json", root), "utf8"));
const initial = new Set();
function visit(key) {
  const item = manifest[key];
  if (!item) throw new Error(`Unknown manifest import: ${key}`);
  if (initial.has(item.file)) return;
  initial.add(item.file);
  for (const dependency of item.imports ?? []) visit(dependency);
}
const entries = Object.entries(manifest).filter(([, item]) => item.isEntry);
if (entries.length !== 1) throw new Error("Expected exactly one app entry.");
visit(entries[0][0]);
const assets = [...new Set(Object.values(manifest).map(item => item.file).filter(file => file.endsWith(".js")))];
const sizes = assets.map(file => {
  const bytes = readFileSync(new URL(file, root));
  return { file, initial: initial.has(file), minified: bytes.length, gzip: gzipSync(bytes).length };
});
const initialGzip = sizes.filter(item => item.initial).reduce((sum, item) => sum + item.gzip, 0);
const totalGzip = sizes.reduce((sum, item) => sum + item.gzip, 0);
console.log(JSON.stringify({ sizes, initialGzip, totalGzip, limits: { initialGzip: 100000, totalGzip: 190000, chunkMinified: 500000 } }, null, 2));
if (initialGzip > 100000 || totalGzip > 190000 || sizes.some(item => item.minified > 500000)) {
  throw new Error("JavaScript bundle budget exceeded.");
}
