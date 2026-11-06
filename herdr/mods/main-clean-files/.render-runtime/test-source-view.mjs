import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import {columns,offsetAtColumn,columnAtOffset,wordRange} from "../source-model.js";
import {captureLineScroll,restoreLineScroll} from "../scroll-state.js";

const source=(await readFile(new URL("../source-view.js",import.meta.url),"utf8"))
  .replace(/^import .*$/gm,"")
  .replace("export class SourceView","class SourceView")
  .replace(/export const sourceColumns[^;]*;/g,"")+";SourceView;";
const SourceView=vm.runInNewContext(source,{columns,offsetAtColumn,columnAtOffset,wordRange,captureLineScroll,restoreLineScroll,Math,JSON,String,Array,Map,Set});
let copied="",stopped=0,notified=0,focused=0;
const cx={
  focus_handle:()=>({focus(){focused++}}),
  write_to_clipboard:value=>{copied=value},
  stop_propagation(){stopped++},
  notify(){notified++},
};
const view=new SourceView(cx);
const text="alpha path/file.cpp:42\n中文😀 line\nthird";
const lines=text.split("\n").map(line=>[[line,{color:"#111"},{color:"#eee"}]]);
view.setDocument({source:{lines,columns:40}},text,"fixture");
view.height=200;view.width=600;
const event=(x,y,count=1)=>({local_position:{x,y},click_count:count,modifiers:{}});
view.mouseDown(event(58+8+5,5),cx,26,10);
view.mouseMove(event(58+8+30,26*2+5),cx,26,10);
view.dragging=false;
view.keyDown({keystroke:"cmd-c"},cx);
assert(copied.includes("\n中文😀 line\n"));
assert(focused>0&&stopped>0&&notified>0);

const pathOffset=text.indexOf("file.cpp")+2;
const pathColumn=columnAtOffset(text.split("\n")[0],pathOffset);
view.mouseDown(event(58+8+pathColumn*10,5,2),cx,26,10);
view.keyDown({keystroke:"cmd-c"},cx);
assert.equal(copied,"path/file.cpp:42");

view.keyDown({keystroke:"cmd-a"},cx);
view.keyDown({keystroke:"cmd-c"},cx);
assert.equal(copied,text);
view.keyDown({keystroke:"escape"},cx);
assert.equal(view.selectedText(),"");

const kept=new SourceView(cx),lineHeight=26;
kept.lineHeight=lineHeight;kept.scrollY=lineHeight+7;kept.scrollX=41;
kept.setDocument({source:{lines,columns:40}},text,"same-file",1);
kept.scrollY=lineHeight+7;kept.scrollX=41;
const inserted="inserted one\ninserted two\n"+text;
const insertedLines=inserted.split("\n").map(line=>[[line,{color:"#111"},{color:"#eee"}]]);
kept.setDocument({source:{lines:insertedLines,columns:40}},inserted,"same-file",2);
assert.equal(kept.scrollY,3*lineHeight+7);
assert.equal(kept.scrollX,41);
kept.setDocument({source:{lines,columns:40}},text,"different-file",1);
assert.equal(kept.scrollY,0);
assert.equal(kept.scrollX,0);

console.log("PASS: SourceView selection/copy and same-file logical scroll retention; different files reset");
