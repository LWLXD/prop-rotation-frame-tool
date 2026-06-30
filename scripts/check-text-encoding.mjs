import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const includeExts = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx"
]);
const ignoredDirs = new Set([
  ".git",
  ".runtime-logs",
  ".venv-rembg",
  "dist",
  "node_modules",
  "storage"
]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        files.push(...await walk(path.join(dir, entry.name)));
      }
      continue;
    }
    if (includeExts.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const files = await walk(root);
const failures = [];
for (const file of files) {
  const text = await readFile(file, "utf8");
  if (text.includes("\uFFFD")) {
    failures.push(path.relative(root, file));
  }
}

if (failures.length > 0) {
  console.error("Text encoding check failed. Replacement characters found in:");
  for (const file of failures) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

console.log(`Text encoding check passed (${files.length} files scanned).`);
