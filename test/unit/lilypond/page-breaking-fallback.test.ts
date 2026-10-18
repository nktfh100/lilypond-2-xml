import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compileWithPageBreakingFallback,
  isWebAssemblyTrap,
} from '../../../src/lilypond/compile-fallback.js';

const trapMessage =
  'RuntimeError: unreachable\n    at lilypond.wasm.a_crash (wasm://wasm/lilypond.wasm-03a3c866:wasm-function[4713]:0x5600db)';

test('wasm traps are recognised by their abort message', () => {
  assert.equal(isWebAssemblyTrap(new Error(trapMessage)), true);
  assert.equal(isWebAssemblyTrap(new Error('LilyPond exited with code 1')), false);
  assert.equal(isWebAssemblyTrap('RuntimeError: unreachable'), false);
});

test('a wasm trap retries once with the page-breaking fallback', async () => {
  const attempts: boolean[] = [];
  const { result, pageBreakingFallback } = await compileWithPageBreakingFallback(
    async (fallback) => {
      attempts.push(fallback);

      if (!fallback) {
        throw new Error(trapMessage);
      }

      return 'converted';
    },
  );

  assert.deepEqual(attempts, [false, true]);
  assert.equal(pageBreakingFallback, true);
  assert.equal(result, 'converted');
});

test('a successful first compile never requests the fallback', async () => {
  const attempts: boolean[] = [];
  const { result, pageBreakingFallback } = await compileWithPageBreakingFallback(
    async (fallback) => {
      attempts.push(fallback);

      return 'converted';
    },
  );

  assert.deepEqual(attempts, [false]);
  assert.equal(pageBreakingFallback, false);
  assert.equal(result, 'converted');
});

test('non-trap compile errors are not retried', async () => {
  const attempts: boolean[] = [];

  await assert.rejects(
    compileWithPageBreakingFallback(async (fallback) => {
      attempts.push(fallback);
      throw new Error('LilyPond exited with code 1');
    }),
    /exited with code 1/,
  );
  assert.deepEqual(attempts, [false]);
});
