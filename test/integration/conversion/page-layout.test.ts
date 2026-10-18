import type { Document, Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import {
  type ConvertedScore,
  type PageSystemLayout,
  type ScoreDocument,
  createConverter,
  toMusicXML,
} from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import listener from '../../../dist/lilypond/generated/listener.js';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { childElements, elements as all, parse } from '../../support/xml-support.js';

const converter = createConverter(),
  compiler = createReusableCompiler();
const reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const count = (logs: readonly string[], prefix: string) =>
  logs.filter((l) => l.startsWith(prefix)).length;
const pageKey = (row: PageSystemLayout) => `${row.book}:${row.scope}:${row.page}`;
const close = (actual: number, expected: number, tolerance = 0.00006) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} versus ${expected}`);
const numbers = (node: Document | Element, tag: string) =>
  all(node, tag).map((e) => Number(e.textContent));
const stage = (score: ConvertedScore) =>
  score.document.events.filter((e) => e.kind === 'finalLayout')[0]!;

interface SourcePage {
  widthMM: number;
  heightMM: number;
  scale: number;
  lines: { x: number; y: number }[];
}

function sourcePage(bytes: Uint8Array): SourcePage {
  const doc = parse(new TextDecoder().decode(bytes)),
    root = doc.documentElement;
  const view = root.getAttribute('viewBox')!.split(' ').map(Number);
  const widthMM = Number(root.getAttribute('width')!.replace('mm', ''));
  const heightMM = Number(root.getAttribute('height')!.replace('mm', ''));
  const lines = all(doc, 'line')
    .filter((el) => Number(el.getAttribute('x2')) - Number(el.getAttribute('x1')) > 10)
    .map((el) => {
      const transform = (el.parentNode as Element)
        .getAttribute('transform')
        ?.match(/translate\(([-\d.]+), ([-\d.]+)\)/);

      assert.ok(transform, 'independent source staff-line translation');

      return { x: Number(transform[1]), y: Number(transform[2]) };
    });

  return { widthMM, heightMM, scale: widthMM / view[2]!, lines };
}

async function independent(source: string) {
  const baseline = await compiler.compile(source, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(source, {
    format: ['svg', 'midi'],
    files: { 'page-observer.ily': listener },
    includeSettings: 'page-observer.ily',
  });
  const pages = Object.entries(baseline.files)
    .filter(([n]) => n.endsWith('.svg'))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  assert.ok(pages.length);

  for (const [name, bytes] of pages) {
    assert.deepEqual(observed.files[name], bytes, `passive actual source page ${name}`);
  }

  const result = await converter.convert(source);

  for (const prefix of ['PAGE-SOURCE-POST', 'PAGE-SOURCE-AFTER', 'PAGE-SOURCE-FORMAT']) {
    assert.equal(count(observed.logs, prefix), count(baseline.logs, prefix));
    assert.equal(count(result.logs, prefix), count(baseline.logs, prefix));
  }

  result.scores.forEach((s) => validate(s.musicxml));

  return { result, baseline, pages: pages.map(([, b]) => sourcePage(b)) };
}

function sourceCoordinates(scores: readonly ConvertedScore[], pages: readonly SourcePage[]) {
  const groups = new Map<string, PageSystemLayout[]>();

  for (const score of scores) {
    assert.equal(score.document.pageLayoutsCaptured, true);
    assert.equal(stage(score).status, 'complete');
    assert.equal(stage(score).stage, 'book');

    for (const row of score.document.pageLayouts!) {
      const key = pageKey(row),
        group = groups.get(key) ?? [];

      group.push(row);
      groups.set(key, group);
    }
  }

  assert.equal(groups.size, pages.length);
  const source = new Map<string, SourcePage>();
  let index = 0;

  for (const [key, rows] of groups) {
    const page = pages[index++]!;

    source.set(key, page);

    for (const row of rows) {
      assert.ok(row.outputScale !== null && row.width !== null && row.height !== null);
      close(row.width * row.outputScale, page.widthMM, 0.000001);
      close(row.height * row.outputScale, page.heightMM, 0.000001);
      close(row.outputScale, page.scale, 0.00001);
    }

    const expected = rows
      .flatMap((row) =>
        row.staves
          .filter((s) => !s.hidden)
          .flatMap((s) => {
            assert.ok(s.baselineY !== null && s.staffSpace !== null && s.linePositions !== null);

            return s.linePositions.map(
              (p) => s.baselineY! + (s.inkOffset?.[1] ?? 0) - 0.5 * s.staffSpace! * p,
            );
          }),
      )
      .sort((a, b) => a - b);
    const actual = page.lines.map((l) => l.y).sort((a, b) => a - b);

    assert.equal(actual.length, expected.length);
    actual.forEach((y, i) => close(expected[i]!, y));
  }

  return source;
}

function playback(xml: string, midi: Uint8Array, expectedPages: number) {
  reader.setOptions({
    breaks: 'encoded',
    pageWidth: 2200,
    pageHeight: 3000,
    adjustPageHeight: false,
    header: 'none',
    footer: 'none',
    xmlIdSeed: 1,
  });
  assert.equal(reader.loadData(xml), 1);
  assert.equal(reader.getPageCount(), expectedPages);
  const actual = midiTimedNotes(reader.renderToMIDI()),
    expected = midiTimedNotes(midi);

  assert.deepEqual(
    actual.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  actual.forEach((n, i) => close(n.duration!, expected[i]!.duration!, 0.01));
}

const callbacks = String.raw`#(define (page-source-post paper pages) (display "PAGE-SOURCE-POST\n"))
#(define (page-source-after grob) (display "PAGE-SOURCE-AFTER\n") #t)
#(define (page-source-format grob) (display "PAGE-SOURCE-FORMAT\n") (tuplet-number::calc-fraction-text grob))
`;

// This source includes two scores on a real shared page; the second continues
// under automatic pagination. A later bookpart deliberately restarts numbering.
test('actual normal pages retain shared-score placement, automatic page ownership and bookpart numbering', async () => {
  const pair = (upper: string, lower: string) =>
    String.raw`\new PianoStaff << \new Staff="upper" { \override NoteHead.after-line-breaking=#page-source-after ${upper} } \new Staff="lower" { \clef bass \override NoteHead.after-line-breaking=#page-source-after ${lower} } >>`;
  const source =
    callbacks +
    String.raw`\paper { paper-width=90\mm paper-height=150\mm top-margin=5\mm bottom-margin=5\mm left-margin=5\mm right-margin=5\mm indent=0 short-indent=0 ragged-last-bottom=##t page-post-process=#page-source-post }
\book { \bookpart { \header { title="Shared physical source page" tagline=##f }
 \score { \header { piece="A" } ` +
    pair(
      String.raw`\override TupletNumber.text=#page-source-format \tuplet 3/2 { c''8 d'' e'' } f''4 g''2`,
      'c1',
    ) +
    String.raw` \layout{} \midi{\tempo 4=120} }
 \score { \header { piece="B" } ` +
    pair(String.raw`\repeat unfold 12 { c''4 d'' e'' f'' }`, String.raw`\repeat unfold 12 { c1 }`) +
    String.raw` \layout{} \midi{\tempo 4=120} } }
 \bookpart { \paper { first-page-number=17 bookpart-level-page-numbering=##t } \header { title="Numbered bookpart" tagline=##f }
 \score { \header { piece="C" } ` +
    pair(String.raw`g''1 \pageBreak a''1`, 'c1 d1') +
    String.raw` \layout{} \midi{\tempo 4=120} } } }`;
  const { result, baseline, pages } = await independent(source);

  assert.equal(result.scores.length, 3);
  const [a, b, c] = result.scores as [ConvertedScore, ConvertedScore, ConvertedScore];

  assert.equal(
    pageKey(a.document.pageLayouts![0]!),
    pageKey(b.document.pageLayouts![0]!),
    'different exact Score roots share one physical page',
  );
  assert.ok(
    new Set(b.document.pageLayouts!.map(pageKey)).size > 1,
    'actual automatic pagination divides score B',
  );
  assert.ok(
    b.document.pageLayouts![0]!.staves[0]!.baselineY! >
      a.document.pageLayouts![0]!.staves.at(-1)!.baselineY!,
  );
  assert.notEqual(c.document.pageLayouts![0]!.scope, b.document.pageLayouts![0]!.scope);
  assert.deepEqual(
    c.document.pageLayouts!.map((r) => [r.page, r.displayedPage]),
    [
      [1, 17],
      [2, 18],
    ],
  );
  const physical = sourceCoordinates(result.scores, pages);
  const midi = Object.entries(baseline.files).filter(([n]) => n.endsWith('.midi'));

  assert.equal(midi.length, 3);

  for (const [i, score] of result.scores.entries()) {
    const xml = parse(score.musicxml),
      rows = score.document.pageLayouts!,
      ownPages = [...new Set(rows.map(pageKey))];

    playback(score.musicxml, midi[i]![1], ownPages.length);
    const print = all(xml, 'print').filter((p) => p.hasAttribute('new-page'));

    assert.deepEqual(
      print
        .filter((p) => p.getAttribute('new-page') === 'yes')
        .map((p) => p.getAttribute('page-number')),
      ownPages.map((key) => String(rows.find((r) => pageKey(r) === key)!.displayedPage)),
    );
    const mmPerTenth =
      Number(all(xml, 'scaling')[0]!.getElementsByTagName('millimeters')[0]!.textContent) / 40;
    const actualTopMM = numbers(xml, 'top-system-distance').map((n) => n * mmPerTenth);
    const expectedTopMM = ownPages.map((key) => {
      const row = rows.find((r) => pageKey(r) === key)!,
        page = physical.get(key)!;
      const first = row.staves[0]!,
        top = first.baselineY! - first.staffSpace! * 2;
      const sourceInkTop = page.lines.map((l) => l.y).filter((y) => Math.abs(y - top) < 0.00006)[0];

      assert.ok(sourceInkTop !== undefined);

      return sourceInkTop * page.scale - 5;
    });

    assert.equal(actualTopMM.length, expectedTopMM.length);
    actualTopMM.forEach((n, j) => close(n, expectedTopMM[j]!, 0.0002));
    assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-reader'));
  }

  assert.ok(
    numbers(parse(b.musicxml), 'top-system-distance')[0]! >
      numbers(parse(a.musicxml), 'top-system-distance')[0]!,
  );
});

