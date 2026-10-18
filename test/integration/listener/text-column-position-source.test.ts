import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import listener from '../../../src/lilypond/generated/listener.js';
import { elements as all, parse } from '../../support/xml-support.js';

const compiler = createReusableCompiler();

after(() => compiler.dispose());
const source = String.raw`\version "2.26.0"
#(define g03-tags 0)
#(define (g03-tag grob) (set! g03-tags (+ g03-tags 1)) '((data-g03-column . "target")))
#(define (g03-left-tag grob)
 (let* ((system (ly:grob-system grob)) (left (and (ly:grob? system) (ly:spanner-bound system LEFT))))
  (if (and (ly:grob? left) (eq? left grob)) '((data-g03-system-left . "yes")) '())))
#(define (g03-left-stencil grob)
 (ly:stencil-add (ly:paper-column::print grob)
  (ly:make-stencil '(path 0.05 (moveto 0 0 lineto 0 0.1) round round #t)
   '(0 . 0.05) '(0 . 0.1))))
#(define (g03-report paper pages) (format #t "G03-TAG-COUNT ~a\n" g03-tags))
\paper { tagline=##f page-post-process=#g03-report }
\score { \new Staff { \override TextScript.output-attributes=#g03-tag
 c'4-\markup \center-column { "line-one" "line-two" } c'4 d'4 e'4-\markup \left-column { "north" "south" } }
 \layout { \context { \Score
   \override PaperColumn.stencil=#g03-left-stencil
   \override NonMusicalPaperColumn.stencil=#g03-left-stencil
   \override PaperColumn.output-attributes=#g03-left-tag
   \override NonMusicalPaperColumn.output-attributes=#g03-left-tag } }
 \midi { \tempo 4=120 } }
`;
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([name]) => name.endsWith(suffix))![1];

type Matrix = [number, number, number, number, number, number];
const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const transform = (value: string | null): Matrix => {
  let out: Matrix = [1, 0, 0, 1, 0, 0];

  for (const entry of (value ?? '').matchAll(
    /(matrix|translate|scale|rotate|skewX|skewY)\(([^)]*)\)/g,
  )) {
    const n = (entry[2] ?? '').trim().split(/[ ,]+/).map(Number),
      name = entry[1];
    let next: Matrix;

    if (name === 'matrix' && n.length === 6) {
      next = n as Matrix;
    } else if (name === 'translate') {
      next = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    } else if (name === 'scale') {
      next = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    } else if (name === 'rotate') {
      const a = ((n[0] ?? 0) * Math.PI) / 180,
        c = Math.cos(a),
        s = Math.sin(a);

      next = [c, s, -s, c, 0, 0];
    } else if (name === 'skewX') {
      next = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    } else if (name === 'skewY') {
      next = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    } else {
      continue;
    }

    out = mul(out, next);
  }

  return out;
};
const svgPoint = (
  node: Element,
  x = Number(node.getAttribute('x') ?? 0),
  y = Number(node.getAttribute('y') ?? 0),
) => {
  const chain: Element[] = [];

  for (
    let el: Element | null = node;
    el;
    el = el.parentNode?.nodeType === 1 ? (el.parentNode as Element) : null
  ) {
    chain.push(el);
  }

  let m: Matrix = [1, 0, 0, 1, 0, 0];

  for (const el of chain.reverse()) {
    m = mul(m, transform(el.getAttribute('transform')));
  }

  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
};
const collectIds = (value: unknown, out: unknown[] = []): unknown[] => {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectIds(child, out);
    }

    return out;
  }

  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;

    if (Object.hasOwn(object, 'xml-text-column-id')) {
      out.push(object['xml-text-column-id']);
    }

    for (const child of Object.values(object)) {
      collectIds(child, out);
    }
  }

  return out;
};

