import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { compareNotes } from '../../../tools/evaluation/playback.js';
import { parseEvaluationOptions } from '../../../tools/evaluation/evaluation-options.js';
import {
  buildEvaluationReport,
  evaluationMetadata,
  formatEvaluationReport,
  type ScoreEvaluation,
} from '../../../tools/evaluation/evaluation-report.js';

import { compareWrittenNotes } from '../../../tools/evaluation/written.js';

const playbackNote = { pitch: 60, start: 0, duration: 1 };
const writtenNote = {
  pitch: 'C:0:4',
  start: 0,
  duration: 1,
  grace: 0,
  voice: '1',
};
const score = (index = 1): ScoreEvaluation => ({
  index,
  kind: 'printed',
  status: 'evaluated',
  written: compareWrittenNotes([writtenNote], [writtenNote]),
  comparison: compareNotes([playbackNote], [playbackNote]),
});
const metadata = evaluationMetadata('/score.ly', 'hash', '/', 1 / 96, 'fixed-time');

function report(
  scores: ScoreEvaluation[],
  options: {
    suppliedReference?: boolean;
    minimum?: number;
    minimumWritten?: number;
    extra?: boolean;
  } = {},
) {
  return buildEvaluationReport({
    metadata,
    scores,
    references: scores.map(({ index, kind }) => ({
      index,
      kind,
      midi: `${index}.mid`,
    })),
    exports: options.extra ? [{ index: 99, kind: 'printed', xml: 'extra.xml' }] : [],
    nativeVersion: 'native version',
    suppliedReference: options.suppliedReference ?? false,
    minimum: options.minimum ?? null,
    minimumWritten: options.minimumWritten ?? null,
  });
}

test('evaluation options resolve paths and units without filesystem access', () => {
  const options = parseEvaluationOptions([
    'scores/source.ly',
    '--timeout',
    '0.5',
    '--score',
    '2',
    '--reference',
    'native.mid',
    '--min-starts',
    '0',
    '--min-written',
    '100',
  ]);

  assert.equal(options.help, false);

  if (options.help) {
    return;
  }

  assert.equal(options.source, path.resolve('scores/source.ly'));
  assert.equal(options.root, path.resolve('scores'));
  assert.equal(options.reference, path.resolve('native.mid'));
  assert.equal(options.selected, 2);
  assert.equal(options.timeout, 500);
  assert.equal(options.tolerance, 1 / 96);
  assert.equal(options.minimum, 0);
  assert.equal(options.minimumWritten, 100);
  assert.deepEqual(parseEvaluationOptions(['--help']), { help: true });
});

test('evaluation options reject invalid ranges and mismatched input scope', () => {
  for (const [name, value, error] of [
    ['score', '1.5', /positive integer/],
    ['tolerance', '-1', /nonnegative/],
    ['timeout', '0', /positive and finite/],
    ['timeout', '2147484', /positive and finite/],
    ['min-starts', '101', /between 0 and 100/],
    ['min-written', 'NaN', /between 0 and 100/],
  ] as const) {
    assert.throws(() => parseEvaluationOptions(['source.ly', `--${name}=${value}`]), error);
  }

  assert.throws(
    () => parseEvaluationOptions(['source.ly', '--musicxml', 'score.xml']),
    /require --score/,
  );
  assert.throws(
    () => parseEvaluationOptions(['source.ly', '--root', 'elsewhere']),
    /inside --root/,
  );
});

test('reports preserve playback compatibility fields and exact console formatting', () => {
  const { report: result, exitCode } = report([score()]);

  assert.equal(exitCode, 0);
  assert.equal(result.status, 'evaluated');
  assert.equal(result.thresholdStatus, 'not-requested');
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.evaluatedAt, 'fixed-time');
  assert.deepEqual(result.summary, result.playbackSummary);
  assert.deepEqual(result.summary, result.allExportsSummary);
  assert.equal(
    formatEvaluationReport(result, '/results.json'),
    'Score 1 (printed): written notes 100.0000%; playback starts 100.0000%; playback lengths 100.0000%\nWritten notes (printed scores): 100.0000%\nPlayback starts: 100.0000%\nResults: /results.json\n',
  );
});