test('page distances use actual physical frames for global and score-only sizing, local grids and Paper_system offsets', async () => {
  const matrix = [
    [
      'global30-local7',
      String.raw`#(set-global-staff-size 30)`,
      '',
      String.raw`\override StaffSymbol.staff-space=#0.7`,
      '',
    ],
    [
      'score30-local7',
      '',
      String.raw`#(layout-set-staff-size 30)`,
      String.raw`\override StaffSymbol.staff-space=#0.7`,
      '',
    ],
    [
      'sparse-hidden',
      '',
      String.raw`\context { \Staff \override StaffSymbol.line-positions=#'(-4 0 4) }`,
      String.raw`\override StaffSymbol.transparent=##t`,
      '',
    ],
    [
      'paper-extra-two-sided',
      '',
      String.raw`\context { \Score \override NonMusicalPaperColumn.line-break-system-details=#'((extra-offset . (2 . 3))) }`,
      '',
      String.raw`two-sided=##t inner-margin=7\mm outer-margin=11\mm first-page-number=17`,
    ],
  ] as const;

  for (const [name, prefix, layout, lower, paper] of matrix) {
    const source =
      callbacks +
      prefix +
      String.raw`\paper { paper-width=90\mm paper-height=150\mm top-margin=5\mm bottom-margin=5\mm left-margin=5\mm right-margin=5\mm indent=0 short-indent=0 page-post-process=#page-source-post ${paper} }
\book { \bookpart { \header { title="Frame" tagline=##f } \score { \new PianoStaff << \new Staff { \override NoteHead.after-line-breaking=#page-source-after c''1 \pageBreak d''1 } \new Staff \with { ${lower} } { \override NoteHead.after-line-breaking=#page-source-after c1 d1 } >> \layout { ${layout} } \midi{\tempo 4=120} } } }`;
    const { result, pages, baseline } = await independent(source),
      score = result.scores[0]!,
      rows = score.document.pageLayouts!;
    const physical = sourceCoordinates(result.scores, pages),
      xml = parse(score.musicxml);

    assert.equal(rows.length, 2, name);
    const mmPerTenth =
      Number(all(xml, 'scaling')[0]!.getElementsByTagName('millimeters')[0]!.textContent) / 40;

    assert.equal(numbers(xml, 'top-system-distance').length, 2, name);
    const distances = numbers(xml, 'top-system-distance'),
      staffGaps = numbers(xml, 'staff-distance');

    assert.equal(staffGaps.length, 2, name);

    for (const [i, row] of rows.entries()) {
      const page = physical.get(pageKey(row))!,
        [first, second] = row.staves;

      assert.ok(
        first &&
          second &&
          first.baselineY !== null &&
          first.staffSpace !== null &&
          second.baselineY !== null &&
          second.staffSpace !== null,
      );
      const sourceTop = page.lines
        .map((l) => l.y)
        .find((y) => Math.abs(y - (first.baselineY! - 2 * first.staffSpace!)) < 0.00006);

      assert.ok(sourceTop !== undefined);
      close(distances[i]! * mmPerTenth, sourceTop * page.scale - 5, 0.0002);
      const firstBottom = first.baselineY + 2 * first.staffSpace,
        secondTop = second.baselineY - 2 * second.staffSpace;

      close(staffGaps[i]! * mmPerTenth, (secondTop - firstBottom) * page.scale, 0.0002);

      if (name === 'paper-extra-two-sided') {
        assert.equal(row.displayedPage, 17 + i);
        assert.ok(page.lines.every((l) => Math.abs(l.x - row.systemX!) < 0.00006));
        const marginNode = all(xml, 'print').flatMap((p) => all(p, 'system-margins'))[i]!;

        close(
          Number(all(marginNode, 'left-margin')[0]!.textContent) * mmPerTenth,
          2 * page.scale,
          0.0002,
        );
      }
    }

    const sourceMidi = Object.entries(baseline.files).find(([n]) => n.endsWith('.midi'))![1];

    playback(score.musicxml, sourceMidi, 2);
  }

  for (const [name, config, space, ink] of [
    ['offset', String.raw`\override StaffSymbol.extra-offset=#'(0 . 2)`, 1, -2],
    [
      'local-offset',
      String.raw`\override StaffSymbol.staff-space=#0.7 \override StaffSymbol.extra-offset=#'(0 . 2)`,
      0.7,
      -1.4,
    ],
    ['custom-delegate', String.raw`\override StaffSymbol.stencil=#page-custom-staff`, 1, 0],
  ] as const) {
    const source =
      callbacks +
      String.raw`#(define (page-custom-staff g) (display "PAGE-CUSTOM-STAFF\n") (ly:staff-symbol::print g))
\paper { paper-width=90\mm paper-height=150\mm top-margin=5\mm bottom-margin=5\mm left-margin=5\mm right-margin=5\mm page-post-process=#page-source-post }
\score { \new Staff \with { ${config} } { \override NoteHead.color=#blue \override Staff.StaffSymbol.color=#red c'1 } \layout{} \midi{\tempo 4=120} }`;
    const { result, baseline, pages } = await independent(source),
      score = result.scores[0]!,
      xml = parse(score.musicxml);

    sourceCoordinates(result.scores, pages);
    const originalSVG = new TextDecoder().decode(
      Object.entries(baseline.files).find(([n]) => n.endsWith('.svg'))![1],
    );
    const svg = parse(originalSVG),
      group = all(svg, 'g').find(
        (g) => g.getAttribute('color') === 'rgba(0.0000%, 0.0000%, 100.0000%, 100.0000%)',
      );

    assert.ok(group);
    const positioned = all(group, 'g').find((g) =>
      g.getAttribute('transform')?.startsWith('translate('),
    );

    assert.ok(positioned);
    const headY = Number(positioned.getAttribute('transform')!.match(/, ([-\d.]+)\)/)![1]);
    const row = score.document.pageLayouts![0]!,
      staff = row.staves[0]!;

    close(staff.baselineY!, headY - 3 * space);
    close(staff.inkOffset![1], ink);
    const inkCenter = pages[0]!.lines.map((l) => l.y).sort((a, b) => a - b)[2]!;

    close(inkCenter - (headY - 3 * space), ink);
    const mmPerTenth = numbers(xml, 'millimeters')[0]! / 40;

    close(
      numbers(xml, 'top-system-distance')[0]! * mmPerTenth,
      (headY - 5 * space) * pages[0]!.scale - 5,
      0.0002,
    );
    assert.equal(staff.custom, name === 'custom-delegate');
    assert.equal(count(baseline.logs, 'PAGE-CUSTOM-STAFF'), name === 'custom-delegate' ? 1 : 0);
    assert.equal(
      count(result.logs, 'PAGE-CUSTOM-STAFF'),
      count(baseline.logs, 'PAGE-CUSTOM-STAFF'),
    );
  }

  const separate = await independent(
    callbacks +
      String.raw`\paper { page-post-process=#page-source-post }
\score { \new StaffGroup << \new Staff { c''1 } \new Staff { c'1 } >> \layout{} \midi{\tempo 4=120} }`,
  );

  sourceCoordinates(separate.result.scores, separate.pages);
  const parts = all(parse(separate.result.scores[0]!.musicxml), 'part');

  assert.equal(parts.length, 2);
  assert.equal(numbers(parts[0]!, 'staff-distance').length, 0);
  const secondStaff = all(parts[1]!, 'staff-layout')[0]!;

  assert.equal(secondStaff.getAttribute('number'), '1');
  const lines = separate.pages[0]!.lines.map((l) => l.y).sort((a, b) => a - b);

  assert.equal(lines.length, 10);
  const scale = numbers(parse(separate.result.scores[0]!.musicxml), 'millimeters')[0]! / 40;

  close(
    numbers(secondStaff, 'staff-distance')[0]! * scale,
    (lines[5]! - lines[4]!) * separate.pages[0]!.scale,
    0.0002,
  );
});

