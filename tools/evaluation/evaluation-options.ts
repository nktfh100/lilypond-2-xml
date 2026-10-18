import path from 'node:path';
import { parseArgs } from 'node:util';

export const evaluationHelp = `Usage: npm run evaluate -- score.ly [options]

  --lilypond PATH       Native LilyPond executable (default: lilypond)
  --root DIR            Root containing the source and its includes (default: source directory)
  --out-dir DIR         Artifact directory (default: a new /tmp directory)
  --score N             Evaluate one source score by its 1-based index
  --reference FILE      Use an existing native MIDI; requires --score
  --musicxml FILE       Evaluate an existing export; requires --score
  --tolerance NUMBER    Playback timing error in quarter notes (default: 1/96)
  --min-written NUMBER Exit 1 if any score falls below this written-note percentage
  --min-starts NUMBER   Exit 1 if any score falls below this playback-start percentage
  --timeout NUMBER      Seconds allowed per compiler/reader process (default: 120)
  --help                Show this help

Results and mismatch examples are saved as results.json in the artifact directory.
Only printed scores are evaluated; MIDI-only source scores and settings are ignored.
Exit codes: 0 evaluated, 1 threshold missed, 2 compilation/setup/reader failure.
Primary: written pitches, starts and durations, read directly from MusicXML.
Secondary: native MIDI versus Verovio playback. Neither certifies complete losslessness.
`;

export interface EvaluationOptions {
  help: false;
  source: string;
  root: string;
  selected: number | null;
  tolerance: number;
  /** Per-process timeout in milliseconds. */
  timeout: number;
  /** Minimum playback-start percentage for each headline score. */
  minimum: number | null;
  minimumWritten: number | null;
  lilypond: string;
  reference: string | null;
  musicxml: string | null;
  directory: string | null;
}

export type EvaluationOptionResult = { help: true } | EvaluationOptions;

export function parseEvaluationOptions(args: string[]): EvaluationOptionResult {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      lilypond: { type: 'string', default: 'lilypond' },
      root: { type: 'string' },
      'out-dir': { type: 'string' },
      score: { type: 'string' },
      reference: { type: 'string' },
      musicxml: { type: 'string' },
      tolerance: { type: 'string', default: String(1 / 96) },
      'min-starts': { type: 'string' },
      'min-written': { type: 'string' },
      timeout: { type: 'string', default: '120' },
      help: { type: 'boolean' },
    },
  });

  if (values.help) {
    return { help: true };
  }

  if (positionals.length !== 1) {
    throw new Error(evaluationHelp);
  }

  const source = path.resolve(positionals[0]!);
  const root = path.resolve(values.root ?? path.dirname(source));
  const relative = path.relative(root, source);

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('The source must be inside --root');
  }

  const selected = values.score === undefined ? null : Number(values.score);

  if (selected !== null && (!Number.isSafeInteger(selected) || selected < 1)) {
    throw new Error('--score must be a positive integer');
  }

  if ((values.reference || values.musicxml) && selected === null) {
    throw new Error(
      '--reference and --musicxml require --score to identify the matching source score',
    );
  }

  const tolerance = Number(values.tolerance),
    timeout = Number(values.timeout) * 1000;
  const minimum = values['min-starts'] === undefined ? null : Number(values['min-starts']);

  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('--tolerance must be finite and nonnegative');
  }

  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
    throw new Error('--timeout must be positive and finite');
  }

  if (minimum !== null && (!Number.isFinite(minimum) || minimum < 0 || minimum > 100)) {
    throw new Error('--min-starts must be between 0 and 100');
  }

  const minimumWritten = values['min-written'] === undefined ? null : Number(values['min-written']);

  if (
    minimumWritten !== null &&
    (!Number.isFinite(minimumWritten) || minimumWritten < 0 || minimumWritten > 100)
  ) {
    throw new Error('--min-written must be between 0 and 100');
  }

  return {
    help: false,
    source,
    root,
    selected,
    tolerance,
    timeout,
    minimum,
    minimumWritten,
    lilypond: values.lilypond,
    reference: values.reference ? path.resolve(values.reference) : null,
    musicxml: values.musicxml ? path.resolve(values.musicxml) : null,
    directory: values['out-dir'] ? path.resolve(values['out-dir']) : null,
  };
}
