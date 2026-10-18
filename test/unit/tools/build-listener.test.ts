import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const loader = createRequire(import.meta.url).resolve('tsx/esm');

test('listener generation is reproducible and its freshness check rejects stale output', (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'build-listener-'));

  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeFileSync(join(workspace, 'package.json'), '{"type":"module"}');
  symlinkSync(new URL('node_modules/', root), join(workspace, 'node_modules'), 'dir');
  cpSync(new URL('src/lilypond/listener/', root), join(workspace, 'src/lilypond/listener'), {
    recursive: true,
  });
  cpSync(new URL('tools/build-listener.ts', root), join(workspace, 'tools/build-listener.ts'));
  const target = join(workspace, 'src/lilypond/generated/listener.ts');

  cpSync(new URL('src/lilypond/generated/listener.ts', root), target);
  const expected = readFileSync(target, 'utf8');
  const build = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', loader, 'tools/build-listener.ts', ...args], {
      cwd: workspace,
      encoding: 'utf8',
    });

  writeFileSync(target, 'stale');
  const stale = build('--check');

  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /Generated listener is stale/);
  assert.equal(readFileSync(target, 'utf8'), 'stale');

  const generated = build();

  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(readFileSync(target, 'utf8'), expected);

  const fresh = build('--check');

  assert.equal(fresh.status, 0, fresh.stderr);
});
