import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
/** Source regression for final cached standard Tie-stencil centerline capture. */
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import listener from '../../../dist/lilypond/generated/listener.js';
import type { WireEvent } from '../../../src/lilypond/wire.js';
import { elements, parse } from '../../support/xml-support.js';

const compiler = createReusableCompiler();

after(() => compiler.dispose());

const file = (files: Record<string, Uint8Array>, suffix: string) => {
  const found = Object.entries(files).find(([name]) => name.endsWith(suffix));

  assert.ok(found, `compiler output ${suffix}`);

  return found[1];
};
const source = (prefix: string, tagHeads: boolean, staff = '') => {
  const tags = tagHeads
    ? String.raw`#(define (tie-probe-head-attributes grob)
 (let* ((cause (ly:grob-property grob 'cause #f)) (id (and (ly:stream-event? cause) (ly:event-property cause 'ed-note-id #f))))
  (if id (list (cons 'data-probe-note-id (format #f "~a" id))) '())))
`
    : '';
  const tagOverride = tagHeads
    ? String.raw`\override NoteHead.output-attributes = #tie-probe-head-attributes`
    : '';

  return String.raw`${tags}#(define (tie-probe-post paper pages) (format #t "TIE-PROBE-POST ~a\n" (length pages)))
\paper { page-post-process = #tie-probe-post }
\score { \new Staff = "solo" \with { ${tagOverride} ${staff} } { ${prefix} c'1~ c'1 } \layout {} \midi { \tempo 4=120 } }`;
};
const svgTieCenterline = (d: string) => {
  const match = d.match(
    /^M([-\d.]+) ([-\d.]+)C([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)C([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)z$/,
  );

  if (!match) {
    return undefined;
  }

  const n = match.slice(1).map(Number);

  return [
    [(n[0]! + n[14]!) / 2, (n[1]! + n[15]!) / 2],
    [(n[2]! + n[12]!) / 2, (n[3]! + n[13]!) / 2],
    [(n[4]! + n[10]!) / 2, (n[5]! + n[11]!) / 2],
    [(n[6]! + n[8]!) / 2, (n[7]! + n[9]!) / 2],
  ];
};
const svgPoint = (node: Element, x: number, y: number): [number, number] | undefined => {
  type Matrix = [number, number, number, number, number, number];
  const multiply = (left: Matrix, right: Matrix): Matrix => [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
  const transform = (value: string): Matrix | undefined => {
    let result: Matrix = [1, 0, 0, 1, 0, 0];
    const tokens = [...value.matchAll(/(matrix|translate|scale)\(([^)]*)\)/g)];

    if (value.replace(/(matrix|translate|scale)\(([^)]*)\)/g, '').trim()) {
      return undefined;
    }

    for (const token of tokens) {
      const numbers = token[2]!.trim().split(/[ ,]+/).map(Number);

      if (numbers.some((number) => !Number.isFinite(number))) {
        return undefined;
      }

      let next: Matrix;

      if (token[1] === 'matrix' && numbers.length === 6) {
        next = numbers as Matrix;
      } else if (token[1] === 'translate' && (numbers.length === 1 || numbers.length === 2)) {
        next = [1, 0, 0, 1, numbers[0]!, numbers[1] ?? 0];
      } else if (token[1] === 'scale' && (numbers.length === 1 || numbers.length === 2)) {
        next = [numbers[0]!, 0, 0, numbers[1] ?? numbers[0]!, 0, 0];
      } else {
        return undefined;
      }

      result = multiply(result, next);
    }

    return result;
  };
  let point: [number, number] = [x, y];

  for (
    let current: Element | null = node;
    current;
    current = current.parentNode?.nodeType === 1 ? (current.parentNode as Element) : null
  ) {
    const matrix = transform(current.getAttribute('transform') ?? '');

    if (!matrix) {
      return undefined;
    }

    point = [
      matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
      matrix[1] * point[0] + matrix[3] * point[1] + matrix[5],
    ];
  }

  return point;
};
const renderPair = async (prefix: string, staff = '', expectCanonical = true) => {
  const text = String.raw`\version "2.26.0"` + '\n' + source(prefix, false, staff);
  const plain = await compiler.compile(text, { format: ['svg', 'midi'] });
  const observer = await compiler.compile(text, {
    format: ['svg', 'midi'],
    files: { 'tie-bezier-observer.ily': listener },
    includeSettings: 'tie-bezier-observer.ily',
  });
  const svgNames = Object.keys(plain.files)
    .filter((name) => name.endsWith('.svg'))
    .sort();

  assert.ok(svgNames.length > 0);

  for (const name of svgNames) {
    assert.deepEqual(
      observer.files[name],
      plain.files[name],
      'untagged observer keeps source SVG bytes passive',
    );
  }

  assert.ok(Object.keys(observer.files).every((name) => !name.endsWith('.midi')));
  const callbacks = (logs: readonly string[]) =>
    logs.filter((line) => line.startsWith('TIE-PROBE-POST '));

  assert.ok(callbacks(plain.logs).length > 0, 'source page callback ran');
  assert.deepEqual(
    callbacks(observer.logs),
    callbacks(plain.logs),
    'observer keeps page callback sequence passive',
  );
  const taggedText = String.raw`\version "2.26.0"` + '\n' + source(prefix, true, staff);
  const tagged = await compiler.compile(taggedText, {
    format: ['svg', 'midi'],
    files: { 'tie-bezier-observer.ily': listener },
    includeSettings: 'tie-bezier-observer.ily',
  });

  assert.ok(Object.keys(tagged.files).every((name) => !name.endsWith('.midi')));
  assert.deepEqual(
    callbacks(tagged.logs),
    callbacks(plain.logs),
    'diagnostic SVG tagging does not change callback sequence',
  );
  const events = JSON.parse(new TextDecoder().decode(file(tagged.files, '.events.json'))) as {
    events: WireEvent[];
  };
  const svg = parse(new TextDecoder().decode(file(tagged.files, '.svg')));
  const paths = elements(svg, 'path')
    .map((path) => ({ node: path, d: path.getAttribute('d') }))
    .filter((path) =>
      /^M[-\d.]+ [-\d.]+C[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+C[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+z$/.test(
        path.d ?? '',
      ),
    );
  const ties = events.events.filter((event) => event.k === 'tiegraphic');

  assert.equal(ties.length, 1);
  const tie = ties[0]!;

  if (expectCanonical) {
    assert.equal(
      paths.length,
      1,
      'single-tie fixture has one canonical cubic ribbon path, so SVG correlation is unambiguous',
    );
  }

  const tieGeometry = tie.geometry as
    | {
        points: readonly (readonly [number, number])[];
        'curve-origin': readonly [number, number];
        'from-head-id': number;
        'to-head-id': number;
        'from-note-origin': [number, number];
        'to-note-origin': [number, number];
        'from-staff-top-y': number;
      }
    | undefined;

  assert.ok(
    tieGeometry && Array.isArray(tieGeometry.points) && tieGeometry.points.length === 4,
    'eligible final tie stencil yields four native centerline points',
  );
  const taggedHeads = elements(svg, '*')
    .filter((head) => head.hasAttribute('data-probe-note-id'))
    .map((head) => ({
      id: head.getAttribute('data-probe-note-id'),
      element: head,
    }));

  if (!expectCanonical) {
    return {
      event: tie,
      svgPaths: paths,
      taggedHeads,
      svgCount: svg.getElementsByTagName('path').length,
    };
  }

  const svgCenterline = svgTieCenterline(paths[0]!.d!);

  assert.ok(svgCenterline, 'actual cached ribbon has two cubic boundaries');

  const headPath = (headId: number) => {
    const owner = taggedHeads.find((head) => Number(head.id) === headId);

    assert.ok(owner, `source SVG contains exact tagged NoteHead ${headId}`);
    const glyphs = elements(owner.element, 'path');

    assert.equal(
      glyphs.length,
      1,
      `NoteHead ${headId} has one independently measured SVG glyph path`,
    );

    return glyphs[0]!;
  };
  const fromHeadPath = headPath(tieGeometry['from-head-id']);
  const toHeadPath = headPath(tieGeometry['to-head-id']);
  const svgFromHead = svgPoint(fromHeadPath, 0, 0);
  const svgToHead = svgPoint(toHeadPath, 0, 0);

  assert.ok(
    svgFromHead && svgToHead,
    'SVG transforms for endpoint glyphs are independently resolved',
  );
  const staffLines = elements(svg, 'line').filter(
    (line) => Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')) > 8,
  );

  assert.equal(
    staffLines.length,
    5,
    'fixture has one independently measurable five-line source staff',
  );
  const staffTopY = Math.min(
    ...staffLines.map((line) => {
      const point = svgPoint(
        line,
        Number(line.getAttribute('x1')),
        Number(line.getAttribute('y1')),
      );

      assert.ok(point);

      return point[1];
    }),
  );
  const sourceFramePath = paths[0]!.node;

  for (let i = 0; i < 4; i++) {
    const sourcePoint = tieGeometry.points[i] as [number, number];
    const origin = tieGeometry['curve-origin'] as [number, number];

    assert.ok(
      Math.abs(sourcePoint[0] - origin[0] - svgCenterline[i]![0]!) < 0.0002,
      `P${i} SVG X centerline`,
    );
    assert.ok(
      Math.abs(-(sourcePoint[1] - origin[1]) - svgCenterline[i]![1]!) < 0.0002,
      `P${i} SVG Y centerline`,
    );
    const absoluteSvgPoint = svgPoint(
      sourceFramePath,
      svgCenterline[i]![0]!,
      svgCenterline[i]![1]!,
    );

    assert.ok(absoluteSvgPoint, `P${i} SVG affine transform resolves`);
    const absoluteSvgX = absoluteSvgPoint[0];
    const absoluteSvgY = absoluteSvgPoint[1];

    assert.ok(
      Math.abs(staffTopY - absoluteSvgY - (sourcePoint[1] - tieGeometry['from-staff-top-y'])) <
        0.0002,
      `P${i} absolute source staff-top Y`,
    );

    if (i === 0) {
      assert.ok(
        Math.abs(
          absoluteSvgX - svgFromHead[0]! - (sourcePoint[0] - tieGeometry['from-note-origin'][0]),
        ) < 0.0002,
        'P0 absolute X relative to exact start NoteHead ink-left',
      );
    }

    if (i === 3) {
      assert.ok(
        Math.abs(
          absoluteSvgX - svgToHead[0]! - (sourcePoint[0] - tieGeometry['to-note-origin'][0]),
        ) < 0.0002,
        'P3 absolute X relative to exact end NoteHead ink-left',
      );
    }
  }

  const result = {
    event: tie,
    svgPaths: paths,
    taggedHeads,
    svgCount: svg.getElementsByTagName('path').length,
  };

  return result;
};

test('canonical cached Tie stencil captures passive source centerlines', async () => {
  const variants = [
    { name: 'builtin', prefix: '', staff: '', expectedP0: [1.181, -3.75] },
    {
      name: 'literal-controls',
      prefix: String.raw`\once \override Tie.control-points = #'((0 . 0) (0 . 2) (0 . 2) (0 . 0))`,
      staff: '',
      expectedP0: [0, 0],
    },
    {
      name: 'shape-displacement',
      prefix: String.raw`\shape #'((0 . 0) (0 . 2) (0 . 2) (0 . 0)) Tie`,
      staff: '',
      expectedP0: [1.181, -3.75],
    },
    {
      name: 'colored-literal-controls',
      prefix: String.raw`\once \override Tie.color = #red \once \override Tie.control-points = #'((0 . 0) (0 . 2) (0 . 2) (0 . 0))`,
      staff: '',
      expectedP0: [0, 0],
    },
    {
      name: 'local-staff-scale',
      prefix: '',
      staff: String.raw`\override StaffSymbol.staff-space = #0.7`,
      expectedP0: [1.181, -2.7],
    },
    {
      name: 'rational-extra-offset',
      prefix: String.raw`\once \override Tie.extra-offset = #'(1/3 . -2/3)`,
      staff: '',
      expectedP0: [1.181, -3.75],
    },
    {
      name: 'builtin-dashed',
      prefix: String.raw`\once \override Tie.dash-definition = #'((0 1 0.4 0.75))`,
      staff: '',
      expectedP0: [1.181, -3.75],
      canonical: false,
    },
  ];
  let builtinOrigin: readonly [number, number] | undefined;
  let builtinPoints: readonly (readonly [number, number])[] | undefined;

  for (const variant of variants) {
    const result = await renderPair(variant.prefix, variant.staff, variant.canonical !== false);
    const geometry = result.event.geometry as {
      points: readonly (readonly [number, number])[];
      'curve-origin': readonly [number, number];
      'from-head-id': number;
      'to-head-id': number;
    };
    const relativeP0 = [
      geometry.points[0]![0] - geometry['curve-origin'][0],
      geometry.points[0]![1] - geometry['curve-origin'][1],
    ];
    const event = result.event;

    assert.deepEqual(event.from, [geometry['from-head-id']]);
    assert.deepEqual(event.to, [geometry['to-head-id']]);
    const svgHeadIds = new Set(
      result.taggedHeads.map((head: { id: string | null }) => Number(head.id)),
    );

    assert.ok(
      svgHeadIds.has(event.from[0]!) && svgHeadIds.has(event.to[0]!),
      `${variant.name} endpoint IDs are present in tagged source SVG`,
    );

    if (variant.name === 'builtin') {
      builtinOrigin = geometry['curve-origin'];
      builtinPoints = geometry.points;
    }

    if (variant.name === 'builtin-dashed') {
      assert.equal(
        result.event['custom-controls'],
        false,
        "dashed tie uses LilyPond's standard control-point calculation",
      );
      assert.ok(
        Array.isArray(result.event.dash) && result.event.dash.length > 0,
        'source event retains its dash definition',
      );
      assert.ok(
        result.svgPaths.length > 1,
        'dashed source rendering is split into multiple ribbon segments',
      );
      assert.ok(builtinPoints, 'undashed standard tie controls were captured first');

      for (let i = 0; i < 4; i++) {
        for (let axis = 0; axis < 2; axis++) {
          assert.ok(
            Math.abs(geometry.points[i]![axis]! - builtinPoints[i]![axis]!) < 0.0002,
            `dashed standard tie preserves undashed master centerline P${i} axis ${axis}`,
          );
        }
      }
    }

    if (variant.name === 'rational-extra-offset') {
      assert.ok(builtinOrigin);
      assert.ok(
        Math.abs(geometry['curve-origin'][0] - builtinOrigin[0] - 1 / 3) < 0.0002,
        'rational X extra-offset is included once in system origin',
      );
      assert.ok(
        Math.abs(geometry['curve-origin'][1] - builtinOrigin[1] + 2 / 3) < 0.0002,
        'rational Y extra-offset is included once in system origin',
      );
    }

    assert.ok(Math.abs(relativeP0[0]! - variant.expectedP0[0]!) < 0.0002, `${variant.name} P0 X`);
    assert.ok(Math.abs(relativeP0[1]! - variant.expectedP0[1]!) < 0.0002, `${variant.name} P0 Y`);

    if (variant.name === 'literal-controls') {
      assert.equal(result.event['custom-controls'], true);
    }

    if (variant.name === 'colored-literal-controls') {
      assert.equal(result.event['custom-controls'], true);
    }

    if (variant.name === 'shape-displacement') {
      assert.equal(result.event['custom-controls'], true);
    }
  }
});
