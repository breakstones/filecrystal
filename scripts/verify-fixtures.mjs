#!/usr/bin/env node
// Light check that committed fixtures stay small enough to bundle in git.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1024 * 1024; // 1 MB
const dir = 'tests/fixtures';

let bad = 0;
for (const name of readdirSync(dir)) {
  const p = join(dir, name);
  const s = statSync(p);
  if (!s.isFile()) continue;
  if (s.size > MAX_BYTES) {
    console.error(`[verify-fixtures] ${p} is ${s.size} bytes > ${MAX_BYTES}`);
    bad++;
  }
}

if (bad > 0) {
  console.error(`[verify-fixtures] ${bad} oversize fixture(s); move large samples out of git.`);
  process.exit(1);
}
console.error('[verify-fixtures] ok');
