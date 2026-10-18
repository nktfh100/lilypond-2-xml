import { createReusableCompiler, LilyPondCompileError } from '@sightread/lilypond-wasm';
import { createConverter } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import listener from '../../../dist/lilypond/generated/listener.js';

const compiler = createReusableCompiler();
const converter = createConverter();

after(() => {
  compiler.dispose();
  converter.dispose();
});

// Probe the normal-book lifecycle used by the public converter, with independent
// score snapshots to verify isolation and recovery across printed scores.
const protocol = String.raw`
#(define state-probe-records '())
#(define state-probe-active #f)
#(define state-probe-next 0)
#(define state-probe-input-notes (make-hash-table))
#(define (state-probe-save!)
 (when state-probe-active
  (vector-set! state-probe-active 5 (xml-save-score-state))
  (vector-set! state-probe-active 6 xml-geometry-root-system)
  (set! state-probe-active #f)))
#(define (state-probe-collector ctx)
 (state-probe-save!)
 (let ((record (ly:output-def-lookup (ly:context-output-def ctx) 'state-probe-token #f)))
  (unless (vector? record) (error "Missing exact score token"))
  (xml-restore-score-state! (vector-ref record 4))
  (set! state-probe-active record)
  (ed-score-engraver ctx)))
#(define (state-probe-capacity-engraver ctx)
 (cons '(must-be-last . #t)
  (make-engraver
   ((finalize engraver)
    (let ((failure (xml-final-native-capacity-failure)))
     (when failure (format #t "STATE-PROBE-CAPACITY\n") (error failure)))))))
\layout { \context { \Score \remove #ed-score-engraver \consists #state-probe-collector \consists #state-probe-capacity-engraver } }
#(define (state-probe-score score headers papers first?)
 (xml-walk-music (ly:score-music score)
  (lambda (item)
   (when (music-is-of-type? item 'note-event)
    (when (hashq-ref state-probe-input-notes item #f) (format #t "STATE-PROBE-ALIASED-NOTE\n"))
    (hashq-set! state-probe-input-notes item #t))))
 (set! state-probe-next (+ state-probe-next 1))
 (set! ed-score-index state-probe-next)
 (xml-reset-semantic-state!) (xml-reset-final-layout!) (xml-reset-staff-lines!)
 (set! xml-figure-columns '()) (set! xml-figure-column-systems (make-hash-table))
 (set! ed-book-headers headers) (set! ed-book-papers papers)
 (set! xml-header-book-start first?)
 (set! ed-header (apply ed-header-alist (append (list (ly:score-header score)) headers (list (ly:parser-lookup '$defaultheader)))))
 (xml-capture-page-headers) (xml-capture-header-fonts)
 (let* ((music (ly:music-deep-copy (ly:score-music score)))
        (layout (ly:output-def-clone
          (or (find (lambda (d) (eq? (ly:output-def-lookup d 'output-def-kind) 'layout)) (ly:score-output-defs score))
              (ly:parser-lookup '$defaultlayout)))))
  (set! ed-paper (xml-paper-settings layout score))
  (xml-prepare-cues music)
  (let* ((record (vector ed-score-index score music #f (xml-save-score-state) #f #f #f))
         (clone (ly:make-score music)))
   (when (module? (ly:score-header score)) (ly:score-set-header! clone (ly:score-header score)))
   (ly:output-def-set-variable! layout 'state-probe-token record)
   (ly:score-add-output-def! clone layout)
   (set! state-probe-records (append state-probe-records (list record)))
   clone)))
#(define (state-probe-pages paper pages)
 (state-probe-save!)
 (for-each (lambda (page)
  (for-each (lambda (line)
   (let ((system (ly:prob-property line 'system-grob #f)))
    (when (ly:grob? system)
     (let ((owners (filter (lambda (r) (eq? (vector-ref r 6) (or (ly:grob-original system) system))) state-probe-records)))
      (unless (= (length owners) 1) (error "Ambiguous actual root owner"))
      (format #t "STATE-PROBE-PAGE ~a ~a\n" (ly:prob-property page 'page-number) (vector-ref (car owners) 0))))))
    (ly:prob-property page 'lines))) pages)
 (for-each (lambda (record)
  (when (and (vector-ref record 5) (not (vector-ref record 7))
    (any (lambda (page)
     (any (lambda (line)
      (let ((system (ly:prob-property line 'system-grob #f)))
       (and (ly:grob? system) (eq? (vector-ref record 6) (or (ly:grob-original system) system)))))
      (ly:prob-property page 'lines))) pages))
   (xml-restore-score-state! (vector-ref record 5))
   (xml-finish-figure-columns!) (xml-finish-staff-lines! #t)
   (xml-finish-final-layout! #f #t)
   (vector-set! record 5 (xml-save-score-state))
   (vector-set! record 7 #t))) state-probe-records))
#(define (state-probe-paper-value papers key)
 (let lookup ((sources (append papers (list (ly:parser-lookup '$defaultpaper)))))
  (and (pair? sources)
   (let ((var (module-local-variable (ly:output-def-scope (car sources)) key)))
    (if (and var (variable-bound? var)) (variable-ref var) (lookup (cdr sources)))))))
#(define (state-probe-preflight!)
 (state-probe-save!)
 (let ((active (xml-save-score-state)))
  (for-each (lambda (record)
   (when (and (vector-ref record 5) (not (vector-ref record 7)))
    (xml-restore-score-state! (vector-ref record 5))
    (let ((failure (xml-final-native-capacity-failure)))
     (when failure (format #t "STATE-PROBE-CAPACITY
") (error failure))))) state-probe-records)
  (xml-restore-score-state! active)))
#(define (state-probe-book book headers papers part?)
 (let* ((headers (cons (ly:book-header book) headers))
        (own-paper (ly:book-paper book))
        (papers (if (ly:output-def? own-paper) (cons own-paper papers) papers))
        (paper (and (or (not part?) (ly:output-def? own-paper))
          (ly:output-def-clone (if (ly:output-def? own-paper) own-paper (ly:parser-lookup '$defaultpaper)))))
        (post (state-probe-paper-value papers 'page-post-process))
        (breaker (state-probe-paper-value papers 'page-breaking))
        (clone (if paper (ly:make-book paper (ly:book-header book)) (ly:make-book-part '())))
        (first? #t))
  (when (module? (ly:book-header book)) (ly:book-set-header! clone (ly:book-header book)))
  (when paper
   (ly:output-def-set-variable! paper 'page-breaking
    (lambda (paper-book) (state-probe-preflight!) (breaker paper-book)))
   (ly:output-def-set-variable! paper 'page-post-process
    (lambda (actual pages)
     (when (procedure? post) (post actual pages))
     (state-probe-pages actual pages))))
  (for-each (lambda (score)
   (ly:book-add-score! clone (state-probe-score score headers papers first?))
   (set! first? #f)) (reverse (filter ly:score? (ly:book-scores book))))
  (for-each (lambda (part) (ly:book-add-bookpart! clone (state-probe-book part headers papers #t)))
    (reverse (ly:book-book-parts book)))
  clone))
#(define (state-probe-handler book)
 (set! state-probe-records '()) (set! state-probe-active #f)
 (let ((clone (state-probe-book book '() '() #f)))
  (print-book-with-defaults clone))
 (state-probe-save!)
 (for-each (lambda (record)
  (unless (vector-ref record 7) (error "Score final snapshot missing"))
  (xml-restore-score-state! (vector-ref record 5))
  (ed-write-json!)) state-probe-records))
#(set! toplevel-book-handler state-probe-handler)
#(set! default-toplevel-book-handler state-probe-handler)
`;

