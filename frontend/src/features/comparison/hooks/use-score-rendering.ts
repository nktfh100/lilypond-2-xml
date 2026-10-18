import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import type { ConversionOutput, SourceInput } from '@/features/converter/types';
import type { RenderingState } from '../types';

export function useScoreRendering(input: SourceInput, conversion: ConversionOutput) {
  const [state, setState] = useState<RenderingState>({
    status: 'running',
    progress: 'Preparing previews…',
  });
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    active.current = controller;

    async function render() {
      try {
        const { renderScore } = await import('../services/render-score');

        signal.throwIfAborted();

        const output = await renderScore(input, conversion, signal, (progress) => {
          if (!signal.aborted) {
            setState({ status: 'running', progress });
          }
        });

        if (!signal.aborted) {
          setState({ status: 'success', output });
        }
      } catch (error) {
        if (!signal.aborted) {
          setState({ status: 'error', message: errorMessage(error, 'Previews are unavailable.') });
        }
      } finally {
        if (active.current === controller) {
          active.current = null;
        }
      }
    }

    void render();

    return () => controller.abort();
  }, [input, conversion]);

  function cancel() {
    active.current?.abort();
    active.current = null;
    setState({ status: 'cancelled' });
  }

  return { state, cancel };
}
