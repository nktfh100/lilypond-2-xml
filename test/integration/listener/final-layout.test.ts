import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ConvertedScore, createConverter } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { elements, parse } from '../../support/xml-support.js';

const converter = createConverter(),
  compiler = createReusableCompiler();
const reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});
const piano = (upper = '', lower = '', group = '') => String.raw`\score {
  \new PianoStaff \with { instrumentName = "Piano" shortInstrumentName = "Pno." ${group} } <<
    \new Staff = "upper" \with { instrumentName = "RightHand" shortInstrumentName = "RH." ${upper} } { c'1 \break d'1 }
    \new Staff = "lower" \with { instrumentName = "LeftHand" shortInstrumentName = "LH." ${lower} } { c1 d1 }
  >> \layout {} \midi { \tempo 4 = 120 } }`;
const pieces = (score: ConvertedScore) =>
  score.document.events.filter((e) => e.kind === 'instrumentLabelPiece');
const stage = (score: ConvertedScore) => {
  const values = score.document.events.filter((e) => e.kind === 'finalLayout');

  assert.equal(values.length, 1);

  return values[0]!;
};
const complete = (score: ConvertedScore) => {
  assert.equal(stage(score).status, 'complete');
  assert.equal(stage(score).failure, null);
  validate(score.musicxml);
};

// A plain source SVG is independent of the event listener and the native writer.
// These controlled fixtures have two ordinary five-line staves per system.
function compareSvg(score: ConvertedScore, svg: string) {
  const doc = parse(svg);
  const translate = (n: Element) => {
    const m = (n.parentNode as Element)
      .getAttribute('transform')
      ?.match(/translate\(([-\d.]+), ([-\d.]+)\)/);

    return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined;
  };
  const lines = elements(doc, 'line')
    .filter((n) => Number(n.getAttribute('x2')) - Number(n.getAttribute('x1')) > 10)
    .map(translate)
    .filter((p): p is { x: number; y: number } => !!p)
    .sort((a, b) => a.y - b.y);
  const lower = score.document.contexts.find((c) => c.name === 'lower')!.id;
  const texts = elements(doc, 'text');

  for (const piece of pieces(score)) {
    const text = texts.find((n) => n.textContent === piece.text);

    if (piece.hidden) {
      assert.equal(text, undefined);
      continue;
    }

    assert.ok(text, piece.text);
    const position = translate(text)!;
    const staff = lines[((piece.system - 1) * 2 + (piece.context === lower ? 1 : 0)) * 5]!;

    assert.ok(staff, piece.text);
    assert.ok(piece.x !== null);
    assert.ok(Math.abs(position.x - staff.x - piece.x) < 0.00011, `${piece.text} rendered X`);

    if (piece.y !== null) {
      assert.ok(Math.abs(staff.y - position.y - piece.y) < 0.00011, `${piece.text} rendered Y`);
    }
  }
}

async function independent(source: string) {
  const [conversion, compiled] = await Promise.all([
    converter.convert(source),
    compiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const svgs = Object.entries(compiled.files)
    .filter(([n]) => n.endsWith('.svg'))
    .sort(([a], [b]) => a.localeCompare(b));

  assert.equal(svgs.length, conversion.scores.length);
  conversion.scores.forEach((score, i) => {
    complete(score);
    compareSvg(score, new TextDecoder().decode(svgs[i]![1]));
  });

  return { conversion, compiled };
}

test('final layout captures actual default-paper systems once and retains written notes and MIDI', async () => {
  const { conversion, compiled } = await independent(piano());

  assert.deepEqual(Object.keys(conversion).sort(), ['logs', 'scores']);
  const score = conversion.scores[0]!;

  assert.deepEqual(Object.keys(score).sort(), ['diagnostics', 'document', 'filename', 'musicxml']);
  assert.equal(stage(score).attempted, true);
  assert.ok(pieces(score).every((p) => !p.custom));
  assert.deepEqual(
    pieces(score).map((p) => [p.text, p.system]),
    [
      ['RightHand', 1],
      ['RH.', 2],
      ['LeftHand', 1],
      ['LH.', 2],
      ['Piano', 1],
      ['Pno.', 2],
    ],
  );
  const group = score.document.contexts.find((c) => c.type === 'PianoStaff')!.id;

  assert.ok(
    pieces(score)
      .filter((p) => p.context === group)
      .every((p) => p.y === null),
  );
  const notes = elements(parse(score.musicxml), 'note');

  assert.equal(notes.length, 4);
  assert.deepEqual(
    notes.map((n) => n.getElementsByTagName('type')[0]!.textContent),
    ['whole', 'whole', 'whole', 'whole'],
  );
  assert.equal(reader.loadData(score.musicxml), 1);
  const source = midiTimedNotes(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
  );
  const actual = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    source.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - source[i]!.duration!) < 0.01));
});

