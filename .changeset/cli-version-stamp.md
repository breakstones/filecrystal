---
"filecrystal": patch
---

Fix: `filecrystal --version` / `-V` now returns the actual installed
package version instead of the hardcoded `0.1.0` it shipped with since
v0.1.0. The CLI and `ResolvedConfig.parserVersion` (surfaced on every
`ParseResult.parserVersion`) both resolve the version at runtime from
the shipped `package.json`, so every release auto-stamps itself.

Before (on v0.5.0): `npx filecrystal -V` → `0.1.0`.
After  (on v0.5.1): `npx filecrystal -V` → `0.5.1`.
