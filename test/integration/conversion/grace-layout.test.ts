import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { compileObserver } from '../../support/source-observation-support.js';

const compiler = createReusableCompiler();

after(() => compiler.dispose());
type Row = Readonly<Record<string, unknown>>;
type RawDocument = { readonly events: readonly Row[] };
const setup = String.raw`\version "2.26.0"
#(define (grace-layout-after g)
 (let* ((s (ly:grob-system g)) (c (ly:item-get-column g))
        (left (ly:spanner-bound s LEFT)))
  (format #t "GRACE-LAYOUT-AFTER ~s\n"
   (list (ly:grob-property-data c 'when) (ly:grob-property-data left 'when)))) #t)
#(define (grace-layout-post paper pages) (format #t "GRACE-LAYOUT-POST ~a\n" (length pages)))
\paper { ragged-right=##t page-post-process=#grace-layout-post }
\header { tagline=##f }
`;
const score = (music: string) => String.raw`\score { \new Staff {
 \override NoteHead.after-line-breaking=#grace-layout-after ${music} }
 \layout { \context { \Voice \remove Forbid_line_break_engraver } }
 \midi { \tempo 4=120 } }
`;
const graceMusic = String.raw`c'1 \grace { \once \override NoteHead.color=#blue d'16
 \break \once \override NoteHead.color=#red e'16 } f'1`;
const ofKind = (doc: RawDocument, kind: string) => doc.events.filter((e) => e.k === kind);

function fraction(value: unknown): readonly [bigint, bigint] {
  assert.ok(typeof value === 'string' || typeof value === 'number');
  const [n, d = '1'] = String(value).split('/');

  assert.ok(n !== undefined);

  return [BigInt(n), BigInt(d)];
}

function compare(a: unknown, b: unknown) {
  const [an, ad] = fraction(a),
    [bn, bd] = fraction(b);

  return an * bd - bn * ad;
}

function checkOrdered(doc: RawDocument) {
  const rows = ofKind(doc, 'measure-layout');

  assert.ok(rows.length > 0);

  for (const row of rows) {
    const main = compare(row['column-m'], row['end-column-m']);

    assert.ok(
      main < 0n || (main === 0n && compare(row['column-g'], row['end-column-g']) <= 0n),
      'actual full PaperColumn interval is ordered',
    );
    assert.ok(
      typeof row['width-tenths'] === 'number' && row['width-tenths'] >= 0,
      'actual source width stays nonnegative',
    );
  }

  return rows;
}

async function independent(source: string) {
  const { observed } = await compileObserver(compiler, source, [
    'GRACE-LAYOUT-AFTER',
    'GRACE-LAYOUT-POST',
  ]);
  const documents = Object.entries(observed.files)
    .filter(([n]) => n.endsWith('.events.json'))
    .map(([, v]) => JSON.parse(new TextDecoder().decode(v)) as RawDocument);

  return { documents, logs: observed.logs };
}

test('inside-grace source breaks retain ordered full column intervals and passive zero-main metadata', async () => {
  const { documents, logs } = await independent(setup + score(graceMusic));

  assert.equal(documents.length, 1);
  const doc = documents[0]!;
  const rows = checkOrdered(doc);

  assert.deepEqual([...new Set(rows.map((r) => r.system))], [1, 2]);
  const grace = rows.find((r) => r['column-g'] === '-1/8' && r['end-column-g'] === '-1/16');

  assert.ok(grace);
  assert.equal(grace.m, 1);
  assert.equal(grace['end-m'], 1);
  assert.ok(Number(grace['width-tenths']) > 0);
  assert.equal(grace.system, 1);
  assert.equal(grace['last-on-system'], true);
  const left = rows.find((r) => r.system === 2 && r['first-on-system'] === true)!;

  assert.equal(left['column-m'], 1);
  assert.equal(left['column-g'], '-1/16');
  const e = ofKind(doc, 'note').find((r) => r.g === '-1/16')!;

  assert.equal(e.nid, 3);
  assert.equal(e.m, 1);
  assert.ok(ofKind(doc, 'note-position').some((r) => r.nid === e.nid && r['column-g'] === '-1/16'));
  assert.deepEqual(
    logs.filter((l) => l.startsWith('GRACE-LAYOUT-AFTER')),
    [
      'GRACE-LAYOUT-AFTER (#<Mom 0> #<Mom 0>)',
      'GRACE-LAYOUT-AFTER (#<Mom 1G-1/8> #<Mom 0>)',
      'GRACE-LAYOUT-AFTER (#<Mom 1G-1/16> #<Mom 1G-1/16>)',
      'GRACE-LAYOUT-AFTER (#<Mom 1> #<Mom 1G-1/16>)',
    ],
  );
});

test('actual column and source note identities reset independently for successive source scores', async () => {
  const { documents } = await independent(
    setup + score(graceMusic) + score(String.raw`g'1 \grace { a'16 \break b'16 } c''1`),
  );

  assert.equal(documents.length, 2);

  for (const doc of documents) {
    const rows = checkOrdered(doc);

    assert.deepEqual(
      rows.map((r) => r.id),
      [1, 2, 3],
    );
    assert.deepEqual(
      ofKind(doc, 'note').map((r) => r.nid),
      [1, 2, 3, 4],
    );
    assert.deepEqual([...new Set(rows.map((r) => r.system))], [1, 2]);
    assert.ok(
      rows.some(
        (r) =>
          r.m === 1 &&
          r['end-m'] === 1 &&
          r['column-g'] === '-1/8' &&
          r['end-column-g'] === '-1/16',
      ),
    );
  }
});
