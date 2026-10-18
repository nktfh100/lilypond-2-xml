import { toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import {
  converter,
  directionTexts,
  elements,
  parse,
  texts,
} from '../../support/conversion-support.js';

test('nested analysis and measure brackets retain distinct numbers and compiler-resolved endpoints', async () => {
  const { scores } = await converter.convert(String.raw`\layout {
    \context { \Voice \consists Horizontal_bracket_engraver }
    \context { \Staff \consists Measure_spanner_engraver }
  } { \tweak text "measure" \startMeasureSpanner
    c'4-\tweak HorizontalBracketText.text \markup \bold "outer" \startGroup\startGroup
    d'4\stopGroup e'4\startGroup f'4\stopGroup\stopGroup | g'1 \stopMeasureSpanner }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const brackets = elements(xml, 'bracket');

  assert.deepEqual(
    brackets.map((b) => [b.getAttribute('type'), b.getAttribute('number')]),
    [
      ['start', '1'],
      ['start', '2'],
      ['start', '3'],
      ['stop', '2'],
      ['start', '2'],
      ['stop', '1'],
      ['stop', '2'],
      ['stop', '3'],
    ],
  );
  assert.deepEqual(
    brackets.map((b) => texts(b.parentElement!.parentElement!, 'offset')),
    [[], [], [], ['2'], ['4'], ['6'], ['6'], ['8']],
  );
  assert.equal(brackets[0]!.getAttribute('line-end'), 'up');
  assert.equal(brackets[2]!.getAttribute('line-end'), 'down');
  assert.equal(brackets[2]!.getAttribute('end-length'), '7');
  assert.equal(brackets[0]!.parentElement!.parentElement!.getAttribute('placement'), 'below');
  assert.deepEqual(directionTexts(xml).filter(Boolean), ['outer', 'measure']);
  const outer = elements(xml, 'words').find((w) => w.textContent === 'outer')!;

  assert.equal(outer.getAttribute('font-weight'), 'bold');
  assert.deepEqual(texts(outer.parentElement!.parentElement!, 'offset'), ['3']);
  assert.ok(!score.diagnostics.some((d) => d.code === 'bracket-nesting-reader'));
  assert.ok(
    !score.diagnostics.some((d) => d.code.startsWith('unmapped') || d.code === 'bracket-stencil'),
  );
});

test('bracket styles, hook heights, colors and independent visibility use native direction data', async () => {
  const { scores } = await converter.convert(String.raw`\layout {
    \context { \Voice \consists Horizontal_bracket_engraver }
  } { \once \override HorizontalBracket.direction = #UP
    \once \override HorizontalBracket.edge-height = #'(0 . -2)
    \once \override HorizontalBracket.style = #'dashed-line
    \once \override HorizontalBracket.color = #red
    c'4\startGroup d'4\stopGroup
    \once \omit HorizontalBracket
    \once \override HorizontalBracketText.text = "visible label"
    e'4\startGroup f'4\stopGroup
    \once \override HorizontalBracket.transparent = ##t
    g'4\startGroup a'4\stopGroup }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const brackets = elements(parse(score.musicxml), 'bracket');

  assert.equal(brackets.length, 6);
  assert.equal(brackets[0]!.getAttribute('line-end'), 'none');
  assert.equal(brackets[1]!.getAttribute('line-end'), 'up');
  assert.equal(brackets[1]!.getAttribute('end-length'), '20');
  assert.equal(brackets[0]!.getAttribute('line-type'), 'dashed');
  assert.equal(brackets[0]!.getAttribute('color'), '#FF0000');
  assert.ok(brackets.slice(2).every((b) => b.getAttribute('color') === '#00000000'));
  assert.ok(directionTexts(parse(score.musicxml)).includes('visible label'));
});

test('measure spanners use bar-column bounds even when start and stop events occur mid-measure', async () => {
  const { scores } = await converter.convert(String.raw`\layout {
    \context { \Staff \consists Measure_spanner_engraver }
  } { c'4 \startMeasureSpanner d'2. | e'4 \stopMeasureSpanner f'2. | g'1 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const spans = score.document.events.filter((e) => e.kind === 'bracket');

  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0]!.moment.main, { numerator: 1, denominator: 1 });
  assert.deepEqual(spans[0]!.endMoment!.main, { numerator: 2, denominator: 1 });
  const measures = elements(parse(score.musicxml), 'measure');

  assert.equal(elements(measures[0], 'bracket').length, 0);
  assert.equal(elements(measures[1], 'bracket').length, 1);
  assert.equal(elements(measures[2], 'bracket').length, 1);
});

test('removing bracket engravers does not resurrect graphical annotations from events', async () => {
  const { scores } = await converter.convert(String.raw`{ c'2\startGroup d'2\stopGroup }`);

  validate(scores[0]!.musicxml);
  assert.equal(elements(parse(scores[0]!.musicxml), 'bracket').length, 0);
  assert.equal(scores[0]!.document.bracketsCaptured, true);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'unmapped-event'));
});

test('percent repeats shift complete bracket spans and hide the repeated native directions', async () => {
  const { scores } = await converter.convert(String.raw`\layout {
    \context { \Voice \consists Horizontal_bracket_engraver }
  } { \repeat percent 3 { c'4\startGroup d'4\stopGroup e'2 } f'1 }`);

  validate(scores[0]!.musicxml);
  const measures = elements(parse(scores[0]!.musicxml), 'measure');

  assert.deepEqual(
    measures.map((m) => elements(m, 'bracket').length),
    [2, 2, 2, 0],
  );
  assert.ok(
    measures
      .slice(1, 3)
      .every((m) => elements(m, 'bracket').every((b) => b.getAttribute('color') === '#00000000')),
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'bracket-endpoints'));
});

test('independent piano-staff brackets retain native staff ownership and distinct group numbers', async () => {
  const { scores } = await converter.convert(String.raw`\layout {
    \context { \Voice \consists Horizontal_bracket_engraver }
  } \new PianoStaff <<
    \new Staff { c''2\startGroup d''2\stopGroup }
    \new Staff { c'2\startGroup d'2\stopGroup }
  >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const brackets = elements(parse(score.musicxml), 'bracket');

  assert.deepEqual(
    brackets.map((b) => texts(b.parentElement!.parentElement!, 'staff')),
    [['1'], ['2'], ['1'], ['2']],
  );
  assert.deepEqual(
    brackets.filter((b) => b.getAttribute('type') === 'start').map((b) => b.getAttribute('number')),
    ['1', '2'],
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'bracket-staff-reader'));
});

test('bracket numbering reuses closed spans and rejects more than sixteen overlapping spans', async () => {
  const layout = String.raw`\layout { \context { \Voice \consists Horizontal_bracket_engraver } }`;
  const { scores } = await converter.convert(
    layout + String.raw`{ \repeat unfold 20 { c'4\startGroup d'4\stopGroup } }`,
  );

  validate(scores[0]!.musicxml);
  const starts = elements(parse(scores[0]!.musicxml), 'bracket').filter(
    (b) => b.getAttribute('type') === 'start',
  );

  assert.equal(starts.length, 20);
  assert.ok(starts.every((b) => b.getAttribute('number') === '1'));
  await assert.rejects(
    converter.convert(
      layout +
        "{ c'4" +
        String.raw`\startGroup`.repeat(17) +
        " d'4" +
        String.raw`\stopGroup`.repeat(17) +
        ' }',
    ),
    /More than 16 overlapping brackets/,
  );
});

test('older event documents explicitly report missing bracket graphics instead of inventing endpoints', async () => {
  const { scores } = await converter.convert(
    String.raw`\layout { \context { \Voice \consists Horizontal_bracket_engraver } } { c'2\startGroup d'2\stopGroup }`,
  );
  const document = structuredClone(scores[0]!.document);

  delete document.bracketsCaptured;
  document.events = document.events.filter((e) => e.kind !== 'bracket');
  const score = toMusicXML(document);

  validate(score.musicxml);
  assert.equal(elements(parse(score.musicxml), 'bracket').length, 0);
  assert.ok(score.diagnostics.some((d) => d.code === 'bracket-history'));
  assert.ok(score.diagnostics.some((d) => d.code === 'unmapped-event'));
});

test('analysis brackets work on unpitched and tablature note columns and reset between scores', async () => {
  const { scores } = await converter.convert(String.raw`\layout {
    \context { \DrumVoice \consists Horizontal_bracket_engraver }
    \context { \TabVoice \consists Horizontal_bracket_engraver }
  }
  \score { \new DrumStaff \drummode { sn2\startGroup bd2\stopGroup } }
  \score { \new TabStaff { c'2\startGroup d'2\stopGroup } }`);

  assert.equal(scores.length, 2);

  for (const score of scores) {
    validate(score.musicxml);
    const spans = score.document.events.filter((e) => e.kind === 'bracket');

    assert.equal(spans.length, 1);
    assert.equal(spans[0]!.id, 1);
    assert.ok(spans[0]!.resolvedStart);
    assert.deepEqual(spans[0]!.endMoment!.main, {
      numerator: 1,
      denominator: 2,
    });
    assert.equal(elements(parse(score.musicxml), 'bracket').length, 2);
  }
});

test('unterminated measure brackets and repeated spans crossing pattern boundaries are explicitly reported', async () => {
  const { scores } = await converter.convert(String.raw`\layout {
    \context { \Staff \consists Measure_spanner_engraver }
  } { c'1 \startMeasureSpanner d'1 }`);

  validate(scores[0]!.musicxml);
  assert.equal(elements(parse(scores[0]!.musicxml), 'bracket').length, 0);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'bracket-endpoints'));
  const repeated =
    await converter.convert(String.raw`\layout { \context { \Voice \consists Horizontal_bracket_engraver } }
    { \repeat percent 2 { c'4\startGroup d'2. } e'1\stopGroup }`);

  validate(repeated.scores[0]!.musicxml);
  assert.equal(elements(parse(repeated.scores[0]!.musicxml), 'bracket').length, 2);
  assert.ok(repeated.scores[0]!.diagnostics.some((d) => d.code === 'bracket-percent'));
});

test('bracket line suppression and dash fractions retain native visibility and dash geometry', async () => {
  const { scores } =
    await converter.convert(String.raw`\layout { \context { \Voice \consists Horizontal_bracket_engraver } }
    { \once \override HorizontalBracket.style = #'none
      \once \override HorizontalBracketText.text = "label without line"
      c'4\startGroup d'4\stopGroup
      \once \override HorizontalBracket.style = #'dashed-line
      \once \override HorizontalBracket.dash-fraction = #0
      e'4\startGroup f'4\stopGroup
      \once \override HorizontalBracket.style = #'dashed-line
      \once \override HorizontalBracket.dash-period = #2
      \once \override HorizontalBracket.dash-fraction = #0.25
      g'4\startGroup a'4\stopGroup
      \once \override HorizontalBracket.style = #'dashed-line
      \once \override HorizontalBracket.dash-period = #0
      b'4\startGroup c''4\stopGroup }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const brackets = elements(parse(score.musicxml), 'bracket');

  assert.equal(brackets.length, 8);
  assert.ok(brackets.slice(0, 2).every((b) => b.getAttribute('color') === '#00000000'));
  assert.equal(brackets[2]!.getAttribute('line-type'), 'dotted');
  assert.equal(brackets[4]!.getAttribute('dash-length'), '5');
  assert.equal(brackets[4]!.getAttribute('space-length'), '15');
  assert.ok(brackets.slice(6).every((b) => b.getAttribute('color') === '#00000000'));
  assert.ok(directionTexts(parse(score.musicxml)).includes('label without line'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'bracket-style'));
});

test('exact rational bracket dimensions and colors remain native and schema-valid', async () => {
  const { scores } =
    await converter.convert(String.raw`\layout { \context { \Voice \consists Horizontal_bracket_engraver } }
    { \once \override HorizontalBracket.edge-height = #'(1/2 . 1/3)
      \once \override HorizontalBracket.color = #(rgb-color 1/2 0 1/4)
      \once \override HorizontalBracket.style = #'dashed-line
      \once \override HorizontalBracket.dash-fraction = #1/4
      \once \override HorizontalBracket.dash-period = #3/2
      c'2\startGroup d'2\stopGroup }`);

  validate(scores[0]!.musicxml);
  const brackets = elements(parse(scores[0]!.musicxml), 'bracket');

  assert.equal(brackets[0]!.getAttribute('end-length'), '5');
  assert.ok(Math.abs(Number(brackets[1]!.getAttribute('end-length')) - 10 / 3) < 1e-12);
  assert.equal(brackets[0]!.getAttribute('color'), '#800040');
  assert.equal(brackets[0]!.getAttribute('dash-length'), '3.75');
  assert.equal(brackets[0]!.getAttribute('space-length'), '11.25');
});