test('canonical TextScript source column ID and final per-line positions survive passive capture', async () => {
  const plain = await compiler.compile(source, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(source, {
    format: ['svg', 'midi'],
    files: { 'g03-text-column.ily': listener },
    includeSettings: 'g03-text-column.ily',
  });

  assert.deepEqual(
    file(observed.files, '.svg'),
    file(plain.files, '.svg'),
    'capture preserves SVG bytes',
  );
  assert.ok(
    Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  assert.deepEqual(
    observed.logs.filter((l) => l.startsWith('G03-TAG-COUNT ')),
    plain.logs.filter((l) => l.startsWith('G03-TAG-COUNT ')),
    'capture does not add output-attributes callback invocations',
  );
  const raw = JSON.parse(new TextDecoder().decode(file(observed.files, '.events.json'))) as {
    events: Record<string, unknown>[];
  };
  const ids = collectIds(raw.events);

  assert.equal(ids.length, 2, 'both source attachments carry an ID');
  assert.equal(new Set(ids).size, 2, 'distinct source attachments receive distinct stable IDs');
  const rows = raw.events.filter((e) => e.k === 'textcolumnposition');

  assert.equal(rows.length, 2, 'one final-layout sidecar per canonical source column');
  assert.deepEqual(
    new Set(rows.map((row) => row.id)),
    new Set(ids),
    'sidecars join one-to-one by exact source IDs',
  );

  for (const row of rows) {
    assert.equal(row.units, 'system-left/staff-top-global-tenths');
    const lines = row.lines as {
      index: number;
      text: string;
      'system-left-relative-x-tenths': number;
      'staff-top-y-tenths': number;
    }[];

    assert.equal(lines.length, 2);
    assert.deepEqual(
      lines.map((line) => line.index),
      [0, 1],
    );

    for (const line of lines) {
      assert.ok(
        Number.isFinite(line['system-left-relative-x-tenths']) &&
          Number.isFinite(line['staff-top-y-tenths']),
      );
    }
  }

  const svg = parse(new TextDecoder().decode(file(plain.files, '.svg')));
  const owners = all(svg, '*').filter((el) => el.getAttribute('data-g03-column') === 'target');

  assert.equal(owners.length, 2);
  const markers = all(svg, '*')
    .filter((el) => el.getAttribute('data-g03-system-left') === 'yes')
    .flatMap((marked) =>
      all(marked, 'path').flatMap((path) => {
        const d = path.getAttribute('d') ?? '',
          m = d.match(/^M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)$/);

        return m &&
          Math.abs(Number(m[3]) - Number(m[1])) < 1e-7 &&
          Math.abs(Math.abs(Number(m[4]) - Number(m[2])) - 0.1) < 1e-6
          ? [svgPoint(path, Number(m[1]), Number(m[2]))]
          : [];
      }),
    );

  assert.equal(
    markers.length,
    1,
    'independently tagged actual System LEFT has one known-origin marker',
  );
  const actualGroups = owners.map((owner) => ({
    texts: all(owner, 'text').map((el) => el.textContent?.trim()),
    points: all(owner, 'text').map((el) => svgPoint(el)),
  }));
  const staffLines = all(svg, 'line')
    .filter(
      (el) =>
        Math.abs(Number(el.getAttribute('y1')) - Number(el.getAttribute('y2'))) < 1e-7 &&
        Math.abs(Number(el.getAttribute('x2')) - Number(el.getAttribute('x1'))) > 5,
    )
    .map((el) => svgPoint(el, Number(el.getAttribute('x1')), Number(el.getAttribute('y1'))));
  const staffTopY = Math.min(...staffLines.map((line) => line.y));

  for (const row of rows) {
    const lines = row.lines as {
      index: number;
      text: string;
      'system-left-relative-x-tenths': number;
      'staff-top-y-tenths': number;
    }[];
    const group = actualGroups.find(
      (candidate) =>
        JSON.stringify(candidate.texts) === JSON.stringify(lines.map((line) => line.text)),
    );

    assert.ok(group, 'source line roles map to an exact tagged SVG TextScript');
    const scale = Number(row['output-scale']),
      globalMm = Number(row['global-staff-space-mm']),
      layoutSpace = Number(row['global-layout-staff-space']);

    assert.ok(
      Number.isFinite(scale) &&
        scale > 0 &&
        Number.isFinite(globalMm) &&
        globalMm > 0 &&
        Number.isFinite(layoutSpace) &&
        layoutSpace > 0,
    );
    assert.ok(
      Math.abs(scale * layoutSpace - globalMm) < 1e-8,
      'layout and output scales agree with captured physical global staff-space',
    );
    const sourceUnits = globalMm / (scale * 10);

    lines.forEach((line, i) => {
      const actual = group.points[i]!;
      const expectedX = markers[0]!.x + line['system-left-relative-x-tenths'] * sourceUnits;
      const expectedY = -line['staff-top-y-tenths'] * sourceUnits;

      assert.ok(
        Math.abs(actual.x - expectedX) < 0.0004,
        `${line.text} absolute SVG X agrees with captured System origin plus line offset`,
      );
      assert.ok(
        Math.abs(actual.y - staffTopY - expectedY) < 0.0004,
        `${line.text} SVG baseline delta from actual top staff-line agrees with captured Y`,
      );
    });
  }
});
