# Neovim configuration

This directory holds a portable Neovim setup and the
`vscode_mode` module it loads.

## Full configuration

`init.lua` and `lazy-lock.json` provide a complete `~/.config/nvim` setup
(Neovim 0.12, lazy.nvim). It is tuned for browsing and reading large
repositories:

- nvim-tree (gitignored files visible), telescope, diffview
- markview.nvim for in-buffer Markdown rendering
- snacks.image for real inline images (Kitty graphics protocol)
- tree-sitter highlighting from Neovim's bundled parsers, no nvim-treesitter
- `vscode_mode` loaded from `lua/vscode_mode.lua`

Deploy the snapshot and restart Neovim:

```bash
ssh user@host 'mkdir -p ~/.config/nvim/lua'
scp nvim/init.lua nvim/lazy-lock.json user@host:~/.config/nvim/
scp nvim/lua/vscode_mode.lua user@host:~/.config/nvim/lua/
```

On a machine where the plugins are not installed yet:

```bash
ssh user@host 'nvim --headless "+Lazy! install" "+qa"'
```

### Markdown preview

`markview.nvim` renders headings, tables, checkboxes, callouts and LaTeX in
place. Insert mode is configured as hybrid: only the block under the cursor
shows raw Markdown, the rest stays rendered.

- `<leader>mp` toggles rendering, `<leader>mh` toggles hybrid mode
- `:Markview splitToggle` opens a scroll-synced source/preview split
- `snacks.image` draws actual bitmaps inline and works with Ghostty over SSH.
  PNG needs no extra tools; jpg/webp/gif/pdf need ImageMagick
- `:checkhealth snacks` reports terminal detection. If Ghostty is not detected
  through SSH, set `SNACKS_GHOSTTY=true`

### Leaving insert mode

Escape returns to insert mode by design. Press `F12` to switch to normal Vim
navigation, then `:q!`. From insert mode without switching, `Ctrl-o :q!` or
`Ctrl-C` followed by `:q!` also works. The autosave has already persisted the
buffer, so `:q!` is safe.

## vscode_mode module

`lua/vscode_mode.lua` makes ordinary file buffers behave like a conventional
editor while leaving special buffers such as NvimTree in their native mode.

- Opens files directly in Insert mode and returns to it after Escape.
- Saves modified files 200 ms after typing stops and immediately on focus or
  buffer changes.
- Adds macOS Cmd+S/Z/Shift+Z/F/A/C/X/V shortcuts, with Ctrl equivalents for
  remote terminals and non-macOS hosts.
- F12 toggles between VS Code editing mode and normal Vim navigation mode.

On the local macOS config, add the directory to Neovim's runtime path and load
the module:

```lua
vim.opt.rtp:prepend(vim.fn.expand("~/Documents/my-pi-extensions/nvim"))
require("vscode_mode").setup()
```

Ghostty consumes Cmd+A/F/Z by default. On macOS, add these entries to its
configuration so Neovim receives them through the terminal keyboard protocol:

```ini
keybind = super+a=unbind
keybind = super+f=unbind
keybind = super+z=unbind
keybind = super+shift+z=unbind
```
