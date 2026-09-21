# Neovim VS Code editing mode

`lua/vscode_mode.lua` makes ordinary file buffers behave like a conventional
editor while leaving special buffers such as NvimTree in their native mode.

- Opens files directly in Insert mode and returns to it after Escape.
- Saves modified files 200 ms after typing stops and immediately on focus or
  buffer changes.
- Adds Ctrl+S, Ctrl+Z, Ctrl+Y, Ctrl+F, Ctrl+A, Ctrl+C, Ctrl+X, and Ctrl+V.
- F12 toggles between VS Code editing mode and normal Vim navigation mode.

Add the directory to Neovim's runtime path and load the module:

```lua
vim.opt.rtp:prepend(vim.fn.expand("~/Documents/my-pi-extensions/nvim"))
require("vscode_mode").setup()
```
