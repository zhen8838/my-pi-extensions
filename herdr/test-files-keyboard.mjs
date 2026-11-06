import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

async function load(file, name, scope) {
  const source = (await readFile(new URL(file, import.meta.url), "utf8"))
    .replace(/^import .*$/gm, "")
    .replace(`export default class ${name}`, `class ${name}`) + `\n${name};`;
  return vm.runInNewContext(source, { View: class {}, ...scope });
}
const actions = [];
const run = (name, args) => actions.push({ name, args });
const Files = await load("./mods/main-clean-files/main.js", "Files", { run, settings: () => ({ font_size: 16.5 }) });
const view = new Files();
let focused = 0;
Object.assign(view, {
  entries: new Map([["", [{ name: "docs", dir: true }, { name: "last.md", dir: false }]], ["docs", [{ name: "first.md", dir: false }]]]),
  folders: new Set(), panelFocus: { focus() { focused++; } }, view: "tree",
  sourceText: "fixture text",
  sourceView: {},
  remember() {}, openFile(path) { this.file = path; this.view = "source"; },
  toggle(path) { if (this.folders.has(path)) this.folders.delete(path); else this.folders.add(path); },
});
const cx = { notify() {}, stop_propagation() {} };
const key = keystroke => view.handleKeyDown({ keystroke }, cx);
view.showTree(cx); view.focusPanel(cx);
assert.equal(view.treeSelected, "docs");
key("right");
assert(view.folders.has("docs"));
key("down");
assert.equal(view.treeSelected, "docs/first.md");
key("left");
assert.equal(view.treeSelected, "docs");
key("left");
assert(!view.folders.has("docs"));
key("end");
assert.equal(view.treeSelected, "last.md");
key("enter");
assert.equal(view.file, "last.md");
view.view = "source";
view.togglePreview(cx);
assert.equal(view.view, "preview");
view.togglePreview(cx);
assert.equal(view.view, "source");
view.showTree(cx);
assert.equal(view.view, "tree");
assert.equal(view.file, "last.md");
assert.equal(view.treeSelected, "last.md");
key("escape");
assert.equal(actions.at(-1).name, "pane.go");
assert(focused > 0);
view.file = "plain.cpp";
view.view = "source";
view.togglePreview(cx);
assert.equal(view.view, "source");

// Merely focusing the panel must preserve every view mode and its scroll.
Object.assign(view.sourceView, { scrollY: 100, scrollX: 25, height: 200, maxY: () => 1000,
  clamp() { this.scrollY = Math.max(0, Math.min(1000, this.scrollY)); this.scrollX = Math.max(0, Math.min(500, this.scrollX)); } });
view.markdown = { scroll: 150, scrollX: 0, height: 200, maxScroll: () => 1000,
  move(next) { this.scroll = Math.max(0, Math.min(1000, next)); },
  moveX(next) { this.scrollX = Math.max(0, Math.min(500, next)); } };
view.renderDocument = { sourceTruncated: false };
for (const mode of ["source", "preview"]) {
  view.file = "last.md"; view.view = mode;
  view.focusPanel(cx);
  assert.equal(view.file, "last.md");
  assert.equal(view.view, mode);
  assert.equal(view.sourceView.scrollY, 100);
  assert.equal(view.markdown.scroll, 150);
}
view.view = "source";
key("down"); assert.equal(view.sourceView.scrollY, 126);
key("up"); assert.equal(view.sourceView.scrollY, 100);
key("pagedown"); assert.equal(view.sourceView.scrollY, 300);
key("pageup"); assert.equal(view.sourceView.scrollY, 100);
assert.equal(view.treeSelected, "last.md");
key("left"); assert.equal(view.sourceView.scrollX, 0);
key("right"); assert.equal(view.sourceView.scrollX, 16.5 * .7 * 4);
key("escape"); assert.equal(view.view, "tree"); assert.equal(view.file, "last.md");
view.file = "last.md"; view.view = "preview";
key("down"); assert.equal(view.markdown.scroll, 176);
key("pagedown"); assert.equal(view.markdown.scroll, 376);
key("up"); assert.equal(view.markdown.scroll, 350);
assert.equal(view.sourceView.scrollY, 100);
key("right"); assert.equal(view.markdown.scrollX, 16.5 * .7 * 4);
key("left"); assert.equal(view.markdown.scrollX, 0);
key("escape"); assert.equal(view.view, "tree");

const panel = { id: "panel", hidden: true }, body = { id: "panel-body", active: "changes" };
const layout = () => ({ children: [panel, body] });
let currentTabs = [{ id: "first" }, { id: "second" }, { id: "third" }];
const spaces = () => [{ active: true, tabs: currentTabs }];
const panes = () => currentTabs.map(tab => ({ tab: tab.id, pane: `pane-${tab.id}`, terminal: `terminal-${tab.id}` }));
const Tabs = await load("./mods/main-clean-tabs/main.js", "Tabs", { layout, run, spaces, panes });
const tabs = new Tabs();
actions.length = 0;
tabs.filesCommand("toggle-files");
assert.deepEqual(actions.map(action => action.name), ["layout.select", "layout.show", "main-clean-files.focus"]);
panel.hidden = false; body.active = "files";
actions.length = 0;
tabs.filesCommand("toggle-files");
assert.deepEqual(actions.map(action => action.name), ["layout.hide"]);
panel.hidden = true;
actions.length = 0;
tabs.filesCommand("toggle-preview");
assert.deepEqual(actions.map(action => action.name), ["layout.select", "layout.show", "main-clean-files.toggle-preview"]);
actions.length = 0;
tabs.filesCommand("focus-files");
assert.equal(actions.at(-1).name, "main-clean-files.focus-tree");
actions.length = 0;
tabs.filesCommand("select-2");
assert.equal(actions.length, 2);
assert.equal(actions[0].name, "tab.select");
assert.equal(actions[0].args.id, "second");
assert.equal(actions[1].name, "pane.focus");
assert.equal(actions[1].args.pane, "pane-second");
actions.length = 0;
tabs.filesCommand("select-4");
assert.deepEqual(actions.map(action => action.name), ["layout.select", "layout.show", "main-clean-files.focus"]);
panel.hidden = false;
actions.length = 0;
tabs.filesCommand("select-4");
assert(!actions.some(action => action.name === "layout.hide"));
assert.equal(actions.at(-1).name, "main-clean-files.focus");
currentTabs = [{ id: "only" }];
actions.length = 0;
tabs.filesCommand("select-2");
assert.equal(actions.at(-1).name, "main-clean-files.focus");
currentTabs = Array.from({ length: 8 }, (_, index) => ({ id: `tab-${index}` }));
actions.length = 0;
tabs.filesCommand("select-9");
assert.equal(actions.at(-1).name, "main-clean-files.focus");
currentTabs.push({ id: "ninth" });
actions.length = 0;
tabs.filesCommand("select-9");
assert.equal(actions.at(-2).name, "tab.select");
assert.equal(actions.at(-2).args.id, "ninth");
assert.equal(actions.at(-1).name, "pane.focus");
assert.equal(actions.at(-1).args.pane, "pane-ninth");
actions.length = 0;
tabs.filesCommand("select-1");
assert.deepEqual(actions.map(action => action.name), ["tab.select", "pane.focus"]);
assert.equal(actions.at(-1).args.pane, "pane-tab-0");
console.log("PASS: Files keyboard navigation, focus, Preview toggle and hidden-panel command routing");
