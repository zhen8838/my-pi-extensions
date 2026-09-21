local M = {}

local function editable_buffer(bufnr)
  return vim.api.nvim_buf_is_valid(bufnr)
    and vim.bo[bufnr].buftype == ""
    and vim.bo[bufnr].modifiable
    and not vim.bo[bufnr].readonly
    and vim.api.nvim_buf_get_name(bufnr) ~= ""
end

function M.setup(options)
  local opts = vim.tbl_extend("force", {
    autosave_delay_ms = 200,
  }, options or {})

  local group = vim.api.nvim_create_augroup("VscodeMode", { clear = true })
  local keymap_opts = { silent = true }
  local pending_save = {}
  local edit_mode = true

  local function save_buffer(bufnr)
    if not editable_buffer(bufnr) or not vim.bo[bufnr].modified then
      return
    end

    vim.api.nvim_buf_call(bufnr, function()
      local ok, message = pcall(vim.cmd, "silent update")
      if not ok then
        vim.notify("Autosave failed: " .. tostring(message), vim.log.levels.WARN)
      end
    end)
  end

  local function schedule_save(args)
    local bufnr = args.buf
    pending_save[bufnr] = (pending_save[bufnr] or 0) + 1
    local generation = pending_save[bufnr]

    vim.defer_fn(function()
      if pending_save[bufnr] == generation then
        save_buffer(bufnr)
      end
    end, opts.autosave_delay_ms)
  end

  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "TextChangedP" }, {
    group = group,
    callback = schedule_save,
  })

  vim.api.nvim_create_autocmd({ "InsertLeave", "BufLeave", "FocusLost", "VimLeavePre" }, {
    group = group,
    callback = function(args)
      pending_save[args.buf] = (pending_save[args.buf] or 0) + 1
      save_buffer(args.buf)
    end,
  })

  local function start_editing(args)
    if not edit_mode or not editable_buffer(args.buf) then
      return
    end

    vim.schedule(function()
      if edit_mode and args.buf == vim.api.nvim_get_current_buf() and editable_buffer(args.buf) then
        vim.cmd.startinsert()
      end
    end)
  end

  vim.api.nvim_create_autocmd({ "BufWinEnter", "BufEnter", "WinEnter" }, {
    group = group,
    callback = start_editing,
  })

  local escape_namespace = vim.api.nvim_create_namespace("VscodeModeEscape")
  vim.on_key(nil, escape_namespace)
  vim.on_key(function(key)
    if not edit_mode or key ~= "\27" or vim.fn.getcmdtype() ~= "" then
      return
    end

    vim.schedule(function()
      local bufnr = vim.api.nvim_get_current_buf()
      local mode = vim.api.nvim_get_mode().mode
      if edit_mode and editable_buffer(bufnr) and mode:find("^[nvV\22sS\19]") then
        vim.cmd.startinsert()
      end
    end)
  end, escape_namespace)

  local function toggle_edit_mode()
    edit_mode = not edit_mode
    if edit_mode and editable_buffer(vim.api.nvim_get_current_buf()) then
      vim.cmd.startinsert()
      vim.notify("VS Code editing mode")
    else
      vim.cmd.stopinsert()
      vim.notify("Vim navigation mode")
    end
  end

  vim.keymap.set({ "n", "i", "v", "s" }, "<F12>", toggle_edit_mode, {
    silent = true,
    desc = "Toggle VS Code/Vim editing mode",
  })

  vim.keymap.set({ "n", "i", "v", "s" }, "<C-s>", function()
    save_buffer(vim.api.nvim_get_current_buf())
  end, { silent = true, desc = "Save file" })

  vim.keymap.set("i", "<C-z>", "<C-o>u", keymap_opts)
  vim.keymap.set("n", "<C-z>", "u", keymap_opts)
  vim.keymap.set("i", "<C-y>", "<C-o><C-r>", keymap_opts)
  vim.keymap.set("n", "<C-y>", "<C-r>", keymap_opts)
  vim.keymap.set("i", "<C-f>", "<C-o>/", { desc = "Find" })
  vim.keymap.set("n", "<C-f>", "/", { desc = "Find" })

  -- Select mode replaces the selection when normal text is typed, like GUI editors.
  vim.keymap.set({ "i", "n" }, "<C-a>", function()
    vim.cmd.stopinsert()
    vim.cmd("normal! ggVG")
    vim.api.nvim_feedkeys(vim.keycode("<C-g>"), "nx", false)
  end, keymap_opts)
  vim.keymap.set("x", "<C-c>", '"+y<Cmd>startinsert<CR>', keymap_opts)
  vim.keymap.set("s", "<C-c>", '<C-g>"+y<Cmd>startinsert<CR>', keymap_opts)
  vim.keymap.set("x", "<C-x>", '"+d<Cmd>startinsert<CR>', keymap_opts)
  vim.keymap.set("s", "<C-x>", '<C-g>"+d<Cmd>startinsert<CR>', keymap_opts)
  vim.keymap.set("i", "<C-v>", "<C-r>+", keymap_opts)
  vim.keymap.set("n", "<C-v>", "i<C-r>+", keymap_opts)
end

return M
