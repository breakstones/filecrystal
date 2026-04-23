---
'filecrystal': minor
---

`filecrystal extract` now accepts `.zip` archives and already-text inputs
transparently.

- **zip inputs** are expanded into a same-named sibling directory
  (`docs/bundle.zip` → `docs/bundle/`), and every supported file inside
  is routed through the usual parse pipeline. Nested zips are preserved
  on disk but not recursed (safety + zip-bomb avoidance); each produces
  a warning. Entries with path-traversal or absolute-path names are
  rejected (zip-slip defense). Output `.md` files land next to their
  extracted source.
- **text passthroughs** (`.md` / `.markdown` / `.txt`) — whether passed
  directly on the command line or found inside a zip — skip the parser
  entirely and are reported as `{ ok: true, durationMs: 0, message:
  "Already a text file" }` in the summary. No file is rewritten.
- mixed inputs (e.g. `a.pdf notes.md bundle.zip`) are fully supported;
  the summary preserves the user's original argv order with zip entries
  slotted after their parent in alphabetical order.
- summary JSON gains an optional `archives[]` top-level field documenting
  each zip's extraction target, counts (`expanded` / `passthrough`) and
  warnings.

Runtime: adds `jszip ^3.10.1` as a direct dependency.
