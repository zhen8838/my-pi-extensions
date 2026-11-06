import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = (await readFile(new URL("../main.js", import.meta.url), "utf8"))
  .replace(/^import .*$/gm, "")
  .replace("export default class Files", "class Files") + "\nFiles;";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function environment(read, storage = new Map()) {
  const jobs = [];
  const workspace = { cwd:"/root", on:"remote", space:"s" };
  let markdownUpdates=0,highlightUpdates=0,notifies=0;
  const highlightIdentities=[],highlightRevisions=[];
  class MarkdownPreview {
    constructor() { this.doc={blocks:[]}; this.showToc=true; }
    close() {}
    setDocument() { markdownUpdates++; }
  }
  class SourceView {
    setDocument(_document,_text,identity,revision){highlightUpdates++;highlightIdentities.push(identity);highlightRevisions.push(revision);}
  }
  const context = vm.createContext({
    View:class {}, Map, Set, JSON, Math, Number, Boolean, String, Error,
    MarkdownPreview,SourceView,
    prepareDocument:async text=>({version:2,source:{lines:text.split("\n").map(line=>[[line,{color:"#111"},{color:"#eee"}]]),columns:20},blocks:[],truncated:false}),
    filesLook:(_value,t,dark)=>({dark:Boolean(dark),palette:t,document:{dark:Boolean(dark),source:{},markdown:{}}}),
    FILES_APPEARANCE_KEY:"appearance",
    shared:()=>null, setShared(){},
    theme:()=>({background:"#fff",foreground:"#111",dim:"#777"}),
    settings:()=>({font_size:16.5,font_family:"mono",dark:false}),
    spaces:()=>[{active:true,id:workspace.space,folder:workspace.cwd,machine:workspace.on}],
    focused:()=>({pane:"p",cwd:workspace.cwd}),
    panes:()=>[{pane:"p",cwd:workspace.cwd}],
    layout:()=>({}), window:()=>({platform:"macos"}),
    readTextFile:read,
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
  });
  const Files = vm.runInContext(source, context);
  const files = new Files();
  Object.assign(files, {
    markdown:new MarkdownPreview(),sourceView:new SourceView(),root:"/root",on:"remote",saved:new Map(),folders:new Set(),
    entries:new Map(), pending:new Set(), marks:{},
    context:{key:JSON.stringify(workspace),...workspace},
  });
  const cx = {spawn(body){jobs.push(body(cx));},notify(){notifies++;}};
  const drain = async () => { for (let i=0;i<jobs.length;i++) await jobs[i]; };
  return {files,cx,drain,storage,Files,markdownUpdates:()=>markdownUpdates,highlightUpdates:()=>highlightUpdates,
    highlightIdentities:()=>highlightIdentities,highlightRevisions:()=>highlightRevisions,notifies:()=>notifies};
}

{
  let text = "# first";
  const e = environment(async()=>text);
  e.files.openFile("chosen.md",e.cx);
  await e.drain();
  assert.equal(e.files.file,"chosen.md");
  assert.equal(e.files.sourceText,"# first");
  assert.equal(e.markdownUpdates(),1);
  assert.equal(e.highlightUpdates(),1);
  const oldNotify=e.notifies();
  e.files.refreshPreview(e.cx);
  await e.drain();
  assert.equal(e.markdownUpdates(),1);
  assert.equal(e.highlightUpdates(),1);
  assert.equal(e.notifies(),oldNotify);
  text="# second";
  e.files.refreshPreview(e.cx);
  await e.drain();
  assert.equal(e.files.sourceText,"# second");
  assert.equal(e.markdownUpdates(),2);
  assert.equal(e.highlightUpdates(),2);
  assert.equal(e.highlightIdentities()[0],e.highlightIdentities()[1]);
  assert.notEqual(e.highlightRevisions()[0],e.highlightRevisions()[1]);
  assert.equal(e.files.file,"chosen.md");
  console.log("PASS: unchanged polling is inert; changed Markdown updates Source and Preview without switching files");
}

{
  const a=deferred(), b=deferred();
  const e=environment(path=>path.endsWith("a.md")?a.promise:b.promise);
  e.files.openFile("a.md",e.cx);
  await Promise.resolve();
  e.files.openFile("b.md",e.cx);
  await Promise.resolve();
  b.resolve("B"); a.resolve("A");
  await e.drain();
  assert.equal(e.files.file,"b.md");
  assert.equal(e.files.sourceText,"B");
  console.log("PASS: stale async reads cannot replace the later file");
}

{
  let text="ok";
  const e=environment(async()=>text);
  e.files.openFile("kept.md",e.cx);
  e.files.view="preview";
  e.files.folders.add("src");
  e.files.remember();
  await e.drain();
  const saved=JSON.parse(e.storage.get("files.view.v1"));
  assert.equal(saved[0][1].file,"kept.md");
  assert.equal(saved[0][1].view,"preview");
  assert.deepEqual(saved[0][1].folders,["src"]);
  text=null;
  e.files.refreshPreview(e.cx);
  await e.drain();
  assert.match(e.files.fileError,/no longer/);
  text="restored";
  e.files.refreshPreview(e.cx);
  await e.drain();
  assert.equal(e.files.sourceText,"restored");
  console.log("PASS: view state persists and deleted/recreated files recover at the same path");
}

{
  const e=environment(async()=>"binary\0data");
  e.files.openFile("x.bin",e.cx);
  await e.drain();
  assert.equal(e.files.sourceText,null);
  assert.match(e.files.fileError,/Binary/);
  console.log("PASS: binary files remain bounded read-only errors");
}
