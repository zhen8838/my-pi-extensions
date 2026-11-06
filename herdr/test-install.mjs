import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const testRoot = await mkdtemp(path.join(tmpdir(), "herdr-install-test-"));
const config = path.join(testRoot, "config");
const run = (...args) => {
  const result = spawnSync(process.execPath, [path.join(root, "install.mjs"), "--config-dir", config, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};
run("--dry-run");
await assert.rejects(access(config));
await mkdir(path.join(config, "mods", "main-clean-chrome"), { recursive: true });
await writeFile(path.join(config, "mods", "main-clean-chrome", "main.js"), "original mod");
await writeFile(path.join(config, "settings.json"), '{"theme":"existing"}');
await writeFile(path.join(config, "keys.json"), JSON.stringify({ global: {
  "cmd-x": "custom.action", "ctrl-tab": "tab.next", "cmd-shift-[": "tab.prev", "cmd-alt-]": "space.next",
}, terminal: { "cmd-v": "terminal.paste" } }));
run("--skip-deps");
const keys = JSON.parse(await readFile(path.join(config, "keys.json"), "utf8"));
assert.equal(keys.global["cmd-x"], "custom.action");
assert.equal(keys.global["cmd-alt-]"], "space.next");
assert.equal(keys.terminal["cmd-v"], "terminal.paste");
assert.equal(keys.global["cmd-pagedown"], "agent.next");
assert.equal(keys.global["cmd-1"], "tab.select:1");
assert.equal(keys.global["ctrl-tab"], undefined);
assert.equal(keys.global["cmd-shift-["], undefined);
assert.equal(await readFile(path.join(config, "settings.json"), "utf8"), '{"theme":"existing"}');
const backups = await readdir(path.join(config, "backups"));
assert.equal(await readFile(path.join(config, "backups", backups[0], "mods", "main-clean-chrome", "main.js"), "utf8"), "original mod");
await assert.rejects(access(path.join(config, "mods", "main-clean-files", ".render-runtime", "node_modules")));
const layout = JSON.parse(await readFile(path.join(config, "layouts", "main-clean.json"), "utf8"));
assert.equal(layout.font_size, 16.5);
const visit = item => {
  assert(!Object.hasOwn(item.content?.props ?? {}, "initial_space"));
  assert(!Object.hasOwn(item.content?.props ?? {}, "initial_root"));
  assert(!Object.hasOwn(item.content?.props ?? {}, "initial_file"));
  for (const child of item.children ?? []) visit(child);
};
visit(layout);
run("--skip-deps");
assert.equal((await readdir(path.join(config, "backups"))).length, 2);
console.log("PASS: installer dry-run, backup, repeat install, shortcut merge, preserved preferences and portable layout");
