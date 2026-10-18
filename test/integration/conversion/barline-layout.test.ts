import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import listener from '../../../dist/lilypond/generated/listener.js';
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
const layoutRows = (d: ScoreDocument) => d.events.filter((e) => e.kind === 'barlineLayout');
const bars = (d: ScoreDocument) => d.events.filter((e) => e.kind === 'barline');

const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const source = (music: string, staff = '', setup = '') =>
  setup +
  String.raw`\score { \new Staff = "solo" \with { ${staff} } { ${music} } \layout {} \midi { \tempo 4=120 } }`;

// One real normal layout-only book, with current listeners and a deferred snapshot.
// This is an independent passivity probe, not another production formatting pass.
function normalListener() {
  return (
    listener +
    String.raw`
#(define bar-probe-score #f)
#(define bar-probe-clone #f)
#(define bar-probe-post #f)
#(define (xml-run-score music layout score)
 (xml-reset-final-layout!) (xml-reset-staff-lines!)
 (set! xml-figure-columns '()) (set! xml-figure-column-systems (make-hash-table))
 (xml-prepare-cues music)
 (set! bar-probe-score score)
 (set! bar-probe-clone (ly:make-score music))
 (when (module? (ly:score-header score)) (ly:score-set-header! bar-probe-clone (ly:score-header score)))
 (ly:score-add-output-def! bar-probe-clone
  (ly:output-def-clone
   (or (find (lambda(d) (eq? (ly:output-def-lookup d 'output-def-kind) 'layout)) (ly:score-output-defs score))
       (ly:parser-lookup '$defaultlayout)))))
#(define (bar-probe-final paper pages)
 (when (procedure? bar-probe-post) (bar-probe-post paper pages))
 (xml-finish-figure-columns!) (xml-finish-staff-lines! #t) (xml-finish-final-layout! #f #t))
#(define (ed-book-handler book)
 (ed-process-book book '() '())
 (let ((paper (ly:output-def-clone (if (ly:output-def? (ly:book-paper book)) (ly:book-paper book) (ly:parser-lookup '$defaultpaper)))))
  (set! bar-probe-post (ly:output-def-lookup paper 'page-post-process #f))
  (ly:output-def-set-variable! paper 'page-post-process bar-probe-final)
  (print-book-with-defaults (ly:make-book paper (ly:book-header book) bar-probe-clone)))
 (ed-write-json!))
#(set! toplevel-book-handler ed-book-handler)
#(set! default-toplevel-book-handler ed-book-handler)
`
  );
}