test('opaque page-stencil expressions retain diagnostics without aborting source geometry', async () => {
  const source = String.raw`\header { tagline=##f }
\paper { paper-width=90\mm paper-height=100\mm
 oddHeaderMarkup=\markup \fill-line { "Opaque page stencil witness" \draw-line #'(0 . 2) } }
\score { \new Staff { c'1 } \layout{} }`;
  const { result, pages } = await independent(source),
    score = result.scores[0]!;

  assert.equal(stage(score).status, 'complete');
  assert.equal(score.document.pageLayoutsCaptured, true);
  assert.equal(score.document.pageCreditsCaptured, true);
  assert.ok(
    score.document.pageCredits?.some((region) => region.resolved && region.primitives.length > 0),
    'opaque source stencil leaves remain in cached metadata',
  );
  assert.ok(
    score.document.pageCredits?.some((region) =>
      region.items.some((item) => item.text === 'Opaque page stencil witness'),
    ),
    'text survives beside the unsupported drawing',
  );
  assert.ok(
    score.diagnostics.some((d) => d.code === 'page-credit-drawing'),
    'unsupported stencil drawing is diagnosed',
  );
  sourceCoordinates(result.scores, pages);
});

test('cached page provenance, unavailable geometry and following conversions remain explicit', async () => {
  const source = String.raw`\paper { paper-height=90\mm } \score { \new Staff { \repeat unfold 16 { c'4 d' e' f' } } \layout{} \midi{\tempo 4=120} }`;
  const score = (await converter.convert(source)).scores[0]!,
    cached = JSON.parse(JSON.stringify(score.document)) as ScoreDocument;

  validate(score.musicxml);
  assert.ok(cached.pageLayouts!.length > 1);
  assert.equal(
    toMusicXML(cached, { source }).musicxml,
    score.musicxml,
    'complete XML survives cache replay with the original export options',
  );
  const { pageLayoutsCaptured: _capture, ...legacy } = cached;
  const replay = toMusicXML(legacy);

  validate(replay.musicxml);
  assert.ok(replay.diagnostics.some((d) => d.code === 'page-layout-history'));
  assert.equal(all(parse(replay.musicxml), 'top-system-distance').length, 0);
  const duplicate = toMusicXML({
    ...cached,
    pageLayouts: [cached.pageLayouts![0]!, ...cached.pageLayouts!],
  });

  validate(duplicate.musicxml);
  assert.ok(duplicate.diagnostics.some((d) => d.code === 'page-layout-ownership'));
  assert.equal(all(parse(duplicate.musicxml), 'top-system-distance').length, 0);
  await assert.rejects(
    converter.convert(String.raw`\score { { d'1 } \midi{\tempo 4=120} }`),
    /no printed score documents/,
  );
  const failed = (
    await converter.convert(
      String.raw`#(define (page-draw-fail g) (error "page draw failed")) \score { { \override NoteHead.after-line-breaking=#page-draw-fail c'1 } \layout{} }`,
    )
  ).scores[0]!;

  assert.equal(stage(failed).status, 'failed');
  assert.equal(all(parse(failed.musicxml), 'top-system-distance').length, 0);
  const inherited = await converter.convert(
    String.raw`\book { \paper { paper-width=80\mm paper-height=140\mm } \bookpart { \score { { c'1 } \layout{} } } \bookpart { \score { { d'1 } \layout{} } } }`,
  );

  assert.equal(inherited.scores.length, 2);
  const scopes = inherited.scores.map((s) => s.document.pageLayouts![0]!);

  assert.notEqual(
    scopes[0]!.scope,
    scopes[1]!.scope,
    'paperless bookparts sharing a callback still own distinct actual Paper_books',
  );
  assert.deepEqual(
    scopes.map((s) => s.page),
    [1, 1],
  );
  inherited.scores.forEach((s) => validate(s.musicxml));
  const reset = (
    await converter.convert(String.raw`\score { { e'1 } \layout{} \midi{\tempo 4=120} }`)
  ).scores[0]!;

  assert.equal(stage(reset).status, 'complete');
  assert.equal(reset.document.pageLayouts![0]!.book, 1);
  assert.equal(reset.document.pageLayouts![0]!.scope, 1);
  assert.equal(reset.document.pageLayouts![0]!.page, 1);
  const split = (
    await converter.convert(
      String.raw`\score { \new Staff { c'2 \break d'2 } \layout{} \midi{\tempo 4=120} }`,
    )
  ).scores[0]!;

  validate(split.musicxml);
  assert.equal(split.document.pageLayouts!.length, 2);
  assert.ok(!split.diagnostics.some((d) => d.code === 'page-layout-midmeasure-reader'));
  assert.ok(!split.diagnostics.some((d) => d.code === 'page-layout-boundary'));
  const splitXML = parse(split.musicxml);

  assert.equal(all(splitXML, 'note').length, 2, 'page geometry does not split source notes');
  assert.equal(all(splitXML, 'top-system-distance').length, 1);
  assert.equal(all(splitXML, 'measure').length, 1);
  const splitNotes = all(splitXML, 'note');
  const splitChildren = childElements(all(splitXML, 'measure')[0]!);

  assert.equal(splitChildren[splitChildren.indexOf(splitNotes[0]!) + 1]!.nodeName, 'print');
  assert.equal(splitChildren[splitChildren.indexOf(splitNotes[1]!) - 1]!.nodeName, 'print');
  const opaque = await independent(String.raw`#(define page-parent-symbol #f)
#(define (page-parent-observer ctx) (make-engraver (acknowledgers ((staff-symbol-interface engraver grob source) (set! page-parent-symbol grob)))))
#(define (page-parent-post paper pages)
 (let* ((pieces (ly:spanner-broken-into page-parent-symbol)) (piece (if (pair? pieces) (car pieces) page-parent-symbol)) (parent (ly:grob-parent piece Y)))
  (ly:grob-set-property! parent 'Y-offset (lambda (grob) (display "PAGE-OPAQUE-PARENT\n") (error "must not force source parent")))))
\paper { page-post-process=#page-parent-post }
\layout { \context { \Staff \consists #page-parent-observer } }
\score { \new Staff { c'1 } \layout{} \midi{\tempo 4=120} }`);
  const guarded = opaque.result.scores[0]!;

  assert.equal(count(opaque.baseline.logs, 'PAGE-OPAQUE-PARENT'), 0);
  assert.equal(count(opaque.result.logs, 'PAGE-OPAQUE-PARENT'), 0);
  assert.equal(guarded.document.pageLayouts![0]!.staves[0]!.baselineY, null);
  assert.ok(guarded.diagnostics.some((d) => d.code === 'page-layout-staves'));
  assert.equal(all(parse(guarded.musicxml), 'top-system-distance').length, 0);
});
