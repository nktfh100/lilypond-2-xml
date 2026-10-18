import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { sanitizeInput } from '../../../../../src/lilypond/sanitize';
import type { SourceInput } from '@/features/converter/types';
import type { ScorePreview } from '../types';

export async function renderLilyPond(
  input: SourceInput,
  signal: AbortSignal,
): Promise<ScorePreview> {
  const compiler = createReusableCompiler();

  try {
    const sanitized = sanitizeInput(input.source, input.files);
    const result = await compiler.compile(sanitized.source, {
      filename: input.filename,
      files: sanitized.files,
      format: 'svg',
      signal,
    });
    const pages = Object.entries(result.files)
      .filter(([name]) => name.endsWith('.svg'))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([, data]) => new TextDecoder().decode(data));

    return pages.length
      ? { pages }
      : {
          error:
            'The original score preview is unavailable. You can still download the converted score.',
        };
  } catch {
    signal.throwIfAborted();

    return {
      error:
        'The original score preview is unavailable. You can still download the converted score.',
    };
  } finally {
    compiler.dispose();
  }
}