type RawEvent = { k: string; [key: string]: unknown };
type RawScore = {
  contexts: { id: number; name: string }[];
  events: RawEvent[];
  header: { title?: string; piece?: string };
};
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const readScores = (files: Record<string, Uint8Array>) =>
  Object.entries(files)
    .filter(([name]) => name.endsWith('.events.json'))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, bytes]) => ({
      name,
      raw: JSON.parse(decode(bytes)) as RawScore,
    }));

for (const mode of ['shared-page', 'bookpart', 'local-paper']) {
  test(`normal ${mode} state restores exact score owners, terminal labels, and flushes`, async () => {
    const bookparts = mode !== 'shared-page';
    let source = String.raw`
#(define (state-source-post paper pages) (format #t "STATE-SOURCE-POST ~a\n" (length pages)))
#(define (state-source-after grob) (format #t "STATE-SOURCE-AFTER\n") #t)
#(define (state-source-break paper-book) (format #t "STATE-SOURCE-BREAK\n") (ly:optimal-breaking paper-book))
\paper { paper-width=110\mm paper-height=180\mm left-margin=5\mm right-margin=5\mm top-margin=5\mm bottom-margin=5\mm ragged-last-bottom=##t page-post-process=#state-source-post page-breaking=#state-source-break }
\book { \header { title="State witness" tagline=##f }
 \score { \header { piece="First" } \new Staff="same" { \override NoteHead.after-line-breaking=#state-source-after
  \once \omit TupletNumber \tuplet 3/2 { c'8[ d' e'] } f'4 g'2 \label #'first-end }
  \layout {} \midi { \tempo 4=120 } }
 \score { \header { piece="Second" } \new Staff="same" { \override NoteHead.after-line-breaking=#state-source-after
  \once \omit TupletNumber \tuplet 3/2 { a'8[ b' c''] } d''4 e''2 \label #'second-end }
  \layout {} \midi { \tempo 4=90 } }
}`;

    if (bookparts) {
      source =
        source
          .replace(
            '\\score { \\header { piece="First" }',
            '\\bookpart { \\score { \\header { piece="First" }',
          )
          .replace(
            '\\score { \\header { piece="Second" }',
            '} \\bookpart { \\score { \\header { piece="Second" }',
          ) + '}';
    }

    if (mode === 'local-paper') {
      source = source.replace(
        '\\book { \\header',
        String.raw`\book { \paper { paper-width=80\mm paper-height=140\mm left-margin=9\mm right-margin=6\mm } \header`,
      );
    }

    const baseline = await compiler.compile(source, {
      format: ['svg', 'midi'],
    });
    const observed = await compiler.compile(source, {
      format: ['svg', 'midi'],
      files: { 'state-probe.ily': listener + protocol },
      includeSettings: 'state-probe.ily',
    });
    const pages = Object.entries(baseline.files).filter(([name]) => name.endsWith('.svg'));

    assert.equal(
      pages.length,
      bookparts ? 2 : 1,
      'actual page ownership follows the bookpart structure',
    );

    for (const [name, bytes] of pages) {
      assert.deepEqual(observed.files[name], bytes, 'normal book SVG is byte-identical');
    }

    for (const prefix of ['STATE-SOURCE-POST', 'STATE-SOURCE-AFTER', 'STATE-SOURCE-BREAK']) {
      assert.equal(
        observed.logs.filter((l) => l.startsWith(prefix)).length,
        baseline.logs.filter((l) => l.startsWith(prefix)).length,
      );
    }

    assert.deepEqual(
      observed.logs.filter((l) => l.startsWith('STATE-PROBE-PAGE')),
      ['STATE-PROBE-PAGE 1 1', `STATE-PROBE-PAGE ${bookparts ? 2 : 1} 2`],
    );
    const scores = readScores(observed.files);

    assert.equal(scores.length, 2);
    const midi = Object.entries(baseline.files).filter(([name]) => name.endsWith('.midi'));

    assert.equal(midi.length, 2);
    scores.forEach(({ name, raw }, i) => {
      assert.ok(name.endsWith(`.${i + 1}.events.json`));
      assert.equal(raw.header.piece, ['First', 'Second'][i]);
      assert.deepEqual(
        raw.contexts.map((c) => c.id),
        scores[0]!.raw.contexts.map((c) => c.id),
        'context identities reset per score',
      );
      const notes = raw.events.filter((e) => e.k === 'note');

      assert.equal(notes.length, 5);
      assert.deepEqual(
        notes.map((n) => n.nid),
        [1, 2, 3, 4, 5],
      );
      assert.ok(
        raw.events.some((e) => e.k === 'beam'),
        'pending beams survive the snapshot',
      );
      assert.ok(
        raw.events.some((e) => e.k === 'tupletnumber' && e.hidden === true),
        'pending hidden tuplet numbers survive the snapshot',
      );
      const labels = raw.events.filter((e) => e.k === 'label-anchor');

      assert.equal(labels.length, 1);
      assert.deepEqual(labels[0]!.labels, [['first-end', 'second-end'][i]]);
      assert.equal(Number(labels[0]!.m), 1, 'terminal finalizer runs before semantic snapshot');
      const final = raw.events.filter((e) => e.k === 'finallayout');

      assert.equal(final.length, 1);
      assert.equal(final[0]!.status, 'complete');
      assert.equal(raw.events.filter((e) => e.k === 'note-position').length, 5);
      assert.ok(
        Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
        'notation observer emits no MIDI',
      );
    });
  });
}

