import type { Element, Node } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type PageCreditRegion, createConverter } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { callbackLogs, compileObserver } from '../../support/source-observation-support.js';
import { elements as all, parse } from '../../support/xml-support.js';

const compiler = createReusableCompiler(),
  converter = createConverter();

after(() => {
  compiler.dispose();
  converter.dispose();
});
const source = String.raw`\version "2.26.0"
#(define-markup-command (page-credit-source layout props label) (string?)
 (format #t "PAGE-CREDIT-SOURCE ~a\n" label)
 (interpret-markup layout props (markup #:italic label)))
#(define (page-credit-source-post paper pages) (format #t "PAGE-CREDIT-POST ~a\n" (length pages)))
\header { title="Page credit witness" tagline=##f }
\paper { paper-width=90\mm paper-height=70\mm top-margin=6\mm bottom-margin=6\mm
 left-margin=5\mm right-margin=5\mm first-page-number=17 print-first-page-number=##t
 ragged-last-bottom=##f page-post-process=#page-credit-source-post
 oddHeaderMarkup=\markup \fill-line { \page-credit-source "ODD header" \fromproperty #'page:page-number-string }
 evenHeaderMarkup=\markup \fill-line { \fromproperty #'page:page-number-string \page-credit-source "EVEN header" }
 oddFooterMarkup=\markup \fill-line { \if \on-last-page \page-credit-source "LAST footer" }
 evenFooterMarkup=\markup \fill-line { \if \on-last-page \page-credit-source "LAST footer" }
}
\score { \new Staff { c'1 \break d'1 \break e'1 \break f'1 } \layout{} \midi{\tempo 4=120} }
`;
const regions = (rows: readonly PageCreditRegion[], page: number, region: 'header' | 'footer') =>
  rows.filter((r) => r.page === page && r.region === region);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.02, `${a} should match ${b}`);

test('cached actual page header/footer observation preserves source SVG bytes and complete callback sequence', async () => {
  const prefixes = ['PAGE-CREDIT-SOURCE', 'PAGE-CREDIT-POST'];
  const { baseline, svgs } = await compileObserver(compiler, source, prefixes);

  assert.equal(svgs.length, 2);
  const callback = (logs: readonly string[]) => callbackLogs(logs, prefixes);
  const result = await converter.convert(source),
    score = result.scores[0]!;

  assert.deepEqual(callback(result.logs), callback(baseline.logs));
  assert.equal(score.document.pageCreditsCaptured, true);
  const rows = score.document.pageCredits!;

  assert.equal(rows.length, 4, 'each source page has a separately resolved header and footer');

  for (const row of rows) {
    assert.equal(row.resolved, true);
    assert.equal(row.book, 1);
    assert.equal(row.bookpart, 0);
    assert.ok(row.scope > 0);
    assert.ok(row.outputScale !== null && row.width !== null && row.height !== null);
    assert.equal(
      row.items.filter((item) => item.text.length > 0).length,
      new Set(row.items.map((item) => item.piece)).size,
    );
  }

  const page1Header = regions(rows, 1, 'header')[0]!,
    page1Footer = regions(rows, 1, 'footer')[0]!;
  const page2Header = regions(rows, 2, 'header')[0]!,
    page2Footer = regions(rows, 2, 'footer')[0]!;

  assert.deepEqual(
    page1Header.items.map((item) => item.text),
    ['ODD header', '17'],
  );
  assert.deepEqual(
    page2Header.items.map((item) => item.text),
    ['18', 'EVEN header'],
  );
  assert.deepEqual(
    page1Footer.items.map((item) => item.text),
    [],
  );
  assert.deepEqual(
    page2Footer.items.map((item) => item.text),
    ['LAST footer'],
  );
  const pageFiles = svgs.map(([, bytes]) => bytes);

  for (const [row, svgBytes] of [
    [page1Header, pageFiles[0]!],
    [page2Header, pageFiles[1]!],
    [page2Footer, pageFiles[1]!],
  ] as const) {
    const doc = parse(new TextDecoder().decode(svgBytes)),
      root = doc.documentElement,
      view = root.getAttribute('viewBox')!.split(' ').map(Number);
    const mmPerSvg = Number(root.getAttribute('width')!.replace('mm', '')) / view[2]!;

    for (const item of row.items) {
      assert.ok(item.x !== null && item.y !== null && item.fontDescription !== null);
      const node = all(doc, 'text').find((el) => el.textContent?.trim() === item.text);

      assert.ok(node, `source SVG text ${item.text}`);
      let x = Number(node.getAttribute('x') ?? 0),
        y = Number(node.getAttribute('y') ?? 0),
        parent: Node | null = node;

      while (parent && parent !== root) {
        if (parent.nodeType === 1) {
          const transform = (parent as Element)
            .getAttribute('transform')
            ?.match(/^translate\(\s*([\d.e+-]+)(?:,\s*|\s+)([\d.e+-]+)\s*\)$/);

          if (transform) {
            x += Number(transform[1]);
            y += Number(transform[2]);
          }
        }

        parent = parent.parentNode;
      }

      close((item.x * row.outputScale!) / mmPerSvg, x);
      close((item.y * row.outputScale!) / mmPerSvg, y);
      const pangoSize = Number(item.fontDescription.match(/(?:^| )([0-9]+(?:\.[0-9]+)?)$/)?.[1]);
      const svgSize = Number(node.getAttribute('font-size'));

      assert.ok(
        Number.isFinite(pangoSize) && svgSize > 0,
        `physical font sizes resolve for ${item.text}`,
      );
      close((pangoSize * 72) / 25.4, (svgSize * mmPerSvg * 72) / 25.4);

      if (item.fontDescription.includes('Italic')) {
        assert.equal(node.getAttribute('font-style'), 'italic');
      }
    }
  }

  const cached = JSON.parse(JSON.stringify(score.document)) as typeof score.document;

  assert.deepEqual(
    cached.pageCredits,
    rows,
    'the public wire metadata survives JSON cache round-trip',
  );
});

test('page credit regions preserve separate source book and bookpart identities', async () => {
  const text = String.raw`\book { \bookpart { \header { title="First part" tagline=##f }
 \score { \header { piece="One" } \new Staff { c'1 } \layout{} }
 \score { \header { piece="Two" } \new Staff { d'1 } \layout{} } }
 \bookpart { \paper { first-page-number=17 bookpart-level-page-numbering=##t }
 \header { title="Second part" tagline=##f }
 \score { \header { piece="Three" } \new Staff { e'1 } \layout{} } } }`;
  const result = await converter.convert(text);

  assert.equal(result.scores.length, 3);
  const owners = result.scores.map((score) => {
    assert.equal(score.document.pageCreditsCaptured, true);
    const rows = score.document.pageCredits!;

    assert.ok(
      rows.length >= 2,
      JSON.stringify({
        piece: score.document.header.piece,
        captured: score.document.pageCreditsCaptured,
        stage: score.document.events.filter((e) => e.kind === 'finalLayout'),
        pages: score.document.pageLayouts,
        logs: result.logs.slice(-15),
      }),
    );

    return new Set(rows.map((row) => `${row.book}:${row.bookpart}:${row.scope}:${row.page}`));
  });

  assert.ok(
    owners.every((set) => set.size === 1),
    'each score retains only its actual shared page ownership',
  );
  assert.equal(
    [...owners[0]!][0],
    [...owners[1]!][0],
    'distinct scores on the actual shared page retain that shared page identity',
  );
  assert.notEqual(
    [...owners[1]!][0],
    [...owners[2]!][0],
    'a later bookpart has an independent source identity',
  );
});