test('unnamed scores capture final heads and report failing paper callbacks without returning images', async () => {
  const { scores } = await converter.convert(String.raw`
    #(define (must-not-render grob) (error "unexpected final rendering"))
    \score { \new Staff { \override NoteHead.stencil = #must-not-render c'1 } \layout {} \midi {} }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(stage(score).attempted, true);
  assert.equal(stage(score).status, 'failed');
  assert.ok(stage(score).failure?.includes('unexpected final rendering'));
  assert.ok(score.diagnostics.some((d) => d.code === 'note-position-capture'));
  assert.equal(pieces(score).length, 0);
});

test('resolved bookpart paper inherits outer settings and resets sibling name identities', async () => {
  const { conversion } =
    await independent(String.raw`\paper { paper-width = 190\mm left-margin = 12\mm right-margin = 18\mm }
    \book { \paper { indent = 19\mm }
      \bookpart { \paper { right-margin = 21\mm short-indent = 7\mm } ${piano()} }
      \bookpart { \paper { left-margin = 15\mm } ${piano()} } }`);

  assert.equal(conversion.scores.length, 2);

  for (const score of conversion.scores) {
    assert.equal(pieces(score).length, 6);
    assert.deepEqual(
      pieces(score).map((p) => p.nameId),
      [1, 1, 2, 2, 3, 3],
    );
  }
});

test('final paper normalization follows source two-sided, explicit-margin, consistency and staff-size layouts', async () => {
  for (const header of [
    String.raw`\paper { two-sided = ##t paper-width = 190\mm outer-margin = 13\mm inner-margin = 17\mm binding-offset = 4\mm }`,
    String.raw`\paper { line-width = 150\mm }`,
    String.raw`\paper { line-width = 150\mm left-margin = 11\mm }`,
    String.raw`\paper { line-width = 150\mm right-margin = 16\mm }`,
    String.raw`\paper { line-width = 150\mm left-margin = 10\mm right-margin = 10\mm }`,
    '#(set-global-staff-size 30)',
  ]) {
    const { conversion } = await independent(header + piano());

    assert.equal(pieces(conversion.scores[0]!).length, 6, header);
  }
});

test('render-time rational label and staff-symbol offsets agree with independent source geometry', async () => {
  for (const [header, override] of [
    ['', String.raw`\override InstrumentName.extra-offset = #'(2 . 1)`],
    ['', String.raw`\override InstrumentName.extra-offset = #'(3/2 . -7/4)`],
    [
      '',
      String.raw`\override StaffSymbol.staff-space = #0.7 \override InstrumentName.extra-offset = #'(3/2 . -7/4)`,
    ],
    ['', String.raw`\override StaffSymbol.extra-offset = #'(0 . 2)`],
    [
      '#(set-global-staff-size 30)',
      String.raw`\override InstrumentName.extra-offset = #'(3/2 . -7/4)`,
    ],
  ]) {
    await independent(header + piano(override));
  }
});

test('hidden and genuinely empty name stencils retain absence in final captured pieces', async () => {
  for (const override of [
    String.raw`\override InstrumentName.stencil = ##f`,
    String.raw`\override InstrumentName.stencil = #(lambda (grob) empty-stencil)`,
  ]) {
    const { conversion } = await independent(piano(override));
    const hidden = pieces(conversion.scores[0]!).filter(
      (p) => p.text === 'RightHand' || p.text === 'RH.',
    );

    assert.equal(hidden.length, 2);
    assert.ok(hidden.every((p) => p.hidden && p.x === null && p.y === null));
  }
});

test('forcing final layout invokes controlled name callbacks exactly once per normal rendered piece', async () => {
  const callback = String.raw`\override InstrumentName.stencil = #count-stencil \override InstrumentName.after-line-breaking = #count-after`;
  const source = String.raw`
    #(define (count-stencil grob) (format #t "FINAL-STENCIL\n") (system-start-text::print grob))
    #(define (count-after grob) (format #t "FINAL-AFTER\n"))
    ${piano(callback, callback, callback)}`;
  const { conversion, compiled } = await independent(source);

  for (const logs of [conversion.logs, compiled.logs]) {
    assert.equal(logs.filter((l) => l === 'FINAL-STENCIL').length, 6);
    assert.equal(logs.filter((l) => l === 'FINAL-AFTER').length, 6);
  }
});

test('an after-line-breaking callback retains custom provenance even with the default stencil', async () => {
  const source = piano(
    String.raw`\override InstrumentName.after-line-breaking = #(lambda (grob) #t)`,
  );
  const { conversion } = await independent(source);
  const score = conversion.scores[0]!;
  const upper = score.document.contexts.find((c) => c.name === 'upper')!.id;

  assert.ok(
    pieces(score)
      .filter((p) => p.context === upper)
      .every((p) => p.custom),
  );
  assert.ok(
    pieces(score)
      .filter((p) => p.context !== upper)
      .every((p) => !p.custom),
  );
});

test('throwing final callbacks preserve semantic names and MIDI and reset the next score', async () => {
  const broken = piano(
    String.raw`\override InstrumentName.after-line-breaking = #(lambda (grob) (error "controlled final-layout failure"))`,
  );
  const { scores } = await converter.convert(broken + piano());

  assert.equal(scores.length, 2);
  const first = scores[0]!,
    second = scores[1]!;

  validate(first.musicxml);
  assert.equal(stage(first).status, 'failed');
  assert.equal(stage(first).attempted, true);
  assert.match(stage(first).failure!, /controlled final-layout failure/);
  assert.equal(pieces(first).length, 0);
  assert.equal(first.document.events.filter((e) => e.kind === 'instrumentName').length, 3);
  complete(second);
  assert.deepEqual(
    pieces(second).map((p) => p.nameId),
    [1, 1, 2, 2, 3, 3],
  );
});
