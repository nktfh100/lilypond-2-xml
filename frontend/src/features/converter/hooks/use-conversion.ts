import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import type { ConversionState, SourceInput } from '../types';

export function useConversion() {
  const [state, setState] = useState<ConversionState>({ status: 'idle' });
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => active.current?.abort(), []);

  function reset() {
    active.current?.abort();
    active.current = null;
    setState({ status: 'idle' });
  }

  async function convert(input: SourceInput) {
    active.current?.abort();

    const controller = new AbortController();
    const { signal } = controller;

    active.current = controller;
    setState({ status: 'running', progress: { label: 'Preparing…' } });

    try {
      const { convertScore } = await import('../services/convert-score');

      signal.throwIfAborted();

      const output = await convertScore(input, signal, (progress) => {
        if (!signal.aborted) {
          setState({ status: 'running', progress });
        }
      });

      if (!signal.aborted) {
        setState({ status: 'success', output });
      }
    } catch (error) {
      if (!signal.aborted) {
        setState({
          status: 'error',
          message: errorMessage(
            error,
            'This score could not be converted. Try again, or try a different LilyPond file.',
          ),
        });
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
      }
    }
  }

  return { state, convert, reset };
}
