import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import {captureBlockScroll,restoreBlockScroll} from "../scroll-state.js";

const source=(await readFile(new URL("../preview-native.js",import.meta.url),"utf8"))
  .replace(/^import .*$/gm,"")
  .replace("export class MarkdownPreview","class MarkdownPreview")+"\nMarkdownPreview;";
const MarkdownPreview=vm.runInNewContext(source,{
  captureBlockScroll,restoreBlockScroll,
  collectMarkdownImages:()=>[],prepareMarkdownImages:async source=>({source}),prepareDocument:async()=>({blocks:[]}),
  headingSlug:value=>value,Math,JSON,String,Array,Map,Set,Number,Boolean,RegExp,
});
const paragraph=text=>({kind:"paragraph",runs:[{text}]});
const document=blocks=>({version:2,blocks,source:{lines:[],columns:0}});
const target={space:"space",on:"machine",root:"/repo",path:"doc.md"};
let notified=0;
const cx={notify(){notified++},spawn(){throw Error("prepared documents must not spawn")}};

{
  const preview=new MarkdownPreview();
  const before=[paragraph("first"),paragraph("keep this block"),paragraph("after")];
  preview.setDocument("old",target,cx,true,document(before));
  preview.heights=[80,120,90];preview.total=338;preview.height=100;preview.layoutPending=false;
  preview.scroll=24+80+17;
  const after=[paragraph("inserted"),...before];
  preview.setDocument("new",target,cx,true,document(after));
  assert.equal(preview.scroll,121,"same-file replacement must not clear scroll before measurement");
  [60,80,120,90].forEach((height,index)=>preview.measure(index,height,cx));
  assert.equal(preview.scroll,24+60+80+17,"same block and intra-block offset must be restored");
}

{
  const preview=new MarkdownPreview();
  const before=[paragraph("first"),paragraph("keep"),paragraph("after")];
  preview.setDocument("old",target,cx,true,document(before));
  preview.heights=[100,100,100];preview.total=348;preview.height=100;preview.layoutPending=false;preview.scroll=140;
  preview.setDocument("new",target,cx,true,document([paragraph("inserted"),...before]));
  preview.move(180,cx,true);
  [60,100,100,100].forEach((height,index)=>preview.measure(index,height,cx));
  assert.equal(preview.scroll,180,"manual scrolling during refresh must win over the stale anchor");
}

{
  const preview=new MarkdownPreview();
  preview.setDocument("one",target,cx,true,document([paragraph("one"),paragraph("two")]));
  preview.heights=[100,100];preview.total=248;preview.height=100;preview.layoutPending=false;preview.scroll=90;
  preview.setDocument("other",{...target,path:"other.md"},cx,true,document([paragraph("other")]));
  assert.equal(preview.scroll,0,"a different file must still start at the top");
}

assert(notified>0);
{
  const preview=new MarkdownPreview();
  const code={kind:"code",language:"text",columns:200,lines:[[ ["a long line",{},{}] ]]};
  preview.setDocument("wide",target,cx,true,document([code]));
  preview.width=500;preview.contentWidth=preview.canvasWidth(16.5);
  assert(preview.contentWidth>2000,"wide code must contribute to the document's horizontal extent");
  preview.moveX(120,cx);assert.equal(preview.scrollX,120);
  const oldY=preview.scroll;
  preview.moveX(100000,cx);assert.equal(preview.scrollX,preview.maxScrollX());
  assert.equal(preview.scroll,oldY,"horizontal movement must not change vertical position");
  preview.moveX(-1,cx);assert.equal(preview.scrollX,0);
  preview.moveX(120,cx);
  preview.setDocument("wide updated",target,cx,true,document([code]));
  assert.equal(preview.scrollX,120,"same-file refresh retains the horizontal position");
  preview.setDocument("other",{...target,path:"other.md"},cx,true,document([paragraph("other")]));
  assert.equal(preview.scrollX,0,"different file resets horizontal position");
}
console.log("PASS: Markdown refresh preserves block position, respects manual scroll, and resets on file change");