test('normal score preparation isolates aliased source Music before assigning notation identities', async () => {
  const source = String.raw`
#(define shared #{ c'4 d'4 e'4 f'4 #})
#(define state-music-first (make-music 'SequentialMusic 'elements (list shared)))
#(define state-music-second (make-music 'SequentialMusic 'elements (list #{ a'4 #} shared)))
#(format #t "STATE-MUSIC-ALIASED ~a\n" (eq? (car (ly:music-property state-music-first 'elements)) (cadr (ly:music-property state-music-second 'elements))))
#(define (state-alias-score music)
 (let ((score (ly:make-score (make-music 'ContextSpeccedMusic 'context-type 'Staff 'context-id "same" 'element music))))
  (ly:score-add-output-def! score (ly:output-def-clone (ly:parser-lookup '$defaultlayout)))
  (ly:score-add-output-def! score (ly:output-def-clone (ly:parser-lookup '$defaultmidi))) score))
#(let ((book (ly:make-book (ly:output-def-clone (ly:parser-lookup '$defaultpaper)) #f)))
  (ly:book-add-score! book (state-alias-score state-music-first))
  (ly:book-add-score! book (state-alias-score state-music-second))
  (toplevel-book-handler book))`;
  const baseline = await compiler.compile(source, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(source, {
    format: ['svg', 'midi'],
    files: { 'state-probe.ily': listener + protocol },
    includeSettings: 'state-probe.ily',
  });

  assert.ok(
    observed.logs.includes('STATE-MUSIC-ALIASED #t'),
    'source Scores really share one Music subtree',
  );
  assert.equal(
    observed.logs.filter((l) => l.startsWith('STATE-PROBE-ALIASED-NOTE')).length,
    4,
    'the actual original Scores passed to the book handler still alias all four NoteEvents',
  );

  for (const [name, bytes] of Object.entries(baseline.files).filter(([name]) =>
    name.endsWith('.svg'),
  )) {
    assert.deepEqual(observed.files[name], bytes);
  }

  const midi = Object.entries(baseline.files).filter(([name]) => name.endsWith('.midi'));

  assert.equal(midi.length, 2);
  const scores = readScores(observed.files);

  assert.equal(scores.length, 2);
  scores.forEach(({ raw }, i) => {
    const ids = Array.from({ length: 4 + i }, (_, n) => n + 1);

    assert.deepEqual(
      raw.events.filter((e) => e.k === 'note').map((e) => e.nid),
      ids,
      "preparing a later aliased score cannot overwrite the earlier score's layout Music",
    );
    assert.ok(
      Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
      'notation observer emits no MIDI',
    );
  });
});

test('a Scheme-created bookpart with no paper retains the actual parent paper and callback scope', async () => {
  const source = String.raw`
#(define (state-null-paper-post paper pages) (format #t "STATE-NULL-PAPER-POST\n"))
#(let* ((score (ly:make-score #{ \new Staff="same" { c'4 d' e' f' } #}))
        (part (ly:make-book-part (list score)))
        (paper (ly:output-def-clone (ly:parser-lookup '$defaultpaper)))
        (book (ly:make-book paper #f)))
  (format #t "STATE-SOURCE-PAPER-ABSENT ~a\n" (not (ly:output-def? (ly:book-paper part))))
  (ly:score-add-output-def! score (ly:output-def-clone (ly:parser-lookup '$defaultlayout)))
  (ly:score-add-output-def! score (ly:output-def-clone (ly:parser-lookup '$defaultmidi)))
  (ly:output-def-set-variable! paper 'paper-width (* 80 (ly:output-def-lookup paper 'mm)))
  (ly:output-def-set-variable! paper 'paper-height (* 140 (ly:output-def-lookup paper 'mm)))
  (ly:output-def-set-variable! paper 'page-post-process state-null-paper-post)
  (ly:book-add-bookpart! book part)
  (toplevel-book-handler book))`;
  const baseline = await compiler.compile(source, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(source, {
    format: ['svg', 'midi'],
    files: { 'state-probe.ily': listener + protocol },
    includeSettings: 'state-probe.ily',
  });

  assert.ok(observed.logs.includes('STATE-SOURCE-PAPER-ABSENT #t'));
  const pages = Object.entries(baseline.files).filter(([name]) => name.endsWith('.svg'));

  assert.equal(pages.length, 1);

  for (const [name, bytes] of pages) {
    assert.deepEqual(
      observed.files[name],
      bytes,
      "absent child paper does not replace its parent's physical frame with global defaults",
    );
  }

  assert.equal(observed.logs.filter((l) => l.startsWith('STATE-NULL-PAPER-POST')).length, 1);
  const scores = readScores(observed.files);

  assert.equal(scores.length, 1);
  assert.ok(scores[0]!.raw.events.some((e) => e.k === 'finallayout' && e.status === 'complete'));
  const midi = Object.entries(baseline.files).filter(([name]) => name.endsWith('.midi'));

  assert.equal(midi.length, 1);
  assert.ok(
    Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
});

for (const kind of ['bracket', 'slur']) {
  test(`normal translator rejects guaranteed ${kind} capacity before source layout callbacks`, async () => {
    const starts =
      kind === 'bracket'
        ? String.raw`\startGroup`.repeat(17)
        : Array.from({ length: 17 }, (_, i) => `\\=${i}(`).join('');
    const stops =
      kind === 'bracket'
        ? String.raw`\stopGroup`.repeat(17)
        : Array.from({ length: 17 }, (_, i) => `\\=${i})`).join('');
    const source = String.raw`
#(define (state-capacity-after grob) (format #t "STATE-CAPACITY-AFTER\n") #t)
#(define (state-capacity-break paper-book) (format #t "STATE-CAPACITY-BREAK\n") (ly:optimal-breaking paper-book))
\paper { page-breaking=#state-capacity-break }
\layout { \context { \Voice \consists Horizontal_bracket_engraver } }
{ \override NoteHead.after-line-breaking=#state-capacity-after c'2${starts} d'2${stops} }`;

    await assert.rejects(
      converter.convert(source, { signal: AbortSignal.timeout(15_000) }),
      kind === 'bracket' ? /More than 16 overlapping brackets/ : /More than 16 overlapping slurs/,
    );
    await assert.rejects(
      compiler.compile(source, {
        format: 'svg',
        signal: AbortSignal.timeout(15_000),
        files: { 'state-probe.ily': listener + protocol },
        includeSettings: 'state-probe.ily',
      }),
      (error) => {
        assert.ok(
          error instanceof LilyPondCompileError,
          'controlled compiler rejection, rather than a layout timeout',
        );
        assert.equal(error.logs.filter((l) => l.startsWith('STATE-PROBE-CAPACITY')).length, 1);
        assert.equal(
          error.logs.filter((l) => l.startsWith('STATE-CAPACITY-BREAK')).length,
          0,
          'the actual paginator is never entered',
        );
        assert.equal(
          error.logs.filter((l) => l.startsWith('STATE-CAPACITY-AFTER')).length,
          0,
          'source layout callbacks are never drawn',
        );

        return true;
      },
    );
  });
}

test('normal source page callback fails once and the same compiler recovers without stale score state', async () => {
  const source = String.raw`
#(define (state-failed-post paper pages) (format #t "STATE-FAILED-POST\n") (error "state page failure"))
\paper { page-post-process=#state-failed-post }
{ c'1 }`;

  await assert.rejects(
    compiler.compile(source, {
      format: 'svg',
      files: { 'state-probe.ily': listener + protocol },
      includeSettings: 'state-probe.ily',
    }),
    (error) => {
      assert.ok(error instanceof LilyPondCompileError);
      assert.equal(error.logs.filter((l) => l.startsWith('STATE-FAILED-POST')).length, 1);
      assert.equal(
        error.logs.filter((l) => l.includes('lilypond-event-document: wrote')).length,
        0,
        'no partial JSON commits after user callback failure',
      );

      return true;
    },
  );
  const healthy = await compiler.compile(String.raw`\score { { d'1 } \layout {} \midi {} }`, {
    format: 'svg',
    files: { 'state-probe.ily': listener + protocol },
    includeSettings: 'state-probe.ily',
  });
  const scores = readScores(healthy.files);

  assert.equal(scores.length, 1);
  assert.ok(scores[0]!.name.endsWith('.1.events.json'));
  assert.equal(scores[0]!.raw.events.filter((e) => e.k === 'note').length, 1);
  assert.ok(scores[0]!.raw.events.some((e) => e.k === 'finallayout' && e.status === 'complete'));
});
