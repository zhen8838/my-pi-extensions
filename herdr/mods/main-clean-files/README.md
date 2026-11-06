# main-clean-files

Personal native Files panel for the main-clean layout.

## Rendering

- Source: @wooorm/starry-night 3.11.0 resolves the full file path through GitHub Linguist metadata and returns HAST tokens. The mod draws GitHub light/dark tokens, its own gutter, and a read-only selection/copy model. Highlighter failure or limits fall back to plain text in the same SourceView, bounded to 400,000 characters plus a truncation marker.
- Markdown: Marked 18.1.3 produces GFM blocks. Tables, quotes, code and inline runs are native GPUI elements using colors generated from github-markdown-css 5.9.0. Text selection uses native TextView participants where layout permits it; fenced code and Source preserve exact raw text for copy.
- Images: HTTP(S), data, local and remote-relative images are cached under the app cache, with bounded size and explicit failure text.

All helper processes are short-lived local Node processes. They do not execute document code and do not modify Herdr's application theme.

The panel root owns keyboard focus in tree, Source, loading/error and Preview. Opening, returning to the tree and asynchronous refresh change state without transferring focus. Left/Right scrolls Source/Preview horizontally; Up/Down scrolls vertically. Escape returns a document view to its tree without destroying the retained document.

## Validation

Run:

    herdr-app check ~/.config/herdr-app/mods/main-clean-files
    node ~/.config/herdr-app/mods/main-clean-files/.render-runtime/test-render.mjs
    node ~/.config/herdr-app/mods/main-clean-files/.render-runtime/test-source.mjs
    node ~/.config/herdr-app/mods/main-clean-files/.render-runtime/test-source-view.mjs
    node ~/.config/herdr-app/mods/main-clean-files/.markdown-runtime/test-assets.mjs
    node ~/.config/herdr-app/mods/main-clean-files/.markdown-runtime/test-refresh.mjs
