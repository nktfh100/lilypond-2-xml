import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

for (const [name, music, glyph, code] of [
  ['tied and slurred', String.raw`\repeat percent 3 { c'2~ c'4( d'4) }`, 'repeat1Bar', 'E500'],
  ['single-measure', String.raw`\repeat percent 3 { c'4 d' e' f' }`, 'repeat1Bar', 'E500'],
  ['double-measure', String.raw`\repeat percent 3 { c'1 d'1 } e'1`, 'repeat2Bars', 'E501'],
  ['beat', String.raw`c'4 \repeat percent 3 { d'8 e'8 } f'4`, 'repeatBarSlash', 'E504'],
]) {
  test(`Verovio imports ${name} percent signs and matches actual source playback`, async () => {
    const source = `\\score { { ${music} } \\layout {} \\midi { \\tempo 4=120 } }`;
    const { scores } = await converter.convert(source);

    validate(scores[0]!.musicxml);
    assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
    assert.equal(
      (toolkit.getMEI().match(new RegExp(`glyph.name="${glyph}"`, 'g')) || []).length,
      2,
    );
    assert.ok(toolkit.renderToSVG(1).includes(String.fromCodePoint(parseInt(code!, 16))));
    const repeated = midiTimedNotes(toolkit.renderToMIDI());
    const original = await midiCompiler.compile(
      source.replaceAll('\\repeat percent', '\\repeat unfold'),
      { format: 'midi' },
    );
    const expected = midiTimedNotes(
      Object.entries(original.files).find(([name]) => name.endsWith('.midi'))![1],
    );

    assert.deepEqual(
      repeated.map(({ pitch, onset, velocity }) => ({
        pitch,
        onset,
        velocity,
      })),
      expected.map(({ pitch, onset, velocity }) => ({
        pitch,
        onset,
        velocity,
      })),
    );
    assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'percent-layout'));
  });
}
