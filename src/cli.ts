import { Command } from 'commander';
import { registerExtractCommand } from './cli/extract.js';
import { registerStructureCommand } from './cli/structure.js';
import { VERSION } from './version.js';

const program = new Command();

program
  .name('filecrystal')
  .description(
    'Universal file parser for PDFs, images, xlsx/xls, docx. ' +
      'Two-step pipeline: `extract` (raw parse → Markdown) + `structure` (LLM field extraction).',
  )
  .version(VERSION);

registerExtractCommand(program);
registerStructureCommand(program);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error('[filecrystal]', err.message);
  process.exit(1);
});
