import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildDocument} from "./worker.mjs";
import {filesLook} from "../files-appearance.js";

const base={background:"#222222",foreground:"#eeeeee",surface:"#333333",chrome:"#111111",border:"#444444",accent:"#5599ff",muted:"#aaaaaa",dim:"#888888"};
const lightCss=await readFile(new URL("./node_modules/github-markdown-css/github-markdown-light.css",import.meta.url),"utf8");
const darkCss=await readFile(new URL("./node_modules/github-markdown-css/github-markdown-dark.css",import.meta.url),"utf8");
assert(lightCss.includes("color: #1f2328")&&lightCss.includes("background-color: #ffffff"));
assert(darkCss.includes("color: #f0f6fc")&&darkCss.includes("background-color: #0d1117"));
assert.equal(filesLook("light",base,true).document.markdown.foreground,"#1f2328");
assert.equal(filesLook("dark",base,false).document.markdown.background,"#0d1117");

const tick=String.fromCharCode(96);
const markdown=[
  "---","type: feat","component: demo","---",
  "# 中文 Heading",
  "",
  "**bold** *italic* ~~strike~~ "+tick+"inline"+tick+" [link](https://example.com)",
  "",
  "- [x] done","- [ ] todo",
  "",
  "> quote",
  "",
  "| left | right |","| --- | ---: |","| A | "+tick+"B"+tick+" |",
  "",
  tick.repeat(3)+"ts","const count: number = 16.5; // comment",tick.repeat(3),
  "",
  tick.repeat(3)+"cpp","namespace demo {","","/**"," * comment"," */","struct Warp {","  bool resident = false;","};",tick.repeat(3),
  "",
  "![image](data:image/png;base64,aGVsbG8=)",
  "<script>steal()</script>",
].join("\n");
const doc=await buildDocument({text:markdown,path:"docs/README.md"});
assert.equal(doc.version,2);
assert.equal(doc.markdown,true);
assert.equal(doc.source.language,"text.md");
assert.equal(doc.source.lines.map(line=>line.map(token=>token[0]).join("")).join("\n"),markdown);
assert(new Set(doc.source.lines.flat().map(token=>token[1].color)).size>2);
assert(doc.blocks.some(block=>block.kind==="heading"));
assert(doc.blocks.some(block=>block.kind==="table"));
assert(doc.blocks.some(block=>block.kind==="list"));
assert(doc.blocks.some(block=>block.kind==="quote"));
assert(doc.blocks.some(block=>block.kind==="code"&&block.language==="source.ts"));
assert(doc.blocks.some(block=>block.kind==="image"));
assert.equal(JSON.stringify(doc.blocks).includes("<script>"),false);
const structLine=markdown.split("\n").indexOf("struct Warp {");
const structToken=doc.source.lines[structLine].find(token=>token[0]==="struct");
assert(structToken,"embedded C++ must remain highlighted after a blank line and block comment");
assert.equal(structToken[1].color,"#cf222e");

for(const[path,code,scope]of[
  ["a.py","def greet():\n    return '中文'","source.python"],
  ["a.cpp","#include <vector>\nint main(){return 0;}","source.c++"],
  ["a.rs","fn main(){let x=42;}","source.rust"],
  ["a.json",'{"ok":true}',"source.json"],
]){
  const rendered=await buildDocument({text:code,path});
  assert.equal(rendered.source.language,scope);
  assert.equal(rendered.source.lines.map(line=>line.map(token=>token[0]).join("")).join("\n"),code);
  assert(new Set(rendered.source.lines.flat().map(token=>token[1].color)).size>1,path);
}

const unknown=await buildDocument({text:"plain <literal>",path:"a.unknown"});
assert.equal(unknown.source.language,"text");
assert.equal(unknown.source.lines[0][0][0],"plain <literal>");
const huge=await buildDocument({text:"x".repeat(130000),path:"a.js"});
assert.equal(huge.truncated,true);
assert.equal(huge.sourceTruncated,true);
assert.equal(huge.source.lines[0].map(token=>token[0]).join("").length,120000);

console.log("PASS: GitHub Linguist path resolution, starry-night light/dark tokens, GFM blocks, images, Unicode and limits");
