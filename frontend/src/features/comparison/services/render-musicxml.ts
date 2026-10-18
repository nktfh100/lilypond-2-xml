import { releaseProxy, wrap } from 'comlink';
import { errorMessage } from '@/lib/error-message';
import type { MusicXmlRenderer } from '../workers/musicxml.worker';
import type { RenderedScore, ScoreRenderInput } from '../types';

async function renderInWorker(
  scores: ScoreRenderInput[],
  signal: AbortSignal,
): Promise<RenderedScore[]> {
  signal.throwIfAborted();

  const worker = new Worker(new URL('../workers/musicxml.worker.ts', import.meta.url), {
    type: 'module',
  });
  const renderer = wrap<MusicXmlRenderer>(worker);
  const listeners = new AbortController();

  try {
    return await new Promise<RenderedScore[]>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      const fail = (event: ErrorEvent) =>
        reject(new Error(event.message || 'The score renderer could not start.'));

      signal.addEventListener('abort', abort, { signal: listeners.signal });
      worker.addEventListener('error', fail, { signal: listeners.signal });
      renderer.renderScores(scores).then(resolve, reject);
    });
  } finally {
    listeners.abort();
    renderer[releaseProxy]();
    worker.terminate();
  }
}

export async function renderMusicXml(
  scores: ScoreRenderInput[],
  signal: AbortSignal,
): Promise<RenderedScore[]> {
  try {
    return await renderInWorker(scores, signal);
  } catch (error) {
    signal.throwIfAborted();

    return scores.map(() => ({
      preview: {
        error:
          'The converted score preview is unavailable. You can still download the MusicXML and open it in your music app.',
      },
      accuracy: { notes: null, playback: null },
      logs: [`Score rendering and evaluation unavailable: ${errorMessage(error)}`],
    }));
  }
}
