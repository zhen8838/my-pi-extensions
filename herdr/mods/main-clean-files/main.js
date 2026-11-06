// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { filesLook, FILES_APPEARANCE_KEY } from "./files-appearance.js";
import { MarkdownPreview } from "./preview-native.js";
import { SourceView } from "./source-view.js";
import { prepareDocument } from "./render-client.js";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, layout, nextCommand, shared, setShared, run } from "herdr";

function location(previous = null) {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  // Internal mod focus need not name a terminal. It must not turn a remote
  // document into a local one or change its working directory.
  if (previous && space && previous.space === space.id && !pane && !f?.terminal)
    return { cwd: previous.cwd, on: previous.on, space: previous.space };
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = previous => JSON.stringify(location(previous));
const PER_FOLDER = 500, TOTAL = 5000;
function terminalFontSize() { const n=Number(settings().font_size); return Number.isFinite(n)&&n>0?n:14; }
function fileLook() { return filesLook(shared(FILES_APPEARANCE_KEY), theme(), settings().dark); }
function terminalHeaderHeight() {
  const find=n=>{if(n?.content?.tab==="active"&&n.content.pane?.header?.height)return n.content.pane.header.height;for(const c of n?.children??[]){const v=find(c);if(v)return v;}return null;};
  return Math.max(1,Number(find(layout())??30)-1); // The Files frame adds a 1px top border.
}

async function directory(path, on) {
  if (!on && window()?.platform === "windows") {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Reparse points keep directory attributes even when dangling; check their target.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replaceAll("'", "''") + "'"]);
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  }
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.view = "tree";
    this.panelFocus = cx.focus_handle();
    this.markdown = new MarkdownPreview();
    this.sourceView = new SourceView(cx, () => this.panelFocus.focus());
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.focusPanel(cx);
        else if (command === "focus-tree") { this.showTree(cx); this.focusPanel(cx); }
        else if (command === "toggle-preview") this.togglePreview(cx);
        else if (command.startsWith("open:")) this.openFile(command.slice(5), cx);
        else if (command === "source" || command === "preview") { if (this.file) { this.view = command; this.remember(); } }
        else if (command === "back") this.showTree(cx);
        else if (command.startsWith("appearance:")) {
          const mode = command.slice(11);
          if (["app", "light", "dark"].includes(mode)) {
            setShared(FILES_APPEARANCE_KEY, mode === "app" ? null : mode);
          }
        }
        cx.notify();
      }
    });
    try { this.saved = new Map(JSON.parse(localStorage.getItem("files.view.v1") ?? "[]")); }
    catch { this.saved = new Map(); }
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
    // watchFolder is local-only. Check the open document independently of
    // the slower directory/Git refresh, including remote workspaces.
    cx.timer.every(2000, cx => this.refreshPreview(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key(context) === context.key;
  }

  visibleEntries(prefix = "", depth = 0, out = []) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push({ ...entry, path, depth });
      if (entry.dir && this.folders.has(path)) this.visibleEntries(path, depth + 1, out);
    }
    return out;
  }

  selectTree(path) {
    this.treeSelected = path;
  }

  openTreeEntry(path, cx) {
    const entry = this.visibleEntries().find(item => item.path === path);
    if (!entry) return;
    this.selectTree(path);
    if (entry.dir) this.toggle(path, cx);
    else this.openFile(path, cx);
    cx.notify();
  }

  focusPanel(cx) {
    this.panelFocus.focus();
    cx.notify();
  }

  showTree(cx) {
    if (this.file) this.treeSelected = this.file;
    this.view = "tree";
    const rows = this.visibleEntries();
    if (!rows.some(row => row.path === this.treeSelected)) this.treeSelected = rows[0]?.path ?? null;
    this.remember();
    cx.notify();
  }

  togglePreview(cx) {
    if (this.view === "tree" || !/\.(md|markdown|mdown|mkd|mkdn)$/i.test(this.file ?? "")) return;
    this.view = this.view === "preview" ? "source" : "preview";
    this.remember();
    cx.notify();
  }

  handleKeyDown(event, cx) {
    if (this.view !== "tree") {
      if (event.keystroke === "escape") { cx.stop_propagation(); this.showTree(cx); }
      else if (this.view === "source" && this.sourceText !== null && ["cmd-c", "ctrl-c", "cmd-a", "ctrl-a"].includes(event.keystroke)) this.sourceView.keyDown(event, cx);
      else this.scrollFile(event, cx);
      return;
    }
    const keys = ["up", "down", "home", "end", "left", "right", "enter", "escape"];
    if (!keys.includes(event.keystroke)) return;
    cx.stop_propagation();
    const rows = this.visibleEntries();
    let index = rows.findIndex(row => row.path === this.treeSelected);
    const selected = rows[index];
    if (event.keystroke === "down") this.selectTree(rows[Math.min(rows.length - 1, index + 1)]?.path);
    else if (event.keystroke === "up") this.selectTree(rows[Math.max(0, index - 1)]?.path);
    else if (event.keystroke === "home") this.selectTree(rows[0]?.path);
    else if (event.keystroke === "end") this.selectTree(rows.at(-1)?.path);
    else if (selected && event.keystroke === "enter") {
      this.openTreeEntry(selected.path, cx);
    } else if (selected && event.keystroke === "right" && selected.dir) {
      if (!this.folders.has(selected.path)) this.toggle(selected.path, cx);
      else if (rows[index + 1]?.depth > selected.depth) this.selectTree(rows[index + 1].path);
    } else if (selected && event.keystroke === "left") {
      if (selected.dir && this.folders.has(selected.path)) this.toggle(selected.path, cx);
      else if (selected.path.includes("/")) this.selectTree(selected.path.slice(0, selected.path.lastIndexOf("/")));
    } else if (event.keystroke === "escape") run("pane.go", { direction: "left" });
    cx.notify();
  }

  scrollFile(event, cx) {
    const key = event.keystroke;
    if (!["up", "down", "left", "right", "pageup", "pagedown", "home", "end"].includes(key)) return;
    cx.stop_propagation();
    const size = terminalFontSize(), line = Math.ceil(size * 1.55);
    const preview = this.view === "preview";
    const view = preview ? this.markdown : this.sourceView;
    if (!preview && this.sourceText === null) return;
    if (key === "left" || key === "right") {
      const delta = (key === "left" ? -1 : 1) * size * .7 * 4;
      if (preview) view.moveX(view.scrollX + delta, cx);
      else { view.scrollX += delta; view.clamp(line, size * .7); cx.notify(); }
      return;
    }
    const current = preview ? view.scroll : view.scrollY;
    const page = Math.max(line, view.height || line);
    const max = preview ? view.maxScroll() : view.maxY(line);
    const next = key === "home" ? 0 : key === "end" ? max : current + (key === "up" ? -line : key === "down" ? line : key === "pageup" ? -page : page);
    if (preview) view.move(next, cx);
    else { view.scrollY = next; view.clamp(line, size * .7); cx.notify(); }
  }

  remember() {
    if (!this.context) return;
    this.saved.set(this.context.key, {folders:[...this.folders], selected:this.treeSelected, file:this.file, view:this.view});
    localStorage.setItem("files.view.v1", JSON.stringify([...this.saved].slice(-40)));
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const place = location(this.context), { cwd, on } = place, next = JSON.stringify(place);
    if (next !== this.context?.key) {
      this.remember();
      const saved = this.saved.get(next);
      this.context = { key: next, ...place }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.treeSelected = saved?.selected ?? saved?.file ?? null;
      this.pending = new Set(); this.marks = {}; this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      this.resetDocument();
      this.view = "tree";
      if (saved?.file) this.openFile(saved.file, cx, false);
      this.view = saved?.view ?? (saved?.file ? saved.mode ?? "source" : "tree");
    }
    this.refreshPreview(cx);
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    this.remember(); cx.notify();
  }

  resetDocument() {
    this.previewGeneration = (this.previewGeneration ?? 0) + 1;
    this.previewRead = null; this.loadedText = undefined;
    this.markdown.close();this.renderDocument=null;this.previewError=null;this.previewLoading=false;
    this.sourceText = null; this.file = null; this.fileError = null;
  }

  openFile(path, cx, remember = true) {
    if (!path) return;
    if (this.file !== path) this.resetDocument();
    this.file = path; this.view = "source"; this.treeSelected = path;
    this.previewLoading = this.loadedText === undefined;
    if (remember) this.remember();
    if (cx) { this.refreshPreview(cx); cx.notify(); }
  }

  refreshPreview(cx) {
    if (!this.file || !this.root || !this.current(this.context) || this.previewRead) return;
    const path = this.file, context = this.context, root = this.root, on = this.on;
    const request = this.previewRead = {};
    const generation = this.previewGeneration = (this.previewGeneration ?? 0) + 1;
    cx.spawn(async cx => {
      let changed = false;
      const current = () => this.previewRead === request && this.file === path && this.current(context) && this.previewGeneration === generation;
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (!current()) return;
        if (text === this.loadedText) return;
        if (text === null || text.includes("\0")) {
          this.loadedText = text; this.renderDocument = null; this.previewError = null;
          this.sourceText = null; this.markdown.close();
          this.fileError = text === null ? "This file is no longer available" : "Binary file · no text preview";
          changed = true;
          return;
        }
        const sourceText = text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text;
        let document = null, error = null;
        try { document = await prepareDocument(text, path); }
        catch (cause) { error = String(cause); }
        if (!current()) return;
        // One commit boundary: no shared document state changes before the
        // captured context/path/generation has survived the final await.
        this.loadedText = text; this.sourceText = sourceText;
        this.renderDocument = document; this.previewError = error; this.fileError = null;
        const sourceDocument = document && !document.sourceTruncated ? document : { source: { lines: [], columns: 0 } };
        this.sourceView.setDocument(sourceDocument, sourceText, JSON.stringify([context.key,path]), generation);
        if (/\.(md|markdown|mdown|mkd|mkdn)$/i.test(path)) {
          this.markdown.setDocument(sourceText,{space:context.space,on,root,path},cx,true,document);
        }
        changed = true;
      } catch {
        if (current()) {
          this.loadedText = undefined; this.sourceText = null; this.markdown.close();
          this.renderDocument = null; this.previewError = null;
          this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; changed = true;
        }
      } finally {
        if (this.previewRead === request) this.previewRead = null;
        if (this.previewGeneration === generation) this.previewLoading = false;
        if (changed) cx.notify();
      }
    });
  }

  close() { this.previewGeneration = (this.previewGeneration ?? 0) + 1; this.markdown.close(); }

  previewBody(cx, t) {
    const look=fileLook();
    if (this.view === "preview" && this.sourceText !== null) {
      return this.markdown.render(cx,{theme:look.document,family:"Helvetica Neue",size:Math.max(14,terminalFontSize())});
    }
    if(this.sourceText!==null&&this.sourceText!==undefined)return v_flex().flex_1().min_h(0).bg(t.background)
      .when(Boolean(this.renderDocument?.sourceTruncated),element=>element.child(div().px(10).py(4).flex_none().text_size(11).text_color(t.dim).child("Large file · highlighting limited")))
      .when(Boolean(this.previewError),element=>element.child(div().px(10).py(4).flex_none().text_size(11).text_color(t.dim).child("Highlighter unavailable · plain text")))
      .child(div().flex_1().min_h(0).child(this.sourceView.render(cx,{theme:look.document,family:settings().font_family,size:terminalFontSize()})));
    return v_flex().flex_1().min_h(0).bg(t.background).text_color(t.foreground)
      .child(div().p(12).text_color(t.dim).child(this.fileError || (this.previewLoading ? "Loading file…" : "No preview")));
  }

  treeRow(entry, t) {
      const { path, depth } = entry, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      return h_flex().id(`file-${path}`).h(Math.max(28,Math.ceil(terminalFontSize()+10))).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
        .bg(this.treeSelected === path ? t.selected : "#00000000").hover(s => s.bg(t.hover))
        .on_click((_event, cx) => { this.focusPanel(cx); this.openTreeEntry(path, cx); })
        .child(entry.dir ? svg(`mods/main-clean-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/main-clean-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark)));
  }

  render(cx) {
    if (key(this.context) !== this.context?.key) this.refresh(cx);
    const t = fileLook().palette;
    const treeRows = this.visibleEntries();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(terminalFontSize())
      .track_focus(this.panelFocus).on_key_down((event, liveCx) => this.handleKeyDown(event, liveCx))
      .child(h_flex().h(terminalHeaderHeight()).text_size(12).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .when(this.view !== "tree", el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.focusPanel(cx); this.showTree(cx); }).child("←")))
        .child(div().font_medium().child("Files"))
        .when(this.view !== "tree" && /\.(md|markdown|mdown|mkd|mkdn)$/i.test(this.file ?? ""), el => el.child(div().id("files-view-preview").px(5).py(2).rounded(3).cursor_pointer()
          .bg(this.view === "preview" ? t.selected : "#00000000").text_color(this.view === "preview" ? t.accent : t.dim)
          .on_click((_e, cx) => { this.focusPanel(cx); this.togglePreview(cx); }).child("Preview")))
        .when(this.view === "preview" && this.markdown.hasToc(), el => el.child(div().id("files-toggle-toc").px(5).py(2).rounded(3).cursor_pointer()
          .bg(this.markdown.showToc ? t.selected : "#00000000").text_color(this.markdown.showToc ? t.accent : t.dim)
          .on_click((_e, cx) => { this.markdown.showToc = !this.markdown.showToc; this.markdown.tocHeight = 0; cx.notify(); }).child("TOC")))
        .when(Boolean(this.file) && this.previewLoading, el => el.child(div().text_color(t.dim).child("…")))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child((this.view !== "tree" ? this.file : null) ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .when(this.view === "tree", el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .children(treeRows.map(entry => this.treeRow(entry, t)))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(this.view !== "tree", el => el.child(this.previewBody(cx, t)));
  }
}
