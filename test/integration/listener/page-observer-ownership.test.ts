import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import listener from '../../../dist/lilypond/generated/listener.js';
import { midiTimedNotes } from '../../support/midi.js';

const compiler = createReusableCompiler();

after(() => compiler.dispose());

// Translate/print the ordinary book once. The Score finalizer deliberately
// detaches collector tables before normal layout asks its grobs to print.
const observationListener =
  listener +
  String.raw`
#(define owner-score-index 0)
#(define owner-snapshots '())
#(define (owner-table-count table) (hash-fold (lambda (key value count) (+ count 1)) 0 table))
#(define (owner-counts tables) (list->vector (map owner-table-count tables)))
#(define (owner-tables) (list xml-combine-text-observed xml-measure-counter-texts xml-ligature-print-values))
#(define (owner-score-engraver ctx)
 (make-engraver
  ((initialize engraver)
   (set! owner-score-index (+ owner-score-index 1))
   (xml-reset-semantic-state!) (xml-reset-final-layout!))
  ((finalize engraver)
   (let ((tables (owner-tables)))
    (set! owner-snapshots (cons (vector owner-score-index (xml-save-score-state)
       tables (owner-counts tables) #f xml-geometry-root-system) owner-snapshots)))
   (xml-clear-combine-text!) (xml-clear-measure-counters!) (xml-clear-ligatures!))))
#(define (owner-observer-post paper pages)
 (owner-source-post paper pages)
 (let ((active (xml-save-score-state)) (fresh (owner-counts (owner-tables)))
       (systems (filter ly:grob? (append-map (lambda(page)
         (map (lambda(line) (ly:prob-property line 'system-grob #f))
          (ly:prob-property page 'lines '()))) pages))))
  (for-each (lambda (entry)
   (when (and (not (vector-ref entry 4))
      (any (lambda(system) (or (eq? system (vector-ref entry 5))
        (eq? (ly:grob-original system) (vector-ref entry 5)))) systems))
    (xml-restore-score-state! (vector-ref entry 1))
    (let ((combine (xml-final-combine-text #t))
          (counters (xml-final-measure-counters)) (ligatures (xml-final-ligatures)))
     (vector-set! entry 4
      (list (cons 'score (vector-ref entry 0))
        (cons 'before (vector-ref entry 3)) (cons 'fresh fresh)
        (cons 'after (owner-counts (vector-ref entry 2)))
        (cons 'combine (list->vector combine)) (cons 'counters (list->vector counters))
        (cons 'ligatures (list->vector ligatures))))))) (reverse owner-snapshots))
  (xml-restore-score-state! active))
 (call-with-output-file (string-append (ly:parser-output-name) ".page-owner.json")
  (lambda (port) (ed-json (list->vector (filter-map (lambda (entry) (vector-ref entry 4))
    (reverse owner-snapshots))) port))))
\layout { \context { \Score \consists #owner-score-engraver } }
#(set! toplevel-book-handler print-book-with-defaults)
#(set! default-toplevel-book-handler print-book-with-defaults)
`;

function score(owner: 'Alpha' | 'Beta') {
  const alpha = owner === 'Alpha',
    style = 'dashed-line';
  const fraction = alpha ? '1/4' : '3/4',
    period = alpha ? '2' : '3';

  return String.raw`
#(define (${owner}-combine g) (format #t "OWNER-${owner}-COMBINE\n") (markup #:bold "${owner}Combine"))
#(define (${owner}-counter g) (format #t "OWNER-${owner}-COUNTER\n") (markup #:italic "${owner}Count"))
#(define (${owner}-style g) (format #t "OWNER-${owner}-STYLE\n") '${style})
#(define (${owner}-fraction g) (format #t "OWNER-${owner}-FRACTION\n") ${fraction})
#(define (${owner}-period g) (format #t "OWNER-${owner}-PERIOD\n") ${period})
\score { \new PianoStaff <<
 \new Staff = "${owner}-combine" \with {
  \override CombineTextScript.font-size = #${alpha ? 1 : 3}
  \override CombineTextScript.before-line-breaking = #(lambda(g) (ly:grob-set-property! g 'text ${owner}-combine))
 } { \partCombine { c''4 d''4 e''4 f''4 g''1 } { c''4 d''4 r4 r4 g''1 } }
 \new Staff = "${owner}-counter" \with {
  \consists Measure_counter_engraver
  \override MeasureCounter.font-encoding = #'latin1
  \override MeasureCounter.text = #${owner}-counter
  \override MeasureCounter.font-size = #${alpha ? 0 : 2}
 } {
  \override LigatureBracket.style = #${owner}-style
  \override LigatureBracket.dash-fraction = #${owner}-fraction
  \override LigatureBracket.dash-period = #${owner}-period
  \startMeasureCount \[ c'2 d'2 \] e'1 \stopMeasureCount
 }
 >> \layout {} \midi { \tempo 4=120 } }
`;
}

function source(bookparts: boolean) {
  const first = score('Alpha'),
    second = score('Beta');

  return String.raw`\version "2.26.0"
#(define (owner-source-post paper pages) (format #t "OWNER-PAGE-POST\n"))
\paper { paper-width=180\mm paper-height=280\mm indent=5\mm ragged-bottom=##t tagline=##f
 page-post-process = #(if (defined? 'owner-observer-post) owner-observer-post owner-source-post) }
\book { ${bookparts ? String.raw`\bookpart { ${first} } \bookpart { ${second} }` : first + second} }
`;
}

