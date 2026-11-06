#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const files = path.join(root, "mods", "main-clean-files");
const installation = spawnSync(process.execPath, [path.join(root, "test-install.mjs")], { stdio: "inherit" });
if (installation.error || installation.status !== 0) process.exit(installation.status || 1);
const tests = [
  ".render-runtime/test-render.mjs",
  ".render-runtime/test-source.mjs",
  ".render-runtime/test-source-view.mjs",
  ".render-runtime/test-scroll-state.mjs",
  ".render-runtime/test-preview-scroll.mjs",
  ".markdown-runtime/test.mjs",
  ".markdown-runtime/test-assets.mjs",
  ".markdown-runtime/test-refresh.mjs",
];
for (const file of tests) {
  const result = spawnSync(process.execPath, [path.join(files, file)], { cwd: files, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) await inspect(name);
    else if (entry.name.endsWith(".json")) JSON.parse(await readFile(name, "utf8"));
    else if (/\.(?:m?js)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ["--check", name], { stdio: "inherit" });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
await inspect(root);
console.log("PASS: regression tests, JavaScript syntax and JSON configuration");
