import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('Verovio retains plucking and fall/doit semantics while omitting their drawings; LilyPond MIDI agrees', async () => {
  const source = String.raw`\score {
    \new Voice { \tempo 4 = 120
      <c'^\rightHandFinger #1 e'_\rightHandFinger #2 >4
      <d'^\rightHandFinger #"custom" >4 e'4\bendAfter #-4 f'4\bendAfter #4 }
    \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = toolkit.getMEI();

  assert.equal((mei.match(/type="technical"/g) || []).length, 3);
  assert.match(mei, /artic="fall"/);
  assert.match(mei, /artic="doit"/);
  assert.ok(!mei.includes('>custom<'));
  const svg = toolkit.renderToSVG(1);

  assert.ok(!svg.includes('class="artic"'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'technique-reader'));
  const originalSvg = Object.entries(compiled.files).find(([name]) => name.endsWith('.svg'));

  assert.ok(originalSvg);
  const lilySvg = new TextDecoder().decode(originalSvg[1]);

  for (const text of ['p', 'i', 'custom']) {
    assert.ok(lilySvg.includes(`<tspan>${text}</tspan>`));
  }

  assert.equal((lilySvg.match(/fill="none" d="m[^"]+c[^"]+"/g) || []).length, 2);
  const original = Object.entries(compiled.files).filter(([name]) => name.endsWith('.midi'));

  assert.equal(original.length, 1);
  const expected = midiNotes(original[0]![1]);
  const actual = midiNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset }) => ({ pitch, onset })),
    expected.map(({ pitch, onset }) => ({ pitch, onset })),
  );

  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i]!.duration! - expected[i]!.duration!) < 0.02);
  }
});
