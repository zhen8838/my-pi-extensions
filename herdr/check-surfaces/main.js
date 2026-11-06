// Native construction check only; this view is never installed into the user's layout.
import { View } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { filesLook } from "./files-appearance.js";
import { SourceView } from "./source-view.js";
import { MarkdownPreview } from "./preview-native.js";

export default class SurfaceCheck extends View {
  init(_props, cx) {
    this.focus = cx.focus_handle();
    this.source = new SourceView(cx, () => this.focus.focus());
    this.preview = new MarkdownPreview();
    const line = "const example = " + "value + ".repeat(40) + "0;";
    const tokens = [[line, { color: "#cf222e" }, { color: "#ff7b72" }]];
    const document = { version: 2, source: { columns: line.length, lines: [tokens] }, blocks: [
      { kind: "heading", depth: 1, runs: [{ text: "Surface check" }] },
      { kind: "code", language: "js", columns: line.length, lines: [tokens] },
      { kind: "table", header: [[{ text: "Column one" }], [{ text: "Column two" }]], rows: [[[{ text: "left" }], [{ text: "right" }]]], align: [null, null] },
    ] };
    this.source.setDocument(document, line, "fixture");
    this.preview.setDocument("# Surface check", { space: "fixture", root: "/fixture", path: "example.md" }, cx, true, document);
  }
  render(cx) {
    const look = filesLook("light", {}, false), options = { theme: look.document, family: "JetBrains Mono", size: 16.5 };
    return h_flex().w(1200).h(500).track_focus(this.focus)
      .child(v_flex().w(600).h(500).child(this.source.render(cx, options)))
      .child(v_flex().w(600).h(500).child(this.preview.render(cx, options)));
  }
}
