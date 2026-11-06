#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile, access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const source = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let target = path.join(homedir(), ".config", "herdr-app");
let dryRun = false, skipDeps = false;
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--dry-run") dryRun = true;
  else if (arg === "--skip-deps") skipDeps = true;
  else if (arg === "--config-dir" && args[index + 1] && !args[index + 1].startsWith("--")) target = path.resolve(args[++index]);
  else throw new Error(`Unknown or incomplete option: ${arg}`);
}
const exists = async file => { try { await access(file); return true; } catch { return false; } };
const keyPatch = JSON.parse(await readFile(path.join(source, "keys.json"), "utf8"));
const keysPath = path.join(target, "keys.json");
const keys = await exists(keysPath) ? JSON.parse(await readFile(keysPath, "utf8")) : {};
for (const [scope, bindings] of Object.entries(keyPatch)) keys[scope] = { ...keys[scope], ...bindings };
// Remove only the old tab-cycling bindings; preserve any other custom action.
for (const [key, action] of Object.entries(keys.global)) {
  if (action === "tab.next" || action === "tab.prev" || action === "agent.next" && key !== "cmd-pagedown" || action === "agent.prev" && key !== "cmd-pageup") delete keys.global[key];
}
const mods = (await readdir(path.join(source, "mods"), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
const items = ["layouts/main-clean.json", "layouts/main-clean.svg", ...mods.map(name => `mods/${name}`), "keys.json"];
const backup = path.join(target, "backups", `main-clean-install-${Date.now()}`);
console.log(`${dryRun ? "Would install" : "Installing"} main-clean into ${target}`);
console.log(`Backup: ${backup}`);
for (const relative of items) {
  console.log(`  ${relative}`);
  if (dryRun) continue;
  const dest = path.join(target, relative);
  if (await exists(dest)) {
    const saved = path.join(backup, relative);
    await mkdir(path.dirname(saved), { recursive: true });
    await cp(dest, saved, { recursive: true });
  }
  await mkdir(path.dirname(dest), { recursive: true });
  if (relative === "keys.json") await writeFile(dest, JSON.stringify(keys, null, 2) + "\n");
  else await cp(path.join(source, relative), dest, { recursive: true, filter: name => path.basename(name) !== "node_modules" });
}
if (!dryRun && !skipDeps) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: path.join(target, "mods", "main-clean-files", ".render-runtime"), stdio: "inherit",
  });
  if (result.error || result.status !== 0) throw new Error(`Dependency installation failed: ${result.error?.message ?? result.status}. Files were copied; the backup is at ${backup}.`);
}
console.log(dryRun ? "Dry run complete; no files changed." : "Installed. Select main-clean in Herdr's layout picker. Existing app preferences and session state were not imported.");
