// Minimal createFileParser example. Run with:
//   node examples/basic/index.mjs
import { createFileParser } from 'filecrystal';

const parser = createFileParser({ mode: 'mock' });
const result = await parser.parse('./tests/fixtures/sample.xlsx');
console.log(JSON.stringify(result, null, 2));
