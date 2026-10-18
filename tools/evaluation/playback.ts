import { readMidiAttacks } from './midi.js';

export interface EvaluationNote {
  pitch: number;
  start: number;
  duration: number | null;
}

export function evaluationNotes(bytes: Uint8Array): EvaluationNote[] {
  const midi = readMidiAttacks(bytes);

  return midi.tracks
    .flatMap((track) =>
      track.attacks.map((note) => ({
        pitch: note.pitch,
        start: note.tick / midi.division,
        duration: note.endTick === null ? null : (note.endTick - note.tick) / midi.division,
      })),
    )
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

export function compareNotes(
  reference: readonly EvaluationNote[],
  exported: readonly EvaluationNote[],
  tolerance = 1 / 96,
) {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('Tolerance must be a finite, nonnegative number of quarter notes');
  }

  for (const note of [...reference, ...exported]) {
    if (
      !Number.isInteger(note.pitch) ||
      note.pitch < 0 ||
      note.pitch > 127 ||
      !Number.isFinite(note.start) ||
      note.start < 0 ||
      (note.duration !== null && (!Number.isFinite(note.duration) || note.duration < 0))
    ) {
      throw new Error(
        'Notes must contain a MIDI pitch, nonnegative start and nonnegative or unknown duration',
      );
    }
  }

  let matched = 0,
    comparableLengths = 0,
    matchingLengths = 0;
  const missing: EvaluationNote[] = [],
    extra: EvaluationNote[] = [];
  const lengthDifferences: {
    reference: EvaluationNote;
    exported: EvaluationNote;
  }[] = [];
  const pitches = [...new Set([...reference, ...exported].map((note) => note.pitch))];

  for (const pitch of pitches) {
    const expected = reference
      .filter((note) => note.pitch === pitch)
      .sort((a, b) => a.start - b.start);
    const actual = exported
      .filter((note) => note.pitch === pitch)
      .sort((a, b) => a.start - b.start);
    let i = 0,
      j = 0;

    while (i < expected.length && j < actual.length) {
      const left = expected[i]!,
        right = actual[j]!;

      if (Math.abs(left.start - right.start) <= tolerance + 1e-8) {
        matched++;

        if (left.duration !== null && right.duration !== null) {
          comparableLengths++;

          if (Math.abs(left.duration - right.duration) <= tolerance + 1e-8) {
            matchingLengths++;
          } else if (lengthDifferences.length < 10) {
            lengthDifferences.push({ reference: left, exported: right });
          }
        }

        i++;
        j++;
      } else if (left.start < right.start) {
        missing.push(left);
        i++;
      } else {
        extra.push(right);
        j++;
      }
    }

    missing.push(...expected.slice(i));
    extra.push(...actual.slice(j));
  }

  return {
    referenceNotes: reference.length,
    exportedNotes: exported.length,
    matched,
    missing: missing.length,
    extra: extra.length,
    startsPercent: reference.length ? (200 * matched) / (reference.length + exported.length) : null,
    lengthsPercent: comparableLengths ? (100 * matchingLengths) / comparableLengths : null,
    comparableLengths,
    matchingLengths,
    unknownLengths: matched - comparableLengths,
    examples: {
      missing: missing.slice(0, 10),
      extra: extra.slice(0, 10),
      lengthDifferences,
    },
  };
}

export function summarizeComparisons(comparisons: readonly ReturnType<typeof compareNotes>[]) {
  const total = (
    field: 'referenceNotes' | 'exportedNotes' | 'matched' | 'comparableLengths' | 'matchingLengths',
  ) => comparisons.reduce((sum, comparison) => sum + comparison[field], 0);
  const referenceNotes = total('referenceNotes'),
    exportedNotes = total('exportedNotes');
  const matched = total('matched'),
    comparableLengths = total('comparableLengths');

  return {
    scores: comparisons.length,
    referenceNotes,
    exportedNotes,
    matched,
    startsPercent: referenceNotes ? (200 * matched) / (referenceNotes + exportedNotes) : null,
    lengthsPercent: comparableLengths ? (100 * total('matchingLengths')) / comparableLengths : null,
    comparableLengths,
  };
}
