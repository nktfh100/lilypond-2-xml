import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('Verovio preserves every chord glissando and matches independent LilyPond SVG and MIDI seconds', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 <c' e' g'>2\glissando <d' f' a'>2 } \layout {} \midi {} }`;
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
    elements(mei, 'gliss').map((g) => [
      pitch(g.getAttribute('startid')!),
      pitch(g.getAttribute('endid')!),
    ]),
    [
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'a'],
    ],
  );
  assert.equal((toolkit.renderToSVG(1).match(/class="gliss glissando"/g) || []).length, 3);
  const svg = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );
  const originalXml = parse(svg);

  assert.equal(
    elements(originalXml, 'line').filter((l) => l.getAttribute('y1') !== l.getAttribute('y2'))
      .length,
    3,
  );
  const midi = Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1];
  const expected = midiTimedNotes(midi),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );

  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i]!.duration! - expected[i]!.duration!) < 0.01);
  }
});

test('Verovio matches custom chord glissando numbers and preserves hidden color and dashed style', async () => {
  const { scores } = await converter.convert(String.raw`{ \set glissandoMap = #'((0 . 2) (2 . 0))
    \once \override Glissando.style = #'dashed-line \once \override Glissando.color = #red
    \once \override Glissando.extra-offset = #'(1 . 2) <c' e' g'>2\glissando <d' f' a'>2 |
    \set glissandoMap = #'((0 . 0)) \once \omit Glissando c'2\glissando d'2 }`);

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const mei = parse(toolkit.getMEI());
  const notes = elements(mei, 'note');
  const pitch = (ref: string) =>
    notes.find((n) => n.getAttribute('xml:id') === ref.slice(1))!.getAttribute('pname');
  const gliss = elements(mei, 'gliss');

  assert.deepEqual(
    gliss.map((g) => [pitch(g.getAttribute('startid')!), pitch(g.getAttribute('endid')!)]),
    [
      ['c', 'a'],
      ['g', 'd'],
    ],
  );
  assert.deepEqual(
    gliss.map((g) => g.getAttribute('lform')),
    ['dashed', 'dashed'],
  );
  assert.deepEqual(
    gliss.map((g) => g.getAttribute('color')),
    ['#FF0000', '#FF0000'],
  );
  assert.ok(gliss.every((g) => !g.hasAttribute('ho') && !g.hasAttribute('vo')));
  const xml = parse(scores[0]!.musicxml);

  assert.equal(
    elements(xml, 'glissando').filter((g) => g.getAttribute('color') === '#00000000').length,
    2,
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'glissando-visibility-reader'));
});
