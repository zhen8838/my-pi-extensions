import assert from "node:assert/strict";
import {columns,offsetAtColumn,columnAtOffset,wordRange} from "../source-model.js";

const line="ab\t中文😀/path/file.cpp";
assert.equal(columns("ab\tc"),5);
assert.equal(columnAtOffset(line,2),2);
assert.equal(offsetAtColumn(line,2),2);
assert.equal(columnAtOffset("中文",1),2);
assert.equal(offsetAtColumn("中文",2),1);
const text="open src/a-file.cpp:42 now";
const[start,end]=wordRange(text,text.indexOf("a-file")+2);
assert.equal(text.slice(start,end),"src/a-file.cpp:42");

const raw="first\n中文😀\nthird";
const selection=raw.slice(3,raw.indexOf("third")+2);
assert.equal(selection,"st\n中文😀\nth");
assert.equal([...selection].includes("😀"),true);

console.log("PASS: source columns, tabs, CJK, emoji, path word selection and exact cross-line copy text");