test('thresholds apply to each score even when the combined percentage passes', () => {
  const weak = score(2);

  weak.comparison = compareNotes([playbackNote], []);
  const { report: result, exitCode } = report([score(), weak], {
    minimum: 40,
    minimumWritten: 100,
  });

  assert.ok(result.summary!.startsPercent! >= 40);
  assert.equal(exitCode, 1);
  assert.equal(result.thresholdStatus, 'failed');
  assert.deepEqual(result.thresholdFailures, [
    { index: 2, metric: 'playback', minimum: 40, actual: 0 },
  ]);
});

test('unavailable written notes permit supplied MIDI but fail requested written thresholds', () => {
  const unavailable = { ...score(), written: null };

  assert.equal(report([unavailable]).exitCode, 2);
  assert.equal(report([unavailable], { suppliedReference: true }).exitCode, 0);
  const result = report([unavailable], {
    suppliedReference: true,
    minimumWritten: 0,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.thresholdFailures[0]!.actual, null);
});

test('reader failures and unmatched exports override threshold exit decisions', () => {
  const failed: ScoreEvaluation = {
    ...score(),
    status: 'failed',
    comparison: null,
    error: 'reader failure',
  };
  const result = report([failed], { minimum: 100 });

  assert.equal(result.exitCode, 2);
  assert.equal(result.report.thresholdStatus, 'unavailable');
  assert.equal(result.report.summary, null);
  assert.equal(result.report.writtenSummary!.percent, 100);
  const extra = report([score()], { extra: true });

  assert.equal(extra.exitCode, 2);
  assert.equal(extra.report.writtenSummary, null);
  assert.equal(extra.report.summary, null);
  assert.equal(extra.report.unexpectedExports[0]!.index, 99);
});

test('per-score execution preserves written evidence when the reader fails', async () => {
  const { evaluateScore } = await import('../../../tools/evaluation/evaluation-score.js');
  const midi = new Uint8Array([
    77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, 13, 0, 144, 60, 80,
    131, 96, 128, 60, 0, 0, 255, 47, 0,
  ]);
  const rendered: string[][] = [];
  const result = await evaluateScore(
    { index: 2, kind: 'printed', midi: 'reference.mid', written: 'notes.tsv' },
    { index: 2, kind: 'printed', xml: 'export.xml' },
    '/artifacts',
    1 / 96,
    {
      readText: async (filename) =>
        filename === 'notes.tsv'
          ? '0\t4\t0\t0\t0\t1\t1\n'
          : '<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>',
      readMidi: async () => midi,
      render: async (...args) => {
        rendered.push(args);
        throw new Error('reader unavailable');
      },
    },
  );

  assert.deepEqual(rendered, [['export.xml', '/artifacts/score-2.reader.mid', 'reader-2']]);
  assert.equal(result.status, 'failed');
  assert.equal(result.comparison, null);
  assert.equal(result.written!.percent, 100);
  assert.equal(result.writtenReference, 'notes.tsv');
  assert.match(result.error!, /reader unavailable/);
});

test('threshold boundaries are inclusive and zero remains a requested threshold', () => {
  const empty = score();

  empty.written = compareWrittenNotes([writtenNote], []);
  empty.comparison = compareNotes([playbackNote], []);
  const zero = report([empty], { minimum: 0, minimumWritten: 0 });

  assert.equal(zero.exitCode, 0);
  assert.equal(zero.report.thresholdStatus, 'passed');
  assert.deepEqual(zero.report.thresholdChecks, [
    { index: 1, metric: 'written', minimum: 0, actual: 0 },
    { index: 1, metric: 'playback', minimum: 0, actual: 0 },
  ]);
  const perfect = report([score()], { minimum: 100, minimumWritten: 100 });

  assert.equal(perfect.exitCode, 0);
  assert.equal(perfect.report.thresholdStatus, 'passed');
  assert.deepEqual(perfect.report.thresholdFailures, []);
});

test('headline summaries and thresholds prefer printed scores over unknown scores', () => {
  const unknown: ScoreEvaluation = {
    ...score(2),
    kind: 'unknown',
    written: compareWrittenNotes([writtenNote], []),
    comparison: compareNotes([playbackNote], []),
  };
  const { report: result, exitCode } = report([score(), unknown], {
    minimum: 100,
    minimumWritten: 100,
  });

  assert.equal(exitCode, 0);
  assert.equal(result.headlineScope, 'printed scores');
  assert.equal(result.summary!.scores, 1);
  assert.equal(result.writtenSummary!.scores, 1);
  assert.equal(result.allExportsSummary!.scores, 2);
  assert.ok(result.allExportsSummary!.startsPercent! < 100);
  assert.deepEqual(
    result.thresholdChecks.map(({ index }) => index),
    [1, 1],
  );

  const selected = report([unknown], { minimum: 100, minimumWritten: 100 });

  assert.equal(selected.exitCode, 1);
  assert.equal(selected.report.headlineScope, 'selected scores');
  assert.deepEqual(selected.report.thresholdFailures, [
    { index: 2, metric: 'written', minimum: 100, actual: 0 },
    { index: 2, metric: 'playback', minimum: 100, actual: 0 },
  ]);
});

test('missing exports suppress aggregate results even when zero thresholds pass', () => {
  const missing: ScoreEvaluation = {
    ...score(),
    status: 'missing-export',
    written: compareWrittenNotes([writtenNote], []),
    comparison: compareNotes([playbackNote], []),
  };
  const { report: result, exitCode } = report([missing], {
    suppliedReference: true,
    minimum: 0,
    minimumWritten: 0,
  });

  assert.equal(exitCode, 2);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.thresholdStatus, 'unavailable');
  assert.deepEqual(result.thresholdFailures, []);
  assert.equal(result.writtenSummary, null);
  assert.equal(result.playbackSummary, null);
  assert.equal(result.allExportsSummary, null);
  assert.equal(result.scores[0]!.written!.percent, 0);
});

