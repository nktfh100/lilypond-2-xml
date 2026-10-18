import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { createConverter } from 'lilypond-2-xml';
import { after } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';

// Each reader suite owns its compiler instances and mutable toolkit. Keep the
// independent LilyPond MIDI/SVG oracle separate from the conversion compiler.
export const createReaderHarness = async () => {
  const converter = createConverter();
  const midiCompiler = createReusableCompiler();
  const toolkit = new VerovioToolkit(await createModule());

  after(() => {
    converter.dispose();
    midiCompiler.dispose();
    toolkit.destroy();
  });
  const playback = () =>
    toolkit
      .renderToTimemap()
      .flatMap((event) => (event.on || []).map((id) => toolkit.getMIDIValuesForElement(id!)));

  return { converter, midiCompiler, toolkit, playback };
};
