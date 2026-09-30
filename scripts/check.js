import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.version, pkg.version);
assert.match(manifest.minimum_client_version, /^\d+\.\d+\.\d+$/);
for (const file of [manifest.js, manifest.css, 'LICENSE']) await access(path.join(root, file));
const sources = ['index.js', ...(await readdir(path.join(root, 'src'))).filter(f => f.endsWith('.js')).map(f => `src/${f}`)];
for (const file of sources) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
    const text = await readFile(path.join(root, file), 'utf8');
    assert.ok(!/\b(?:ctx|context|c)\(\)?\.worldInfo\b/.test(text), `Nonexistent World Info context API in ${file}`);
    for (const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) await access(path.resolve(root, path.dirname(file), match[1]));
}
console.log(`Validated ${sources.length} modules, local imports, manifest assets, and version ${manifest.version}.`);
