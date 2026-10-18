import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadMusicXml } from '@/lib/download';
import { ScorePreview } from './score-preview';
import { ConversionNotes } from './conversion-notes';
import { ScoreAccuracy } from '@/features/evaluation/components/score-accuracy';
import { useScoreRendering } from '../hooks/use-score-rendering';
import type { ConversionOutput, SourceInput } from '@/features/converter/types';

export function ScoreComparison({
  input,
  output,
}: {
  input: SourceInput;
  output: ConversionOutput;
}) {
  const [selected, setSelected] = useState(0);
  const { state, cancel } = useScoreRendering(input, output);
  const score = output.scores[selected];
  const rendering = state.status === 'running';
  const rendered = state.status === 'success' ? state.output : undefined;
  const previewError =
    state.status === 'cancelled'
      ? { error: 'Rendering cancelled.' }
      : state.status === 'error'
        ? { error: state.message }
        : undefined;

  if (!score) {
    return null;
  }

  return (
    <section className='comparison' aria-label='Score comparison'>
      <div className='comparison-toolbar'>
        <p className='sr-only' role='status'>
          Conversion complete
        </p>
        <ScoreAccuracy accuracy={rendered?.scores[selected]?.accuracy} pending={rendering} />
        <Button onClick={() => downloadMusicXml(score.filename, score.musicxml)}>
          <Download />
          Download
        </Button>
      </div>
      {state.status === 'running' && (
        <div className='rendering-progress progress-caption'>
          <p role='status'>{state.progress}</p>
          <Button variant='ghost' onClick={cancel} aria-label='Cancel rendering'>
            Cancel
          </Button>
        </div>
      )}
      {output.scores.length > 1 && (
        <div className='score-selector'>
          <label htmlFor='converted-score'>Score</label>
          <select
            id='converted-score'
            value={selected}
            onChange={(event) => setSelected(Number(event.target.value))}
          >
            {output.scores.map((item, index) => (
              <option key={item.filename} value={index}>
                {item.filename}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className='comparison-grid'>
        <ScorePreview title='LilyPond' preview={rendered?.original ?? previewError} />
        <ScorePreview
          key={score.filename}
          title='MusicXML'
          preview={rendered?.scores[selected]?.preview ?? previewError}
        />
      </div>
      <ConversionNotes diagnostics={score.diagnostics} />
    </section>
  );
}
