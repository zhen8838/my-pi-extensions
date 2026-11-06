import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Render ordinary rows eagerly, then exercise their clicks and both document modes.
const elements = [];
function element() {
  const handlers = new Map();
  const state = { handlers, elementId: null, renderedChildren: [], scrollable: false };
  let proxy;
  proxy = new Proxy(state, {
    get(target, name) {
      if (name in target) return target[name];
      return (...args) => {
        if (name === "when" && args[0]) args[1](proxy);
        if (name === "id") target.elementId = args[0];
        if (name === "child") target.renderedChildren.push(args[0]);
        if (name === "children") target.renderedChildren.push(...args[0]);
        if (name === "overflow_y_scrollbar") target.scrollable = true;
        if (String(name).startsWith("on_")) {
          handlers.set(name, args[0]);
        }
        return proxy;
      };
    },
  });
  elements.push(state);
  return proxy;
}
const source = (await readFile(new URL("./mods/main-clean-files/main.js", import.meta.url), "utf8"))
  .replace(/^import .*$/gm, "").replace("export default class Files", "class Files") + "\nFiles;";
const palette = { background: "#fff", foreground: "#111", selected: "#ddd" };
const Files = vm.runInNewContext(source, {
  View: class {}, div: element, svg: element, v_flex: element, h_flex: element,
  layout: () => ({}), theme: () => palette, shared: () => null,
  filesLook: () => ({ palette, document: {} }), FILES_APPEARANCE_KEY: "appearance",
  spaces: () => [{ active: true, id: "fixture", folder: "/fixture" }], focused: () => ({}), panes: () => [],
  settings: () => ({ font_size: 16.5 }),
});
const view = new Files();
Object.assign(view, {
  context: { key: JSON.stringify({ cwd: "/fixture", on: null, space: "fixture" }) },
  root: "/fixture", entries: new Map([["", [{ name: "folder", dir: true }, { name: "sample.md", dir: false }]]]),
  folders: new Set(), marks: {}, panelFocus: { focus() {} }, view: "tree",
  sourceView: {},
  openFile(path) { this.file = path; this.view = "source"; }, toggle(path) { this.folders.add(path); },
});
view.render({ notify() {} });
const tree = elements.find(item => item.elementId === "files-tree");
assert(tree?.scrollable);
assert.equal(tree.renderedChildren.length, 2);
const click = elements.find(item => item.elementId === "file-sample.md")?.handlers.get("on_click");
assert.equal(typeof click, "function");
click({}, { notify() {} });
assert.equal(view.file, "sample.md");
assert.equal(view.treeSelected, "sample.md");
let sourceRendered = 0, previewRendered = 0;
view.renderDocument = { sourceTruncated: false };
view.sourceText = "# Example";
view.sourceView.render = () => { sourceRendered++; return element(); };
view.markdown = { hasToc: () => false, render() { previewRendered++; return element(); } };
view.view = "source";
view.render({ notify() {} });
assert.equal(sourceRendered, 1);
view.view = "preview";
view.render({ notify() {} });
assert.equal(previewRendered, 1);
console.log("PASS: ordinary Files tree renders rows, opens clicked files, and renders Source and Preview bodies");
