// The site build imports esbuild and sharp directly, so every deployment needs
// the locked packages on disk. Git-based builds install them before the build
// command runs, but other deploy paths (such as a source upload) do not, and the
// build then fails on a missing package instead of a missing install step.
// Install from the lockfile only when something declared is absent, so a build
// that already has its packages pays nothing.
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
const present = async (name) => {
  try {
    await access(new URL(`node_modules/${name}/package.json`, root));
    return true;
  } catch {
    return false;
  }
};
const missing = [];
for (const name of declared) if (!(await present(name))) missing.push(name);
if (!missing.length) {
  console.log('Build packages already installed.');
} else {
  const hasLockfile = await access(new URL('package-lock.json', root)).then(() => true, () => false);
  console.log(`Installing build packages, missing: ${missing.join(', ')}`);
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    hasLockfile ? 'ci' : 'install', '--no-audit', '--no-fund',
  ], { cwd: root, stdio: 'inherit', timeout: 300000 });
  const stillMissing = [];
  for (const name of declared) if (!(await present(name))) stillMissing.push(name);
  if (stillMissing.length) throw new Error(`Install did not provide: ${stillMissing.join(', ')}`);
  console.log('Build packages installed.');
}
