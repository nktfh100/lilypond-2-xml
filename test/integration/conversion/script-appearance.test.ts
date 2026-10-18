import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { elements as all, parse } from '../../support/xml-support.js';

const converter = createConverter(),
  compiler = createReusableCompiler();
const reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const source = (overrides: string) =>
  String.raw`\score { \new Staff { ${overrides} c'4\turn d'4\staccato e'4\upbow f'4\fermata } \layout {} \midi { \tempo 4=120 } }`;

test('actual Script colors and offsets reach native ornaments, articulations, technical marks and fermatas', async () => {
  const text = source(
    String.raw`\override Script.color = #(rgb-color 1 0 0) \override Script.extra-offset = #'(2 . -1)`,
  );
  const [{ scores }, independent] = await Promise.all([
    converter.convert(text),
    compiler.compile(text, { format: ['svg', 'midi'] }),
  ]);
  const converted = scores[0]!;

  validate(converted.musicxml);
  const xml = parse(converted.musicxml);

  for (const tag of ['turn', 'staccato', 'up-bow', 'fermata']) {
    const mark = all(xml, tag)[0]!;

    assert.ok(mark, tag);
    assert.equal(mark.getAttribute('color'), '#FF0000');
    assert.equal(mark.getAttribute('relative-x'), '20');
    assert.equal(mark.getAttribute('relative-y'), '-10');
  }

  const scripts = converted.document.events.filter((e) => e.kind === 'script');

  assert.equal(scripts.length, 4);

  for (const s of scripts) {
    assert.deepEqual(s.color, [1, 0, 0]);
    assert.deepEqual(s.offset, [2, -1]);
  }

  const svg = new TextDecoder().decode(
    Object.entries(independent.files).find(([name]) => name.endsWith('.svg'))![1],
  );

  assert.equal(
    all(parse(svg), 'g').filter(
      (g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
    ).length,
    4,
  );
  assert.equal(reader.loadData(converted.musicxml), 1);
  const mei = parse(reader.getMEI()),
    readerSVG = parse(reader.renderToSVG(1));

  for (const tag of ['artic', 'turn', 'fermata']) {
    for (const mark of all(mei, tag)) {
      assert.equal(mark.getAttribute('color'), '#FF0000');
    }
  }

  assert.equal(all(readerSVG, 'g').filter((g) => g.getAttribute('color') === '#FF0000').length, 4);
  assert.ok(!converted.diagnostics.some((d) => d.code === 'script-position-reader'));

  const expected = midiTimedNotes(
    Object.entries(independent.files).find(([name]) => name.endsWith('.midi'))![1],
  );
  const actual = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset }) => ({ pitch, onset })),
    expected.map(({ pitch, onset }) => ({ pitch, onset })),
  );
});

const readerShapes = (svg: string) =>
  all(parse(svg), 'g')
    .filter((g) => /^(artic|turn|fermata)( |$)/.test(g.getAttribute('class') || ''))
    .map((g) =>
      all(g, 'use').map((u) => ({
        glyph: (u.getAttribute('xlink:href') || '').split('-')[0],
        x: u.getAttribute('x'),
        y: u.getAttribute('y'),
        transform: u.getAttribute('transform'),
      })),
    );

