import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

test('resolved tie graphics retain dash styles, colors, placement, rational offsets and hidden curves', async () => {
  const { scores } = await converter.convert(String.raw`{ \tieUp \tieDashed
    \once \override Tie.color = #'(1/2 0 1) \once \override Tie.extra-offset = #'(1/2 . -1/4) c'2~ c'2 |
    \tieDown \tieDotted \once \omit Tie d'2~ d'2 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(score.document.tiesCaptured, true);
  const marks = elements(parse(score.musicxml), 'tied');

  assert.equal(marks.length, 4);
  assert.deepEqual(
    marks.map((m) => m.getAttribute('line-type')),
    ['dashed', 'dashed', 'dotted', 'dotted'],
  );
  assert.deepEqual(
    marks.map((m) => m.getAttribute('placement')),
    ['above', 'above', 'below', 'below'],
  );
  assert.equal(marks[0]!.getAttribute('color'), '#8000FF');
  const tie = score.document.events.find(
    (event) => event.kind === 'tieGraphic' && event.fromNotes[0] === 1,
  );

  assert.ok(
    tie?.kind === 'tieGraphic' && tie.resolvedGeometry,
    'expected final tie geometry for the offset tie',
  );
  assert.deepEqual(tie.offset, [0.5, -0.25]);
  const geometry = tie.resolvedGeometry;
  const staffSpace = score.document.paper?.['staff-space'];

  assert.ok(typeof staffSpace === 'number' && staffSpace > 0);
  const factor = (geometry.outputScale * 10) / staffSpace;
  const firstEndpoint = geometry.points[0],
    firstControl = geometry.points[1];
  const lastEndpoint = geometry.points[3],
    lastControl = geometry.points[2];
  const near = (mark: Element, name: string, expected: number) =>
    assert.ok(
      Math.abs(Number(mark.getAttribute(name)) - expected) < 1e-8,
      `${name} should match independently projected source geometry`,
    );

  near(marks[0]!, 'default-x', (firstEndpoint[0] - geometry.fromNoteOrigin[0]) * factor);
  near(marks[0]!, 'default-y', (firstEndpoint[1] - geometry.fromStaffTopY) * factor);
  near(marks[0]!, 'bezier-x', (firstControl[0] - firstEndpoint[0]) * factor);
  near(marks[0]!, 'bezier-y', (firstControl[1] - firstEndpoint[1]) * factor);
  near(marks[1]!, 'default-x', (lastEndpoint[0] - geometry.toNoteOrigin[0]) * factor);
  near(marks[1]!, 'default-y', (lastEndpoint[1] - geometry.toStaffTopY) * factor);
  near(marks[1]!, 'bezier-x', (lastControl[0] - lastEndpoint[0]) * factor);
  near(marks[1]!, 'bezier-y', (lastControl[1] - lastEndpoint[1]) * factor);
  assert.equal(
    marks[0]!.getAttribute('relative-x'),
    null,
    'resolved geometry already includes the source offset',
  );
  assert.equal(
    marks[0]!.getAttribute('relative-y'),
    null,
    'resolved geometry already includes the source offset',
  );
  assert.equal(marks[0]!.getAttribute('dash-length'), '3');

  for (const m of marks.slice(2)) {
    assert.equal(m.getAttribute('color'), '#00000000');
    assert.equal(m.parentElement!.getAttribute('print-object'), 'no');
  }
});

test('chord ties retain selected notehead pairs and resolved individual directions without false custom-curve flags', async () => {
  const { scores } = await converter.convert(String.raw`{ <c'~ e' g'~>2 <c' f' g'>2 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.deepEqual(
    elements(xml, 'note')
      .filter((n) => elements(n, 'tied').length)
      .map((n) => texts(n, 'step')[0]),
    ['C', 'G', 'C', 'G'],
  );
  const spans = score.document.events.filter((e) => e.kind === 'tieGraphic');

  assert.deepEqual(
    spans.map((s) => [s.fromNotes, s.toNotes]),
    [
      [[1], [4]],
      [[3], [6]],
    ],
  );
  assert.deepEqual(
    spans.map((s) => s.direction),
    [-1, 1],
  );
  assert.ok(spans.every((s) => !s.customControls && s.controlPoints === null));
  assert.ok(!score.diagnostics.some((d) => d.code === 'tie-layout'));
});

test('semi-ties preserve per-note ownership and native paired repeat or let-ring notation', async () => {
  const { scores } = await converter.convert(String.raw`{ \once \override RepeatTie.direction = #UP
    \once \override RepeatTie.color = #red <c'\repeatTie e' g'\laissezVibrer>1 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const notes = elements(parse(score.musicxml), 'note');

  assert.deepEqual(
    elements(notes[0], 'tied').map((t) => t.getAttribute('type')),
    ['start', 'stop'],
  );
  assert.equal(elements(notes[1], 'tied').length, 0);
  assert.equal(elements(notes[2], 'tied')[0]!.getAttribute('type'), 'let-ring');
  assert.equal(elements(notes[0], 'tied')[0]!.getAttribute('placement'), 'above');
  assert.equal(elements(parse(score.musicxml), 'tie').length, 0);
  assert.ok(!score.diagnostics.some((d) => d.code === 'repeat-tie-reader'));
});

test('tie graphics anchor to the last split segment and first destination segment while sound pairs retain enharmonic spelling', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \tieUp \once \override Tie.color = #red cis'1.~ des'2 }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    notes = elements(xml, 'note');

  assert.deepEqual(
    notes.map((n) => elements(n, 'tie').map((t) => t.getAttribute('type'))),
    [['start'], ['stop', 'start'], ['stop']],
  );
  assert.equal(elements(notes[0], 'tied')[0]!.getAttribute('color'), null);
  assert.equal(elements(notes[1], 'tied')[1]!.getAttribute('color'), '#FF0000');
  assert.equal(elements(notes[2], 'tied')[0]!.getAttribute('color'), '#FF0000');
  assert.deepEqual(
    notes.map((n) => texts(n, 'step')[0]),
    ['C', 'C', 'D'],
  );
});

test('ties support grace, cross-staff piano and tablature bounds', async () => {
  for (const source of [
    String.raw`{ \grace { c'8~ c'8 } d'1 }`,
    String.raw`\new PianoStaff << \new Staff = "up" { c'2~ \change Staff = "down" c'2 } \new Staff = "down" { s1 } >>`,
    String.raw`\new TabStaff { e'2~ e'2 }`,
  ]) {
    const { scores } = await converter.convert(source);

    validate(scores[0]!.musicxml);
    assert.equal(elements(parse(scores[0]!.musicxml), 'tied').length, 2);
    assert.ok(
      !scores[0]!.diagnostics.some((d) => d.code === 'tie-anchor' || d.code === 'tie-endpoints'),
    );
  }
});

test('tie custom curves, partial dash patterns, stencils, details and missing bounds report explicit limits', async () => {
  const { scores } =
    await converter.convert(String.raw`{ \shape #'((0 . 0) (0 . 2) (0 . 2) (0 . 0)) Tie c'2~ c'2 |
    \once \override Tie.stencil = #(lambda (g) (grob-interpret-markup g "custom")) d'2~ d'2 |
    \once \override Tie.details.height-limit = #2 \tieHalfDashed e'2~ e'2 | f'1~ }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(elements(parse(score.musicxml), 'tied').length, 6);

  for (const code of [
    'tie-layout',
    'tie-stencil',
    'tie-dash-pattern',
    'tie-endpoints',
    'tie-playback-unresolved',
  ]) {
    assert.ok(
      score.diagnostics.some((d) => d.code === code),
      code,
    );
  }
});

test('percent-repeat ties remap both noteheads and report crossing pattern boundaries', async () => {
  const { scores } = await converter.convert(String.raw`{ \repeat percent 3 { c'2~ c'2 } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const measures = elements(parse(score.musicxml), 'measure');

  assert.deepEqual(
    measures.map((m) => elements(m, 'tied').length),
    [2, 2, 2],
  );
  assert.ok(
    measures
      .slice(1)
      .every((m) => elements(m, 'tied').every((t) => t.getAttribute('color') === '#00000000')),
  );
  const crossing = await converter.convert(String.raw`{ \repeat percent 2 { c'1~ } c'1 }`);

  validate(crossing.scores[0]!.musicxml);
  assert.ok(crossing.scores[0]!.diagnostics.some((d) => d.code === 'tie-percent'));
});

test('more than sixteen distinct chord pitches can retain native ties without a global numbering limit', async () => {
  const chord = Array.from(
    { length: 17 },
    (_, i) => `${['c', 'd', 'e', 'f', 'g', 'a', 'b'][i % 7]}${"'".repeat(1 + Math.floor(i / 7))}`,
  ).join(' ');
  const { scores } = await converter.convert(`{ <${chord}>2~ <${chord}>2 }`);

  validate(scores[0]!.musicxml);
  assert.equal(elements(parse(scores[0]!.musicxml), 'tied').length, 34);
});

test('removed tie engravers retain sound-only data and legacy documents retain explicit history limits', async () => {
  const { scores } = await converter.convert(
    String.raw`\layout { \context { \Voice \remove Tie_engraver } } { c'2~ c'2 }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.equal(elements(xml, 'tied').length, 0);
  assert.equal(elements(xml, 'tie').length, 2);
  assert.ok(!score.diagnostics.some((d) => d.code === 'tie-playback-reader'));
  const legacy = structuredClone(score.document);

  delete legacy.tiesCaptured;
  const result = toMusicXML(legacy);

  validate(result.musicxml);
  assert.equal(elements(parse(result.musicxml), 'tied').length, 2);
  assert.ok(result.diagnostics.some((d) => d.code === 'tie-history'));
});

test('overlapping enharmonic chord ties retain distinct native numbers', async () => {
  const { scores } = await converter.convert(String.raw`{ <cis'~ des'~>2 <cis' des'>2 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const marks = elements(parse(score.musicxml), 'tied');

  assert.deepEqual(
    marks.map((m) => m.getAttribute('number')),
    ['1', '2', '1', '2'],
  );
  assert.deepEqual(
    score.document.events
      .filter((e) => e.kind === 'tieGraphic')
      .map((e) => [e.fromNotes, e.toNotes]),
    [
      [[1], [3]],
      [[2], [4]],
    ],
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'tie-pairing-reader'));
});
