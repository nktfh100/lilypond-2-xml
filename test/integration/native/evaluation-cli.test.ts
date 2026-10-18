import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import path from 'node:path';
import { fixture, loader, script, xml } from '../../support/evaluation-cli.js';

test(
  'written thresholds use independent native notes, accepting a correct export and rejecting a wrong pitch',
  {
    skip:
      !process.env.LILYPOND_BIN &&
      'LILYPOND_BIN is unset; npm run test:native requires a native LilyPond executable',
  },
  async (t) => {
    const setup = await fixture(t);
    const run = (name: string) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          loader,
          script,
          setup.source,
          '--score',
          '1',
          '--lilypond',
          process.env.LILYPOND_BIN!,
          '--musicxml',
          setup.musicxml,
          '--out-dir',
          path.join(setup.directory, name),
          '--min-written',
          '100',
        ],
        { cwd: setup.directory, encoding: 'utf8', timeout: 30_000 },
      );
    const correct = run('native-correct');

    assert.equal(correct.status, 0, correct.stderr);
    assert.equal((await setup.report('native-correct')).writtenSummary.percent, 100);
    await writeFile(setup.musicxml, xml('D'));
    const wrong = run('native-wrong');

    assert.equal(wrong.status, 1, wrong.stderr);
    const report = await setup.report('native-wrong');

    assert.equal(report.writtenSummary.percent, 0);
    assert.equal(report.scores[0].written.missing, 1);
    assert.equal(report.scores[0].written.extra, 1);
  },
);

test(
  'a strong score cannot hide another score below the playback threshold',
  {
    skip:
      !process.env.LILYPOND_BIN &&
      'LILYPOND_BIN is unset; npm run test:native requires a native LilyPond executable',
  },
  async (t) => {
    const setup = await fixture(t);

    await writeFile(
      setup.source,
      String.raw`\version "2.26.0"
\score { { \repeat unfold 40 { c'4 } } \layout {} }
\score { { \time 4/4 c'4 \grace { d'16 } e'4 f'2 } \layout {} }
`,
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        loader,
        script,
        setup.source,
        '--lilypond',
        process.env.LILYPOND_BIN!,
        '--out-dir',
        path.join(setup.directory, 'per-score'),
        '--min-starts',
        '90',
      ],
      { cwd: setup.directory, encoding: 'utf8', timeout: 60_000 },
    );

    assert.equal(result.status, 1, result.stderr);
    const report = await setup.report('per-score');

    assert.ok(report.playbackSummary.startsPercent > 90);
    assert.equal(report.thresholdScope, 'each score');
    assert.equal(report.thresholdStatus, 'failed');
    assert.equal(report.thresholdFailures.length, 1);
    assert.equal(report.thresholdFailures[0].index, 2);
    assert.equal(report.thresholdFailures[0].metric, 'playback');
    assert.ok(report.thresholdFailures[0].actual < 90);
  },
);
