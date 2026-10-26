// Parses every source module as an ES module: catches syntax errors without a
// browser. Bare specifiers ("three") are resolved by the import map at runtime,
// so parsing is the right level of check here.
// Run via `npm run check` (which passes --experimental-vm-modules).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';

const dir = 'src';
let bad = 0;
for (const f of (await readdir(dir)).sort()) {
  if (!f.endsWith('.js')) continue;
  const file = join(dir, f);
  const src = await readFile(file, 'utf8');
  try {
    new vm.SourceTextModule(src, { identifier: file });
    console.log(`ok   ${file}`);
  } catch (e) {
    bad++;
    console.log(`FAIL ${file}: ${e.message}`);
  }
}
process.exit(bad ? 1 : 0);
