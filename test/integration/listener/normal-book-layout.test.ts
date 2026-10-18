import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ConvertedScore, type ScoreDocument, createConverter } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import listener from '../../../dist/lilypond/generated/listener.js';
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

const notes = (document: ScoreDocument) => document.events.filter((e) => e.kind === 'note');
const stage = (score: ConvertedScore) => {
  const stages = score.document.events.filter((e) => e.kind === 'finalLayout');

  assert.equal(stages.length, 1);

  return stages[0]!;
};
const count = (logs: readonly string[], prefix: string) =>
  logs.filter((l) => l.startsWith(prefix)).length;

async function independent(source: string) {
  const baseline = await compiler.compile(source, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(source, {
    format: ['svg', 'midi'],
    files: { 'normal-listener.ily': listener },
    includeSettings: 'normal-listener.ily',
  });
  const svg = Object.entries(baseline.files).filter(([name]) => name.endsWith('.svg'));

  assert.ok(svg.length > 0);

  for (const [name, bytes] of svg) {
    assert.deepEqual(
      observed.files[name],
      bytes,
      `normal source rendering stays byte-identical: ${name}`,
    );
  }

  const result = await converter.convert(source);

  result.scores.forEach((s) => validate(s.musicxml));
  assert.deepEqual(Object.keys(result).sort(), ['logs', 'scores']);
  result.scores.forEach((s) =>
    assert.deepEqual(Object.keys(s).sort(), ['diagnostics', 'document', 'filename', 'musicxml']),
  );

  return { baseline, observed, result, svg };
}

function samePlayback(xml: string, source: Uint8Array) {
  assert.equal(reader.loadData(xml), 1);
  const actual = midiTimedNotes(reader.renderToMIDI()),
    expected = midiTimedNotes(source);

  assert.deepEqual(
    actual.map((n) => [n.pitch, n.channel, n.velocity, n.onset]),
    expected.map((n) => [n.pitch, n.channel, n.velocity, n.onset]),
  );
  actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
}

const callbacks = String.raw`#(define (normal-source-post paper pages) (format #t "NORMAL-BOOK-POST ~a\n" (length pages)))
#(define (normal-source-after grob) (format #t "NORMAL-BOOK-AFTER\n") #t)
\paper { paper-width=100\mm paper-height=150\mm top-margin=5\mm bottom-margin=5\mm left-margin=5\mm right-margin=5\mm page-post-process=#normal-source-post }
`;

test('public normal book retains arbitrary markup and page markers without rerendering source callbacks', async () => {
  const text =
    callbacks +
    String.raw`\book { \header { title="Markup witness" tagline=##f }
 \markup "Opening outside every score" \pageBreak
 \score { \header { piece="First" } { \override NoteHead.after-line-breaking=#normal-source-after c'1 \label #'first-end } \layout{} \midi{\tempo 4=120} }
 \markup "Between the scores" \pageBreak
 \score { \header { piece="Second" } { \override NoteHead.after-line-breaking=#normal-source-after d'1 \label #'second-end } \layout{} \midi{\tempo 4=120} }
}`;
  const { baseline, observed, result, svg } = await independent(text);

  assert.equal(result.scores.length, 2);
  const renderedText = svg.map(([, bytes]) => new TextDecoder().decode(bytes)).join('\n');

  assert.ok(
    renderedText.includes('Opening outside every score') &&
      renderedText.includes('Between the scores'),
  );
  assert.ok(svg.length >= 2, 'book-level page markers reach the real source paginator');

  for (const prefix of ['NORMAL-BOOK-POST', 'NORMAL-BOOK-AFTER']) {
    assert.ok(count(baseline.logs, prefix) > 0);
    assert.equal(count(observed.logs, prefix), count(baseline.logs, prefix));
    assert.equal(count(result.logs, prefix), count(baseline.logs, prefix));
  }

  const midi = Object.entries(baseline.files).filter(([name]) => name.endsWith('.midi'));

  assert.equal(midi.length, 2);
  result.scores.forEach((score, i) => {
    assert.equal(stage(score).status, 'complete');
    assert.equal(score.document.header.piece, ['First', 'Second'][i]);
    assert.deepEqual(
      notes(score.document).map((n) => n.noteId),
      [1],
    );
    const labels = score.document.events.filter((e) => e.kind === 'label');

    assert.deepEqual(
      labels.flatMap((e) => e.names),
      [['first-end', 'second-end'][i]],
    );
    samePlayback(score.musicxml, midi[i]![1]);
  });
});

test('embedded score markup preserves the main score collector and later source scores', async () => {
  const source = String.raw`#(define (embedded-head-after grob) (format #t "NORMAL-EMBEDDED-HEAD\n") #t)
  \book {
    \score { { c'4 d'4^\markup { \score { {
      \override NoteHead.after-line-breaking = #embedded-head-after
      <fis'' a'' cis'''>4^\markup { \score { { b'''4 } \layout {} } }
    } \layout {} } } f'2 } \layout {} \midi { \tempo 4=120 } }
    \score { { g'1 } \layout {} \midi { \tempo 4=120 } }
  }`;
  const { baseline, observed, result } = await independent(source);

  assert.ok(count(baseline.logs, 'NORMAL-EMBEDDED-HEAD') > 0);
  assert.equal(
    count(observed.logs, 'NORMAL-EMBEDDED-HEAD'),
    count(baseline.logs, 'NORMAL-EMBEDDED-HEAD'),
  );
  assert.equal(
    count(result.logs, 'NORMAL-EMBEDDED-HEAD'),
    count(baseline.logs, 'NORMAL-EMBEDDED-HEAD'),
  );
  assert.equal(result.scores.length, 2);
  assert.deepEqual(
    result.scores.map((score) => notes(score.document).map((note) => note.pitch?.step)),
    [[0, 1, 3], [4]],
  );
  assert.deepEqual(
    result.scores.map((score) => notes(score.document).map((note) => note.noteId)),
    [[1, 2, 3], [1]],
  );
  const midi = Object.entries(baseline.files).filter(([name]) => name.endsWith('.midi'));

  result.scores.forEach((score, index) => {
    assert.equal(stage(score).status, 'complete');
    samePlayback(score.musicxml, midi[index]![1]);
  });
});

test('multiple source books and bookparts keep written score order, local headers, paper scopes and terminal flushes', async () => {
  const score = (piece: string, music: string) =>
    String.raw`\score { \header { piece="${piece}" } \new Staff="same" { \override NoteHead.after-line-breaking=#normal-source-after ${music} } \layout{} \midi{\tempo 4=120} }`;
  const text =
    callbacks +
    String.raw`\book { \paper { paper-width=80\mm paper-height=140\mm left-margin=9\mm right-margin=6\mm }
 \header { title="Book Alpha" composer="Alpha composer" tagline=##f }
 \bookpart { \header { subtitle="Part one" } ` +
    score('Alpha one', String.raw`\tuplet 3/2 { c'8[ d' e'] } f'4 g'2 \label #'alpha-one`) +
    String.raw` }
 \bookpart { \header { subtitle="Part two" } ` +
    score('Alpha two', String.raw`a'1 \label #'alpha-two`) +
    String.raw` } }
\book { \header { title="Book Beta" composer="Beta composer" tagline=##f }
 ` +
    score('Beta one', String.raw`b'1 \label #'beta-one`) +
    ' }';
  const { baseline, observed, result } = await independent(text);

  assert.equal(result.scores.length, 3);
  assert.deepEqual(
    result.scores.map((s) => s.document.header.piece),
    ['Alpha one', 'Alpha two', 'Beta one'],
  );
  assert.deepEqual(
    result.scores.map((s) => s.document.header.composer),
    ['Alpha composer', 'Alpha composer', 'Beta composer'],
  );
  const names = ['alpha-one', 'alpha-two', 'beta-one'];

  for (const [i, score] of result.scores.entries()) {
    assert.equal(stage(score).status, 'complete');
    assert.equal(notes(score.document)[0]!.noteId, 1);
    assert.deepEqual(
      score.document.events.filter((e) => e.kind === 'label').flatMap((e) => e.names),
      [names[i]],
    );
  }

  assert.ok(result.scores[0]!.document.events.some((e) => e.kind === 'beam'));
  assert.deepEqual(
    all(parse(result.scores[0]!.musicxml), 'tuplet').map((e) => e.getAttribute('type')),
    ['start', 'stop'],
  );

  for (const prefix of ['NORMAL-BOOK-POST', 'NORMAL-BOOK-AFTER']) {
    assert.equal(count(observed.logs, prefix), count(baseline.logs, prefix));
    assert.equal(count(result.logs, prefix), count(baseline.logs, prefix));
  }
});

test('empty and unprinted source scores never inherit neighboring score identities or geometry', async () => {
  const text = String.raw`#(define (normal-init ctx) (make-engraver ((initialize engraver) (format #t "NORMAL-EMPTY-INIT\n"))))
\layout { \context { \Score \consists #normal-init } }
\book { \header { tagline=##f }
 \score { \header { piece="Empty" } \new Staff {} \layout{} }
 \score { \header { piece="Before" } { c'1 } \layout{} }
 \score { \header { piece="Unprinted" } \new Staff { \omit Staff.StaffSymbol \omit NoteHead c''1 } \layout{} }
 \score { \header { piece="After" } { d'1 } \layout{} }
}`;
  const baseline = await compiler.compile(text, { format: 'svg' }),
    result = await converter.convert(text);

  assert.equal(
    result.scores.length,
    count(baseline.logs, 'NORMAL-EMPTY-INIT'),
    'one document per actual source translation, including a translated empty score',
  );
  assert.equal(result.scores[0]!.document.header.piece, 'Before');
  assert.equal(
    result.scores[0]!.document.headerScopes?.bookStart,
    true,
    'an untranslated empty score does not consume the book title scope',
  );
  assert.equal(result.scores.at(-1)!.document.header.piece, 'After');

  for (const score of result.scores) {
    validate(score.musicxml);
    const final = stage(score);

    if (score.document.header.piece === 'Empty') {
      assert.equal(notes(score.document).length, 0);
      assert.equal(score.document.events.filter((e) => e.kind === 'notePosition').length, 0);

      if (final.status === 'failed') {
        assert.ok(score.diagnostics.some((d) => /capture|layout/.test(d.code)));
      }
    }

    if (score.document.header.piece === 'Unprinted') {
      assert.ok(
        score.document.events
          .filter((e) => e.kind === 'notePosition')
          .every((e) => e.hidden || e.staff === null),
      );
    }

    if (notes(score.document).length) {
      assert.equal(notes(score.document)[0]!.noteId, 1);
    }
  }
});

test('removed collector and failing source page callbacks are explicit and converter recovery stays clean', async () => {
  await assert.rejects(
    converter.convert(
      String.raw`\layout { \context { \Score \remove #ed-score-engraver } } { c'1 }`,
    ),
    /collector|score state|capture|token|translation/i,
  );
  const failing = String.raw`#(define (normal-fail paper pages) (format #t "NORMAL-BOOK-FAIL\n") (error "normal-user-page-failed"))
\paper { page-post-process=#normal-fail } { c'1 }`;
  let logs: readonly string[] = [];

  await assert.rejects(converter.convert(failing), (error: unknown) => {
    const e = error as Error & { logs?: readonly string[] };

    logs = e.logs ?? [];

    return /normal-user-page-failed/.test(e.message);
  });
  assert.equal(count(logs, 'NORMAL-BOOK-FAIL'), 1);
  const reset = (await converter.convert("{ d'1 }")).scores[0]!;

  validate(reset.musicxml);
  assert.equal(stage(reset).status, 'complete');
  assert.deepEqual(
    notes(reset.document).map((n) => n.noteId),
    [1],
  );
});

test('normal renderer formatting failure retains semantic scores without inventing completed geometry', async () => {
  const text = String.raw`#(define (normal-draw-fail grob) (format #t "NORMAL-DRAW-FAIL\n") (error "normal-source-draw-failed"))
\score { \header { piece="Failed" } { \override NoteHead.after-line-breaking=#normal-draw-fail c'1 } \layout{} }
\score { \header { piece="Following" } { d'1 } \layout{} }`;
  const result = await converter.convert(text);

  assert.equal(result.scores.length, 2);
  assert.equal(count(result.logs, 'NORMAL-DRAW-FAIL'), 1);
  assert.deepEqual(
    result.scores.map((s) => s.document.header.piece),
    ['Failed', 'Following'],
  );
  assert.equal(stage(result.scores[0]!).status, 'failed');
  assert.deepEqual(
    notes(result.scores[0]!.document).map((n) => n.noteId),
    [1],
  );
  assert.ok(
    all(parse(result.scores[0]!.musicxml), 'note').every((n) => !n.hasAttribute('default-x')),
  );
  result.scores.forEach((s) => validate(s.musicxml));
  const reset = (await converter.convert("{ e'1 }")).scores[0]!;

  assert.equal(stage(reset).status, 'complete');
  assert.deepEqual(
    notes(reset.document).map((n) => n.noteId),
    [1],
  );
});

test('completed pagination retains real broken, scaled, sparse and hidden staff grids', async () => {
  const source = String.raw`#(set-global-staff-size 30)
\paper { tagline=##f }
\score { \new Staff { c'1 \break d'1 } \layout{} \midi{} }
\score { \new Staff \with { \override StaffSymbol.staff-space=#0.7 } { e'1 } \layout{} \midi{} }
\score { \new Staff \with { \override StaffSymbol.line-positions=#'(-4 0 4) } { f'1 } \layout{} \midi{} }
\score { \new Staff \with { \override StaffSymbol.transparent=##t } { g'1 } \layout{} \midi{} }`;
  const { result } = await independent(source);

  assert.equal(result.scores.length, 4);
  const grids = result.scores.map((s) => s.document.events.filter((e) => e.kind === 'staffLines'));

  for (const [i, rows] of grids.entries()) {
    assert.equal(rows.length, 1);
    const grid = rows[0]!;

    assert.equal(grid.present, true);
    assert.equal(grid.custom, false);
    assert.deepEqual(
      [...grid.positions!].sort((a, b) => a - b),
      i === 2 ? [-4, 0, 4] : [-4, -2, 0, 2, 4],
    );
    assert.equal(grid.hidden, i === 3);
    assert.ok(typeof grid.staffSpace === 'number' && typeof grid.layoutStaffSpace === 'number');
    assert.ok(Math.abs(grid.staffSpace / grid.layoutStaffSpace - (i === 1 ? 0.7 : 1)) < 1e-12);
  }

  assert.equal(
    result.scores[0]!.document.events.filter((e) => e.kind === 'measureLayout' && e.firstOnSystem)
      .length,
    2,
  );
});
