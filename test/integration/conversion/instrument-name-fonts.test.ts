import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
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
  compiler = createReusableCompiler(),
  reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const wrap = (music: string) => String.raw`\score { ${music} \layout {} \midi { \tempo 4=120 } }`;
const staff = (body: string, extra = '') =>
  String.raw`\new Staff = "solo" \with { instrumentName = "Flute" shortInstrumentName = "Fl." \override InstrumentName.font-size = #3 \override InstrumentName.font-series = #'bold \override InstrumentName.font-shape = #'italic ${extra} } { ${body} }`;
const displayTexts = (xml: string, tag: string) =>
  all(parse(xml), tag).flatMap((d) => all(d, 'display-text'));
const font = (node: Element) => Number(node.getAttribute('font-size'));
const sourceLabels = (files: Record<string, Uint8Array>, labels: readonly string[]) =>
  Object.entries(files)
    .filter(([n]) => n.endsWith('.svg'))
    .flatMap(([, bytes]) => {
      const root = parse(new TextDecoder().decode(bytes)).documentElement;
      const unit =
        Number(root.getAttribute('width')!.replace('mm', '')) /
        Number(root.getAttribute('viewBox')!.split(/\s+/)[2]);

      return all(root, 'text')
        .filter((t) => labels.includes(t.textContent || ''))
        .map((t) => ({
          text: t.textContent!,
          points: (Number(t.getAttribute('font-size')) * unit * 72) / 25.4,
          weight: t.getAttribute('font-weight'),
          style: t.getAttribute('font-style'),
        }));
    });

test('main staff, piano and group displays use actual inherited font contexts with independent SVG and MIDI', async () => {
  for (const [setup, music, long, short, tag] of [
    ['', staff(String.raw`c'1 \break d'1`), 'Flute', 'Fl.', 'part'],
    ['#(set-global-staff-size 30)', staff(String.raw`c'1 \break d'1`), 'Flute', 'Fl.', 'part'],
    [
      String.raw`\paper { text-font-size = #20 }`,
      staff(String.raw`c'1 \break d'1`),
      'Flute',
      'Fl.',
      'part',
    ],
    [
      '',
      String.raw`\new PianoStaff = "piano" \with { instrumentName = "Piano" shortInstrumentName = "Pno." \override InstrumentName.font-size = #3 \override InstrumentName.font-series = #'bold \override InstrumentName.font-shape = #'italic } << \new Staff { c'1 \break d'1 } \new Staff { c1 d1 } >>`,
      'Piano',
      'Pno.',
      'part',
    ],
    [
      '',
      String.raw`\new StaffGroup = "strings" \with { instrumentName = "Strings" shortInstrumentName = "Str." \override InstrumentName.font-size = #3 \override InstrumentName.font-series = #'bold \override InstrumentName.font-shape = #'italic } << \new Staff { c'1 \break d'1 } \new Staff { c1 d1 } >>`,
      'Strings',
      'Str.',
      'group',
    ],
  ] as const) {
    const source = setup + wrap(music),
      [{ scores }, independent] = await Promise.all([
        converter.convert(source),
        compiler.compile(source, { format: ['svg', 'midi'] }),
      ]);
    const score = scores[0]!;

    validate(score.musicxml);
    const full = displayTexts(score.musicxml, `${tag}-name-display`)[0]!,
      abbr = displayTexts(score.musicxml, `${tag}-abbreviation-display`)[0]!;

    assert.ok(full, long);
    assert.ok(abbr, short);
    assert.equal(full.textContent, long);
    assert.equal(abbr.textContent, short);
    const actual = sourceLabels(independent.files, [long, short]);

    assert.equal(actual.length, 2);

    for (const [node, label] of [
      [full, long],
      [abbr, short],
    ] as const) {
      assert.equal(node.getAttribute('font-weight'), 'bold');
      assert.equal(node.getAttribute('font-style'), 'italic');
      assert.ok(Math.abs(font(node) - actual.find((s) => s.text === label)!.points) < 0.003);
    }

    const state = score.document.events.filter((e) => e.kind === 'instrumentName')[0]!;

    assert.ok(Number.isSafeInteger(state.nameId) && state.nameId! > 0);
    const pieces = score.document.events
      .filter((e) => e.kind === 'instrumentLabelPiece')
      .filter((p) => p.context === state.context && p.nameId === state.nameId);

    assert.equal(pieces.length, 2);

    if (tag === 'group' || long === 'Piano') {
      assert.ok(pieces.every((p) => p.y === null));
    }

    assert.equal(reader.loadData(score.musicxml), 1);
    const mei = parse(reader.getMEI());

    assert.ok(all(mei, 'label').some((n) => n.textContent?.trim() === long));
    assert.ok(all(mei, 'labelAbbr').some((n) => n.textContent?.trim() === short));
    assert.ok(!score.diagnostics.some((d) => d.code === 'instrument-name-reader'));
    const expected = midiTimedNotes(
        Object.entries(independent.files).find(([n]) => n.endsWith('.midi'))![1],
      ),
      actualMidi = midiTimedNotes(reader.renderToMIDI());

    assert.deepEqual(
      actualMidi.map(({ pitch, onset, velocity }) => ({
        pitch,
        onset,
        velocity,
      })),
      expected.map(({ pitch, onset, velocity }) => ({
        pitch,
        onset,
        velocity,
      })),
    );
    actualMidi.forEach((note, i) => {
      assert.ok(note.duration !== null && expected[i]!.duration !== null);
      assert.ok(
        Math.abs(note.duration - expected[i]!.duration!) < 0.01,
        `${setup || long}: independently measured duration stays within 10ms`,
      );
    });
    const cached = toMusicXML(JSON.parse(JSON.stringify(score.document)) as ScoreDocument);

    validate(cached.musicxml);
    assert.equal(font(displayTexts(cached.musicxml, `${tag}-name-display`)[0]!), font(full));
  }
});

