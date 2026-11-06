#!/usr/bin/env node
import { cp, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "herdr-surfaces-"));
try {
  const target = path.join(temporary, "mod");
  await cp(path.join(root, "mods", "main-clean-files"), target, {
    recursive: true, filter: source => path.basename(source) !== "node_modules",
  });
  await copyFile(path.join(root, "check-surfaces", "main.js"), path.join(target, "main.js"));
  const result = spawnSync("herdr-app", ["check", target], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
