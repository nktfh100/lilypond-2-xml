import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('resolved figured-bass formatter labels match independent SVG styles and MIDI without rerunning procedures', async () => {
  const source = String.raw`#(set-global-staff-size 18)
    #(define formatter-count 0)
    #(define (formatter figure event context)
      (set! formatter-count (+ formatter-count 1))
      (case figure
        ((6) (markup #:with-color blue #:bold #:abs-fontsize 14 (string-append "Count" (number->string formatter-count))))
        ((5) (markup #:italic #:fontsize 2 "Relative"))
        ((4) (markup #:abs-fontsize 24 #:small "Reset"))
        ((3) (markup #:transparent "Secret"))
        (else (make-null-markup))))
    \score { << \new Staff { \tempo 4 = 120 c4 d e f g a } \figures {
      \override BassFigure.font-size = #3 \override BassFigure.color = #red
      \set figuredBassFormatter = #formatter <6+>4 <6+> <5-> <4+> <3> <2> } >> \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const numbers = elements(xml, 'figure-number');

  assert.deepEqual(
    numbers.map((n) => n.textContent),
    ['Count1', 'Count2', 'Relative', 'Reset', 'Secret', ''],
  );
  assert.equal(xml.getElementsByTagName('prefix').length, 0);
  assert.equal(xml.getElementsByTagName('suffix').length, 0);
  const original = new TextDecoder().decode(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
    ),
    svg = parse(original);
  const texts = elements(svg, 'text');
  const labels = texts
    .map((n) => n.textContent)
    .filter(
      (text) => text?.startsWith('Count') || ['Relative', 'Reset', 'Secret'].includes(text ?? ''),
    );

  assert.deepEqual(labels, ['Count1', 'Count2', 'Relative', 'Reset']);
  assert.ok(!original.includes('Secret'));
  const unitMillimeters =
    Number(svg.documentElement.getAttribute('width')!.replace('mm', '')) /
    Number(svg.documentElement.getAttribute('viewBox')!.split(/\s+/)[2]);

  for (const label of labels) {
    const printed = texts.find((n) => n.textContent === label)!,
      written = numbers.find((n) => n.textContent === label)!;
    const physical = (Number(printed.getAttribute('font-size')) * unitMillimeters * 72) / 25.4;

    assert.ok(
      Math.abs(Number(written.getAttribute('font-size')) - physical) < 0.003,
      `${label}: source ${physical}, native ${written.getAttribute('font-size')}`,
    );

    for (const attr of ['font-weight', 'font-style']) {
      assert.equal(written.getAttribute(attr) ?? 'normal', printed.getAttribute(attr) ?? 'normal');
    }

    let parent = printed.parentElement;

    while (parent && !parent.hasAttribute('color')) {
      parent = parent.parentElement;
    }

    assert.equal(
      parent?.getAttribute('color'),
      label?.startsWith('Count')
        ? 'rgba(0.0000%, 0.0000%, 100.0000%, 100.0000%)'
        : 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
    );
  }

  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI());

  assert.deepEqual(
    elements(mei, 'f').map((n) => n.textContent),
    ['Count1', 'Count2', 'Relative', 'Reset'],
  );
  assert.ok(!toolkit.renderToSVG(1).includes('Secret'));
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
});

test('explicit figure text and custom formatters follow the actual source display and keep continuation endpoints', async () => {
  const source = String.raw`\score { << \new Staff { \tempo 4 = 120 c4 d e f } \figures {
    \set figuredBassFormatter = #(lambda (figure event context) (markup #:bold "Formatted"))
    \bassFigureExtendersOn <\markup \italic "EventLabel" 6+>4 <6+> <6+> <6+> } >> \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const svg = parse(
    new TextDecoder().decode(Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1]),
  );
  const expected = elements(svg, 'text')
    .map((n) => n.textContent)
    .filter((text) => ['EventLabel', 'Formatted'].includes(text ?? ''));
  const numbers = elements(xml, 'figure-number');

  assert.deepEqual(
    numbers.map((n) => n.textContent),
    expected,
  );
  assert.ok(expected.length);
  assert.equal(xml.getElementsByTagName('prefix').length, 0);
  assert.ok(xml.getElementsByTagName('extend').length >= 2);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const original = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    original.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - original[i]!.duration!) < 0.01));
});

