import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import listener from '../../../dist/lilypond/generated/listener.js';
import { elements, parse } from '../../support/xml-support.js';

const compiler = createReusableCompiler();

after(() => compiler.dispose());

const file = (files: Record<string, Uint8Array>, suffix: string) => {
  const found = Object.entries(files).find(([name]) => name.endsWith(suffix));

  assert.ok(found, `compiler output ${suffix}`);

  return found[1];
};
const source = (
  staff = '',
  prefix = '',
  notation = "c'2( d'2)",
) => String.raw`#(define (slur-head-tags grob)
 (let* ((cause (ly:grob-property grob 'cause #f)) (pitch (and (ly:stream-event? cause) (ly:event-property cause 'pitch #f))))
  (if (ly:pitch? pitch) (list (cons 'data-head (format #f "~a" (ly:pitch-notename pitch)))) '())))
\score { \new Staff = "solo" \with { \override NoteHead.output-attributes = #slur-head-tags ${staff} } { ${prefix} ${notation} } \layout {} \midi { \tempo 4=120 } }`;
const marker = String.raw`#(define (slur-source-post paper pages) (format #t "SLUR-SOURCE-POST ~a\n" (length pages)))
\paper { page-post-process = #slur-source-post }
`;
const observed = async (text: string) =>
  compiler.compile(text, {
    format: ['svg', 'midi'],
    files: { 'slur-observer.ily': listener },
    includeSettings: 'slur-observer.ily',
  });
const baseline = async (text: string) => compiler.compile(text, { format: ['svg', 'midi'] });
const rows = (files: Record<string, Uint8Array>) => {
  const raw = JSON.parse(new TextDecoder().decode(file(files, '.events.json'))) as {
    events: Record<string, unknown>[];
  };

  return raw.events.filter((event) => event.k === 'slur');
};
const svgTranslate = (node: Element, axis: 0 | 1) => {
  let sum = 0;

  for (
    let current: Element | null = node;
    current;
    current = current.parentNode?.nodeType === 1 ? (current.parentNode as Element) : null
  ) {
    const value = (current.getAttribute('transform') ?? '').match(
      /translate\(([-\d.]+)[, ]+([-\d.]+)\)/,
    );

    if (value) {
      sum += Number(value[axis + 1]);
    }
  }

  return sum;
};

type RawGeometry = {
  units: string;
  system: number;
  'from-note-id': number;
  'to-note-id': number;
  'from-head-id': number;
  'to-head-id': number;
  points: [number, number][];
  'curve-origin': [number, number];
  'from-note-origin': [number, number];
  'to-note-origin': [number, number];
  'staff-top-y': number;
  'output-scale': number;
  'layout-staff-space-mm': number;
  'local-staff-space-mm': number;
  'global-staff-space-mm': number | null;
};

