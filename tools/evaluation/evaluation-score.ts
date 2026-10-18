import path from 'node:path';
import { compareNotes, evaluationNotes } from './playback.js';
import { compareWrittenNotes, musicXmlWrittenNotes, nativeWrittenNotes } from './written.js';
import type { ScoreFile, ScoreReference, ScoreEvaluation } from './evaluation-report.js';

export interface ScoreEvaluationEffects {
  readText(filename: string): Promise<string>;
  readMidi(filename: string): Promise<Uint8Array>;
  render(input: string, output: string, label: string): Promise<unknown>;
}

export async function evaluateScore(
  reference: ScoreReference,
  exported: ScoreFile | undefined,
  directory: string,
  tolerance: number,
  effects: ScoreEvaluationEffects,
): Promise<ScoreEvaluation> {
  const kind = reference.kind === 'unknown' ? (exported?.kind ?? 'unknown') : reference.kind;
  let written: ScoreEvaluation['written'] = null;
  let writtenError: string | undefined;

  try {
    if (!reference.written) {
      throw new Error(
        'A supplied MIDI reference cannot establish written correctness; omit --reference to collect native written notes',
      );
    }

    const native = nativeWrittenNotes(await effects.readText(reference.written));

    if (!native.length) {
      throw new Error('No native pitched written notes to compare');
    }

    written = compareWrittenNotes(
      native,
      exported ? musicXmlWrittenNotes(await effects.readText(exported.xml)) : [],
    );
  } catch (error) {
    writtenError = String(error);
  }

  const writtenResult = {
    written,
    ...(writtenError ? { writtenError } : {}),
    ...(reference.written ? { writtenReference: reference.written } : {}),
  };

  try {
    const native = evaluationNotes(await effects.readMidi(reference.midi));

    if (!native.length) {
      throw new Error(
        'Native reference contains no attacks; no meaningful percentage is available',
      );
    }

    if (!exported) {
      return {
        index: reference.index,
        kind,
        status: 'missing-export',
        reference: reference.midi,
        ...writtenResult,
        comparison: compareNotes(native, [], tolerance),
      };
    }

    const midi = path.join(directory, `score-${reference.index}.reader.mid`);

    await effects.render(exported.xml, midi, `reader-${reference.index}`);
    const comparison = compareNotes(
      native,
      evaluationNotes(await effects.readMidi(midi)),
      tolerance,
    );

    return {
      index: reference.index,
      kind,
      status: 'evaluated',
      reference: reference.midi,
      musicxml: exported.xml,
      ...writtenResult,
      comparison,
    };
  } catch (error) {
    return {
      index: reference.index,
      kind,
      status: 'failed',
      error: String(error),
      ...writtenResult,
      comparison: null,
    };
  }
}