interface ObservedRow {
  text?: string | null;
  style?: string;
  'dash-fraction'?: number | string;
  'dash-period'?: number;
  'text-observed'?: boolean;
  hidden?: boolean;
  'font-context'?: { attrs?: { 'font-size'?: number | string } };
}
interface Observation {
  score: number;
  before: number[];
  fresh: number[];
  after: number[];
  combine: ObservedRow[];
  counters: ObservedRow[];
  ligatures: ObservedRow[];
}

for (const bookparts of [false, true]) {
  test(`delayed normal ${bookparts ? 'bookpart' : 'shared-page'} printers retain their owning text and ligature observation tables`, async () => {
    const text = source(bookparts);
    const original = await compiler.compile(text, { format: ['svg', 'midi'] });
    const observed = await compiler.compile(text, {
      format: ['svg', 'midi'],
      files: { 'page-owner.ily': observationListener },
      includeSettings: 'page-owner.ily',
    });
    const pages = Object.keys(original.files).filter((name) => name.endsWith('.svg'));

    assert.equal(
      pages.length,
      bookparts ? 2 : 1,
      'scores actually occupy separate bookparts or one shared page',
    );

    for (const name of pages) {
      assert.deepEqual(
        observed.files[name],
        original.files[name],
        `normal source SVG remains byte-identical: ${name}`,
      );
    }

    const midi = Object.keys(original.files).filter((name) => name.endsWith('.midi'));

    assert.equal(midi.length, 2);

    for (const name of midi) {
      assert.deepEqual(
        midiTimedNotes(observed.files[name]!),
        midiTimedNotes(original.files[name]!),
      );
    }

    const ownerFile = Object.entries(observed.files).find(([name]) =>
      name.endsWith('.page-owner.json'),
    );

    console.log(
      'OWNERSHIP-COUNTS',
      bookparts,
      ownerFile &&
        JSON.parse(new TextDecoder().decode(ownerFile[1])).map((entry: Observation) => ({
          score: entry.score,
          before: entry.before,
          after: entry.after,
          fresh: entry.fresh,
        })),
    );

    for (const owner of ['Alpha', 'Beta']) {
      for (const kind of ['COMBINE', 'COUNTER', 'STYLE', 'FRACTION', 'PERIOD']) {
        const prefix = `OWNER-${owner}-${kind}`,
          count = original.logs.filter((line) => line.startsWith(prefix)).length;

        assert.ok(count > 0, `source really requests ${prefix}`);
        assert.equal(
          observed.logs.filter((line) => line.startsWith(prefix)).length,
          count,
          `no extra or missing source callback: ${prefix}`,
        );
      }
    }

    assert.equal(
      observed.logs.filter((line) => line.startsWith('OWNER-PAGE-POST')).length,
      original.logs.filter((line) => line.startsWith('OWNER-PAGE-POST')).length,
    );
    const output = Object.entries(observed.files).find(([name]) =>
      name.endsWith('.page-owner.json'),
    );

    assert.ok(output);
    const observations = JSON.parse(new TextDecoder().decode(output[1])) as Observation[];

    assert.deepEqual(
      observations.map((entry) => entry.score),
      [1, 2],
    );

    for (const [index, entry] of observations.entries()) {
      const owner = index === 0 ? 'Alpha' : 'Beta';

      assert.deepEqual(
        entry.before,
        [0, 0, 0],
        'all actual printer observations are delayed until after collector detachment',
      );
      assert.deepEqual(
        entry.fresh,
        [0, 0, 0],
        "delayed printers never write into a newer score's global tables",
      );
      assert.ok(
        entry.after.every((count) => count > 0),
        'each detached owning table receives its actual print observations',
      );
      assert.ok(
        entry.combine.length > 0 && entry.counters.length > 0 && entry.ligatures.length > 0,
      );
      assert.ok(
        entry.combine.every(
          (row) => row.text === `${owner}Combine` && row['text-observed'] === true && !row.hidden,
        ),
      );
      assert.ok(entry.counters.every((row) => row.text === `${owner}Count` && !row.hidden));
      assert.ok(entry.ligatures.every((row) => row.style === 'dashed-line' && !row.hidden));
      assert.ok(
        entry.ligatures.every((row) => Number(row['dash-period']) === (index === 0 ? 2 : 3)),
      );
      assert.ok(
        entry.ligatures.every((row) => {
          const value = row['dash-fraction'],
            fraction =
              typeof value === 'string' && value.includes('/')
                ? value
                    .split('/')
                    .map(Number)
                    .reduce((a, b) => a / b)
                : Number(value);

          return fraction === (index === 0 ? 0.25 : 0.75);
        }),
      );
      assert.ok(entry.combine.every((row) => !row.text?.includes(index === 0 ? 'Beta' : 'Alpha')));
    }

    const font = (entry: Observation) =>
      Number(entry.combine[0]!['font-context']?.attrs?.['font-size']);

    assert.ok(
      font(observations[1]!) > font(observations[0]!),
      "owning score's selected font context survives restoration",
    );
  });
}
