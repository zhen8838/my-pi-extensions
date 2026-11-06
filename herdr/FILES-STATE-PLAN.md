# Files panel state and focus refactor

## Contract

- Files owns one stable keyboard focus handle on its root, across tree, Source, loading, errors and Preview.
- Enter and clicking a file use one open operation. Opening changes document/view state, never tab/pane selection or keyboard focus.
- Focusing Files preserves its current view, document, selection and scroll. Returning to the tree is a separate operation.
- Tree arrows select entries; Enter opens/toggles; Source/Preview arrows scroll; Escape from either document view returns to the tree.
- Source/Preview Left/Right scroll horizontally. Tree Left/Right retains directory navigation. Preview horizontal scrolling must have one explicit owner, including wide code blocks/tables.
- Cmd+1–N selects and focuses the corresponding tab's pane. Cmd+(N+1) focuses Files without changing its internal state.
- File reads, highlighting, image preparation and periodic refresh never focus anything. Stale requests cannot change current content.
- The file tree remains an ordinary scrollable list. No virtual list, restart, terminal input or live-window automation is introduced.

## Responsibilities

1. `Files.view`: `tree`, `source`, or `preview`; `file` is the retained document identity, not an implicit view switch.
2. Document content fields: text, prepared render document, loading/error, request generation. They are updated together only for the captured current request.
3. `focusPanel(cx)`: focus only the stable root. `showTree(cx)` changes the view and preserves the retained document. `openFile(path,cx)` changes the document/view and starts loading. `togglePreview(cx)` changes the view only.
4. `handleKeyDown`: consume recognized navigation keys before changing view. Delegate Source selection/copy keys to SourceView without a second focus handle.
5. SourceView: text, tokens, selection and scroll only. Its pointer handler activates the owning panel; it does not create or focus a disappearing child view.
   The native Editor exposes no scroll/focus method through this API. Source therefore keeps the existing bounded read-only SourceView for highlighted and plain-text fallback alike; highlighter failure/limits change token coverage, not keyboard ownership. Preserve the existing 400,000-character display bound.
6. Workspace context: bind to the active space and terminal location while a terminal is focused. Internal Files focus cannot change cwd/machine; an external space/pane change can.
7. Tab bar: route explicit external navigation only. Normal file opening does not invoke tab or pane commands.

## Implementation order

1. Separate the view from document identity and replace the overloaded focus/show methods.
2. Retain the root handle throughout file opening and mode changes; route mouse and keyboard opening through the same function.
3. Capture context/path/generation at read start, prepare results locally, and commit once after the final validity check; serialize one read per current document. Cancel on context/document changes and close.
4. Anchor context across internal focus changes and preserve legacy saved view state on first load.
5. Update tests to execute the real open/load functions with controlled asynchronous reads. Do not stub opening or count focus calls as proof of native attachment.
6. Validate the repository copy, back up the active files, then deploy only the changed custom mods and inspect runtime errors/read-only screenshot.

## Verification

- Tree Enter: root retains focus, Source is not focused before mounting, Enter is consumed first, and no tab/pane command is issued.
- Slow reads and failures: the loading/error body stays inside the same focused panel.
- Source/Preview focus: document, view and scroll are unchanged.
- Source/Preview Escape: tree selection and expanded folders survive; reopening is functional.
- Source Cmd+A/C and pointer selection: exact text copy still works with the single root focus owner.
- Rapid A→B, context switch during highlight, close during read: late results are discarded; late Markdown cannot reuse a new file's text with an old target.
- Refresh in tree and document views: no implicit view changes or focus stealing; Source/Preview scroll retention tests remain green.
- Cmd+(N+1)→Cmd+1: explicit pane focus remains in the tab controller; Enter is unrelated to it.
- Run `node herdr/verify.mjs`, `herdr-app check` for Files and Tabs, and inspect the running app's status. A mock is not reported as a native keyboard reproduction.

## Delivery boundaries

The repo already has uncommitted keyboard changes from this session; preserve them. Do not commit/push unless requested. Keep published material free of machine names, personal paths and live workspace IDs. Live user tabs, agents and terminals are not test fixtures.

## Status

- Code refactor and automatic verification completed; deployed to the custom Files mod with a recoverable backup.
- Verified real open/load methods against a controlled mounted-root lifecycle, stale-request cancellation, error paths, selection/copy, Source/Preview scroll retention and both scroll axes.
- `node herdr/verify.mjs`, native Files/Tabs checks, and `node herdr/check-surfaces.mjs` passed. Read-only live screenshots show the selected source document loaded successfully; runtime errors/overlays are empty.
- Native keyboard replay was not performed against the user's working window. The controlled lifecycle test and native construction checks are reported separately, without claiming that a real Enter/Cmd key sequence was replayed.
