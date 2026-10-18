import { useState } from 'react';
import { ArrowRight, Code2, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { ScoreComparison } from '@/features/comparison/components/score-comparison';
import { SourceEditor } from './source-editor';
import { useConversion } from '../hooks/use-conversion';
import type { SourceInput } from '../types';

export function ConverterWorkspace() {
  const [input, setInput] = useState<SourceInput>({ source: '', filename: 'score.ly', files: {} });
  const [reading, setReading] = useState(false);
  const { state, convert, reset } = useConversion();
  const busy = state.status === 'running';

  function updateInput(next: SourceInput) {
    reset();
    setInput(next);
  }

  return (
    <main className='page-shell' data-has-result={state.status === 'success'}>
      <div className='workspace'>
        <h1 className='page-title'>Convert LilyPond to MusicXML</h1>
        <section className='converter-panel' aria-label='Convert your score'>
          <SourceEditor
            input={input}
            onChange={updateInput}
            disabled={busy}
            reading={reading}
            onReadingChange={setReading}
          />
          <div className='convert-toolbar'>
            <Button
              className='convert-button'
              data-converting={busy}
              onClick={() => void convert(input)}
              disabled={busy || reading || !input.source.trim()}
            >
              <span className='convert-button-label'>
                {busy ? (
                  <>
                    <LoaderCircle className='loading-spinner' />
                    Converting…
                  </>
                ) : (
                  <>
                    Convert
                    <ArrowRight />
                  </>
                )}
              </span>
            </Button>
          </div>
        </section>
        {state.status === 'running' && (
          <div className='conversion-progress'>
            <div className='progress-caption'>
              <p role='status'>
                {state.progress.label}
                {state.progress.percent !== undefined && ` ${state.progress.percent}%`}
              </p>
              <Button variant='ghost' onClick={reset}>
                Cancel
              </Button>
            </div>
            <Progress
              value={state.progress.percent ?? null}
              aria-label={state.progress.label}
              className={state.progress.percent === undefined ? 'progress-indeterminate' : ''}
            />
          </div>
        )}
        {state.status === 'error' && (
          <Alert variant='destructive' className='conversion-error'>
            <AlertTitle>Couldn’t convert this score</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
      </div>
      {state.status === 'success' && <ScoreComparison input={input} output={state.output} />}
      <footer className='page-footer'>
        <a
          href='https://github.com/nktfh100/lilypond-2-xml'
          target='_blank'
          rel='noreferrer'
        >
          <Code2 />
          GitHub
          <ArrowRight />
        </a>
      </footer>
    </main>
  );
}
