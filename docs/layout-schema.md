# Layout schema

Per-project workspace layout stored at `~/.dancode/projects/<slug>/layout.json`.
Owned by the server, served via:

- `GET /api/projects/:slug/layout` — returns the saved layout (default if none).
- `PUT /api/projects/:slug/layout` — replaces the layout. Validates schema;
  unknown fields → `400`.

Writes are atomic: the server writes to `layout.json.tmp.<rand>`, calls
`fsync`, then renames over `layout.json`. Concurrent writes are serialized
per-slug inside the process; the final file always parses cleanly and matches
exactly one of the inputs.

## Top-level shape

```jsonc
{
  "terminals": [ /* TerminalRef */ ],
  "openFiles": [ /* OpenFile */ ],
  "splits":    { /* SplitTree */ },
  "focusedPane": "pane-id"
}
```

The following four keys are the only ones allowed at the top level. Any other
top-level key causes `PUT` to return `400`. `GET` additionally annotates the
response with `missingFiles: [...]` listing any `openFiles` whose `path` no
longer resolves to a file inside the project root.

### TerminalRef

```jsonc
{
  "id":              "uuid-or-stable-id",       // required, non-empty string
  "cwd":             "/abs/path",               // optional string
  "command":         "claude --skip-perms",     // optional string|null
  "claudeSessionId": "abc123-...",              // optional string|null
  "background":      false,                     // optional boolean
  "label":           "CLI"                      // optional string
}
```

Only the listed keys are accepted; extras → `400`.

### OpenFile

```jsonc
{
  "path":      "src/index.js",   // required, non-empty string (relative to project root)
  "pane":      "pane-id",        // required, non-empty string
  "scrollTop": 120               // optional number
}
```

### SplitTree

A recursive tree of nodes describing the workspace's pane layout. Three node
types:

**Leaf** — a single pane that holds either a terminal or an open file (the
pane id is the link).

```jsonc
{ "type": "leaf", "id": "pane-id" }
```

**Split** — a horizontal or vertical split with ≥2 children. `ratio` is the
fractional size of the first child (between 0 and 1).

```jsonc
{
  "type": "split",
  "direction": "vertical" | "horizontal",
  "ratio": 0.5,
  "children": [ /* SplitTree */, /* SplitTree */, ... ]
}
```

**Tabs** — a tabbed container with ≥1 children and an optional `active` index.

```jsonc
{
  "type": "tabs",
  "active": 0,
  "children": [ /* SplitTree */, ... ]
}
```

### focusedPane

The `id` of the currently focused leaf node. Required, non-empty string.

## Default layout

When `layout.json` does not exist, `GET` returns:

```json
{
  "terminals": [],
  "openFiles": [],
  "splits": { "type": "leaf", "id": "root" },
  "focusedPane": "root",
  "missingFiles": []
}
```

## When the client writes

The client persists the layout (debounced 500ms for noisy events) whenever
any of the following occurs:

- A terminal is added, closed, or moved.
- A file is opened or closed.
- A split is added, removed, or resized.
- The focused pane changes.
- A file's scroll position changes.

## Missing files

If `layout.json` references a file that has been deleted on disk, the project
still loads. The pane that would have shown the file displays a yellow banner
(`[data-testid="missing-file-warning"]`): "File &lt;path&gt; no longer exists."
Clicking the banner's Close button removes that entry from `openFiles` and
saves a fresh layout via `PUT`.