test('barline metadata remains passive through normal source pagination, bar heights and callbacks', async () => {
  const text = String.raw`#(define (bar-source-post paper pages) (format #t "BAR-SOURCE-POST\n"))
#(define (bar-source-after g) (format #t "BAR-SOURCE-AFTER\n") #t)
#(define (bar-source-format g) (format #t "BAR-SOURCE-FORMAT\n") (tuplet-number::calc-fraction-text g))
\paper { paper-width=90\mm paper-height=95\mm top-margin=5\mm bottom-margin=5\mm left-margin=5\mm right-margin=5\mm indent=8\mm ragged-last-bottom=##f page-post-process=#bar-source-post }
\header { title="Bar witness" tagline=##f }
\score { \new PianoStaff <<
 \new Staff="upper" { \override NoteHead.after-line-breaking=#bar-source-after \override TupletNumber.text=#bar-source-format
  \repeat unfold 12 { \tuplet 3/2 { c''8 d''8 e''8 } f''4 g''2 } }
 \new Staff="lower" { \clef bass \override NoteHead.after-line-breaking=#bar-source-after \repeat unfold 12 { c1 } }
 >> \layout {} \midi { \tempo 4=120 } }`;
  const original = await compiler.compile(text, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(text, {
    format: ['svg', 'midi'],
    files: { 'bar-observer.ily': normalListener() },
    includeSettings: 'bar-observer.ily',
  });
  const pages = Object.keys(original.files).filter((n) => n.endsWith('.svg'));

  assert.equal(pages.length, 2);
  const heights: number[] = [];

  for (const name of pages) {
    assert.deepEqual(
      observed.files[name],
      original.files[name],
      'actual source SVG bytes, including all bar heights/X positions, are unchanged',
    );
    const rectangles = all(parse(new TextDecoder().decode(original.files[name])), 'rect');

    heights.push(...rectangles.map((r) => Number(r.getAttribute('height'))));
  }

  assert.ok(
    heights.includes(4.05),
    'independent actual source includes4.05-unit bar height; page-end bars need not all share one height',
  );

  for (const prefix of ['BAR-SOURCE-POST', 'BAR-SOURCE-AFTER', 'BAR-SOURCE-FORMAT']) {
    assert.equal(
      observed.logs.filter((l) => l.startsWith(prefix)).length,
      original.logs.filter((l) => l.startsWith(prefix)).length,
    );
  }

  assert.ok(
    Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  const raw = JSON.parse(new TextDecoder().decode(file(observed.files, '.events.json'))) as {
    events: { k: string; id?: number; pieces?: unknown[] }[];
  };

  assert.ok(raw.events.some((e) => e.k === 'barline-layout' && e.pieces!.length));
});

test('actual broken barline pieces retain distinct end/start glyphs and stable source IDs', async () => {
  const text = source(String.raw`c'1 \bar ":|.|:" \break d'1 \bar "|."`);
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  assert.equal(result.document.barlineLayoutsCaptured, true);
  const middle = layoutRows(result.document).filter(
    (r) => r.moment.main.numerator / r.moment.main.denominator === 1,
  );

  assert.equal(middle.length, 1);
  assert.deepEqual(
    middle[0]!.pieces.map((p) => [p.system, p.breakDirection, p.glyph, p.hidden]),
    [
      [1, -1, ':|.', false],
      [2, 1, '.|:', false],
    ],
  );

  for (const row of layoutRows(result.document)) {
    assert.equal(
      bars(result.document).filter((b) => b.id === row.barlineId && b.staff === row.staff).length,
      1,
    );
  }

  const last = layoutRows(result.document).find(
    (r) => r.moment.main.numerator / r.moment.main.denominator === 2,
  )!;

  assert.ok(last.pieces.some((p) => p.breakDirection === -1 && p.glyph === '|.'));
  const native = parse(result.musicxml),
    measures = all(native, 'measure');
  const end = all(measures[0]!, 'barline').find((b) => b.getAttribute('location') === 'right')!;
  const start = all(measures[1]!, 'barline').find((b) => b.getAttribute('location') === 'left')!;

  assert.equal(all(end, 'bar-style')[0]!.textContent, 'light-heavy');
  assert.equal(all(start, 'bar-style')[0]!.textContent, 'heavy-light');
  assert.equal(all(end, 'repeat')[0]!.getAttribute('direction'), 'backward');
  assert.equal(all(end, 'repeat')[0]!.getAttribute('times'), '1');
  assert.equal(all(start, 'repeat')[0]!.getAttribute('direction'), 'forward');
  assert.equal(
    all(native, 'repeat').length,
    2,
    'actual dots emitted once on each source-proven side',
  );
  const original = await compiler.compile(text, { format: 'midi' });

  assert.equal(reader.loadData(result.musicxml), 1);
  const played = midiTimedNotes(reader.renderToMIDI()),
    expected = midiTimedNotes(file(original.files, '.midi'));

  assert.deepEqual(
    played.map((n) => [n.pitch, n.channel, n.velocity, n.onset]),
    expected.map((n) => [n.pitch, n.channel, n.velocity, n.onset]),
    'visual repeat dots do not introduce an audible loop',
  );
  played.forEach((n, i) =>
    assert.ok(
      Math.abs(n.duration! - expected[i]!.duration!) < 0.01,
      'reader noteoff rounding stays within10ms',
    ),
  );
});

test('barline glyph and custom stencil callbacks run only when source rendering requests them', async () => {
  const setup = String.raw`#(define (bar-glyph g) (format #t "BAR-GLYPH-CALL\n") "|")
#(define (bar-print g) (format #t "BAR-PRINT-CALL\n") (ly:bar-line::print g))`;
  const text = source(
    String.raw`\override Staff.BarLine.glyph-name=#bar-glyph \override Staff.BarLine.stencil=#bar-print c'1 d'1`,
    '',
    setup,
  );
  const result = await converter.convert(text),
    original = await compiler.compile(text, { format: ['svg', 'midi'] });

  for (const prefix of ['BAR-GLYPH-CALL', 'BAR-PRINT-CALL']) {
    const expected = original.logs.filter((l) => l.startsWith(prefix)).length;

    assert.ok(expected > 0);
    assert.equal(result.logs.filter((l) => l.startsWith(prefix)).length, expected);
  }

  assert.ok(
    layoutRows(result.scores[0]!.document)
      .flatMap((r) => r.pieces)
      .every((p) => p.custom),
  );
});

test('omitted, transparent, empty and removed source bars retain actual final absence', async () => {
  for (const [music, staff] of [
    [String.raw`\omit Staff.BarLine c'1 d'1`, ''],
    [String.raw`\override Staff.BarLine.transparent=##t c'1 d'1`, ''],
    [
      String.raw`\override Staff.BarLine.stencil=#(lambda(g) (ly:make-stencil '() '(0 . 0) '(0 . 0))) c'1 d'1`,
      '',
    ],
    ["c'1 d'1", String.raw`\remove Bar_engraver`],
  ] as const) {
    const result = (await converter.convert(source(music, staff))).scores[0]!;

    validate(result.musicxml);
    assert.ok(
      layoutRows(result.document)
        .flatMap((r) => r.pieces)
        .every((p) => p.hidden === true),
    );
    const styles = all(parse(result.musicxml), 'bar-style');

    assert.ok(
      styles.length > 0 && styles.every((style) => style.textContent === 'none'),
      'native explicit none suppresses automatic visible bars',
    );

    if (staff) {
      assert.equal(bars(result.document).length, 0);
      assert.equal(layoutRows(result.document).length, 0);
    } else {
      assert.ok(layoutRows(result.document).length > 0);
    }
  }
});

test('barline cache roundtrips keep pieces and legacy history explicit', async () => {
  const result = (await converter.convert(source("c'1 d'1"))).scores[0]!;
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;
  const barStyles = (xml: string) =>
    all(parse(xml), 'barline').map((b) => [
      b.getAttribute('location'),
      all(b, 'bar-style')[0]?.textContent,
    ]);

  assert.deepEqual(barStyles(toMusicXML(cached).musicxml), barStyles(result.musicxml));
  const { barlineLayoutsCaptured: _flag, ...legacy } = cached;

  assert.ok(toMusicXML(legacy).diagnostics.some((d) => d.code.startsWith('barline-layout-')));
});

test('barline IDs and final pieces stay staff-owned and reset after scores and layout failure', async () => {
  const piano = String.raw`\score { \new PianoStaff << \new Staff="upper" { <c' e'>1 \break r1 } \new Staff="lower" { c1 d1 } >> \layout{} }`;
  const result = await converter.convert(piano + source("e'1"));
  const first = result.scores[0]!.document;

  assert.equal(new Set(layoutRows(first).map((r) => r.staff)).size, 2);
  assert.equal(new Set(bars(first).map((b) => b.id)).size, bars(first).length);
  assert.equal(bars(result.scores[1]!.document)[0]!.id, 1);
  const failed = source(
    String.raw`\override NoteHead.after-line-breaking=#(lambda(g) (error "bar-layout-failed")) c'1`,
  );
  const reset = await converter.convert(failed + source("f'1"));

  assert.equal(layoutRows(reset.scores[0]!.document).length, 0);
  assert.equal(bars(reset.scores[1]!.document)[0]!.id, 1);
  assert.ok(layoutRows(reset.scores[1]!.document).some((r) => r.pieces.length > 0));
});

test('actual metered interior bars stay between source half notes without splitting the native measure', async () => {
  const translateX = (node: Element) => {
    let x = 0;

    for (
      let e: Element | null = node;
      e;
      e = e.parentNode?.nodeType === 1 ? (e.parentNode as Element) : null
    ) {
      for (const m of (e.getAttribute('transform') ?? '').matchAll(
        /translate\(([-\d.]+)[, ]+([-\d.]+)\)/g,
      )) {
        x += Number(m[1]);
      }
    }

    return x;
  };
  const colored = (node: Element, color: string) => {
    for (
      let e: Element | null = node;
      e;
      e = e.parentNode?.nodeType === 1 ? (e.parentNode as Element) : null
    ) {
      if (e.getAttribute('color')?.startsWith(color)) {
        return true;
      }
    }

    return false;
  };

  for (const omitted of [false, true]) {
    const music = String.raw`\override NoteHead.color=#blue \override Staff.BarLine.color=#red c'2 ${omitted ? String.raw`\once \omit Staff.BarLine` : ''} \bar "||" d'2 e'1`;
    const text = source(music),
      result = (await converter.convert(text)).scores[0]!;

    validate(result.musicxml);
    const native = parse(result.musicxml),
      measures = all(native, 'measure');

    assert.equal(measures.length, 2);
    const first = measures[0]!,
      notes = all(first, 'note');

    assert.deepEqual(
      notes.map((n) => all(n, 'step')[0]!.textContent),
      ['C', 'D'],
    );
    assert.deepEqual(
      notes.map((n) => all(n, 'type')[0]!.textContent),
      ['half', 'half'],
    );
    const middle = all(first, 'barline').filter((b) => b.getAttribute('location') === 'middle');

    if (omitted) {
      assert.ok(middle.every((b) => all(b, 'bar-style')[0]!.textContent === 'none'));
    } else {
      assert.equal(middle.length, 1);
      assert.equal(all(middle[0]!, 'bar-style')[0]!.textContent, 'light-light');
      const children = Array.from(first.childNodes);

      assert.ok(
        children.indexOf(notes[0]!) < children.indexOf(middle[0]!) &&
          children.indexOf(middle[0]!) < children.indexOf(notes[1]!),
        'middle bar appears at the actual cursor between the source half notes',
      );
    }

    const sourceRow = layoutRows(result.document).find(
      (r) => r.moment.main.numerator * 2 === r.moment.main.denominator,
    )!;

    assert.ok(sourceRow);

    if (!omitted) {
      assert.ok(
        sourceRow.pieces.some((p) => p.breakDirection === 0 && p.glyph === '||' && !p.hidden),
      );
    }

    const original = await compiler.compile(text, { format: ['svg', 'midi'] });
    const svg = parse(new TextDecoder().decode(file(original.files, '.svg')));
    const heads = all(svg, 'path')
      .filter((p) => colored(p, 'rgba(0.0000%, 0.0000%, 100.0000%'))
      .map(translateX)
      .sort((a, b) => a - b);

    assert.equal(heads.length, 3);
    const inside = all(svg, 'rect').filter(
      (r) =>
        colored(r, 'rgba(100.0000%, 0.0000%, 0.0000%') &&
        translateX(r) > heads[0]! &&
        translateX(r) < heads[1]!,
    );

    assert.equal(
      inside.length,
      omitted ? 0 : 2,
      'independent SVG proves the actual interior double bar or source omission',
    );
    assert.equal(reader.loadData(result.musicxml), 1);
    const played = midiTimedNotes(reader.renderToMIDI()),
      expected = midiTimedNotes(file(original.files, '.midi'));

    assert.deepEqual(
      played.map((n) => [n.pitch, n.channel, n.velocity, n.onset]),
      expected.map((n) => [n.pitch, n.channel, n.velocity, n.onset]),
    );
    played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  }
});
