import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { createConverter } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import listener from '../../../dist/lilypond/generated/listener.js';
import type { WireEvent } from '../../../src/lilypond/wire.js';
import { elements as all, parse } from '../../support/xml-support.js';

const compiler = createReusableCompiler();
const converter = createConverter();

after(() => {
  compiler.dispose();
  converter.dispose();
});

const output = (files: Record<string, Uint8Array>, suffix: string) => {
  const entry = Object.entries(files).find(([name]) => name.endsWith(suffix));

  assert.ok(entry, `compiler output ${suffix}`);

  return entry[1];
};
const events = (files: Record<string, Uint8Array>) =>
  JSON.parse(new TextDecoder().decode(output(files, '.events.json'))) as {
    events: Record<string, unknown>[];
  };

type Matrix = [number, number, number, number, number, number];
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const matrix = (text: string | null): Matrix => {
  let result: Matrix = [1, 0, 0, 1, 0, 0];

  for (const match of (text ?? '').matchAll(/(matrix|translate|scale)\(([^)]*)\)/g)) {
    const n = (match[2] ?? '').trim().split(/[ ,]+/).map(Number),
      kind = match[1];
    const next: Matrix =
      kind === 'matrix' && n.length === 6
        ? (n as Matrix)
        : kind === 'translate'
          ? [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]
          : [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];

    result = multiply(result, next);
  }

  return result;
};
const point = (
  node: Element,
  x = Number(node.getAttribute('x') ?? 0),
  y = Number(node.getAttribute('y') ?? 0),
) => {
  const chain: Element[] = [];

  for (
    let current: Element | null = node;
    current;
    current = current.parentNode?.nodeType === 1 ? (current.parentNode as Element) : null
  ) {
    chain.push(current);
  }

  let m: Matrix = [1, 0, 0, 1, 0, 0];

  for (const el of chain.reverse()) {
    m = multiply(m, matrix(el.getAttribute('transform')));
  }

  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
};
const sourceHeader = String.raw`\version "2.26.0"
#(define tags 0)
#(define after-calls 0)
#(define custom-calls 0)
#(define (tag grob) (set! tags (+ tags 1)) '((data-g03-column . "target")))
#(define (left-tag grob) (let* ((system (ly:grob-system grob)) (left (and (ly:grob? system) (ly:spanner-bound system LEFT)))) (if (and (ly:grob? left) (eq? left grob)) '((data-g03-system-left . "yes")) '())))
#(define (left-print grob) (ly:stencil-add (ly:paper-column::print grob) (ly:make-stencil '(path 0.05 (moveto 0 0 lineto 0 0.1) round round #t) '(0 . 0.05) '(0 . 0.1))))
#(define (after-callback grob) (set! after-calls (+ after-calls 1)) #t)
#(define (custom-print grob) (set! custom-calls (+ custom-calls 1)) (ly:text-interface::print grob))
#(define (report paper pages) (format #t "G03-COUNTS ~a ~a ~a\\n" tags after-calls custom-calls))
\paper { tagline=##f page-post-process=#report }
`;
const layout = String.raw`\layout { \context { \Score
 \override PaperColumn.stencil=#left-print \override NonMusicalPaperColumn.stencil=#left-print
 \override PaperColumn.output-attributes=#left-tag \override NonMusicalPaperColumn.output-attributes=#left-tag } }`;
const musical = (staff: string, extra: string) =>
  sourceHeader +
  String.raw`\score { \new Staff { ${staff}
 \override TextScript.output-attributes=#tag ${extra} c'4-\markup \center-column { "upper" "lower" } d'4 }
 ${layout} \midi { \tempo 4=120 } }`;

