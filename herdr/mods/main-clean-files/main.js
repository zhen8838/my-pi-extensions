// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { filesLook, FILES_APPEARANCE_KEY } from "./files-appearance.js";
import { MarkdownPreview } from "./preview-native.js";
import { SourceView } from "./source-view.js";
import { prepareDocument } from "./render-client.js";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, layout, nextCommand, shared, setShared } from "herdr";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const PER_FOLDER = 500, TOTAL = 5000;
function terminalFontSize() { const n=Number(settings().font_size); return Number.isFinite(n)&&n>0?n:14; }
function fileLook() { return filesLook(shared(FILES_APPEARANCE_KEY), theme(), settings().dark); }
function languageFor(path){return path.includes(".")?path.split(".").pop().toLowerCase():"txt"}
function syntaxColors(dark) {
  return dark
    ? {keyword:"#ff7b72",string:"#a5d6ff",comment:"#8b949e",function:"#d2a8ff",type:"#ffa657",number:"#79c0ff",constant:"#79c0ff",variable:"#c9d1d9",operator:"#ff7b72",punctuation:"#c9d1d9",boolean:"#79c0ff","string.escape":"#7ee787"}
    : {keyword:"#cf222e",string:"#0a3069",comment:"#6e7781",function:"#8250df",type:"#953800",number:"#0550ae",constant:"#0550ae",variable:"#24292f",operator:"#cf222e",punctuation:"#24292f",boolean:"#0550ae","string.escape":"#116329"};
}
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
    this.markdown = new MarkdownPreview();
    this.sourceView = new SourceView(cx);
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command.startsWith("open:")) this.show(command.slice(5), cx);
        else if (command === "source" || command === "preview") { this.previewMode = command; this.remember(); }
        else if (command === "back") this.show(null);
        else if (command.startsWith("appearance:")) {
          const mode = command.slice(11);
          if (["app", "light", "dark"].includes(mode)) {
            setShared(FILES_APPEARANCE_KEY, mode === "app" ? null : mode);
            this.refreshStyle(cx);
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
    cx.timer.every(2000, cx => { this.refreshStyle(cx); this.refreshPreview(cx); });
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
    return this.context === context && key() === context.key;
  }

  remember() {
    if (!this.context) return;
    this.saved.set(this.context.key, {folders:[...this.folders], file:this.file, mode:this.previewMode});
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
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      this.remember();
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      this.show(saved?.file ?? null, cx, false);
      this.previewMode = saved?.mode ?? "source";
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

  show(path, cx, remember = true) {
    const sameFile = this.file === path;
    this.previewGeneration = (this.previewGeneration ?? 0) + 1;
    this.previewRead = null; this.loadedText = undefined;
    this.code?.release(); this.code = null; this.codeText = null; this.editorSignature = null;
    this.markdown.close();this.renderDocument=null;this.previewError=null;this.previewLoading=Boolean(path);
    if (!sameFile) this.previewMode = "source";
    this.sourceText = null; this.file = path; this.fileError = null;
    if (remember) this.remember();
    if (path && cx) this.refreshPreview(cx);
  }

  rebuildCode() {
    if (!this.file || this.sourceText === null || this.sourceText === undefined) return;
    this.code?.release();
    this.code = null; this.codeText = null; this.editorSignature = null;
    this.updateCode(this.sourceText, this.file);
  }

  refreshStyle(cx) {
    if (!this.code || !this.file) return;
    const signature=JSON.stringify([languageFor(this.file),settings().font_family,terminalFontSize(),settings().dark]);
    if (signature !== this.editorSignature) { this.rebuildCode(); cx.notify(); }
  }

  updateCode(value, path) {
    const family=settings().font_family,size=terminalFontSize(),language=languageFor(path),dark=settings().dark;
    const signature=JSON.stringify([language,family,size,dark]);
    if (!this.code || signature !== this.editorSignature) {
      this.code?.release();
      this.code = EditorState.new({ value, language, readonly:true, font_family:family, font_size:size,
        line_numbers:true,folding:true,soft_wrap:false,syntax:syntaxColors(dark)});
      this.editorSignature = signature;
      this.codeText = value;
    } else if (value !== this.codeText) {
      this.code.set_value(value);
      this.codeText = value;
    }
  }

  refreshPreview(cx) {
    if (!this.file || !this.root || !this.current(this.context) || this.previewRead) return;
    const path = this.file, context = this.context, root = this.root, on = this.on;
    const request = this.previewRead = {};
    cx.spawn(async cx => {
      let generation, changed = false;
      const current = () => this.file === path && this.current(context) && this.previewGeneration === generation;
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.previewRead !== request || this.file !== path || !this.current(context)) return;
        this.previewRead = null;
        if (text === this.loadedText) return;
        this.loadedText = text;
        generation = this.previewGeneration = (this.previewGeneration ?? 0) + 1;
        changed = true; this.fileError = null; this.previewError = null;
        if (text === null || text.includes("\0")) {
          this.code?.release(); this.code = null; this.sourceText = null; this.markdown.close();
          this.fileError = text === null ? "This file is no longer available" : "Binary file · no text preview";
          return;
        }
        this.sourceText = text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text;
        this.updateCode(this.sourceText, path);
        try{
          const document=await prepareDocument(text,path);
          if(current()){
            this.renderDocument=document;
            this.sourceView.setDocument(document,this.sourceText,JSON.stringify([context.key,path]),generation);
          }
        }catch(error){if(current())this.previewError=String(error)}
        if (/\.(md|markdown|mdown|mkd|mkdn)$/i.test(path)) {
          this.markdown.setDocument(this.sourceText,{space:location().space,on,root,path},cx,true,this.renderDocument);
        }
      } catch {
        if (this.previewRead === request && this.file === path && this.current(context)) {
          generation = this.previewGeneration = (this.previewGeneration ?? 0) + 1;
          this.loadedText = undefined; this.code?.release(); this.code = null; this.sourceText = null; this.markdown.close();
          this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; changed = true;
        }
      } finally {
        if (this.previewRead === request) this.previewRead = null;
        if (this.previewGeneration === generation) this.previewLoading = false;
        if (changed) cx.notify();
      }
    });
  }

  close() { this.previewGeneration = (this.previewGeneration ?? 0) + 1; this.code?.release(); this.markdown.close(); }

  previewBody(cx, t) {
    const look=fileLook();
    if (/\.(md|markdown|mdown|mkd|mkdn)$/i.test(this.file ?? "") && this.previewMode === "preview" && this.sourceText !== null) {
      return this.markdown.render(cx,{theme:look.document,family:"Helvetica Neue",size:Math.max(14,terminalFontSize())});
    }
    if(this.renderDocument&&!this.renderDocument.sourceTruncated&&!this.previewError)return this.sourceView.render(cx,{theme:look.document,family:settings().font_family,size:terminalFontSize()});
    if(this.code){const app=theme();return v_flex().flex_1().min_h(0).bg(app.background).text_color(app.foreground)
      .when(Boolean(this.renderDocument?.sourceTruncated),element=>element.child(div().px(10).py(4).flex_none().text_size(11).text_color(app.dim).child("Large file · native viewer")))
      .when(Boolean(this.previewError),element=>element.child(div().px(10).py(4).flex_none().text_size(11).text_color(app.dim).child("Highlighter unavailable · native viewer")))
      .child(Editor.new(this.code).flex_1().min_h(0));}
    return v_flex().flex_1().min_h(0).bg(t.background).text_color(t.foreground)
      .child(div().p(12).text_color(t.dim).child(this.fileError || (this.previewLoading ? "Loading file…" : "No preview")));
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(Math.max(28,Math.ceil(terminalFontSize()+10))).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/main-clean-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/main-clean-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = fileLook().palette;
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(terminalFontSize())
      .child(h_flex().h(terminalHeaderHeight()).text_size(12).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_medium().child("Files"))
        .when(Boolean(this.file) && /\.(md|markdown|mdown|mkd|mkdn)$/i.test(this.file), el => el.child(div().id("files-view-preview").px(5).py(2).rounded(3).cursor_pointer()
          .bg(this.previewMode === "preview" ? t.selected : "#00000000").text_color(this.previewMode === "preview" ? t.accent : t.dim)
          .on_click((_e, cx) => { this.previewMode = this.previewMode === "preview" ? "source" : "preview"; this.remember(); cx.notify(); }).child("Preview")))
        .when(Boolean(this.file) && this.previewMode === "preview" && this.markdown.hasToc(), el => el.child(div().id("files-toggle-toc").px(5).py(2).rounded(3).cursor_pointer()
          .bg(this.markdown.showToc ? t.selected : "#00000000").text_color(this.markdown.showToc ? t.accent : t.dim)
          .on_click((_e, cx) => { this.markdown.showToc = !this.markdown.showToc; this.markdown.tocHeight = 0; cx.notify(); }).child("TOC")))
        .when(Boolean(this.file) && this.previewLoading, el => el.child(div().text_color(t.dim).child("…")))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.previewBody(cx, t)));
  }
}
