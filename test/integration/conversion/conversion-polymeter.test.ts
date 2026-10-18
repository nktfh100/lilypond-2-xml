import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import {
  childElements,
  converter,
  elements,
  parse,
  texts,
} from '../../support/conversion-support.js';

test('per-staff timing retains independent native part boundaries, alignment keys and source measure numbers', async () => {
  const { scores } = await converter.convert(String.raw`\score { \new StaffGroup <<
    \new Staff { \time 3/4 c'2. d'2. } \new Staff { \time 2/4 e'2 f'2 g'2 }
    >> \layout { \enablePerStaffTiming } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    parts = elements(xml, 'part');

  assert.equal(parts.length, 2);
  assert.deepEqual(
    parts.map((p) => texts(p, 'beats')),
    [['3'], ['2']],
  );
  const measures = parts.map((p) => elements(p, 'measure'));

  assert.deepEqual(
    measures.map((ms) => ms.map((m) => m.getAttribute('text'))),
    [
      ['1', '2'],
      ['1', '2', '3'],
    ],
  );
  assert.equal(measures[0]![0]!.getAttribute('number'), measures[1]![0]!.getAttribute('number'));
  assert.equal(measures[0]![1]!.getAttribute('non-controlling'), 'yes');
  assert.equal(measures[1]![1]!.getAttribute('non-controlling'), 'yes');
  assert.ok(score.document.events.some((e) => e.kind === 'staffStep' && e.time?.numerator === 3));
  assert.ok(!score.diagnostics.some((d) => d.code === 'polymeter-reader'));
});

test('piano staves retain numbered independent time signatures and exact note timing on the first staff grid', async () => {
  const { scores } = await converter.convert(String.raw`\score { \new PianoStaff <<
    \new Staff { \time 3/4 c'2. d'2. } \new Staff { \time 2/4 e'2 f'2 g'2 }
    >> \layout { \enablePerStaffTiming } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    times = elements(xml, 'time');

  assert.deepEqual(
    times.map((t) => [t.getAttribute('number'), texts(t, 'beats')[0]]),
    [
      ['1', '3'],
      ['2', '2'],
    ],
  );
  assert.equal(elements(xml, 'measure').length, 2);
  assert.ok(score.diagnostics.some((d) => d.code === 'staff-timing-staves'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'polymeter-reader'));
});

test('aligned local meters keep separate staff signatures without claiming divergent barlines', async () => {
  const { scores } = await converter.convert(String.raw`\score { \new PianoStaff <<
    \new Staff { \time 3/4 c'2. \time 6/8 d'2. } \new Staff { \time 6/8 e'2. \time 3/4 f'2. }
    >> \layout { \enablePerStaffTiming } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.deepEqual(
    elements(xml, 'time').map((t) => [
      t.getAttribute('number'),
      texts(t, 'beats')[0],
      texts(t, 'beat-type')[0],
    ]),
    [
      ['1', '3', '4'],
      ['2', '6', '8'],
      ['1', '6', '8'],
      ['2', '3', '4'],
    ],
  );
  assert.ok(
    !score.diagnostics.some((d) => ['polymeter-reader', 'staff-timing-staves'].includes(d.code)),
  );
});

test('mid-measure local meter changes retain the correct staff number and musical offset', async () => {
  const { scores } = await converter.convert(String.raw`\score { \new PianoStaff <<
    \new Staff { \time 3/4 c'4 \time 6/8 d'2 } \new Staff { \time 6/8 e'2. }
    >> \layout { \enablePerStaffTiming } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    measure = elements(xml, 'measure')[0]!;
  const times = elements(measure, 'time');

  assert.equal(times.at(-1)!.getAttribute('number'), '1');
  assert.equal(texts(times.at(-1), 'beats')[0], '6');
  const children = childElements(measure),
    attribute = times.at(-1)!.parentNode;
  const firstNote = children.findIndex((n) => n.tagName === 'note');

  assert.ok(children.indexOf(attribute as Element) > firstNote);
});

test('per-staff pickup and cadenza timing retain native boundaries without invalid score steps', async () => {
  const { scores } = await converter.convert(String.raw`\score { \new StaffGroup <<
    \new Staff { \time 3/4 \partial 4 c'4 d'2. } \new Staff { \time 2/4 \partial 4 e'4 f'2 g'4 }
    >> \layout { \enablePerStaffTiming } }
    \score { \new Staff { \cadenzaOn c'4 d'2 \bar "|" e'1 \cadenzaOff f'1 } \layout { \enablePerStaffTiming } }`);

  for (const score of scores) {
    validate(score.musicxml);
  }

  const parts = elements(parse(scores[0]!.musicxml), 'part');

  for (const part of parts) {
    assert.equal(elements(part, 'measure')[0]!.getAttribute('implicit'), 'yes');
  }

  assert.ok(elements(parse(scores[1]!.musicxml), 'senza-misura').length > 0);
  assert.ok(scores[1]!.document.events.some((e) => e.kind === 'staffStep' && !e.timing));
});

test('scaled polymetric staff signatures retain their displayed meter and inherited timing-group measure length', async () => {
  const { scores } = await converter.convert(String.raw`\score { <<
    \new TimingStaffGroup << \new Staff { \scaleDurations 8/5 { \time 6/5 \context Staff \polymetric \time 6/8 c'8 d' e' f' g' a' } } >>
    \new TimingStaffGroup << \new Staff { \time 2/4 c'2 d'2 e'4 } >>
    >> \layout { \context { \Score \remove "Timing_translator" \accepts TimingStaffGroup }
      \context { \StaffGroup \name TimingStaffGroup \alias StaffGroup \consists "Timing_translator" } } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const steps = score.document.events.filter((e) => e.kind === 'staffStep');

  assert.ok(steps.some((e) => e.length.numerator === 6 && e.length.denominator === 5));
  assert.ok(
    elements(parse(score.musicxml), 'time').some(
      (t) => texts(t, 'beats')[0] === '6' && texts(t, 'beat-type')[0] === '8',
    ),
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'polymeter-reader'));
});
