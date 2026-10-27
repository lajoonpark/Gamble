// Parses every source module as an ES module: catches syntax errors without a
// browser. Bare specifiers ("three") are resolved by the import map at runtime,
// so parsing is the right level of check here.
// Run via `npm run check` (which passes --experimental-vm-modules).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';

// GLSL lives in template literals, so a backtick or a `${` inside a shader —
// even in a comment — silently ends the literal and the file stops parsing.
// Worse, the file can still come out *balanced* and then fail confusingly, or
// break only in the browser, which is what made this cost a round trip twice.
//
// A backtick on a `//` comment line is only a bug while a template is open, so
// the scan tracks that state. Ordinary JS comments use backticks for emphasis
// all over src/, and those must not be flagged.
const templateTrap = (src) => {
  const lines = src.split('\n');
  const hits = [];
  let inTemplate = false;
  let opened = 0;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const slashes = line.indexOf('//');
    const code = slashes < 0 ? line : line.slice(0, slashes);
    const comment = slashes < 0 ? '' : line.slice(slashes);

    if (inTemplate) {
      // A closing delimiter is never indented into a comment, so anything the
      // comment carries here is stray text that ended the literal early.
      if (comment.includes('`')) {
        hits.push({ line: n + 1, what: 'backtick', text: comment.trim(), opened });
      }
      if (comment.includes('${')) {
        hits.push({ line: n + 1, what: '${', text: comment.trim(), opened });
      }
      // Resync: count delimiters in the code portion only.
      const ticks = (code.match(/`/g) || []).length;
      if (ticks % 2 === 1) { inTemplate = false; }
    } else {
      const ticks = (code.match(/`/g) || []).length;
      if (ticks % 2 === 1) { inTemplate = true; opened = n + 1; }
    }
  }
  return hits;
};

const dir = 'src';
let bad = 0;
for (const f of (await readdir(dir)).sort()) {
  if (!f.endsWith('.js')) continue;
  const file = join(dir, f);
  const src = await readFile(file, 'utf8');
  // Warn even when the file parses: a balanced-but-wrong template literal can
  // swallow code the parser never complains about.
  const traps = templateTrap(src);
  for (const hit of traps) {
    console.log(`WARN ${file}:${hit.line} comment contains ${hit.what}, which closes the `
      + `enclosing template literal: ${hit.text}`);
    bad++;
  }
  try {
    new vm.SourceTextModule(src, { identifier: file });
    if (!traps.length) console.log(`ok   ${file}`);
  } catch (e) {
    bad++;
    console.log(`FAIL ${file}: ${e.message}`);
  }
}
process.exit(bad ? 1 : 0);
