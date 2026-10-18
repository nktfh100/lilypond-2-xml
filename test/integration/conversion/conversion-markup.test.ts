import { toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

test('markup colors and nested transparency retain native runs, styling and original hidden text', async () => {
  const { scores } =
    await converter.convert(String.raw`{ c'1^\markup { \with-color "dark slate blue" \italic "colored"
    \transparent \with-color #red \bold "secret" \with-color "#f008" "half" } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const words = elements(parse(score.musicxml), 'words');

  assert.deepEqual(
    words.map((w) => w.getAttribute('color')),
    ['#483D8B', '#00000000', '#88FF0000'],
  );
  assert.equal(words[0]!.getAttribute('font-style'), 'italic');
  assert.equal(words[1]!.getAttribute('font-weight'), 'bold');
  assert.ok(words[1]!.textContent!.includes('secret'));
  assert.ok(!score.diagnostics.some((d) => d.code.startsWith('markup-')));
});

test('relative markup sizes use an explicit absolute base and preserve exact rational increments', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1^\markup { \abs-fontsize #12 { \fontsize #6 "double" \smaller "smaller" \fontsize #1/2 \bold "fraction" } } }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const words = elements(parse(score.musicxml), 'words');
  const sizes = words.map((w) => Number(w.getAttribute('font-size')));

  assert.ok(Math.abs(sizes[0]! - 24 * (72 / 72.27)) < 1e-10);
  assert.ok(Math.abs(sizes[1]! - 12 * (72 / 72.27) * Math.pow(2, -1 / 6)) < 1e-10);
  assert.ok(Math.abs(sizes[2]! - 12 * (72 / 72.27) * Math.pow(2, 1 / 12)) < 1e-10);
  assert.equal(words[2]!.getAttribute('font-weight'), 'bold');
  assert.ok(!score.diagnostics.some((d) => d.code === 'markup-font-base'));
});

test('unknown font bases and fixed font-step resets preserve other styles with explicit limits', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1^\markup { \larger \bold "relative" \abs-fontsize #20 \tiny \italic "reset" } }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const words = elements(parse(score.musicxml), 'words');

  assert.equal(words[0]!.getAttribute('font-weight'), 'bold');
  assert.equal(words[1]!.getAttribute('font-style'), 'italic');
  assert.ok(words.every((w) => !w.hasAttribute('font-size')));
  assert.ok(score.diagnostics.some((d) => d.code === 'markup-font-base'));
  assert.ok(score.diagnostics.some((d) => d.code === 'markup-font-reset'));
});

test('CSS string colors on captured grobs normalize without extraction failures', async () => {
  const { scores } =
    await converter.convert(String.raw`{ \once \override Arpeggio.color = "cornflowerblue" <c' e' g'>2\arpeggio <d' f' a'>2 |
    \once \override Slur.color = "#f00" c'2( d'2) | \once \override Tie.color = "green" e'2~ e'2 |
    \once \override Glissando.color = "#f008" f'2\glissando g'2 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.deepEqual(
    elements(xml, 'arpeggiate').map((m) => m.getAttribute('color')),
    ['#6495ED', '#6495ED', '#6495ED'],
  );
  assert.deepEqual(
    elements(xml, 'slur').map((m) => m.getAttribute('color')),
    ['#FF0000', '#FF0000'],
  );
  assert.deepEqual(
    elements(xml, 'tied').map((m) => m.getAttribute('color')),
    ['#008000', '#008000'],
  );
  assert.deepEqual(
    elements(xml, 'glissando').map((m) => m.getAttribute('color')),
    ['#88FF0000', '#88FF0000'],
  );
});

test('colored and fully transparent instrument labels retain native display data and hide fallback labels', async () => {
  const { scores } =
    await converter.convert(String.raw`\score { \new Staff \with { instrumentName = \markup { \transparent \with-color #red "secret" } } { c'1 } }
    \score { \new Staff \with { instrumentName = "Violin" \override InstrumentName.color = "cornflowerblue" } { c'1 } }`);

  for (const s of scores) {
    validate(s.musicxml);
  }

  const hidden = parse(scores[0]!.musicxml);

  assert.equal(elements(hidden, 'part-name')[0]!.getAttribute('print-object'), 'no');
  assert.equal(elements(hidden, 'part-name-display')[0]!.getAttribute('print-object'), 'no');
  assert.equal(elements(hidden, 'display-text')[0]!.getAttribute('color'), '#00000000');
  const color = parse(scores[1]!.musicxml);

  assert.equal(elements(color, 'part-name')[0]!.getAttribute('color'), '#6495ED');
  assert.equal(elements(color, 'display-text')[0]!.getAttribute('color'), '#6495ED');
});

test('cached markup retains CSS color names and short hex values without requiring compiler normalization', async () => {
  const { scores } = await converter.convert(String.raw`{ c'1^"cached" }`);
  const document = structuredClone(scores[0]!.document);
  const text = document.events.find((e) => e.kind === 'voice' && e.class === 'text-script-event')!;

  assert.equal(text.kind, 'voice');
  document.events = document.events.map((e) =>
    e === text
      ? {
          ...e,
          markup: {
            command: 'with-color-markup',
            args: ['rebeccapurple', 'cached'],
            plain: 'cached',
          },
        }
      : e,
  );
  const result = toMusicXML(document);

  validate(result.musicxml);
  assert.equal(elements(parse(result.musicxml), 'words')[0]!.getAttribute('color'), '#663399');
});

test('forced-hidden percent copies and bracket labels remain hidden under nested color markup', async () => {
  const repeated = (
    await converter.convert(
      String.raw`{ \repeat percent 2 { c'1^\markup \with-color #red "repeat" } }`,
    )
  ).scores[0]!;

  validate(repeated.musicxml);
  const measures = elements(parse(repeated.musicxml), 'measure');

  assert.equal(elements(measures[0], 'words')[0]!.getAttribute('color'), '#FF0000');
  assert.equal(elements(measures[1], 'words')[0]!.getAttribute('color'), '#00000000');
  const bracket = (
    await converter.convert(String.raw`\layout { \context { \Voice \consists Horizontal_bracket_engraver } }
    { \once \omit HorizontalBracketText \once \override HorizontalBracketText.text = \markup \with-color #blue "hidden" c'2\startGroup d'2\stopGroup }`)
  ).scores[0]!;

  validate(bracket.musicxml);
  assert.equal(elements(parse(bracket.musicxml), 'words')[0]!.getAttribute('color'), '#00000000');
});

test('formatted lyric syllables retain native text fragments, colors and font styles', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Voice = "singer" { c'2 d'2 } \addlyrics { \markup \with-color #red \bold "first" \markup \concat { \italic "sec" \bold "ond" } }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const lyrics = elements(parse(score.musicxml), 'lyric');

  assert.equal(lyrics.length, 2);
  assert.equal(lyrics[0]!.getAttribute('color'), '#FF0000');
  assert.equal(elements(lyrics[0], 'text')[0]!.getAttribute('font-weight'), 'bold');
  assert.deepEqual(
    elements(lyrics[1], 'text').map((t) => [
      t.textContent,
      t.getAttribute('font-style'),
      t.getAttribute('font-weight'),
    ]),
    [
      ['sec', 'italic', null],
      ['ond', null, 'bold'],
    ],
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'lyric-runs-reader'));
});

test('transparent lyric text remains native while source extenders and unsupported formatting are diagnosed', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Voice = "singer" { c'4 d'4 e'4 f'4 } \addlyrics { \markup \transparent "hidden" \markup \box "boxed" \markup \with-color #red "held" __ }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const lyrics = elements(parse(score.musicxml), 'lyric');

  assert.equal(lyrics[0]!.getAttribute('print-object'), 'no');
  assert.equal(texts(lyrics[0], 'text')[0], 'hidden');
  assert.equal(elements(lyrics[0], 'text')[0]!.getAttribute('color'), '#00000000');
  assert.ok(score.diagnostics.some((d) => d.code === 'lyric-markup-layout'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'lyric-text-reader'));
  assert.ok(elements(parse(score.musicxml), 'extend').length > 0);
});

test('small absolute markup point sizes serialize as schema-valid decimal attributes', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1^\markup \abs-fontsize #0.0000001 "small" }`,
  );

  validate(scores[0]!.musicxml);
  assert.ok(
    !elements(parse(scores[0]!.musicxml), 'words')[0]!.getAttribute('font-size')!.includes('e'),
  );
});

test('nested underlining preserves native double and triple strokes and diagnoses the schema limit', async () => {
  const { scores } =
    await converter.convert(String.raw`{ c'4^\markup \underline \underline \bold "double"
    d'4^\markup \underline \underline \underline "triple"
    e'4^\markup \underline \underline \underline \underline "four"
    f'4 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const words = elements(parse(score.musicxml), 'words');

  assert.deepEqual(
    words.map((w) => w.getAttribute('underline')),
    ['2', '3', '3'],
  );
  assert.equal(words[0]!.getAttribute('font-weight'), 'bold');
  assert.ok(score.diagnostics.some((d) => d.code === 'markup-underlines'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'text-decoration-reader'));
});
