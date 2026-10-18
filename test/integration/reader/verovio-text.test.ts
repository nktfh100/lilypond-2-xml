import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('native text colors and transparency match independent LilyPond display and preserve playback', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 c'1^\markup { \with-color #red "red"
    \transparent \with-color #blue \bold "secret" \abs-fontsize #12 \fontsize #6 "large" } } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI()),
    rends = elements(mei, 'rend');

  assert.equal(
    rends.find((r) => r.textContent?.trim() === 'red')!.getAttribute('color'),
    '#FF0000',
  );
  assert.equal(
    rends.find((r) => r.textContent?.trim() === 'secret')!.getAttribute('color'),
    '#00000000',
  );
  assert.ok(rends.every((r) => !r.hasAttribute('fontsize')));
  const svg = toolkit.renderToSVG(1);

  assert.ok(svg.includes('fill="#FF0000"'));
  assert.ok(svg.includes('fill="#00000000"'));
  const original = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );

  assert.ok(original.includes('red'));
  assert.ok(!original.includes('secret'));
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  assert.ok(Math.abs(actual[0]!.duration! - expected[0]!.duration!) < 0.01);
  assert.ok(!score.diagnostics.some((d) => d.code === 'text-font-size-reader'));
});

test('native lyric runs retain one syllable while Verovio drops fragment colors and splits formatting', async () => {
  const source = String.raw`\score { \new Voice = "singer" { \tempo 4 = 120 c'2 d'2 } \addlyrics {
    \markup \with-color #red \bold "first" \markup \concat { \italic "sec" \with-color #blue \bold "ond" } } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI()),
    verses = elements(mei, 'verse');

  assert.equal(verses[0]!.getAttribute('color'), '#FF0000');
  assert.equal(verses[0]!.getElementsByTagName('syl')[0]!.getAttribute('fontweight'), 'bold');
  assert.equal(verses[1]!.getElementsByTagName('syl').length, 2);
  assert.ok(elements(verses[1]!, 'syl').every((s) => !s.hasAttribute('color')));
  const original = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );

  assert.ok(original.includes('first'));
  assert.ok(original.includes('ond'));
  assert.ok(original.includes('rgba(0.0000%, 0.0000%, 100.0000%, 100.0000%)'));
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

  assert.ok(!score.diagnostics.some((d) => d.code === 'lyric-text-reader'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'lyric-runs-reader'));
});

test('fully transparent labels stay absent while visible label color remains native despite reader loss', async () => {
  const { scores } =
    await converter.convert(String.raw`\score { \new Staff \with { instrumentName = \markup \transparent \with-color #red "secret" } { c'1 } }
    \score { \new Staff \with { instrumentName = "Violin" \override InstrumentName.color = "cornflowerblue" } { c'1 } }`);

  for (const score of scores) {
    validate(score.musicxml);
  }

  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.doesNotMatch(toolkit.getMEI(), /<label[ >]/);
  assert.equal(toolkit.loadData(scores[1]!.musicxml), 1);
  const mei = parse(toolkit.getMEI());

  assert.equal(mei.getElementsByTagName('label')[0]!.textContent, 'Violin');
  assert.equal(mei.getElementsByTagName('label')[0]!.getAttribute('color'), null);
  assert.ok(scores[1]!.musicxml.includes('color="#6495ED"'));
  assert.ok(!scores[1]!.diagnostics.some((d) => d.code === 'instrument-name-reader'));
});

test('native multiple underlines match independent source strokes while the reader drops decoration', async () => {
  const source = String.raw`\score { { \tempo 4 = 120
    c'2^\markup \with-color #blue \underline \underline "double"
    d'2^\markup \with-color #blue \underline \underline \underline "triple" } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI());
  const runs = elements(mei, 'rend').filter((r) =>
    ['double', 'triple'].includes(r.textContent?.trim() ?? ''),
  );

  assert.equal(runs.length, 2);
  assert.ok(runs.every((r) => !r.hasAttribute('rend')));
  const original = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );
  const svg = parse(original);
  const blue = elements(svg, 'g').filter(
    (g) => g.getAttribute('color') === 'rgba(0.0000%, 0.0000%, 100.0000%, 100.0000%)',
  );

  assert.equal(
    blue.reduce((n, g) => n + g.getElementsByTagName('line').length, 0),
    5,
  );
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset }) => ({ pitch, onset })),
    expected.map(({ pitch, onset }) => ({ pitch, onset })),
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'text-decoration-reader'));
});
