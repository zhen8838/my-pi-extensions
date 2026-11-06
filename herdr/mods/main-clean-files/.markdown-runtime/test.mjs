import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  collectMarkdownImages,
  headingOffset,
  imageRequest,
  parseMarkdownDocument,
  rewriteMarkdownImages,
} from "../markdown-model.js";
import { filesLook } from "../files-appearance.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const inherited={background:"#123456",foreground:"#abcdef",surface:"#222222",border:"#333333"};
assert.equal(filesLook("app",inherited,true).palette.background,"#123456");
assert.equal(filesLook("light",inherited,true).palette.background,"#ffffff");
assert.equal(filesLook("light",inherited,true).palette.foreground,"#24292f");
assert.equal(filesLook("dark",inherited,false).palette.background,"#24292e");
assert.equal(filesLook("dark",inherited,false).palette.foreground,"#e1e4e8");
assert.equal(filesLook("light",inherited,true).document.source.gutterBackground,"#f6f8fa");
assert.equal(filesLook("light",inherited,true).document.markdown.tableBodyBackground,"#ffffff");
assert.equal(filesLook("dark",inherited,false).document.markdown.tableBodyBackground,"#0d1117");
const source = `# 中文 heading

[TOC]

## Repeat

###### Deep heading

Text with **bold**, [link](https://example.com), and \`inline\`.

| A | B |
|---|---|
| 一 | two |

![local](../images/a%20b.png)

![reference][remote]

[remote]: https://example.test/a.png

<img src="data:image/png;base64,${png}" alt="inline data">

<img src="https://example.test/html.png?x=1&amp;y=2" alt="HTML URL">

\`\`\`md
# not a heading
![not-an-image](ignored.png)
\`\`\`

## Repeat
`;

const doc = parseMarkdownDocument(source);
assert.deepEqual(doc.toc.map(item => item.slug), ["中文-heading", "repeat", "deep-heading", "repeat-1"]);
assert.equal(doc.toc.find(item=>item.slug==="deep-heading").level,6);
assert.equal(doc.blocks.some(block => /\[TOC\]/i.test(block.markdown)), false);
assert(doc.blocks.some(block => block.markdown.includes("| A | B |")));
assert(doc.blocks.some(block => block.markdown.includes("not a heading")));
assert(doc.blocks.every(block => typeof block.markdown === "string" && block.markdown.length));

const images = collectMarkdownImages(source);
assert.equal(images.length, 4);
assert.equal(images.some(image => image.src === "ignored.png"), false);
const target = { root:"/repo", path:"docs/readme.md", on:"box" };
assert.deepEqual(imageRequest(target, images[0], "a"), {
  id:"a", original:"../images/a%20b.png", path:"/repo/images/a b.png", on:"box",
});
assert.equal(imageRequest(target, images[1], "b").url, "https://example.test/a.png");
assert.equal(imageRequest(target, images[3], "html").url, "https://example.test/html.png?x=1&y=2");
assert.equal(imageRequest(target, {src:"javascript:alert(1)"}, "c").error, "Unsupported image address");

const rewritten = rewriteMarkdownImages(source, [
  { original:"../images/a%20b.png", dataUrl:`data:image/png;base64,${png}` },
  { original:"https://example.test/a.png", error:"HTTP 404" },
  { original:`data:image/png;base64,${png}`, dataUrl:`data:image/png;base64,${png}` },
]);
assert(rewritten.includes(`data:image/png;base64,${png}`));
assert(rewritten.includes("Image unavailable"));
assert(rewritten.includes("HTTP 404"));
const heights = doc.blocks.map((_block, index) => 10 + index);
const lastHeading = doc.toc.find(item => item.slug === "repeat-1");
assert.equal(headingOffset(doc.toc, "repeat-1", heights, 14), 14 + heights.slice(0, lastHeading.index).reduce((a,b)=>a+b,0));

const work = await mkdtemp(path.join(tmpdir(), "herdr-markdown-worker-"));
const request = path.join(work, "request.json");
await writeFile(request, JSON.stringify({ cacheDir:path.join(work,"cache"), items:[{id:"data",data:`data:image/png;base64,${png}`}] }));
const workerPath = await realpath(new URL("./asset-worker.mjs", import.meta.url));
const worker = spawnSync(process.execPath, [workerPath, request], { encoding:"utf8" });
assert.equal(worker.status, 0, worker.stderr);
const result = JSON.parse(worker.stdout);
assert.equal(result.images[0].width, 1);
assert.equal(result.images[0].height, 1);
assert.equal((await readFile(result.images[0].path)).length > 0, true);

const main = await readFile(new URL("../main.js", import.meta.url), "utf8");
const preview = await readFile(new URL("../preview-native.js", import.meta.url), "utf8");
const sourceView = await readFile(new URL("../source-view.js", import.meta.url), "utf8");
assert(main.includes("EditorState.new({ value, language, readonly:true"));
assert(main.includes("Editor.new(this.code)"));
assert(main.includes("new SourceView(cx)"));
assert(main.includes("prepareDocument(text,path)"));
assert(preview.includes("TextView.markdown"));
assert(preview.includes(".selectable(true)"));
assert(preview.includes("tableBodyBackground"));
assert(sourceView.includes("write_to_clipboard"));
assert(sourceView.includes("gutterBackground"));
assert.equal(main.includes("preparePreview"), false);
assert.equal(preview.includes("Copy"), false);
assert.equal(main.includes("openOverlay"), false);
assert.equal(main.includes("hc read"), false);

console.log("PASS: custom themed Source, native fallback, selectable Preview, TOC, GitHub surfaces, image fallback and no Copy controls");