test('failures outside the headline scope still make the evaluation incomplete', () => {
  const failed: ScoreEvaluation = {
    ...score(2),
    kind: 'unknown',
    status: 'failed',
    comparison: null,
  };
  const { report: result, exitCode } = report([score(), failed], {
    minimum: 100,
  });

  assert.equal(exitCode, 2);
  assert.equal(result.thresholdStatus, 'unavailable');
  assert.deepEqual(result.thresholdFailures, []);
  assert.equal(result.summary!.startsPercent, 100);
  assert.equal(result.allExportsSummary, null);
});

test('evaluation options preserve defaults, selected exports and finite numeric boundaries', () => {
  const defaults = parseEvaluationOptions(['source.ly']);

  assert.equal(defaults.help, false);

  if (defaults.help) {
    return;
  }

  assert.equal(defaults.timeout, 120_000);
  assert.equal(defaults.selected, null);
  assert.equal(defaults.minimum, null);
  assert.equal(defaults.minimumWritten, null);
  assert.equal(defaults.reference, null);
  assert.equal(defaults.musicxml, null);
  assert.equal(defaults.directory, null);
  const selected = parseEvaluationOptions([
    'source.ly',
    '--score=1',
    '--musicxml=score.xml',
    '--tolerance=0',
    '--timeout=2147483.647',
    '--out-dir=artifacts',
  ]);

  assert.equal(selected.help, false);

  if (selected.help) {
    return;
  }

  assert.equal(selected.musicxml, path.resolve('score.xml'));
  assert.equal(selected.directory, path.resolve('artifacts'));
  assert.equal(selected.tolerance, 0);
  assert.equal(selected.timeout, 2_147_483_647);

  for (const [name, value] of [
    ['score', '0'],
    ['score', '9007199254740992'],
    ['tolerance', 'Infinity'],
    ['timeout', 'Infinity'],
    ['min-starts', 'NaN'],
    ['min-written', '-1'],
  ]) {
    assert.throws(() => parseEvaluationOptions(['source.ly', `--${name}=${value}`]));
  }
});
