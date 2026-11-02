-- nvim —— 以「浏览 + 阅读 + 顺手改」为目标的配置。没有 LSP，不跑后台索引。
-- 典型用法：`nvim ~/zqh/TileFoundry-<某个 worktree>` 打开就是树 + 编辑区。

local lazypath = vim.fn.stdpath('data') .. '/lazy/lazy.nvim'
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({'git', 'clone', '--filter=blob:none', 'https://github.com/folke/lazy.nvim.git', lazypath})
end
vim.opt.rtp:prepend(lazypath)

vim.g.mapleader = ' '

-- 远端没有 pbcopy/xclip；显式走 OSC 52，把 yank 经 Herdr/Ghostty 写进本机剪贴板。
-- 必须放在插件加载前，避免 clipboard provider 先按远端环境完成自动探测。
vim.g.clipboard = 'osc52'

require('lazy').setup({
  {
    'nvim-tree/nvim-tree.lua',
    version = '*',
    dependencies = { 'nvim-tree/nvim-web-devicons' },
    config = function()
      require('nvim-tree').setup({
        view = { width = 25, side = 'right' },
        -- 被 .gitignore 忽略的东西照样显示：foreman 的 local/、TileFoundry 的
        -- docs/plans/ 与 CLAUDE.local.md 都是 gitignored，而那正是最常要改的地方。
        -- 代价是 .venv 与各种 cache 也会冒出来，那些单独藏掉（vim regex，不是 lua pattern）。
        -- build/ 与 test_results/ 留着 —— 偶尔要翻产物。
        filters = {
          dotfiles = false,
          git_ignored = false,
          custom = {
            [[^\.git$]], [[^\.venv$]], [[^__pycache__$]],
            [[^\.pytest_cache$]], [[^\.ruff_cache$]], [[^\.mypy_cache$]],
          },
        },
        git = { enable = true },
        -- 光标停在哪个 buffer，树就跟到哪 —— VSCode 的行为
        update_focused_file = { enable = true },
        renderer = {
          group_empty = true,      -- a/b/c 这种独苗链折成一行
          highlight_git = 'name',  -- 改过的文件名变色
          indent_markers = { enable = true },
        },
      })
      vim.keymap.set('n', '<C-n>', ':NvimTreeToggle<CR>', { desc = '开关文件树' })
      vim.keymap.set('n', '<C-b>', ':NvimTreeFocus<CR>', { desc = '聚焦文件树' })
    end,
  },

  {
    'nvim-telescope/telescope.nvim',
    version = '*',
    dependencies = { 'nvim-lua/plenary.nvim' },
    config = function()
      local tel = require('telescope')
      tel.setup({
        defaults = {
          -- 大仓库里这些目录搜出来只是噪音
          file_ignore_patterns = { '%.git/', '%.venv/', 'build/', '__pycache__/',
                                   'third_party/', '%.pyc$', '%.so$' },
          path_display = { 'truncate' },
        },
        pickers = {
          -- 跟文件树一致：gitignored 与点文件都要能搜到（docs/plans 才找得着）
          find_files = { hidden = true, no_ignore = true },
          live_grep = { additional_args = { '--hidden', '--no-ignore' } },
        },
      })
      local b = require('telescope.builtin')
      vim.keymap.set('n', '<C-p>', b.find_files,  { desc = '找文件' })
      vim.keymap.set('n', '<C-f>', b.live_grep,   { desc = '全文搜' })
      vim.keymap.set('n', '<leader>fb', b.buffers, { desc = '已开的 buffer' })
      vim.keymap.set('n', '<leader>fr', b.resume,  { desc = '回到上次搜索' })
      vim.keymap.set('n', '<leader>fw', b.grep_string, { desc = '搜光标下的词' })
    end,
  },

  {
    -- Typora 式原地渲染：正常模式全渲染，insert 时只有光标所在块显源码。
    -- 与 render-markdown.nvim 二选一（同时开会重复画 extmark）。
    'OXY2DEV/markview.nvim',
    lazy = false,
    opts = {
      preview = {
        modes = { 'n', 'no', 'c', 'i' },
        hybrid_modes = { 'i' },
      },
      -- 图片位图交给 snacks.image，这里只保留文字渲染，避免叠两层。
      markdown_inline = {
        images = { enable = false },
      },
    },
    config = function(_, opts)
      require('markview').setup(opts)
      vim.keymap.set('n', '<leader>mp', ':Markview Toggle<CR>', { desc = 'Markdown 渲染开关' })
      vim.keymap.set('n', '<leader>mh', ':Markview HybridToggle<CR>', { desc = 'Hybrid 编辑开关' })
    end,
  },

  {
    -- markview 负责文字渲染，snacks.image 负责真图（kitty graphics，Ghostty 支持）。
    -- PNG 不需要额外依赖；jpg/webp 等要 ImageMagick。
    'folke/snacks.nvim',
    lazy = false,
    priority = 1000,
    opts = {
      image = {
        doc = { enabled = true, inline = true, float = false },
      },
    },
  },

  {
    'sindrets/diffview.nvim',
    config = function()
      vim.keymap.set('n', '<leader>gd', ':DiffviewOpen<CR>', { desc = 'Git diff' })
      vim.keymap.set('n', '<leader>gh', ':DiffviewFileHistory<CR>', { desc = 'File history' })
      vim.keymap.set('n', '<leader>gc', ':DiffviewClose<CR>', { desc = 'Close diff' })
    end,
  },
})

