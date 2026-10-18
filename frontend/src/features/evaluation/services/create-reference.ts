import { createReusableCompiler } from '@sightread/lilypond-wasm';
import referenceSettings from '@evaluation/reference/evaluate-reference.ily?raw';
import writtenSettings from '@evaluation/reference/evaluate-written-reference.ily?raw';
import { errorMessage } from '@/lib/error-message';
import { sanitizeInput } from '../../../../../src/lilypond/sanitize';
import type { SourceInput } from '@/features/converter/types';
import type { EvaluationReference } from '../types';

export async function createReference(input: SourceInput, signal: AbortSignal) {
  const compiler = createReusableCompiler();
  const scores = new Map<number, EvaluationReference>();

  try {
    const sanitized = sanitizeInput(input.source, input.files);
    const directory = `evaluation-${crypto.randomUUID()}`;
    const result = await compiler.compile(sanitized.source, {
      filename: input.filename,
      files: {
        ...sanitized.files,
        [`${directory}/evaluate-reference.ily`]: referenceSettings,
        [`${directory}/evaluate-written-reference.ily`]: writtenSettings,
        [`${directory}/settings.ily`]:
          '#(define evaluation-output-prefix "/output/reference")\n\\include "evaluate-reference.ily"\n',
      },
      includePaths: [directory],
      includeSettings: `${directory}/settings.ily`,
      format: 'svg',
      signal,
    });

    if (result.logs.some((line) => /programming error:/i.test(line))) {
      throw new Error('LilyPond reported an internal error while evaluating the source.');
    }

    const manifest = result.files['reference.tsv'];

    if (!manifest) {
      throw new Error('LilyPond did not produce evaluation references.');
    }

    for (const line of new TextDecoder().decode(manifest).trim().split('\n').filter(Boolean)) {
      const [index, kind] = line.split('\t');
      const scoreIndex = Number(index);

      if (kind !== 'printed' || !Number.isSafeInteger(scoreIndex) || scoreIndex < 1) {
        throw new Error('Invalid evaluation reference manifest.');
      }

      const written = result.files[`reference-${scoreIndex}.written.tsv`];
      const midi = result.files[`reference-${scoreIndex}.midi`];

      scores.set(scoreIndex, {
        ...(written ? { written: new TextDecoder().decode(written) } : {}),
        ...(midi ? { midi } : {}),
      });
    }

    return { scores, logs: result.logs };
  } catch (error) {
    signal.throwIfAborted();

    return {
      scores: new Map<number, EvaluationReference>(),
      logs: [`Evaluation unavailable: ${errorMessage(error)}`],
    };
  } finally {
    compiler.dispose();
  }
}
