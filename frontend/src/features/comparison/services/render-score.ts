import { createReference } from '@/features/evaluation/services/create-reference';
import { renderLilyPond } from './render-lilypond';
import { renderMusicXml } from './render-musicxml';
import type { ConversionOutput, SourceInput } from '@/features/converter/types';
import type { RenderingOutput } from '../types';

export async function renderScore(
  input: SourceInput,
  conversion: ConversionOutput,
  signal: AbortSignal,
  onProgress: (label: string) => void,
): Promise<RenderingOutput> {
  signal.throwIfAborted();
  onProgress('Rendering LilyPond…');

  const original = await renderLilyPond(input, signal);

  signal.throwIfAborted();
  onProgress('Checking accuracy…');

  const reference = await createReference(input, signal);

  signal.throwIfAborted();
  onProgress('Rendering MusicXML…');

  const scores = await renderMusicXml(
    conversion.scores.map((score) => ({
      musicxml: score.musicxml,
      reference: reference.scores.get(score.sourceIndex),
    })),
    signal,
  );

  return {
    original,
    scores,
    logs: [...reference.logs, ...scores.flatMap((score) => score.logs)],
  };
}
