import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import * as sourceModel from "./mods/main-clean-files/source-model.js";
import * as scrollModel from "./mods/main-clean-files/scroll-state.js";

const load = async (file, name, scope) => {
  const text = (await readFile(new URL(file, import.meta.url), "utf8"))
    .replace(/^import .*$/gm, "").replace(`export default class ${name}`, `class ${name}`).replace(`export class ${name}`, `class ${name}`);
  return vm.runInNewContext(text + `\n${name};`, scope);
};
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const document = text => ({ version: 2, source: { lines: text.split("\n").map(line => [[line, {}, {}]]), columns: 100 }, blocks: [] });

async function environment(options = {}) {
  const mounted = new Set(), handles = [], events = [], actions = [], updates = [], jobs = [], storage = new Map();
  const state = { space: { active: true, id: "fixture", folder: "/repo", machine: "remote" }, focused: { pane: "p", cwd: "/repo" } };
  function element() {
    let proxy;
    proxy = new Proxy({}, { get(_target, key) { return (...args) => {
      if (key === "when" && args[0]) args[1](proxy);
      if (key === "track_focus") mounted.add(args[0]);
      return proxy;
    }; } });
    return proxy;
  }
  class MarkdownPreview {
    constructor() { this.doc = { blocks: [] }; this.scroll = 0; this.scrollX = 0; }
    close() { this.doc = { blocks: [] }; }
    setDocument(text, target, _cx, _force, prepared) { updates.push({ text, target }); this.doc = prepared ?? { blocks: [] }; }
    hasToc() { return false; }
    render() { return element(); }
  }
  const SourceView = await load("./mods/main-clean-files/source-view.js", "SourceView", { ...sourceModel, ...scrollModel, div: element, v_flex: element, h_flex: element });
  const palette = { foreground: "#111", background: "#fff" };
  const Files = await load("./mods/main-clean-files/main.js", "Files", {
    View: class {}, SourceView, MarkdownPreview, div: element, svg: element, v_flex: element, h_flex: element,
    spaces: () => [state.space], focused: () => state.focused,
    panes: () => state.focused.pane ? [{ pane: "p", cwd: state.space.folder }] : [],
    settings: () => ({ font_size: 16.5, font_family: "mono", dark: false }), layout: () => ({}), window: () => ({ platform: "macos" }),
    theme: () => palette, shared: () => null, FILES_APPEARANCE_KEY: "appearance",
    filesLook: () => ({ palette, document: { source: palette, markdown: palette } }),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    nextCommand: () => new Promise(() => {}), run: (name, args) => actions.push({ name, args }),
    exec: async command => command === "sh" ? { code: 0, stdout: "f\0a.md\0f\0b.md\0", stderr: "" } : { code: 1, stdout: "" },
    readTextFile: options.read ?? (async path => "# " + path), prepareDocument: options.prepare ?? (async text => document(text)),
    EditorState: { new({ value }) { return { value, set_value(next) { this.value = next; }, release() {} }; } }, Editor: { new: element },
  });
  let activeFocus = null, copied = "";
  const cx = {
    timer: { every() {} }, notify() { events.push("notify"); }, stop_propagation() { events.push("consume"); },
    write_to_clipboard(value) { copied = value; },
    focus_handle() {
      const handle = { focus() { assert(mounted.has(handle), "cannot focus an element before it is mounted"); activeFocus = handle; state.focused = { pane: null, terminal: null }; events.push("focus"); }, is_focused: () => activeFocus === handle };
      handles.push(handle); return handle;
    },
    spawn(body) { jobs.push(body(cx)); },
  };
  const view = new Files(); view.init({}, cx);
  // Job zero is the intentionally live command loop. Folder loads and reads are real methods.
  const drain = async () => { for (let i = 1; i < jobs.length; i++) await jobs[i]; };
  await drain(); view.render(cx); view.showTree(cx); view.focusPanel(cx);
  return { view, cx, state, handles, events, actions, updates, drain, activeFocus: () => activeFocus, copied: () => copied };
}

