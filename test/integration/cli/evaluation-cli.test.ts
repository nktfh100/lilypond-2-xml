import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fixture, loader, script, xml } from '../../support/evaluation-cli.js';

test('evaluation CLI works outside the repository and scores a known correct export', async (t) => {
  const setup = await fixture(t);
  const result = setup.run('correct', ['--min-starts', '100']);

  assert.equal(result.status, 0, result.stderr);
  const report = await setup.report('correct');

  assert.equal(report.status, 'evaluated');
  assert.equal(report.thresholdStatus, 'passed');
  assert.equal(report.writtenSummary, null);
  assert.match(report.scores[0].writtenError, /supplied MIDI reference/);
  assert.equal(report.playbackSummary.startsPercent, 100);
  assert.equal(report.summary.startsPercent, 100);
  assert.equal(report.summary.lengthsPercent, 100);
});

test('evaluation CLI fails a fidelity threshold and retains missing and extra note evidence', async (t) => {
  const setup = await fixture(t);

  await writeFile(setup.musicxml, xml('D'));
  const result = setup.run('wrong-pitch', ['--min-starts', '99']);

  assert.equal(result.status, 1, result.stderr);
  const report = await setup.report('wrong-pitch');

  assert.equal(report.thresholdStatus, 'failed');
  assert.equal(report.summary.startsPercent, 0);
  assert.equal(report.scores[0].comparison.missing, 1);
  assert.equal(report.scores[0].comparison.extra, 1);
});

test('reader errors remain failures without fabricated zero-percent scores', async (t) => {
  const setup = await fixture(t);

  await writeFile(setup.musicxml, '<broken/>');
  const result = setup.run('reader-error');

  assert.equal(result.status, 2);
  const report = await setup.report('reader-error');

  assert.equal(report.status, 'incomplete');
  assert.equal(report.thresholdStatus, 'unavailable');
  assert.equal(report.summary, null);
  assert.equal(report.scores[0].comparison, null);
});

test('evaluation overwrites previous results when reusing an output directory', async (t) => {
  const setup = await fixture(t);
  const first = setup.run('reused');

  assert.equal(first.status, 0, first.stderr);
  assert.equal((await setup.report('reused')).summary.startsPercent, 100);
  await writeFile(setup.musicxml, xml('D'));
  const second = setup.run('reused');

  assert.equal(second.status, 0, second.stderr);
  const report = await setup.report('reused');

  assert.equal(report.status, 'evaluated');
  assert.equal(report.summary.startsPercent, 0);
  assert.equal(report.scores[0].comparison.missing, 1);
  assert.equal(report.scores[0].comparison.extra, 1);
});

test('evaluation rejects ambiguous manual references', async (t) => {
  const setup = await fixture(t);
  const result = spawnSync(
    process.execPath,
    ['--import', loader, script, setup.source, '--reference', 'native.mid'],
    { encoding: 'utf8', timeout: 30_000 },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /require --score/);
});

test('a MIDI-only manual reference cannot pass a written-note threshold', async (t) => {
  const setup = await fixture(t);
  const result = setup.run('no-written-reference', ['--min-written', '99']);

  assert.equal(result.status, 1, result.stderr);
  assert.equal((await setup.report('no-written-reference')).writtenSummary, null);
});