test('removed and restored figured-bass engravers match independent source visibility on piano staves', async () => {
  for (const removed of [true, false]) {
    const setup = removed
      ? String.raw`\remove Figured_bass_engraver`
      : String.raw`\remove Figured_bass_engraver \consists Figured_bass_engraver`;
    const source =
      String.raw`\score { \new PianoStaff <<
      \new Staff = "upper" << { \tempo 4 = 120 c'2 d' } \new FiguredBass \with { ` +
      setup +
      String.raw` } \figuremode { <\markup "Ghost" 6+>1 } >>
      \new Staff = "lower" << { c2 d } \figures { <\markup "Visible" 4+>1 } >> >> \layout {} \midi {} }`;
    const [{ scores }, compiled] = await Promise.all([
      converter.convert(source),
      midiCompiler.compile(source, { format: ['svg', 'midi'] }),
    ]);
    const score = scores[0]!;

    validate(score.musicxml);
    const xml = parse(score.musicxml);
    const groups = elements(xml, 'figured-bass');

    assert.equal(groups[0]!.getAttribute('print-object'), removed ? 'no' : null);
    assert.equal(groups[1]!.getAttribute('print-object'), null);
    const svg = parse(
      new TextDecoder().decode(
        Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
      ),
    );
    const labels = new Set(['Ghost', 'Visible']),
      original = elements(svg, 'text')
        .map((n) => n.textContent)
        .filter((text) => labels.has(text ?? ''));
    const native = groups
      .filter((g) => g.getAttribute('print-object') !== 'no')
      .flatMap((g) => elements(g, 'figure-number'))
      .map((n) => n.textContent)
      .filter((text) => labels.has(text ?? ''));

    assert.deepEqual([...native].sort(), [...original].sort());
    assert.deepEqual([...native].sort(), removed ? ['Visible'] : ['Ghost', 'Visible']);
    const figures = score.document.events.filter((e) => e.kind === 'figuredBass');

    assert.ok(figures[0]!.figures.every((f) => f.graphic === !removed));
    assert.ok(figures[1]!.figures.every((f) => f.graphic === true));
    assert.equal(toolkit.loadData(score.musicxml), 1);
    const mei = parse(toolkit.getMEI());
    const text = elements(mei, 'f').map((n) => n.textContent);

    assert.equal(text.includes('Ghost'), !removed);
    assert.ok(text.includes('Visible'));
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
    actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  }
});

test('replacement figured-bass text grobs retain source labels and physical styles without invented absence', async () => {
  const source = String.raw`\score { \new Staff \with { \remove Figured_bass_engraver
    \consists #(lambda (ctx) (make-engraver (listeners ((bass-figure-event engraver event)
      (let ((grob (ly:engraver-make-grob engraver 'BassFigure event)))
        (ly:grob-set-property! grob 'text (markup #:with-color blue #:bold #:abs-fontsize 14 "Replacement"))))))) }
    << { \tempo 4 = 120 c1 } \figuremode { <6+>1 } >> \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    number = xml.getElementsByTagName('figure-number')[0]!;

  assert.equal(number.textContent, 'Replacement');
  assert.equal(number.getAttribute('color'), '#0000FF');
  assert.equal(number.getAttribute('font-weight'), 'bold');
  assert.equal(xml.getElementsByTagName('prefix').length, 0);
  const svg = parse(
    new TextDecoder().decode(Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1]),
  );
  const label = elements(svg, 'text').find((n) => n.textContent === 'Replacement')!;

  assert.ok(label);
  const unitMillimeters =
    Number(svg.documentElement.getAttribute('width')!.replace('mm', '')) /
    Number(svg.documentElement.getAttribute('viewBox')!.split(/\s+/)[2]);
  const physical = (Number(label.getAttribute('font-size')) * unitMillimeters * 72) / 25.4;

  assert.ok(Math.abs(Number(number.getAttribute('font-size')) - physical) < 0.003);
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-row'));
  assert.equal(toolkit.loadData(score.musicxml), 1);
  assert.ok(toolkit.getMEI().includes('Replacement'));
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
});