test('local staff scale and rational TextScript offset agree with absolute source SVG coordinates', async () => {
  const source = musical(
    String.raw`\override StaffSymbol.staff-space=#0.7`,
    String.raw`\override TextScript.extra-offset=#'(3/2 . -7/4)`,
  );
  const plain = await compiler.compile(source, { format: ['svg', 'midi'] });
  const captured = await compiler.compile(source, {
    format: ['svg', 'midi'],
    files: { 'text-columns.ily': listener },
    includeSettings: 'text-columns.ily',
  });

  assert.deepEqual(output(captured.files, '.svg'), output(plain.files, '.svg'));
  assert.ok(
    Object.keys(captured.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  assert.deepEqual(
    captured.logs.filter((x) => x.startsWith('G03-COUNTS ')),
    plain.logs.filter((x) => x.startsWith('G03-COUNTS ')),
  );
  const raw = events(captured.files),
    rows = raw.events.filter(
      (e): e is Extract<WireEvent, { k: 'textcolumnposition' }> => e.k === 'textcolumnposition',
    ),
    attachments = raw.events.filter((e) => e.c === 'text-script-event');

  assert.equal(rows.length, 1);
  assert.equal(attachments.length, 1);
  assert.equal(rows[0]!.id, attachments[0]!['xml-text-column-id']);
  const row = rows[0]!,
    line = row.lines[0]!,
    scale = Number(row['output-scale']),
    globalMm = Number(row['global-staff-space-mm']),
    layoutSpace = Number(row['global-layout-staff-space']);

  assert.ok(Math.abs(scale * layoutSpace - globalMm) < 1e-8);
  assert.ok(Math.abs(Number(line['staff-top-y-tenths'])) > 0);
  const svg = parse(new TextDecoder().decode(output(plain.files, '.svg')));
  const owner = all(svg, '*').find((el) => el.getAttribute('data-g03-column') === 'target');

  assert.ok(owner);
  const text = all(owner, 'text').find((el) => el.textContent?.trim() === 'upper');

  assert.ok(text);
  const marker = all(svg, '*').find((el) => el.getAttribute('data-g03-system-left') === 'yes');

  assert.ok(marker);
  const markerPath = all(marker, 'path').find((el) => {
    const m = (el.getAttribute('d') ?? '').match(/^M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)$/);

    return (
      !!m &&
      Math.abs(Number(m[3]) - Number(m[1])) < 1e-7 &&
      Math.abs(Math.abs(Number(m[4]) - Number(m[2])) - 0.1) < 1e-6
    );
  });

  assert.ok(markerPath);
  const d = markerPath.getAttribute('d')!.match(/^M([-\d.]+) ([-\d.]+)/)!;
  const markerPoint = point(markerPath, Number(d[1]), Number(d[2])),
    actual = point(text);
  const rawUnits = globalMm / (scale * 10);
  const expectedDx = Number(line['system-left-relative-x-tenths']) * rawUnits,
    actualDx = actual.x - markerPoint.x;

  assert.ok(
    Math.abs(actualDx - expectedDx) < 0.0004,
    `absolute X delta ${actualDx} != source geometry ${expectedDx}; marker=${markerPoint.x}, text=${actual.x}, scale=${scale}, global=${globalMm}, offset=${line['system-left-relative-x-tenths']}`,
  );
  const staffLines = all(svg, 'line')
    .filter(
      (el) =>
        Math.abs(Number(el.getAttribute('y1')) - Number(el.getAttribute('y2'))) < 1e-7 &&
        Math.abs(Number(el.getAttribute('x2')) - Number(el.getAttribute('x1'))) > 5,
    )
    .map((el) => point(el, Number(el.getAttribute('x1')), Number(el.getAttribute('y1'))));

  assert.ok(
    Math.abs(
      actual.y -
        Math.min(...staffLines.map((p) => p.y)) +
        Number(line['staff-top-y-tenths']) * rawUnits,
    ) < 0.0004,
  );
});

test('custom TextScript printer and callback remain passive and do not receive guessed positions', async () => {
  const source =
    sourceHeader +
    String.raw`\score { \new Staff { \override TextScript.stencil=#custom-print
 \override TextScript.after-line-breaking=#after-callback \override TextScript.output-attributes=#tag
 c'4-\markup \center-column { "unresolved-a" "unresolved-b" } d'4 }
 ${layout} \midi { \tempo 4=120 } }`;
  const plain = await compiler.compile(source, { format: ['svg', 'midi'] });
  const captured = await compiler.compile(source, {
    format: ['svg', 'midi'],
    files: { 'text-columns.ily': listener },
    includeSettings: 'text-columns.ily',
  });

  assert.deepEqual(output(captured.files, '.svg'), output(plain.files, '.svg'));
  assert.ok(
    Object.keys(captured.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  assert.deepEqual(
    captured.logs.filter((x) => x.startsWith('G03-COUNTS ')),
    plain.logs.filter((x) => x.startsWith('G03-COUNTS ')),
  );
  const raw = events(captured.files);

  assert.equal(raw.events.filter((e) => e.c === 'text-script-event').length, 1);
  assert.equal(
    raw.events.filter(
      (e): e is Extract<WireEvent, { k: 'textcolumnposition' }> => e.k === 'textcolumnposition',
    ).length,
    0,
    'custom callbacks are not projected without proven line ownership',
  );
  assert.equal(raw.events.find((e) => e.k === 'finallayout')?.status, 'complete');
});

test('normal-book score-local text IDs join only their own source attachments', async () => {
  const source =
    sourceHeader +
    String.raw`\book {
  \score { \new Staff { \override TextScript.output-attributes=#tag c'4-\markup \column { "score-one" "line-two" } d'4 } ${layout} \midi { \tempo 4=120 } }
  \score { \new Staff { \override TextScript.output-attributes=#tag e'4-\markup \column { "score-two" "line-two" } f'4 } ${layout} \midi { \tempo 4=120 } }
}`;
  const plain = await compiler.compile(source, { format: ['svg', 'midi'] });
  const captured = await compiler.compile(source, {
    format: ['svg', 'midi'],
    files: { 'text-columns.ily': listener },
    includeSettings: 'text-columns.ily',
  });

  assert.deepEqual(
    output(captured.files, '.svg'),
    output(plain.files, '.svg'),
    'per-score observer preserves the book SVG',
  );
  assert.ok(
    Object.keys(captured.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  assert.deepEqual(
    captured.logs.filter((x) => x.startsWith('G03-COUNTS ')),
    plain.logs.filter((x) => x.startsWith('G03-COUNTS ')),
    'source callback counts remain unchanged',
  );
  const converted = await converter.convert(source);

  assert.equal(converted.scores.length, 2);

  for (const [index, score] of converted.scores.entries()) {
    const text = index === 0 ? 'score-one' : 'score-two';
    const xml = parse(score.musicxml),
      words = all(xml, 'words');

    assert.ok(
      words.some((word) => word.textContent?.includes(text)),
      `score ${index + 1} keeps its own words`,
    );
    assert.ok(
      words.some(
        (word) =>
          word.getAttribute('default-x') !== null && word.getAttribute('default-y') !== null,
      ),
      `score ${index + 1} gets native coordinates from its own ID scope`,
    );
    const source = JSON.parse(
      new TextDecoder().decode(output(captured.files, `.${index + 1}.events.json`)),
    ) as { events: Record<string, unknown>[] };
    const attachment = source.events.filter(
      (event) => event.c === 'text-script-event' && String(event.text).includes(text),
    );
    const positions = source.events.filter(
      (event): event is Extract<WireEvent, { k: 'textcolumnposition' }> =>
        event.k === 'textcolumnposition',
    );
    const measures = source.events.filter(
      (event): event is Extract<WireEvent, { k: 'measure-layout' }> => event.k === 'measure-layout',
    );

    assert.equal(attachment.length, 1, `score ${index + 1} has one source attachment`);
    assert.equal(positions.length, 1, `score ${index + 1} has one resolved position row`);
    const position = positions[0]!;

    assert.equal(
      position.id,
      attachment[0]!['xml-text-column-id'],
      `score ${index + 1} sidecar joins by its exact source ID`,
    );
    assert.deepEqual(
      position.lines.map((line) => line.text),
      [text, 'line-two'],
    );
    const matching = measures.filter(
      (measure) =>
        measure.s === position['staff-context'] &&
        measure.system === position.system &&
        measure.m === position['column-moment'].main &&
        measure.g === position['column-moment'].grace,
    );

    assert.equal(
      matching.length,
      1,
      `score ${index + 1} has one exact staff/system/moment layout owner`,
    );
    assert.ok(
      Math.abs(
        Number(position['system-left-origin-x-tenths']) -
          Number(matching[0]!['system-left-x-tenths']),
      ) < 1e-8,
      `score ${index + 1} uses its own System origin`,
    );
    assert.equal(source.events.find((event) => event.k === 'finallayout')?.status, 'complete');
  }
});
