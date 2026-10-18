import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('Verovio preserves resolved tie colors, styles and hidden display and matches independent LilyPond playback seconds', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 \tieUp \tieDashed
    \once \override Tie.color = #red \once \override Tie.extra-offset = #'(1 . 2) c'2~ c'2 |
    \once \omit Tie d'2~ d'2 } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI());
  const ties = elements(mei, 'tie');

  assert.equal(ties.length, 2);
  assert.deepEqual(
    ties.map((t) => t.getAttribute('color')),
    ['#FF0000', '#00000000'],
  );
  assert.deepEqual(
    ties.map((t) => t.getAttribute('lform')),
    ['dashed', 'dashed'],
  );
  assert.ok(
    ties.every(
      (t) =>
        t.getAttribute('curvedir') === 'above' && !t.hasAttribute('ho') && !t.hasAttribute('vo'),
    ),
  );
  assert.ok(toolkit.renderToSVG(1).includes('class="tie" color="#00000000"'));
  const svg = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );
  const original = parse(svg);
  const red = elements(original, 'g').find(
    (g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
  )!;

  assert.ok(red);
  assert.ok(elements(red, 'path').some((p) => p.getAttribute('d')?.includes('C')));
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

test('resolved chord ties, enharmonic spelling and split-note continuations match independent LilyPond MIDI', async () => {
  for (const music of [
    String.raw`<c'~ e' g'~>2 <c' f' g'>2`,
    String.raw`cis'2~ des'2`,
    String.raw`cis'1.~ des'2`,
  ]) {
    const source = `\\score { { \\tempo 4 = 120 ${music} } \\layout {} \\midi {} }`;
    const [{ scores }, compiled] = await Promise.all([
      converter.convert(source),
      midiCompiler.compile(source, { format: 'midi' }),
    ]);

    validate(scores[0]!.musicxml);
    assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
    const expected = midiTimedNotes(
        Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
      ),
      actual = midiTimedNotes(toolkit.renderToMIDI());

    assert.deepEqual(
      actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
      expected.map(({ pitch, onset, velocity }) => ({
        pitch,
        onset,
        velocity,
      })),
    );

    for (let i = 0; i < actual.length; i++) {
      assert.ok(Math.abs(actual[i]!.duration! - expected[i]!.duration!) < 0.01, music);
    }
  }
});

test('unterminated source ties no longer merge later attacks and agree with independent MIDI', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 c'2~ d'2 | c'1 } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: 'midi' }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const xml = parse(score.musicxml);

  assert.equal(xml.getElementsByTagName('tied').length, 0);
  assert.equal(xml.getElementsByTagName('tie').length, 0);
  assert.ok(score.diagnostics.some((d) => d.code === 'tie-endpoints'));
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset }) => ({ pitch, onset })),
    expected.map(({ pitch, onset }) => ({ pitch, onset })),
  );

  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i]!.duration! - expected[i]!.duration!) < 0.01);
  }
});

test('Verovio semi-tie import preserves native LV data but exposes repeat-tie display and playback loss', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 \once \override RepeatTie.color = #red c'1\repeatTie |
    \once \override LaissezVibrerTie.color = #blue \once \override LaissezVibrerTie.direction = #UP d'1\laissezVibrer } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: 'midi' }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI());
  const tie = mei.getElementsByTagName('tie')[0]!,
    lv = mei.getElementsByTagName('lv')[0]!;

  assert.equal(tie.getAttribute('startid'), tie.getAttribute('endid'));
  assert.equal(tie.getAttribute('color'), '#FF0000');
  assert.equal(lv.getAttribute('color'), '#0000FF');
  assert.equal(lv.getAttribute('curvedir'), 'above');
  const svg = parse(toolkit.renderToSVG(1));
  const group = elements(svg, 'g').find(
    (g) => g.getAttribute('id') === tie.getAttribute('xml:id'),
  )!;

  assert.equal(group.getElementsByTagName('path').length, 0);
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    expected.map((n) => n.pitch),
    [60, 62],
  );
  assert.deepEqual(
    actual.map((n) => n.pitch),
    [62],
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'repeat-tie-reader'));
});

test('removed tie engravers preserve native sound links while Verovio loses sound-only playback', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 c'2~ c'2 } \layout { \context { \Voice \remove Tie_engraver } } \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: 'midi' }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    expected.map((n) => n.onset),
    [0],
  );
  assert.deepEqual(
    actual.map((n) => n.onset),
    [0, 1],
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'tie-playback-reader'));
});

test('ties across intervening notes retain source endpoints while Verovio shortens playback', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 \set tieWaitForNote = ##t c'2~ d'2 | c'1 } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: 'midi' }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset }) => ({ pitch, onset })),
    expected.map(({ pitch, onset }) => ({ pitch, onset })),
  );
  assert.equal(expected[0]!.duration, 4);
  assert.ok(Math.abs(actual[0]!.duration! - 3) < 0.01);
  assert.ok(!score.diagnostics.some((d) => d.code === 'tie-wait-playback-reader'));
});

test('simultaneous enharmonic ties preserve native numbers but Verovio swaps their source notehead ownership', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 <cis'~ des'~>2 <cis' des'>2 } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI()),
    notes = elements(mei, 'note');
  const index = (ref: string) => notes.findIndex((n) => n.getAttribute('xml:id') === ref.slice(1));

  assert.deepEqual(
    elements(mei, 'tie').map((t) => [
      index(t.getAttribute('startid')!),
      index(t.getAttribute('endid')!),
    ]),
    [
      [0, 3],
      [1, 2],
    ],
  );
  assert.deepEqual(
    score.document.events
      .filter((e) => e.kind === 'tieGraphic')
      .map((t) => [t.fromNotes, t.toNotes]),
    [
      [[1], [3]],
      [[2], [4]],
    ],
  );
  const original = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );

  assert.equal((original.match(/stroke-width="0.0800"[^>]* d="M[^"]*C/g) || []).length, 2);
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.equal(expected.length, 1);
  assert.equal(actual.length, 2);
  assert.ok(
    actual.every(
      (n) =>
        n.pitch === expected[0]!.pitch &&
        n.onset === expected[0]!.onset &&
        Math.abs(n.duration! - expected[0]!.duration!) < 0.01,
    ),
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'tie-pairing-reader'));
});
