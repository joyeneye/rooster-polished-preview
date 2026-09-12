// A function that fails to parse is dropped by the bundler and the deploy still
// succeeds, so the endpoint simply disappears from production with no error.
// That is how /api/mona/chat came to return 404 on a green build. Parse every
// function here and fail the build loudly instead.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';

const root = new URL('../netlify/functions/', import.meta.url);

async function sourceFiles(dir, base = '') {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await sourceFiles(new URL(`${entry.name}/`, dir), rel));
    else if (/\.(mts|ts|mjs|js)$/.test(entry.name)) found.push({ rel, url: new URL(entry.name, dir) });
  }
  return found;
}

const files = await sourceFiles(root);
const broken = [];
for (const file of files) {
  const contents = await readFile(file.url, 'utf8');
  const loader = file.rel.endsWith('js') ? 'js' : 'ts';
  try {
    await transform(contents, { loader, format: 'esm' });
  } catch (error) {
    broken.push(`${file.rel}: ${error.errors?.[0]?.text ?? error.message}`);
  }
}

if (broken.length) {
  console.error(`\n${broken.length} function source file(s) cannot be parsed and would be silently dropped from the deploy:\n`);
  for (const line of broken) console.error(`  - ${line}`);
  console.error('');
  throw new Error('Refusing to build: a function that cannot be parsed never reaches production.');
}

console.log(`Function parse check passed: ${files.length} files.`);
