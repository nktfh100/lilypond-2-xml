import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse, texts } from '../../support/xml-support.js';

const { converter, toolkit, playback } = await createReaderHarness();

test('Verovio keeps harmonic head fill and the original playback pitches', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \override NoteHead.style = #'harmonic c'4 d'2. \override NoteHead.style = #'harmonic-black e'4 f'2. }`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const mei = toolkit.getMEI();

  assert.equal((mei.match(/head.fill="void"/g) || []).length, 2);
  assert.equal((mei.match(/head.fill="solid"/g) || []).length, 2);
  const svg = toolkit.renderToSVG(1);

  assert.match(svg, /#E0D9-/);
  assert.match(svg, /#E0DB-/);
  assert.deepEqual(
    playback().map((n) => n.pitch),
    [60, 62, 64, 65],
  );
});

test('Verovio retains hidden-head stems and their playback', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \override NoteHead.transparent = ##t c'4 \once \omit NoteHead d'4 e'4 f'4 }`,
  );

  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.equal((toolkit.getMEI().match(/head.visible="false"/g) || []).length, 2);
  const svg = toolkit.renderToSVG(1);

  assert.equal((svg.match(/class="stem"/g) || []).length, 4);
  assert.equal((svg.match(/class="notehead"/g) || []).length, 2);
  assert.deepEqual(
    playback().map((n) => n.pitch),
    [60, 62, 64, 65],
  );
  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'notehead'), ['none', 'none']);
  assert.deepEqual(
    elements(xml, 'note').map((n) => n.getAttribute('print-object')),
    [null, null, null, null],
  );
});

test('SMuFL notehead glyph data remains native when Verovio cannot render it', async () => {
  const { scores } = await converter.convert(String.raw`{ \aikenHeads c'4 d' e' f' g' a' b' c'' }`);

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.match(toolkit.getMEI(), /glyph.name="noteShapeTriangleUpBlack"/);
  assert.match(toolkit.getMEI(), /glyph.name="noteShapeMoonBlack"/);
  const svg = toolkit.renderToSVG(1);

  assert.match(svg, /#E0A4-/);
  assert.doesNotMatch(svg, /#E1BB-/);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'notehead-reader'));
  assert.deepEqual(
    playback().map((n) => n.pitch),
    [60, 62, 64, 65, 67, 69, 71, 72],
  );
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'notehead'), [
    'do',
    're',
    'mi',
    'fa up',
    'so',
    'la',
    'ti',
    'do',
  ]);
  assert.equal(scores[0]!.document.events.filter((e) => e.kind === 'notehead').length, 8);
});
