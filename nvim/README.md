# Neovim VS Code editing mode

`lua/vscode_mode.lua` makes ordinary file buffers behave like a conventional
editor while leaving special buffers such as NvimTree in their native mode.

- Opens files directly in Insert mode and returns to it after Escape.
- Saves modified files 200 ms after typing stops and immediately on focus or
  buffer changes.
- Adds macOS Cmd+S/Z/Shift+Z/F/A/C/X/V shortcuts, with Ctrl equivalents for
  remote terminals and non-macOS hosts.
- F12 toggles between VS Code editing mode and normal Vim navigation mode.

Add the directory to Neovim's runtime path and load the module:

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
