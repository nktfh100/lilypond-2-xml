import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('Verovio connects numbered chord-note slurs exactly and matches independent LilyPond SVG and MIDI seconds', async () => {
  const source = String.raw`\score { \fixed c' { \tempo 4 = 120 <c f\=1( g\=2( >2 <c e\=1) a\=2) >2 } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const mei = parse(toolkit.getMEI());
  const notes = elements(mei, 'note');
  const pitch = (ref: string) =>
    notes.find((n) => n.getAttribute('xml:id') === ref.slice(1))!.getAttribute('pname');

  assert.deepEqual(
    elements(mei, 'slur').map((s) => [
      pitch(s.getAttribute('startid')!),
      pitch(s.getAttribute('endid')!),
    ]),
    [
      ['f', 'e'],
      ['g', 'a'],
    ],
  );
  assert.equal((toolkit.renderToSVG(1).match(/class="slur"/g) || []).length, 2);
  const originalSvg = Object.entries(compiled.files).find(([name]) => name.endsWith('.svg'))!;
  const svg = new TextDecoder().decode(originalSvg[1]);

  assert.equal((svg.match(/stroke-width="0.0800"[^>]* d="M[^"]*C/g) || []).length, 2);
  const originalMidi = Object.entries(compiled.files).find(([name]) => name.endsWith('.midi'))!;
  const expected = midiTimedNotes(originalMidi[1]),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  assert.deepEqual(
    expected.map((n) => n.onset),
    [0, 0, 0, 1, 1, 1],
  );

  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i]!.duration! - expected[i]!.duration!) < 0.01);
  }
});

test('absolute slur MIDI comparisons expose Verovio mid-measure tempo timing', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 c'4( d'4) \tempo 4 = 60 e'2( f'1) } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: 'midi' }),
  ]);

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const original = Object.entries(compiled.files).find(([name]) => name.endsWith('.midi'))!;
  const expected = midiTimedNotes(original[1]),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    expected.map((n) => n.onset),
    [0, 0.5, 1, 3],
  );
  assert.deepEqual(
    actual.map((n) => n.onset),
    [0, 0.5, 1, 2],
  );
  assert.deepEqual(
    actual.map((n) => n.pitch),
    expected.map((n) => n.pitch),
  );
  assert.match(toolkit.getMEI(), /<tempo [^>]*tstamp="3"[^>]*midi.bpm="60"/);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'tempo-mid-measure-reader'));
});

test('Verovio preserves slur colors, visibility and line styles while dropping explicit offsets', async () => {
  const { scores } =
    await converter.convert(String.raw`{ \once \override Slur.color = #red \slurUp \slurDashed
    \once \override Slur.extra-offset = #'(1 . 2) c'4( d'4)
    \slurDown \slurDotted e'4( f'4) | \once \omit Slur g'2( a'2) }`);

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const mei = parse(toolkit.getMEI());
  const slurs = elements(mei, 'slur');

  assert.deepEqual(
    slurs.map((s) => s.getAttribute('lform')),
    ['dashed', 'dotted', 'dotted'],
  );
  assert.deepEqual(
    slurs.map((s) => s.getAttribute('color')),
    ['#FF0000', null, '#00000000'],
  );
  assert.deepEqual(
    slurs.map((s) => s.getAttribute('curvedir')),
    ['above', 'below', 'below'],
  );
  assert.ok(slurs.every((s) => !s.hasAttribute('ho') && !s.hasAttribute('vo')));
  const svg = toolkit.renderToSVG(1);

  assert.ok(svg.includes('class="slur" color="#00000000" fill="#00000000"'));
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'slur-visibility-reader'));
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'slur-bezier-reader'));
});
