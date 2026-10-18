import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { selectTests } from '../../../tools/test/selection.js';

const files = await readdir(new URL('../../', import.meta.url), { recursive: true });

test('unit, compiler and native tiers cover every Node test exactly once', () => {
  const tiers = ['fast', 'compiler', 'native'].flatMap((tier) => selectTests(files, tier));

  assert.equal(new Set(tiers).size, tiers.length);
  assert.deepEqual(tiers.sort(), selectTests(files, 'all'));
});

test('CI Node and native jobs cover the full suite without duplicate files', () => {
  const node = selectTests(files, 'node');
  const native = selectTests(files, 'native');

  assert.ok(native.length > 0);
  assert.ok(node.length > native.length);
  assert.deepEqual([...node, ...native].sort(), selectTests(files, 'all'));
  assert.ok(native.every((file) => !node.includes(file)));
});

test('new unit tests join the fast tier automatically even with duplicate basenames', () => {
  assert.deepEqual(
    selectTests(
      ['unit/new.test.ts', 'integration/conversion/new.test.ts', 'unit/helper.ts'],
      'fast',
    ),
    ['unit/new.test.ts'],
  );
});

test('path filters select a union within the requested tier', () => {
  const candidates = [
    'integration/conversion/ties.test.ts',
    'integration/reader/ties.test.ts',
    'unit/ties.test.ts',
    'unit/colors.test.ts',
  ];

  assert.deepEqual(selectTests(candidates, 'all', ['test/integration/reader/']), [candidates[1]]);
  assert.deepEqual(selectTests(candidates, 'fast', ['ties', 'colors']), [
    'unit/colors.test.ts',
    'unit/ties.test.ts',
  ]);
  assert.deepEqual(selectTests(candidates, 'all', ['missing']), []);
});

test('unknown tiers fail instead of silently running a different suite', () => {
  assert.throws(() => selectTests(files, 'typo'), /Unknown test tier: typo/);
});

test('Windows discovery paths use the same tiers and filters', () => {
  assert.deepEqual(
    selectTests(
      [String.raw`unit\tools\parser.test.ts`, String.raw`integration\native\parser.test.ts`],
      'fast',
      ['unit/tools'],
    ),
    ['unit/tools/parser.test.ts'],
  );
});
