# Herdr main-clean customization

Portable snapshot of the current `main-clean` layout and its three custom mods.
These are Herdr app mods; no application rebuild is required.

## Included

- `layouts/main-clean.json` and its preview SVG: terminal border/focus ring and bottom status bar removed, freed space filled by the terminal, horizontal padding 14 px and vertical padding 0, default font size 16.5.
- `mods/main-clean-chrome`: compact sidebar chrome and settings entry.
- `mods/main-clean-settings`: decimal font-size input and independent Files appearance controls.
- `mods/main-clean-files`: selectable read-only source, GitHub-style light/dark syntax highlighting, Markdown preview, TOC, tables and images. Same-file refresh retains the visible content position in Source and Preview.
- `keys.json`: Cmd+PageUp/PageDown selects agents, Cmd+1–9 selects tabs, Cmd+B toggles the sidebar, Cmd+, opens the custom settings mod.

The layout uses Herdr's built-in `spaces`, `agents`, `tabs`, `pane` and `changes` mods. Built-in dependencies should come from the installed Herdr version. Generated GPUI declarations are kept with the custom mods as their API snapshot.

No machine registrations, hostnames, workspace/session IDs, project paths, terminal history, settings.json, live view state, caches or installed Node dependencies are included. The layout has no preselected document. Fonts and the app theme remain the user's own choices; Files can use its own light/dark appearance.

## Install

Requires the Herdr desktop app, Node.js 18+ and npm. This snapshot was made from customizations based on Herdr 0.1.12; later app versions may change the mod API.

Preview the file operations:

```sh
node herdr/install.mjs --dry-run
```

Install from the repository root:

```sh
node herdr/install.mjs
```

The installer backs up existing destination files under the app config's `backups/`, copies only this layout and the three custom mods, merges the shortcut overrides, removes old next/previous-tab bindings, and installs the pinned renderer dependencies with `npm ci --ignore-scripts`. Unrelated settings and mods are preserved. Select **main-clean** in Herdr's layout picker afterwards. Installing into a running app can hot-reload the changed mods.

For a different config directory:

```sh
node herdr/install.mjs --config-dir /path/to/herdr-app
```

`--skip-deps` copies the files without running npm. Renderer dependencies must then be installed separately under `mods/main-clean-files/.render-runtime`.

## Verify the snapshot

```sh
npm ci --prefix herdr/mods/main-clean-files/.render-runtime --ignore-scripts --no-audit --no-fund
node herdr/verify.mjs
```

After installation, the app can also check the installed mods with `herdr-app check <config-dir>/mods/main-clean-files` (and likewise for the other two mods). The automated tests use fixtures and temporary files, not live terminals.

## Implementation and limits

Starry Night resolves languages from GitHub Linguist metadata. Marked parses GFM; fenced blocks are independently highlighted using their declared language, then merged back into Source rows. Markdown images support HTTP(S), data URLs, local paths and remote-relative paths through `hc`.

The custom source view is read-only. Documents above its configured size/line limits use Herdr's native read-only Editor. Preview is a native GPUI block renderer, not an embedded browser; it does not execute HTML or JavaScript from documents, and selection depends on native TextView support. The refresh-position tests cover the custom Source/Preview views.

Node renderer dependencies and their licenses are recorded in `.render-runtime/package-lock.json`. The bundled `markdown-it` 14.1.0 browser build in `.markdown-runtime/vendor/markdown-it.js` is MIT-licensed; its copyright notice is in `THIRD_PARTY_NOTICES.md`.