const svgSlurCenterline = (svg: string) => {
  const doc = parse(svg);
  const candidates = elements(doc, 'path');

  for (const path of candidates) {
    const d = path.getAttribute('d') ?? '';
    const m = d.match(
      /^M([-\d.]+) ([-\d.]+)C([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)C([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)z$/,
    );

    if (!m) {
      continue;
    }

    const n = m.slice(1).map(Number);

    return {
      points: [
        [(n[0]! + n[14]!) / 2, (n[1]! + n[15]!) / 2],
        [(n[2]! + n[12]!) / 2, (n[3]! + n[13]!) / 2],
        [(n[4]! + n[10]!) / 2, (n[5]! + n[11]!) / 2],
        [(n[6]! + n[8]!) / 2, (n[7]! + n[9]!) / 2],
      ],
      origin: [svgTranslate(path, 0), svgTranslate(path, 1)] as const,
      doc,
    };
  }

  return undefined;
};
const svgStaffGap = (svg: string) => {
  const doc = parse(svg);
  const ys = elements(doc, 'line')
    .filter(
      (line) => Math.abs(Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'))) > 5,
    )
    .map((line) => {
      let y = Number(line.getAttribute('y1'));

      for (let parent = line.parentNode; parent?.nodeType === 1; parent = parent.parentNode) {
        const transform = (parent as Element).getAttribute('transform') ?? '';
        const translate = transform.match(/translate\(([-\d.]+)[, ]+([-\d.]+)\)/);

        if (translate) {
          y += Number(translate[2]);
        }
      }

      return Number(y.toFixed(4));
    })
    .filter((y, i, all) => all.indexOf(y) === i)
    .sort((a, b) => a - b);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]!);

  assert.ok(gaps.length >= 4, `found independent source staff line gaps ${gaps}`);

  return gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
};

test('single-system slur geometry is final, source-passive, and scaled in physical layout units', async () => {
  for (const [staff, prefix, scale] of [
    ['', '', 1],
    [String.raw`\override StaffSymbol.staff-space = #0.7`, '', 0.7],
    ['', String.raw`\once \override Slur.extra-offset = #'(1/3 . -2/3)`, 1],
  ] as const) {
    const text = marker + source(staff, prefix);
    const [plain, captured] = await Promise.all([baseline(text), observed(text)]);
    const svgNames = Object.keys(plain.files)
      .filter((name) => name.endsWith('.svg'))
      .sort();

    assert.ok(svgNames.length > 0);

    for (const name of svgNames) {
      assert.deepEqual(
        captured.files[name],
        plain.files[name],
        'observer leaves actual source SVG bytes unchanged',
      );
    }

    assert.ok(
      Object.keys(captured.files).every((name) => !name.endsWith('.midi')),
      'notation observer emits no MIDI',
    );
    const callbackSequence = (logs: readonly string[]) =>
      logs.filter((line) => line.startsWith('SLUR-SOURCE-POST '));

    assert.ok(callbackSequence(plain.logs).length > 0);
    assert.deepEqual(
      callbackSequence(captured.logs),
      callbackSequence(plain.logs),
      'the source page callback sequence is unchanged',
    );
    const [row] = rows(captured.files) as (Record<string, unknown> & {
      geometry?: RawGeometry;
    })[];

    assert.ok(row);
    const geometry = row.geometry;

    assert.ok(geometry, 'default one-system slur has proven final geometry');
    assert.equal(geometry.units, 'lilypond-final-layout-coordinates');
    assert.equal(geometry.system, 1);
    assert.equal(geometry['from-note-id'], geometry['from-head-id']);
    assert.equal(geometry['to-note-id'], geometry['to-head-id']);
    assert.ok(
      Math.abs(geometry['local-staff-space-mm'] / geometry['layout-staff-space-mm'] - scale) < 1e-9,
      `local staff-space ratio ${geometry['local-staff-space-mm'] / geometry['layout-staff-space-mm']}, expected ${scale}`,
    );
    const sourceStaffGap = svgStaffGap(new TextDecoder().decode(file(plain.files, '.svg')));

    assert.ok(
      Math.abs(sourceStaffGap / 1 - scale) < 0.0001,
      `actual SVG staff-line gap ${sourceStaffGap}, expected local ratio ${scale}`,
    );
    assert.ok(geometry['global-staff-space-mm'] !== null);
    assert.ok(
      Math.abs(
        sourceStaffGap * geometry['output-scale'] - geometry['global-staff-space-mm'] * scale,
      ) < 1e-4,
      `SVG local staff gap ${sourceStaffGap} * output scale ${geometry['output-scale']} matches physical local spacing ${geometry['global-staff-space-mm'] * scale}`,
    );
    assert.ok(
      Math.abs(geometry['layout-staff-space-mm'] - geometry['global-staff-space-mm']) < 1e-7,
    );
    assert.ok(
      Math.abs(geometry['local-staff-space-mm'] - geometry['global-staff-space-mm'] * scale) < 1e-7,
    );
    assert.ok(
      geometry.points[0]![0] > geometry['from-note-origin'][0],
      'slur start is measured from the actual left edge of its attached notehead',
    );
    assert.ok(
      geometry.points[3]![0] > geometry['to-note-origin'][0],
      'slur end references the actual left edge of its attached notehead',
    );
    assert.equal(geometry.points.length, 4);
    const svg = new TextDecoder().decode(file(plain.files, '.svg'));
    const sourceSlur = svgSlurCenterline(svg);

    assert.ok(sourceSlur, 'independent actual SVG contains the filled two-cubic source slur');
    const expected = geometry.points.map(([x, y]) => [
      x - geometry['curve-origin'][0],
      -(y - geometry['curve-origin'][1]),
    ]);

    for (let i = 0; i < 4; i++) {
      for (let axis = 0; axis < 2; axis++) {
        assert.ok(
          Math.abs(sourceSlur.points[i]![axis]! - expected[i]![axis]!) < 0.0001,
          `SVG centerline P${i} axis ${axis}: ${sourceSlur.points[i]![axis]} vs ${expected[i]![axis]}`,
        );
      }
    }

    const svgNoteLeft = (pitch: string) => {
      const group = elements(sourceSlur.doc, 'g').find(
        (g) => g.getAttribute('data-head') === pitch,
      );

      assert.ok(group, `independent SVG identifies source notehead ${pitch}`);
      const path = group.getElementsByTagName('path')[0];

      assert.ok(path);

      return svgTranslate(path, 0);
    };

    assert.ok(
      Math.abs(
        svgNoteLeft('0') -
          sourceSlur.origin[0] -
          (geometry['from-note-origin'][0] - geometry['curve-origin'][0]),
      ) < 0.0001,
      "source NoteHead's measured left origin agrees with the slur endpoint reference",
    );
  }
});

test('cached standard slur ribbons resolve shaped and dimensioned controls while broken spans remain unpositioned', async () => {
  const callbackSequence = (logs: readonly string[]) =>
    logs.filter((line) => line.startsWith('SLUR-SOURCE-POST '));
  const controlCases = [
    ['shape', String.raw`\shape #'((0 . 0) (0 . 2) (0 . 2) (0 . 0)) Slur`],
    [
      'literal',
      String.raw`\once \override Slur.control-points = #'((0 . 0) (0 . 2) (0 . 2) (0 . 0))`,
    ],
  ] as const;

  for (const [name, controls] of controlCases) {
    const custom = marker + source('', controls);
    const [plain, captured] = await Promise.all([baseline(custom), observed(custom)]);
    const svgNames = Object.keys(plain.files)
      .filter((name) => name.endsWith('.svg'))
      .sort();

    assert.ok(svgNames.length > 0);

    for (const svgName of svgNames) {
      assert.deepEqual(
        captured.files[svgName],
        plain.files[svgName],
        `${name} cached-stencil observation leaves source SVG bytes unchanged`,
      );
    }

    assert.ok(
      Object.keys(captured.files).every((name) => !name.endsWith('.midi')),
      'notation observer emits no MIDI',
    );
    assert.deepEqual(callbackSequence(captured.logs), callbackSequence(plain.logs));
    const [customRow] = rows(captured.files) as (Record<string, unknown> & {
      geometry?: RawGeometry;
    })[];

    assert.ok(customRow);
    assert.equal(customRow['custom-controls'], true);
    assert.ok(
      customRow.geometry,
      `the final standard stencil supplies ${name} controls rather than a recomputed callback`,
    );
    const curveSvg = svgSlurCenterline(new TextDecoder().decode(file(plain.files, '.svg')));

    assert.ok(curveSvg);

    for (let i = 0; i < 4; i++) {
      for (let axis = 0; axis < 2; axis++) {
        const capturedPoint = customRow.geometry.points[i]!;
        const expected =
          axis === 0
            ? capturedPoint[axis]! - customRow.geometry['curve-origin'][axis]!
            : -(capturedPoint[axis]! - customRow.geometry['curve-origin'][axis]!);

        assert.ok(
          Math.abs(curveSvg.points[i]![axis]! - expected) < 0.0001,
          `${name} SVG centerline P${i} axis ${axis}`,
        );
      }
    }

    const fromHead = elements(curveSvg.doc, 'g').find((g) => g.getAttribute('data-head') === '0');

    assert.ok(fromHead, `${name} SVG identifies the attached start NoteHead`);
    const headPath = fromHead.getElementsByTagName('path')[0];

    assert.ok(headPath);
    assert.ok(
      Math.abs(
        svgTranslate(headPath, 0) -
          curveSvg.origin[0] -
          (customRow.geometry['from-note-origin'][0] - customRow.geometry['curve-origin'][0]),
      ) < 0.0001,
      `${name} centerline and endpoint use the same actual NoteHead-relative SVG frame`,
    );
  }

  const phrasingText = marker + source('', '', String.raw`c'2\( d'2\)`);
  const [phrasingPlain, phrasingCaptured] = await Promise.all([
    baseline(phrasingText),
    observed(phrasingText),
  ]);

  for (const name of Object.keys(phrasingPlain.files).filter((name) => name.endsWith('.svg'))) {
    assert.deepEqual(
      phrasingCaptured.files[name],
      phrasingPlain.files[name],
      'PhrasingSlur capture leaves source SVG unchanged',
    );
  }

  assert.ok(Object.keys(phrasingCaptured.files).every((name) => !name.endsWith('.midi')));
  assert.deepEqual(callbackSequence(phrasingCaptured.logs), callbackSequence(phrasingPlain.logs));
  const [phrasingRow] = rows(phrasingCaptured.files) as (Record<string, unknown> & {
    phrasing?: boolean;
    geometry?: RawGeometry;
  })[];

  assert.equal(phrasingRow?.phrasing, true);
  assert.ok(
    phrasingRow?.geometry,
    'the same cached-stencil contract proves the native PhrasingSlur curve',
  );
  const defaultCaptured = await observed(marker + source());
  const [defaultRow] = rows(defaultCaptured.files) as (Record<string, unknown> & {
    geometry?: RawGeometry;
  })[];

  assert.ok(defaultRow?.geometry);
  assert.ok(
    phrasingRow.geometry.points.some((point, index) =>
      point.some(
        (value, axis) => Math.abs(value - defaultRow.geometry!.points[index]![axis]!) > 1e-4,
      ),
    ),
    "the PhrasingSlur's default geometry differs from the normal Slur baseline",
  );
  const phrasingSvg = svgSlurCenterline(
    new TextDecoder().decode(file(phrasingPlain.files, '.svg')),
  );

  assert.ok(phrasingSvg);

  for (let i = 0; i < 4; i++) {
    for (let axis = 0; axis < 2; axis++) {
      const capturedPoint = phrasingRow.geometry.points[i]!;
      const expected =
        axis === 0
          ? capturedPoint[axis]! - phrasingRow.geometry['curve-origin'][axis]!
          : -(capturedPoint[axis]! - phrasingRow.geometry['curve-origin'][axis]!);

      assert.ok(
        Math.abs(phrasingSvg.points[i]![axis]! - expected) < 0.0001,
        `PhrasingSlur SVG centerline P${i} axis ${axis}`,
      );
    }
  }

  for (const dimensions of [
    String.raw`\once \override Slur.height-limit = #0.5`,
    String.raw`\once \override Slur.ratio = #0.4`,
  ]) {
    const text = marker + source('', dimensions);
    const [baselineResult, observedResult] = await Promise.all([baseline(text), observed(text)]);

    for (const name of Object.keys(baselineResult.files).filter((name) => name.endsWith('.svg'))) {
      assert.deepEqual(
        observedResult.files[name],
        baselineResult.files[name],
        'dimension capture preserves source SVG',
      );
    }

    assert.ok(Object.keys(observedResult.files).every((name) => !name.endsWith('.midi')));
    assert.deepEqual(callbackSequence(observedResult.logs), callbackSequence(baselineResult.logs));
    const [row] = rows(observedResult.files) as (Record<string, unknown> & {
      geometry?: RawGeometry;
    })[];

    assert.ok(row?.geometry, 'final cached curve captures the selected layout dimensions');
    assert.ok(
      row.geometry.points.some((point, index) =>
        point.some(
          (value, axis) => Math.abs(value - defaultRow.geometry!.points[index]![axis]!) > 1e-4,
        ),
      ),
      'the nondefault curve dimension changes the measured source centerline from the default',
    );
    const svgCurve = svgSlurCenterline(
      new TextDecoder().decode(file(baselineResult.files, '.svg')),
    );

    assert.ok(svgCurve);

    for (let i = 0; i < 4; i++) {
      for (let axis = 0; axis < 2; axis++) {
        const capturedPoint = row.geometry.points[i]!;
        const expected =
          axis === 0
            ? capturedPoint[axis]! - row.geometry['curve-origin'][axis]!
            : -(capturedPoint[axis]! - row.geometry['curve-origin'][axis]!);

        assert.ok(
          Math.abs(svgCurve.points[i]![axis]! - expected) < 0.0001,
          `dimensioned SVG centerline P${i} axis ${axis}`,
        );
      }
    }
  }

  const broken = String.raw`\score { \new Staff = "solo" { c'1( \break d'1) } \layout {} \midi { \tempo 4=120 } }`;
  const [brokenRow] = rows((await observed(broken)).files) as (Record<string, unknown> & {
    geometry?: unknown;
  })[];

  assert.ok(brokenRow);
  assert.equal(
    brokenRow.geometry,
    undefined,
    'a split span remains fail-closed until piece ownership is proven',
  );
  const customStencil =
    marker +
    source(
      '',
      String.raw`\once \override Slur.stencil = #(lambda (g) (grob-interpret-markup g "custom"))`,
    );
  const customStencilCapture = await observed(customStencil);
  const [customStencilRow] = rows(customStencilCapture.files) as (Record<string, unknown> & {
    geometry?: unknown;
  })[];

  assert.ok(customStencilRow);
  assert.equal(
    customStencilRow.geometry,
    undefined,
    'an arbitrary custom stencil is outside the bounded ribbon grammar',
  );
});