test('actual main label markup resets resolve once against the captured layout font reference', async () => {
  const source = wrap(
    String.raw`\new Staff \with { instrumentName = \markup \fontsize #0 "Flute" shortInstrumentName = \markup \abs-fontsize #18 "Fl." \override InstrumentName.font-size = #3 } { c'1 \break d'1 }`,
  );
  const [{ scores }, independent] = await Promise.all([
    converter.convert(source),
    compiler.compile(source, { format: 'svg' }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const rendered = sourceLabels(independent.files, ['Flute', 'Fl.']);
  const full = displayTexts(score.musicxml, 'part-name-display')[0]!,
    short = displayTexts(score.musicxml, 'part-abbreviation-display')[0]!;

  assert.ok(Math.abs(font(full) - rendered.find((t) => t.text === 'Flute')!.points) < 0.003);
  assert.ok(Math.abs(font(short) - rendered.find((t) => t.text === 'Fl.')!.points) < 0.003);
  assert.ok(Math.abs(font(short) - (18 * 72) / 72.27) < 1e-8);
  assert.ok(Math.abs(font(full) - (11 * Math.SQRT2 * 72) / 72.27) < 1e-8);
});

test('unrendered abbreviations and legacy missing name identity do not borrow a full-name font', async () => {
  const { scores } = await converter.convert(wrap(staff("c'1")));
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(score.document.events.filter((e) => e.kind === 'instrumentLabelPiece').length, 1);

  for (const node of displayTexts(score.musicxml, 'part-abbreviation-display')) {
    assert.equal(node.getAttribute('font-size'), null);
  }

  assert.ok(score.diagnostics.some((d) => d.code === 'instrument-name-font-history'));
  const document = JSON.parse(JSON.stringify(score.document)) as ScoreDocument;
  const legacy: ScoreDocument = {
    ...document,
    events: document.events.map((e) => {
      if (e.kind !== 'instrumentName') {
        return e;
      }

      const { nameId, ...old } = e;

      return old;
    }),
  };
  const result = toMusicXML(legacy);

  validate(result.musicxml);
  assert.ok(result.diagnostics.some((d) => d.code === 'instrument-name-font-history'));

  for (const node of displayTexts(result.musicxml, 'part-name-display')) {
    assert.equal(node.getAttribute('font-size'), null);
  }
});

test('final callbacks control actual label text and visibility, with cache and next-score reset', async () => {
  const source =
    wrap(
      staff(
        String.raw`c'1 \break d'1`,
        String.raw`\override InstrumentName.after-line-breaking = #(lambda(g)(ly:grob-set-property! g 'long-text "Actual")(ly:grob-set-property! g 'text "A.")(ly:grob-set-property! g 'stencil system-start-text::print))`,
      ),
    ) +
    wrap(
      String.raw`\new Staff \with { instrumentName = "Hidden" shortInstrumentName = "H." \override InstrumentName.after-line-breaking = #(lambda(g)(ly:grob-set-property! g 'transparent #t)) } { c'1 \break d'1 }`,
    ) +
    wrap(
      String.raw`\new Staff \with { instrumentName = "Normal" shortInstrumentName = "N." } { c'1 \break d'1 }`,
    );
  const [{ scores }, independent] = await Promise.all([
    converter.convert(source),
    compiler.compile(source, { format: 'svg' }),
  ]);

  scores.forEach((s) => validate(s.musicxml));
  assert.equal(scores.length, 3);
  const actual = sourceLabels(independent.files, ['Actual', 'A.', 'Hidden', 'H.', 'Normal', 'N.']);

  assert.deepEqual(actual.map((t) => t.text).sort(), ['Actual', 'A.', 'Normal', 'N.'].sort());
  assert.equal(displayTexts(scores[0]!.musicxml, 'part-name-display')[0]!.textContent, 'Actual');
  assert.equal(
    displayTexts(scores[0]!.musicxml, 'part-abbreviation-display')[0]!.textContent,
    'A.',
  );

  for (const s of scores.slice(0, 2)) {
    assert.ok(s.diagnostics.some((d) => d.code === 'instrument-name-stencil'));
  }

  const hidden = parse(scores[1]!.musicxml);

  assert.equal(all(hidden, 'part-name')[0]!.getAttribute('print-object'), 'no');
  assert.equal(all(hidden, 'part-name-display')[0]!.getAttribute('print-object'), 'no');
  const cached = toMusicXML(JSON.parse(JSON.stringify(scores[1]!.document)) as ScoreDocument);

  validate(cached.musicxml);
  assert.equal(all(parse(cached.musicxml), 'part-name')[0]!.getAttribute('print-object'), 'no');
  assert.equal(displayTexts(scores[2]!.musicxml, 'part-name-display')[0]!.textContent, 'Normal');
  assert.equal(all(parse(scores[2]!.musicxml), 'part-name')[0]!.getAttribute('print-object'), null);
});

test('later actual short-piece font changes produce native timed display updates', async () => {
  const source =
    wrap(String.raw`\new Staff \with { instrumentName = "Flute" shortInstrumentName = "Fl."
    \override InstrumentName.after-line-breaking = #(lambda(g)
      (let ((m (ly:moment-main (ly:grob-property (ly:spanner-bound g LEFT) 'when))))
        (ly:grob-set-property! g 'font-size (if (= m 1) -3 3))
        (ly:grob-set-property! g 'stencil system-start-text::print)))
    } { c'1 \break d'1 \break e'1 }`);
  const [{ scores }, independent] = await Promise.all([
    converter.convert(source),
    compiler.compile(source, { format: 'svg' }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const actual = sourceLabels(independent.files, ['Flute', 'Fl.']),
    pieces = score.document.events.filter((e) => e.kind === 'instrumentLabelPiece');

  assert.equal(pieces.length, 3);
  assert.equal(actual.length, 3);
  const xml = parse(score.musicxml),
    measures = all(xml, 'measure');
  const second =
      all(measures[1]!, 'part-abbreviation-display')[0] ??
      all(all(xml, 'score-part')[0]!, 'part-abbreviation-display')[0]!,
    third = all(measures[2]!, 'part-abbreviation-display')[0]!;

  assert.ok(second);
  assert.ok(third);
  assert.ok(Math.abs(font(all(second, 'display-text')[0]!) - actual[1]!.points) < 0.003);
  assert.ok(Math.abs(font(all(third, 'display-text')[0]!) - actual[2]!.points) < 0.003);
  assert.notEqual(font(all(second, 'display-text')[0]!), font(all(third, 'display-text')[0]!));
  assert.ok(!score.diagnostics.some((d) => d.code === 'instrument-name-change-reader'));
});

test('failed final capture and conflicting same-role pieces keep diagnosed semantic fallback', async () => {
  const { scores } = await converter.convert(wrap(staff(String.raw`c'1 \break d'1`)));
  const document = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;
  const failed: ScoreDocument = {
    ...document,
    events: document.events.map((e) =>
      e.kind === 'finalLayout'
        ? { ...e, status: 'failed' as const, failure: 'test-final-failure' }
        : e,
    ),
  };
  const unavailable = toMusicXML(failed);

  validate(unavailable.musicxml);
  assert.ok(unavailable.diagnostics.some((d) => d.code === 'instrument-name-font-history'));

  for (const n of displayTexts(unavailable.musicxml, 'part-name-display')) {
    assert.equal(n.getAttribute('font-size'), null);
  }

  const piece = document.events.filter((e) => e.kind === 'instrumentLabelPiece')[0]!;
  const ambiguous: ScoreDocument = {
    ...document,
    events: [...document.events, { ...piece, text: 'Contradictory', markup: 'Contradictory' }],
  };
  const conflict = toMusicXML(ambiguous);

  validate(conflict.musicxml);
  assert.ok(conflict.diagnostics.some((d) => d.code === 'instrument-name-piece'));
  assert.ok(
    !displayTexts(conflict.musicxml, 'part-name-display').some(
      (n) => n.textContent === 'Contradictory',
    ),
  );
});

test('repeated semantic name text keeps exact original identity, distinct fonts and score-local reset', async () => {
  const source =
    wrap(
      staff(String.raw`c'1
    \override Staff.InstrumentName.font-size = #-3 \set Staff.instrumentName = "Next" \set Staff.shortInstrumentName = "N." \break d'1
    \override Staff.InstrumentName.font-size = #6 \set Staff.instrumentName = "Flute" \set Staff.shortInstrumentName = "Fl." \break e'1`),
    ) +
    wrap(
      String.raw`\new Staff \with { instrumentName = "Flute" shortInstrumentName = "Fl." } { c'1 \break d'1 }`,
    );
  const [{ scores }, independent] = await Promise.all([
    converter.convert(source),
    compiler.compile(source, { format: 'svg' }),
  ]);

  assert.equal(scores.length, 2);
  scores.forEach((s) => validate(s.musicxml));
  const first = scores[0]!,
    states = first.document.events.filter((e) => e.kind === 'instrumentName'),
    pieces = first.document.events.filter((e) => e.kind === 'instrumentLabelPiece');

  assert.deepEqual(
    states.map((s) => [s.text, s.shortText]),
    [
      ['Flute', 'Fl.'],
      ['Next', 'N.'],
      ['Flute', 'Fl.'],
    ],
  );
  assert.equal(new Set(states.map((s) => s.nameId)).size, 3);
  assert.equal(new Set(states.map((s) => s.context)).size, 1);
  assert.deepEqual(
    pieces.map((p) => p.nameId),
    states.map((s) => s.nameId),
  );
  assert.deepEqual(
    pieces.map((p) => p.text),
    ['Flute', 'N.', 'Fl.'],
  );
  const xml = parse(first.musicxml),
    measures = all(xml, 'measure');
  const native = [
    displayTexts(first.musicxml, 'part-name-display')[0]!,
    all(all(measures[1]!, 'part-abbreviation-display')[0]!, 'display-text')[0]!,
    all(all(measures[2]!, 'part-abbreviation-display')[0]!, 'display-text')[0]!,
  ];

  assert.deepEqual(
    native.map((n) => n.textContent),
    ['Flute', 'N.', 'Fl.'],
  );
  const actual = sourceLabels(independent.files, ['Flute', 'N.', 'Fl.']);

  assert.equal(actual.length, 5);

  for (const [i, node] of native.entries()) {
    assert.ok(Math.abs(font(node) - actual[i]!.points) < 0.003);
    assert.ok(Math.abs(font(node) - Number(pieces[i]!.fontContext!.attrs['font-size'])) < 1e-8);
  }

  assert.equal(new Set(native.map(font)).size, 3);
  const cached = toMusicXML(JSON.parse(JSON.stringify(first.document)) as ScoreDocument);

  validate(cached.musicxml);
  assert.deepEqual(
    displayTexts(cached.musicxml, 'part-abbreviation-display').map((n) => [n.textContent, font(n)]),
    displayTexts(first.musicxml, 'part-abbreviation-display').map((n) => [n.textContent, font(n)]),
  );
  const reset = scores[1]!,
    resetStates = reset.document.events.filter((e) => e.kind === 'instrumentName'),
    resetPieces = reset.document.events.filter((e) => e.kind === 'instrumentLabelPiece');

  assert.equal(resetStates[0]!.nameId, states[0]!.nameId);
  assert.ok(resetPieces.every((p) => p.nameId === resetStates[0]!.nameId));
  assert.ok(
    Math.abs(font(displayTexts(reset.musicxml, 'part-name-display')[0]!) - actual[3]!.points) <
      0.003,
  );
  assert.ok(
    Math.abs(font(displayTexts(reset.musicxml, 'part-name-display')[0]!) - (11 * 72) / 72.27) <
      1e-8,
  );
});

const actualAccidentalFontProbe = String.raw`#(define (audit-actual-glyph-font expression)
 (and (pair? expression)
  (if (eq? (car expression) 'named-glyph) (cadr expression)
   (any audit-actual-glyph-font expression))))
#(define-markup-command (auditAccidental layout props index kind) (integer? symbol?)
 (let* ((original (case kind ((flat) flat-markup) ((sharp) sharp-markup)
          ((natural) natural-markup) ((doubleflat) doubleflat-markup)
          ((doublesharp) doublesharp-markup)))
        (stencil (original layout props))
        (font (or (audit-actual-glyph-font (ly:stencil-expr stencil))
                  (error "actual accidental has no named glyph font")))
        (points (* (ly:font-design-size font) (ly:font-magnification font)
                   (ly:output-def-lookup layout 'output-scale) (/ 72 25.4))))
  (format #t "ACTUAL-ACCIDENTAL|~a|~a|~s\n" index kind points)
  stencil))`;

test('inline name accidentals use actual selected music font points instead of inherited text font points', async () => {
  const glyphs = ['flat', 'sharp', 'natural', 'flat-flat', 'double-sharp', 'sharp'];
  const markup = String.raw`\markup \with-color #blue \line { "Keys" \with-color #red \line {
    \smaller \flat \fontsize #2 \sharp \tiny \natural \abs-fontsize #18 \doubleflat \magnify #0.5 \doublesharp \normalsize \sharp } }`;

  for (const [name, prefix, overrides] of [
    ['default', '', ''],
    [
      'named',
      '',
      String.raw`\override InstrumentName.font-name = #"serif" \override InstrumentName.font-size = #3 \override InstrumentName.font-series = #'bold \override InstrumentName.font-shape = #'italic`,
    ],
    ['text20', String.raw`\paper { text-font-size = #20 }`, ''],
    ['staff30', '#(set-global-staff-size 30)', ''],
  ] as const) {
    const source =
      prefix +
      wrap(String.raw`\new Staff \with { instrumentName = ${markup} ${overrides} } { c'1 }`);
    let leafIndex = 0;
    const instrumented =
      actualAccidentalFontProbe +
      source.replace(
        /\\(doubleflat|doublesharp|flat|sharp|natural)\b/g,
        (_match, kind: string) => String.raw`\auditAccidental #${leafIndex++} #'${kind}`,
      );
    const [{ scores }, independent] = await Promise.all([
      converter.convert(source),
      compiler.compile(instrumented, { format: 'svg' }),
    ]);
    const score = scores[0]!;

    validate(score.musicxml);
    const observed = independent.logs
      .filter((l) => l.startsWith('ACTUAL-ACCIDENTAL|'))
      .map((l) => ({
        index: Number(l.split('|')[1]),
        kind: l.split('|')[2],
        points: Number(l.split('|')[3]),
      }));

    assert.ok(observed.length >= 6, `${name}: actual source leaves were measured`);
    const expected = Array.from(
      { length: 6 },
      (_, index) => observed.find((o) => o.index === index)!,
    );

    assert.ok(expected.every(Boolean));
    assert.deepEqual(
      expected.map((p) => p.kind),
      ['flat', 'sharp', 'natural', 'doubleflat', 'doublesharp', 'sharp'],
    );
    const native = all(all(parse(score.musicxml), 'part-name-display')[0]!, 'accidental-text');

    assert.equal(native.length, 6);
    const piece = score.document.events.filter((e) => e.kind === 'instrumentLabelPiece')[0]!;

    assert.ok(piece.musicFonts?.length);

    for (const [i, accidental] of native.entries()) {
      assert.equal(accidental.textContent, glyphs[i]);
      assert.ok(
        Math.abs(font(accidental) - expected[i]!.points) < 1e-8,
        `${name} ${glyphs[i]} actual font em`,
      );
      assert.equal(accidental.getAttribute('font-family'), null);
      assert.equal(accidental.getAttribute('font-weight'), null);
      assert.equal(accidental.getAttribute('font-style'), null);
      assert.equal(accidental.getAttribute('color'), '#FF0000');
      assert.ok(
        piece.musicFonts!.some((f) => Math.abs(f.musicPoints - expected[i]!.points) < 1e-8),
      );
    }

    assert.ok(!score.diagnostics.some((d) => d.code === 'markup-music-font'));
    const sourceSvgs = Object.entries(independent.files).filter(([n]) => n.endsWith('.svg'));

    assert.equal(sourceSvgs.length, 1);
    const svg = parse(new TextDecoder().decode(sourceSvgs[0]![1])),
      root = svg.documentElement;
    const unit =
      Number(root.getAttribute('width')!.replace('mm', '')) /
      Number(root.getAttribute('viewBox')!.split(/\s+/)[2]);
    const paths = all(svg, 'g')
      .filter((g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)')
      .flatMap((g) => all(g, 'path'));

    assert.equal(paths.length, 6);
    const physical = paths
      .map(
        (path) =>
          (Number(/scale\(([\d.]+),/.exec(path.getAttribute('transform')!)![1]) *
            1000 *
            unit *
            72) /
          25.4,
      )
      .sort((a, b) => a - b);
    const exact = expected.map((e) => e.points).sort((a, b) => a - b),
      roundingBound = (0.000050001 * 1000 * unit * 72) / 25.4 + 0.005;

    physical.forEach((points, i) =>
      assert.ok(
        Math.abs(points - exact[i]!) < roundingBound,
        `${name}: rounded SVG outline scales agree with independently observed actual fonts`,
      ),
    );
    const document = JSON.parse(JSON.stringify(score.document)) as ScoreDocument,
      cached = toMusicXML(document);

    validate(cached.musicxml);
    assert.deepEqual(
      all(all(parse(cached.musicxml), 'part-name-display')[0]!, 'accidental-text').map(font),
      native.map(font),
    );
    const legacy: ScoreDocument = {
      ...document,
      events: document.events.map((e) => {
        if (e.kind !== 'instrumentLabelPiece') {
          return e;
        }

        const { musicFonts, ...old } = e;

        return old;
      }),
    };
    const old = toMusicXML(legacy);

    validate(old.musicxml);
    assert.ok(old.diagnostics.some((d) => d.code === 'markup-music-font'));

    for (const accidental of all(
      all(parse(old.musicxml), 'part-name-display')[0]!,
      'accidental-text',
    )) {
      assert.equal(accidental.getAttribute('font-size'), null);
      assert.equal(accidental.getAttribute('font-family'), null);
      assert.equal(accidental.getAttribute('color'), '#FF0000');
    }
  }
});