-- ── 编辑器基础 ──────────────────────────────────────────────────────────────
vim.opt.number = true
vim.opt.relativenumber = false  -- 绝对行号，不要从光标处往两头数
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.expandtab = true
vim.opt.mouse = 'a'
vim.opt.termguicolors = true

vim.opt.ignorecase = true
vim.opt.smartcase = true      -- 全小写时不分大小写，打了大写就精确匹配
vim.opt.scrolloff = 5
vim.opt.signcolumn = 'yes'    -- 有没有 git 标记都占一列，免得正文左右跳
vim.opt.splitright = true
vim.opt.splitbelow = true
vim.opt.undofile = true       -- 关掉 nvim 再打开，undo 历史还在

-- 所有普通 yank（y/yy）都写入上面指定的 OSC 52 系统剪贴板。
vim.opt.clipboard = 'unnamedplus'

-- ── 顺手的键 ────────────────────────────────────────────────────────────────
vim.keymap.set('n', '<Esc>', ':nohlsearch<CR>', { silent = true, desc = '清掉搜索高亮' })
vim.keymap.set('n', '<leader>w', ':w<CR>', { desc = '保存' })

-- 高亮：全部走 nvim 0.12 内置的 treesitter，不装 nvim-treesitter 插件。
--   parser 与 query 放在 ~/.local/share/nvim/site/{parser,queries}/（已编译好的一份）。
--   markdown / markdown_inline / lua 用 nvim 自带的那份，不覆盖。
-- 为什么不用插件：master 分支的 query_predicates.lua 在 0.12 上会炸
--   （treesitter.lua:197 attempt to call method 'range'，render-markdown 解析围栏时踩到）；
--   main 分支又要求另装 tree-sitter-cli。搬 parser 进 site 是最省的一条路。
-- 加语言：编译好 <lang>.so 丢进 site/parser/，query 丢进 site/queries/<lang>/，
--   再把 filetype 加进下面的 pattern。注意 query 只能用 nvim 内置的 predicate
--   （set! offset! gsub! trim! / eq? any-of? lua-match? match? contains? has-parent? has-ancestor?）。
-- pcall 兜着 —— 某个语言缺 parser 时只是退回默认高亮，不弹错。
vim.api.nvim_create_autocmd('FileType', {
  pattern = { 'python', 'cpp', 'cuda', 'lua', 'markdown', 'toml',
              'json', 'yaml', 'sh', 'bash', 'diff' },
  callback = function() pcall(vim.treesitter.start) end,
})

-- 一次 `:q` 就退干净。默认行为很烦：关掉文件窗口后只剩一个文件树挂在那，
-- 还得再按一次；裸开 nvim 时剩的是一个空 buffer，同理。
-- 规则：除当前窗口外，剩下的如果全是「树」或「没名字的空 buffer」，就一起收掉。
-- 真的还开着别的文件时不动手 —— 那时 `:q` 本来就该只关一个窗口。
local function disposable(win)
  local buf = vim.api.nvim_win_get_buf(win)
  local name = vim.api.nvim_buf_get_name(buf)
  if name:match('NvimTree_') then return true end
  return name == ''
    and not vim.bo[buf].modified
    and vim.api.nvim_buf_line_count(buf) == 1
    and vim.api.nvim_buf_get_lines(buf, 0, 1, false)[1] == ''
end

vim.api.nvim_create_autocmd('QuitPre', {
  callback = function()
    local cur, others = vim.api.nvim_get_current_win(), {}
    for _, w in ipairs(vim.api.nvim_list_wins()) do
      -- 浮动窗口（telescope 之类）不参与判断
      if w ~= cur and vim.api.nvim_win_get_config(w).relative == '' then
        if not disposable(w) then return end
        others[#others + 1] = w
      end
    end
    for _, w in ipairs(others) do pcall(vim.api.nvim_win_close, w, true) end
  end,
})

-- 开机就把文件树摆出来，四种情况都照顾到：
--   nvim              → 树开在 cwd，光标在树里，直接挑文件
--   nvim <目录>        → 树开在那个目录（跨 worktree 浏览就靠这个）
--   nvim <文件>        → 文件在右边、树在左边，光标留在文件里
--   git commit 拉起来   → 不开树（$EDITOR=nvim 之后这条很重要）
vim.api.nvim_create_autocmd('VimEnter', {
  callback = function()
    if vim.o.diff then return end                       -- nvim -d 是来看 diff 的
    local first = vim.fn.argv(0) or ''
    -- 被 git 当编辑器拉起来时别插一脚
    if first:match('COMMIT_EDITMSG$') or first:match('MERGE_MSG$')
       or first:match('TAG_EDITMSG$') or first:match('git%-rebase%-todo$') then
      return
    end
    local api = require('nvim-tree.api')
    if first == '' then
      api.tree.open({ path = vim.fn.getcwd() })
    elseif vim.fn.isdirectory(first) == 1 then
      api.tree.open({ path = first })
    else
      api.tree.open({ path = vim.fn.getcwd() })
      vim.cmd('wincmd p')                               -- 光标回到文件那一侧
    end
  end,
})

-- ── VS Code 风格编辑模式 ────────────────────────────────────────────────────
-- 打开文件即进 insert；停止输入 200ms 自动保存；F12 在 VS Code 模式与纯 Vim 导航之间切换。
-- 模块本体在 lua/vscode_mode.lua，默认放在 site 之前的 rtp 里，无需另外改 runtimepath。
-- 注意：它会覆盖上面的 <C-f>（原 telescope live_grep）为 Vim 搜索。
require("vscode_mode").setup()
