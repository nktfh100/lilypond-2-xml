import { compareNotes, evaluationNotes } from '@evaluation/playback';
import { compareWrittenNotes, musicXmlWrittenNotes, nativeWrittenNotes } from '@evaluation/written';
import { errorMessage } from '@/lib/error-message';
import type { EvaluationReference, ScoreAccuracy } from '../types';

export function evaluateScore(
  musicxml: string,
  reference: EvaluationReference | undefined,
  renderMidi: () => string,
): { accuracy: ScoreAccuracy; logs: string[] } {
  const logs: string[] = [];
  const { written, midi } = reference ?? {};
  const measure = (label: string, calculate: () => number | null) => {
    try {
      return calculate();
    } catch (error) {
      logs.push(`${label} evaluation unavailable: ${errorMessage(error)}`);

      return null;
    }
  };
  const notes =
    written === undefined
      ? null
      : measure(
          'Notes',
          () =>
            compareWrittenNotes(nativeWrittenNotes(written), musicXmlWrittenNotes(musicxml))
              .percent,
        );
  const playback = midi
    ? measure('Playback', () => {
        const rendered = Uint8Array.from(atob(renderMidi()), (character) =>
          character.charCodeAt(0),
        );

        return compareNotes(evaluationNotes(midi), evaluationNotes(rendered)).startsPercent;
      })
    : null;

  return { accuracy: { notes, playback }, logs };
}