test('independent source SVG moves Script shapes by the captured staff-space translation while Verovio drops it', async () => {
  const results = [];

  for (const offset of ['(0 . 0)', '(2 . -1)']) {
    const text = source(
      String.raw`\override Script.color = #red \override Script.extra-offset = #'${offset}`,
    );
    const [{ scores }, independent] = await Promise.all([
      converter.convert(text),
      compiler.compile(text, { format: ['svg', 'midi'] }),
    ]);
    const converted = scores[0]!;

    validate(converted.musicxml);
    const svg = new TextDecoder().decode(
      Object.entries(independent.files).find(([name]) => name.endsWith('.svg'))![1],
    );
    const marks = all(parse(svg), 'g').filter(
      (g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
    );
    const positions = marks.map((g) => {
      const transform = all(g, 'g')[0]!.getAttribute('transform')!;
      const match = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(transform)!;

      return [Number(match[1]), Number(match[2])];
    });

    assert.equal(reader.loadData(converted.musicxml), 1);
    results.push({
      positions,
      shapes: marks.map((g) => all(g, 'path').map((p) => p.getAttribute('d'))),
      reader: readerShapes(reader.renderToSVG(1)),
      midi: midiTimedNotes(
        Object.entries(independent.files).find(([name]) => name.endsWith('.midi'))![1],
      ),
    });
  }

  const [base, moved] = results;

  assert.equal(base!.positions.length, 4);
  assert.equal(moved!.positions.length, 4);
  moved!.positions.forEach((p, i) => {
    assert.ok(Math.abs(p[0]! - base!.positions[i]![0]! - 2) < 0.0002);
    assert.ok(Math.abs(p[1]! - base!.positions[i]![1]! - 1) < 0.0002);
  });
  assert.deepEqual(moved!.shapes, base!.shapes);
  assert.deepEqual(moved!.reader, base!.reader);
  assert.deepEqual(moved!.midi, base!.midi);
});

test('rational Script colors and offsets survive JSON caches; missing history is diagnosed', async () => {
  const { scores } = await converter.convert(
    source(
      String.raw`\override Script.color = #'(1/2 1/4 3/4) \override Script.extra-offset = #'(1/2 . -1/4)`,
    ),
  );
  const document = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;

  for (const graphic of document.events.filter((e) => e.kind === 'script')) {
    assert.deepEqual(graphic.color, [0.5, 0.25, 0.75]);
    assert.deepEqual(graphic.offset, [0.5, -0.25]);
  }

  const result = toMusicXML(document);

  validate(result.musicxml);

  for (const tag of ['turn', 'staccato', 'up-bow', 'fermata']) {
    const mark = all(parse(result.musicxml), tag)[0]!;

    assert.equal(mark.getAttribute('color'), '#8040BF');
    assert.equal(mark.getAttribute('relative-x'), '5');
    assert.equal(mark.getAttribute('relative-y'), '-2.5');
  }

  const legacy: ScoreDocument = {
    ...document,
    events: document.events.map((e) => {
      if (e.kind !== 'script') {
        return e;
      }

      const { color, offset, ...old } = e;

      return old;
    }),
  };
  const old = toMusicXML(legacy);

  validate(old.musicxml);
  assert.ok(old.diagnostics.some((d) => d.code === 'script-appearance-history'));
  assert.equal(all(parse(old.musicxml), 'turn')[0]!.getAttribute('color'), null);
});

test('hidden scripts keep their source RGB with zero alpha and omitted ornaments stay absent', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \override Script.color = #blue \once \override Script.transparent = ##t c'4\staccato \once \override Script.transparent = ##t d'4\fermata \once \omit Script e'4\turn f'4\upbow }`,
  );
  const xml = parse(scores[0]!.musicxml);

  validate(scores[0]!.musicxml);
  assert.equal(all(xml, 'staccato')[0]!.getAttribute('color'), '#00000000');
  assert.equal(all(xml, 'fermata')[0]!.getAttribute('color'), '#00000000');
  assert.equal(all(xml, 'turn').length, 0);
  assert.equal(all(xml, 'up-bow')[0]!.getAttribute('color'), '#0000FF');
});

test('script appearance is separate between piano staves and reset between scores', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { \new PianoStaff << \new Staff { \override Script.color = #red \override Script.extra-offset = #'(1 . 0) c'1\turn } \new Staff { \override Script.color = #blue c1\fermata } >> } \score { { c'1\turn } }`,
  );

  assert.equal(scores.length, 2);
  scores.forEach((s) => validate(s.musicxml));
  const first = parse(scores[0]!.musicxml),
    second = parse(scores[1]!.musicxml);

  assert.equal(all(first, 'turn')[0]!.getAttribute('color'), '#FF0000');
  assert.equal(all(first, 'fermata')[0]!.getAttribute('color'), '#0000FF');
  assert.equal(all(second, 'turn')[0]!.getAttribute('color'), null);
  assert.equal(all(second, 'turn')[0]!.getAttribute('relative-x'), null);
});
