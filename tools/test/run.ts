import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { selectTests } from './selection.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: 'boolean', default: false },
    'test-shard': { type: 'string' },
    'test-concurrency': { type: 'string', default: '4' },
    'test-name-pattern': { type: 'string' },
    'test-reporter': { type: 'string' },
  },
});
const [mode = 'all', ...filters] = positionals;
const files = selectTests(
  await readdir(new URL('../../test/', import.meta.url), { recursive: true }),
  mode,
  filters,
).map((file) => `test/${file}`);

if (!files.length) {
  throw new Error(`No tests selected for ${[mode, ...filters].join(' ')}`);
}

if (values.list) {
  console.log(files.join('\n'));
  process.exit(0);
}

if (mode === 'native' && !process.env.LILYPOND_BIN) {
  console.error('test:native requires LILYPOND_BIN pointing to a native LilyPond executable.');
  process.exit(1);
}

console.log(`Running ${mode} tests (${files.length} files before sharding).`);
const loader = createRequire(import.meta.url).resolve('tsx/esm');
const options = Object.entries(values)
  .filter(([key, value]) => key !== 'list' && value !== undefined)
  .map(([key, value]) => `--${key}=${value}`);
const result = spawnSync(process.execPath, ['--import', loader, '--test', ...options, ...files], {
  stdio: 'inherit',
  env: process.env,
  cwd: fileURLToPath(new URL('../../', import.meta.url)),
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
