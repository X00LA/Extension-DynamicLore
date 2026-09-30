import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Node 20 on Windows does not expand test globs; pass concrete paths on all hosts.
const root = fileURLToPath(new URL('../', import.meta.url));
const files = readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.js'));
const result = spawnSync(process.execPath, ['--test', ...files.map(name => path.join(root, 'tests', name))], { stdio: 'inherit' });
process.exit(result.status ?? 1);
