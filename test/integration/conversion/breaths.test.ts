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

const score = (music: string) =>
  String.raw`\score { \new Staff { ${music} } \layout {} \midi { \tempo 4=120 } }`;
const noteMarks = (xml: string) =>
  all(parse(xml), 'note').map((n) => ({
    pitch: all(n, 'step')[0]?.textContent ?? 'rest',
    breaths: all(n, 'breath-mark').map((m) => m.textContent),
    caesuras: all(n, 'caesura').map((m) => m.textContent),
    ties: all(n, 'tie').map((t) => t.getAttribute('type')),
  }));

test('breaths attach to preceding notes including terminal endpoints, with independent source SVG and MIDI', async () => {
  const source = score(
    String.raw`\override NoteHead.color = #blue \override BreathingSign.color = #red \override Staff.BreathingSign.color = #red c'4 \breathe d'4 e'4 \caesura f'4 \breathe`,
  );
  const [{ scores }, independent] = await Promise.all([
    converter.convert(source),
    compiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const converted = scores[0]!;

  validate(converted.musicxml);
  assert.deepEqual(
    noteMarks(converted.musicxml).map((n) => [n.pitch, n.breaths, n.caesuras]),
    [
      ['C', ['comma'], []],
      ['D', [], []],
      ['E', [], ['normal']],
      ['F', ['comma'], []],
    ],
  );
  assert.equal(converted.document.breathsCaptured, true);
  assert.equal(
    converted.document.events.filter((e) => e.kind === 'script' && e.breathSign).length,
    3,
  );
  const sourceSVG = new TextDecoder().decode(
    Object.entries(independent.files).find(([n]) => n.endsWith('.svg'))![1],
  );
  const svg = parse(sourceSVG);
  const coloredXs = (color: string) =>
    all(svg, 'g')
      .filter((g) => g.getAttribute('color') === color)
      .map((g) => {
        const translated = all(g, 'g').find((child) =>
          /^translate\(/.test(child.getAttribute('transform') || ''),
        );

        assert.ok(translated, 'a colored source glyph has an explicit position');

        return Number(/^translate\(([-\d.]+),/.exec(translated.getAttribute('transform')!)![1]);
      })
      .sort((a, b) => a - b);
  const heads = coloredXs('rgba(0.0000%, 0.0000%, 100.0000%, 100.0000%)');
  const marks = coloredXs('rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)');

  assert.equal(heads.length, 4);
  assert.equal(marks.length, 3);
  assert.ok(
    heads[0]! < marks[0]! && marks[0]! < heads[1]!,
    'first source breath lies after C and before D',
  );
  assert.ok(
    heads[2]! < marks[1]! && marks[1]! < heads[3]!,
    'source caesura lies after E and before F',
  );
  assert.ok(heads[3]! < marks[2]!, 'terminal source breath lies after F');
  assert.equal(reader.loadData(converted.musicxml), 1);
  const mei = parse(reader.getMEI());

  assert.equal(all(mei, 'breath').length, 2);
  assert.equal(all(mei, 'caesura').length, 1);
  const imported = [...all(mei, 'breath'), ...all(mei, 'caesura')].sort(
    (a, b) => Number(a.getAttribute('tstamp')) - Number(b.getAttribute('tstamp')),
  );

  for (const [i, mark] of imported.entries()) {
    const startid = mark.getAttribute('startid');

    if (startid) {
      const owner = all(mei, 'note').find((n) => n.getAttribute('xml:id') === startid.slice(1));

      assert.equal(owner?.getAttribute('pname'), ['c', 'e', 'f'][i]);
    } else {
      // This importer places breaths near the end of their owning quarter beat.
      const beat = [1, 3, 4][i]!,
        at = Number(mark.getAttribute('tstamp'));

      assert.ok(
        at > beat && at < beat + 1,
        `reader mark ${i} remains within the C/E/F quarter beat`,
      );
      assert.equal(mark.getAttribute('staff'), '1');
    }
  }

  const expected = midiTimedNotes(
    Object.entries(independent.files).find(([n]) => n.endsWith('.midi'))![1],
  );
  const actual = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
});

test('resolved tick, upbow and straight/curved breath glyphs reach schema-valid native values', async () => {
  const { scores } = await converter.convert(
    score(String.raw`c'4 \override BreathingSign.text = \markup \musicglyph "scripts.tickmark" \breathe
    d'4 \override BreathingSign.text = \markup \musicglyph "scripts.uupbow" \breathe
    e'4 \override BreathingSign.text = \markup \musicglyph "scripts.caesura.straight" \breathe
    f'4 \override BreathingSign.text = \markup \musicglyph "scripts.caesura.curved" \breathe`),
  );
  const converted = scores[0]!;

  validate(converted.musicxml);
  assert.deepEqual(
    noteMarks(converted.musicxml).map((n) => [n.breaths, n.caesuras]),
    [
      [['tick'], []],
      [['upbow'], []],
      [[], ['normal']],
      [[], ['curved']],
    ],
  );
  assert.equal(reader.loadData(converted.musicxml), 1);
  const mei = parse(reader.getMEI());

  assert.equal(all(mei, 'breath').length, 2);
  assert.equal(all(mei, 'caesura').length, 2);
  // The pinned reader normalizes native tick/upbow to comma and curved caesura to straight.
  const shapes = all(parse(reader.renderToSVG(1)), 'g').filter((g) =>
    ['breath', 'caesura'].includes(g.getAttribute('class') || ''),
  );

  assert.deepEqual(
    shapes.flatMap((g) => all(g, 'use').map((u) => u.getAttribute('xlink:href')?.split('-')[0])),
    ['#E4CE', '#E4CE', '#E4D1', '#E4D1'],
  );

  for (const mark of [...all(mei, 'breath'), ...all(mei, 'caesura')]) {
    assert.equal(mark.getAttribute('glyph.name'), null);
    assert.equal(mark.getAttribute('glyph.num'), null);
  }
});

test('breaths anchor once on chords and rests and only on final fragments of split notes', async () => {
  const { scores } = await converter.convert(
    score(String.raw`\time 3/4 <c' e'>4 \breathe r4 \breathe d'4 e'1 \breathe f'2`),
  );
  const converted = scores[0]!;

  validate(converted.musicxml);
  const notes = all(parse(converted.musicxml), 'note'),
    marked = notes.filter((n) => all(n, 'breath-mark').length);

  assert.equal(marked.length, 3);
  assert.equal(all(marked[0]!, 'step')[0]!.textContent, 'C');
  assert.equal(all(marked[1]!, 'rest').length, 1);
  assert.equal(all(marked[2]!, 'step')[0]!.textContent, 'E');
  assert.ok(!all(marked[2]!, 'tie').some((t) => t.getAttribute('type') === 'start'));
  assert.equal(
    notes.filter((n) => all(n, 'step')[0]?.textContent === 'E' && !all(n, 'chord').length).length,
    2,
  );
});

test('hidden, omitted and removed breath engravers do not restore visible event marks', async () => {
  const source = String.raw`\score { { \override BreathingSign.color = #blue c'4 \once \override BreathingSign.transparent = ##t \breathe d'4 \once \omit BreathingSign \breathe e'4 \breathe f'4 } }
  \score { \new Staff \with { \remove Caesura_engraver } \new Voice \with { \remove Breathing_sign_engraver } { c'2 \breathe d'2 \caesura } }`;
  const { scores } = await converter.convert(source);

  scores.forEach((s) => validate(s.musicxml));
  const marks = all(parse(scores[0]!.musicxml), 'breath-mark');

  assert.equal(marks.length, 3);
  assert.equal(marks[0]!.getAttribute('color'), '#00000000');
  assert.equal(marks[1]!.getAttribute('color'), '#00000000');
  assert.equal(marks[2]!.getAttribute('color'), '#0000FF');
  assert.equal(all(parse(scores[1]!.musicxml), 'breath-mark').length, 0);
  assert.equal(all(parse(scores[1]!.musicxml), 'caesura').length, 0);
});

test('fermata attached at a breath remains at its preceding note', async () => {
  const { scores } = await converter.convert(
    score(
      String.raw`c'2 #(make-music 'CaesuraEvent 'articulations (list (make-music 'ArticulationEvent 'articulation-type "fermata"))) d'2`,
    ),
  );

  validate(scores[0]!.musicxml);
  const notes = all(parse(scores[0]!.musicxml), 'note');

  assert.equal(all(notes[0]!, 'fermata').length, 1);
  assert.equal(all(notes[0]!, 'caesura').length, 1);
  assert.equal(all(notes[1]!, 'fermata').length, 0);
});

test('breath ownership stays separate across voices/staves and resets between scores', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { << \new Staff = "upper" << \new Voice = "one" { \override BreathingSign.color = #red c'2 \breathe d'2 } \new Voice = "two" { e'1 \breathe } >> \new Staff = "lower" { \override BreathingSign.color = #blue c1 \breathe } >> } \score { { c'1 \breathe } }`,
  );

  scores.forEach((s) => validate(s.musicxml));
  const first = all(parse(scores[0]!.musicxml), 'note').filter((n) => all(n, 'breath-mark').length);

  assert.equal(first.length, 3);
  assert.deepEqual(first.map((n) => all(n, 'step')[0]!.textContent).sort(), ['C', 'C', 'E']);
  assert.ok(first.some((n) => all(n, 'breath-mark')[0]!.getAttribute('color') === '#FF0000'));
  assert.ok(first.some((n) => all(n, 'breath-mark')[0]!.getAttribute('color') === '#0000FF'));
  assert.equal(all(parse(scores[1]!.musicxml), 'breath-mark')[0]!.getAttribute('color'), null);
});

test('JSON breath history preserves appearance while legacy and custom/initial marks diagnose limits', async () => {
  const { scores } = await converter.convert(
    score(
      String.raw`\breathe \override BreathingSign.text = \markup "custom" \override BreathingSign.extra-offset = #'(1/2 . -1/4) c'2 \breathe d'2`,
    ),
  );
  const document = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;
  const cached = toMusicXML(document);

  validate(cached.musicxml);
  assert.ok(cached.diagnostics.some((d) => d.code === 'breath-anchor'));
  assert.ok(cached.diagnostics.some((d) => d.code === 'breath-glyph'));
  const mark = all(parse(cached.musicxml), 'breath-mark')[0]!;

  assert.equal(mark.getAttribute('relative-x'), '5');
  assert.equal(mark.getAttribute('relative-y'), '-2.5');
  const { breathsCaptured, ...withoutHistory } = document;
  const legacy = {
    ...withoutHistory,
    events: document.events.filter((e) => e.kind !== 'script' || !e.breathSign),
  };
  const old = toMusicXML(legacy);

  validate(old.musicxml);
  assert.ok(old.diagnostics.some((d) => d.code === 'breath-history'));
  assert.equal(all(parse(old.musicxml), 'breath-mark').length, 1);
});

test('independent source translations move breath glyphs while native color and reader positioning are checked', async () => {
  const results = [];

  for (const offset of ['(0 . 0)', '(2 . -1)']) {
    const source =
      score(String.raw`\override BreathingSign.color = #red \override Staff.CaesuraScript.color = #red \override Staff.BreathingSign.color = #red
      \override BreathingSign.extra-offset = #'${offset} \override Staff.CaesuraScript.extra-offset = #'${offset} \override Staff.BreathingSign.extra-offset = #'${offset}
      c'2 \breathe d'2 \caesura`);
    const [{ scores }, independent] = await Promise.all([
      converter.convert(source),
      compiler.compile(source, { format: ['svg', 'midi'] }),
    ]);
    const converted = scores[0]!;

    validate(converted.musicxml);
    const native = parse(converted.musicxml);

    for (const tag of ['breath-mark', 'caesura']) {
      assert.equal(all(native, tag)[0]!.getAttribute('color'), '#FF0000');
      assert.equal(
        all(native, tag)[0]!.getAttribute('relative-x'),
        offset === '(0 . 0)' ? null : '20',
      );
      assert.equal(
        all(native, tag)[0]!.getAttribute('relative-y'),
        offset === '(0 . 0)' ? null : '-10',
      );
    }

    const svg = new TextDecoder().decode(
      Object.entries(independent.files).find(([n]) => n.endsWith('.svg'))![1],
    );
    const red = all(parse(svg), 'g').filter(
      (g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
    );

    assert.equal(red.length, 2);
    const positions = red.map((g) => {
      const m = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(
        all(g, 'g')[0]!.getAttribute('transform')!,
      )!;

      return [Number(m[1]), Number(m[2])];
    });

    assert.equal(reader.loadData(converted.musicxml), 1);
    const mei = parse(reader.getMEI());
    const imported = [...all(mei, 'breath'), ...all(mei, 'caesura')];

    assert.equal(imported.length, 2);
    const readerShapes = all(parse(reader.renderToSVG(1)), 'g')
      .filter((g) => ['breath', 'caesura'].includes(g.getAttribute('class') || ''))
      .map((g) => ({
        color: g.getAttribute('color'),
        uses: all(g, 'use').map((u) => ({
          glyph: u.getAttribute('xlink:href')?.split('-')[0],
          transform: u.getAttribute('transform'),
        })),
      }));

    results.push({
      positions,
      sourceShapes: red.map((g) => all(g, 'path').map((p) => p.getAttribute('d'))),
      readerShapes,
      colors: imported.map((n) => n.getAttribute('color')),
      sourceMidi: midiTimedNotes(
        Object.entries(independent.files).find(([n]) => n.endsWith('.midi'))![1],
      ),
    });
  }

  const [base, moved] = results;

  assert.deepEqual(moved!.sourceShapes, base!.sourceShapes);
  assert.deepEqual(moved!.sourceMidi, base!.sourceMidi);
  moved!.positions.forEach((p, i) => {
    assert.ok(Math.abs(p[0]! - base!.positions[i]![0]! - 2) < 0.0002);
    assert.ok(Math.abs(p[1]! - base!.positions[i]![1]! - 1) < 0.0002);
  });
  assert.deepEqual(moved!.readerShapes, base!.readerShapes);
  assert.deepEqual(base!.colors, ['#FF0000', '#FF0000']);
});