{
  const read = deferred();
  const e = await environment({ read: () => read.promise });
  const context = e.view.context;
  e.view.selectTree("a.md"); e.events.length = 0;
  e.view.handleKeyDown({ keystroke: "enter" }, e.cx);
  assert.equal(e.events[0], "consume", "consume Enter before starting the view transition");
  assert(!e.events.includes("focus"), "opening a file must not transfer focus");
  assert.equal(e.handles.length, 1, "the panel owns the only custom focus handle");
  assert.equal(e.activeFocus(), e.view.panelFocus);
  assert.equal(e.view.view, "source"); assert.equal(e.view.previewLoading, true);
  e.view.render(e.cx);
  assert.equal(e.view.context, context, "internal focus preserves the remote context");
  e.view.handleKeyDown({ keystroke: "escape" }, e.cx);
  assert.equal(e.view.view, "tree"); assert.equal(e.view.file, "a.md");
  read.resolve("# loaded later"); await e.drain();
  assert.equal(e.view.view, "tree", "late content must not reopen the document view");
  assert.equal(e.activeFocus(), e.view.panelFocus); assert.equal(e.actions.length, 0);
  e.view.openFile("a.md", e.cx); await e.drain();
  e.view.sourceView.anchor = 0; e.view.sourceView.cursor = 8;
  e.view.sourceView.scrollY = 12; e.view.markdown.scroll = 14;
  e.view.view = "preview";
  e.view.focusPanel(e.cx);
  assert.equal(e.view.view, "preview"); assert.equal(e.view.sourceView.scrollY, 12); assert.equal(e.view.markdown.scroll, 14);
  console.log("PASS: real Enter/load path keeps a mounted root focused; Escape, late reads and internal context are stable");
}

{
  const a = deferred(), b = deferred(); let aStarted = false;
  const e = await environment({ prepare: text => { if (text.endsWith("a.md")) { aStarted = true; return a.promise; } return b.promise; } });
  e.view.openFile("a.md", e.cx);
  for (let i = 0; i < 20 && !aStarted; i++) await Promise.resolve();
  assert(aStarted);
  const pending = e.view.previewRead;
  e.view.refreshPreview(e.cx);
  assert.equal(e.view.previewRead, pending, "a second poll cannot overlap an unfinished highlight");
  e.view.openFile("b.md", e.cx);
  b.resolve(document("B")); a.resolve(document("A")); await e.drain();
  assert.equal(e.view.file, "b.md"); assert.equal(e.view.sourceText, "# /repo/b.md");
  assert.equal(e.updates.length, 1); assert.equal(e.updates[0].target.path, "b.md");
  assert.equal(e.updates[0].text, "# /repo/b.md");
  assert.equal(e.actions.length, 0);
  console.log("PASS: async commits are serialized and stale highlighting cannot overwrite a later file or its Markdown target");
}

{
  const prepare = deferred(); let started = false;
  const e = await environment({ prepare: () => { started = true; return prepare.promise; } });
  e.view.openFile("a.md", e.cx);
  for (let i = 0; i < 20 && !started; i++) await Promise.resolve();
  assert(started);
  e.state.space = { ...e.state.space, id: "other", folder: "/other" };
  e.view.refresh(e.cx);
  prepare.resolve(document("stale")); await e.drain();
  assert.equal(e.view.view, "tree"); assert.equal(e.view.file, null); assert.equal(e.updates.length, 0);
  console.log("PASS: an external workspace switch discards stale document results without moving focus");
}

{
  const e = await environment({ prepare: async () => { throw Error("fixture highlighter failure"); } });
  e.view.openFile("a.md", e.cx); await e.drain();
  assert.match(e.view.previewError, /fixture highlighter/);
  assert.equal(e.view.sourceView.text, "# /repo/a.md");
  e.view.handleKeyDown({ keystroke: "cmd-a" }, e.cx);
  e.view.handleKeyDown({ keystroke: "cmd-c" }, e.cx);
  assert.equal(e.copied(), "# /repo/a.md");
  assert.equal(e.activeFocus(), e.view.panelFocus);
  assert.equal(e.actions.length, 0);
  e.view.render(e.cx);
  console.log("PASS: highlighter failure keeps a readable/copyable Source view and stable panel focus");
}

{
  const e = await environment({ read: async () => { throw Error("fixture read failure"); } });
  e.view.openFile("a.md", e.cx); await e.drain();
  assert.match(e.view.fileError, /Cannot preview/);
  assert.equal(e.view.view, "source"); assert.equal(e.view.previewLoading, false);
  assert.equal(e.activeFocus(), e.view.panelFocus); assert.equal(e.actions.length, 0);
  e.view.render(e.cx);
  e.view.handleKeyDown({ keystroke: "escape" }, e.cx);
  assert.equal(e.view.view, "tree");
  console.log("PASS: read errors stay in the panel and Escape returns to the retained tree");
}

{
  const prepare = deferred(); let started = false;
  const e = await environment({ prepare: () => { started = true; return prepare.promise; } });
  e.view.openFile("a.md", e.cx);
  for (let i = 0; i < 20 && !started; i++) await Promise.resolve();
  assert(started); e.view.close();
  prepare.resolve(document("closed")); await e.drain();
  assert.equal(e.updates.length, 0); assert.equal(e.view.sourceText, null);
  console.log("PASS: closing the view invalidates in-flight document results");
}
