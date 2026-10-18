import { createConverter } from '@converter';
import type { ConversionOutput, ConversionProgress, SourceInput } from '../types';

async function convertWithProgress(
  input: SourceInput,
  signal: AbortSignal,
  onProgress: (progress: ConversionProgress) => void,
) {
  const converter = createConverter();

  try {
    onProgress({ label: 'Loading LilyPond…' });
    await converter.preload({
      signal,
      onProgress: ({ loadedBytes, totalBytes }) => {
        onProgress({
          label: 'Loading LilyPond…',
          ...(totalBytes > 0 ? { percent: Math.round((loadedBytes / totalBytes) * 100) } : {}),
        });
      },
    });
    onProgress({ label: 'Converting…' });

    return await converter.convert(input.source, {
      filename: input.filename,
      files: input.files,
      signal,
    });
  } finally {
    converter.dispose();
  }
}

export async function convertScore(
  input: SourceInput,
  signal: AbortSignal,
  onProgress: (progress: ConversionProgress) => void,
): Promise<ConversionOutput> {
  const conversion = await convertWithProgress(input, signal, onProgress);

  signal.throwIfAborted();
  const basename = input.filename.replace(/\.(ly|ily)$/i, '') || 'score';

  return {
    logs: conversion.logs,
    scores: conversion.scores.map((score, index) => ({
      sourceIndex: Number(/score\.(\d+)\.musicxml$/.exec(score.filename)?.[1]),
      filename: `${basename}${conversion.scores.length > 1 ? `-${index + 1}` : ''}.musicxml`,
      musicxml: score.musicxml,
      diagnostics: score.diagnostics,
    })),
  };
}
