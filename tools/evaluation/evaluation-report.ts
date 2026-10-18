import { compareNotes, summarizeComparisons } from './playback.js';
import { compareWrittenNotes, summarizeWrittenComparisons } from './written.js';

export interface ScoreFile {
  index: number;
  kind: 'printed' | 'unknown';
  xml: string;
}

export interface ScoreEvaluation {
  index: number;
  kind: ScoreFile['kind'];
  status: 'evaluated' | 'missing-export' | 'failed';
  reference?: string;
  musicxml?: string;
  error?: string;
  written: ReturnType<typeof compareWrittenNotes> | null;
  writtenError?: string;
  writtenReference?: string;
  comparison: ReturnType<typeof compareNotes> | null;
}

export interface ScoreReference {
  index: number;
  kind: ScoreFile['kind'];
  midi: string;
  written?: string;
}

export interface EvaluationMetadata {
  schemaVersion: 2;
  source: string;
  sourceSha256: string;
  root: string;
  evaluatedAt: string;
  toleranceQuarters: number;
  writtenPrecisionQuarters: number;
  primaryMetric: string;
  playbackMetric: string;
  limitations: string[];
}

export interface EvaluationReportInput {
  metadata: EvaluationMetadata;
  scores: readonly ScoreEvaluation[];
  references: readonly ScoreReference[];
  exports: readonly ScoreFile[];
  nativeVersion: string | null;
  suppliedReference: boolean;
  minimum: number | null;
  minimumWritten: number | null;
}

export interface EvaluationThresholdCheck {
  index: number;
  metric: 'written' | 'playback';
  minimum: number;
  actual: number | null;
}

export interface EvaluationReport extends EvaluationMetadata {
  status: 'incomplete' | 'evaluated';
  thresholdScope: 'each score';
  thresholdStatus: 'unavailable' | 'not-requested' | 'failed' | 'passed';
  thresholdChecks: EvaluationThresholdCheck[];
  thresholdFailures: EvaluationThresholdCheck[];
  nativeVersion: string | null;
  headlineScope: 'printed scores' | 'selected scores';
  writtenSummary: ReturnType<typeof summarizeWrittenComparisons> | null;
  playbackSummary: ReturnType<typeof summarizeComparisons> | null;
  summary: ReturnType<typeof summarizeComparisons> | null;
  compatibility: string;
  allExportsSummary: ReturnType<typeof summarizeComparisons> | null;
  scores: readonly ScoreEvaluation[];
  unexpectedExports: ScoreFile[];
}

export interface EvaluationReportResult {
  report: EvaluationReport;
  /** 0: evaluated; 1: threshold missed; 2: evaluation incomplete. */
  exitCode: 0 | 1 | 2;
}

export function evaluationMetadata(
  source: string,
  sourceSha256: string,
  root: string,
  tolerance: number,
  evaluatedAt: string,
): EvaluationMetadata {
  return {
    schemaVersion: 2,
    source,
    sourceSha256,
    root,
    evaluatedAt,
    toleranceQuarters: tolerance,
    writtenPrecisionQuarters: 1e-7,
    primaryMetric:
      'written notes: 200 * matched spelled pitch/start/grace/duration / (reference notes + normalized exported notes)',
    playbackMetric: '200 * matched pitch/start attacks / (native attacks + exported attacks)',
    limitations: [
      'Only printed scores are evaluated. Native MIDI is a measurement transport; source MIDI settings and MIDI-only scores are ignored.',
      'Written notes use an independent native engraving observer, folded ordinary repeats and expanded percent repeats. Tied XML fragments may reconstruct one source note.',
      'Written scoring preserves duplicate notes but does not grade staff/voice assignment, rests, ties as markings, other markings or layout. Grace notes use written offsets, not performed timing.',
      'Written comparisons use 1e-7 quarter-note numerical precision; --tolerance affects playback only. Unsupported input produces unavailable written results.',
      'Playback measures converter plus Verovio behavior; reader differences are not automatically exporter bugs.',
      'No time shifting or tempo scaling. Tracks, channels, velocity, tempo changes and pedal resonance are not scored.',
      'Simultaneous same-pitch voices can produce different attack counts in native and reader MIDI.',
      'Ambiguous or missing note releases are excluded from length scoring, never from attack scoring.',
      'Playback agreement does not establish notation correctness. Written scoring is limited to the pitched-note checks described above.',
    ],
  };
}

export function buildEvaluationReport({
  metadata,
  scores,
  references,
  exports,
  nativeVersion,
  suppliedReference,
  minimum,
  minimumWritten,
}: EvaluationReportInput): EvaluationReportResult {
  const unexpectedExports = exports.filter(
    (score) => !references.some((reference) => reference.index === score.index),
  );
  const printed = scores.filter((score) => score.kind === 'printed');
  const headline = printed.length ? printed : scores;
  const valid = (rows: readonly ScoreEvaluation[]) =>
    rows.flatMap((score) => (score.comparison ? [score.comparison] : []));
  const complete =
    headline.every((score) => score.status === 'evaluated') && !unexpectedExports.length;
  const summary = complete ? summarizeComparisons(valid(headline)) : null;
  const writtenSummary =
    !unexpectedExports.length &&
    headline.every((score) => score.written && score.status !== 'missing-export')
      ? summarizeWrittenComparisons(headline.map((score) => score.written!))
      : null;
  const status =
    scores.some((score) => score.status !== 'evaluated') ||
    unexpectedExports.length ||
    (!suppliedReference && !writtenSummary)
      ? 'incomplete'
      : 'evaluated';
  const thresholdChecks = headline.flatMap((score) => {
    const checks: EvaluationThresholdCheck[] = [];

    if (minimumWritten !== null) {
      checks.push({
        index: score.index,
        metric: 'written',
        minimum: minimumWritten,
        actual: score.written?.percent ?? null,
      });
    }

    if (minimum !== null) {
      checks.push({
        index: score.index,
        metric: 'playback',
        minimum,
        actual: score.comparison?.startsPercent ?? null,
      });
    }

    return checks;
  });
  const thresholdFailures = thresholdChecks.filter(
    (check) => check.actual === null || check.actual < check.minimum,
  );
  const report: EvaluationReport = {
    ...metadata,
    status,
    thresholdScope: 'each score',
    thresholdStatus:
      status !== 'evaluated'
        ? 'unavailable'
        : !thresholdChecks.length
          ? 'not-requested'
          : thresholdFailures.length
            ? 'failed'
            : 'passed',
    thresholdChecks,
    thresholdFailures,
    nativeVersion,
    headlineScope: printed.length ? 'printed scores' : 'selected scores',
    writtenSummary,
    playbackSummary: summary,
    summary,
    compatibility:
      'summary, allExportsSummary and scores[].comparison retain playback results; use writtenSummary and scores[].written for written correctness',
    allExportsSummary:
      scores.every((score) => score.status === 'evaluated') && !unexpectedExports.length
        ? summarizeComparisons(valid(scores))
        : null,
    scores,
    unexpectedExports,
  };

  return {
    report,
    exitCode:
      status !== 'evaluated' || (!suppliedReference && !writtenSummary)
        ? 2
        : thresholdFailures.length
          ? 1
          : 0,
  };
}

export function formatEvaluationReport(report: EvaluationReport, resultsPath: string) {
  const { scores, writtenSummary, summary, thresholdFailures } = report;
  const lines: string[] = [];
  const percent = (value: number | null) =>
    value === null ? 'unavailable' : `${value.toFixed(4)}%`;

  for (const score of scores) {
    lines.push(
      `Score ${score.index} (${score.kind}): written notes ${percent(score.written?.percent ?? null)}; playback starts ${percent(score.comparison?.startsPercent ?? null)}; playback lengths ${percent(score.comparison?.lengthsPercent ?? null)}\n`,
    );

    if (score.writtenError) {
      lines.push(`  Written: ${score.writtenError}\n`);
    }

    if (score.error) {
      lines.push(`  Playback: ${score.error}\n`);
    }
  }

  lines.push(
    `Written notes (${report.headlineScope}): ${percent(writtenSummary?.percent ?? null)}\nPlayback starts: ${percent(summary?.startsPercent ?? null)}\nResults: ${resultsPath}\n`,
  );

  for (const failure of thresholdFailures) {
    lines.push(
      `Score ${failure.index} failed ${failure.metric} threshold: ${percent(failure.actual)}; required ${percent(failure.minimum)}\n`,
    );
  }

  return lines.join('');
}
