import type { Document, Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createConverter } from '../../../dist/index.js';
import listener from '../../../dist/lilypond/generated/listener.js';
import type { WireEvent } from '../../../src/lilypond/wire.js';
import { elements, parse } from '../../support/xml-support.js';

const compiler = createReusableCompiler();
const converter = createConverter();

after(() => {
  compiler.dispose();
  converter.dispose();
});

const file = (files: Record<string, Uint8Array>, suffix: string) => {
  const found = Object.entries(files).find(([name]) => name.endsWith(suffix));

  assert.ok(found, `compiler output ${suffix}`);

  return found[1];
};
const score = (music: string, staff = '', prefix = '') => String.raw`#(define (tie-head-tags grob)
 (let* ((cause (ly:grob-property grob 'cause #f)) (pitch (and (ly:stream-event? cause) (ly:event-property cause 'pitch #f))))
  (if (ly:pitch? pitch) (list (cons 'data-tie-head (format #f "~a" (ly:pitch-notename pitch)))) '())))
\score { \new Staff = "solo" \with { \override NoteHead.output-attributes = #tie-head-tags ${staff} } { ${prefix} ${music} } \layout {} \midi { \tempo 4=120 } }`;
const marker = String.raw`#(define (tie-source-post paper pages) (format #t "TIE-SOURCE-POST ~a\n" (length pages)))
\paper { page-post-process = #tie-source-post }
`;
const rows = (files: Record<string, Uint8Array>) => {
  const raw = JSON.parse(new TextDecoder().decode(file(files, '.events.json'))) as {
    events: WireEvent[];
  };

  return raw.events;
};
const parseSvg = (files: Record<string, Uint8Array>) =>
  parse(new TextDecoder().decode(file(files, '.svg')));
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
const svgTieCenterline = (doc: Document) => {
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
      path,
      points: [
        [(n[0]! + n[14]!) / 2, (n[1]! + n[15]!) / 2],
        [(n[2]! + n[12]!) / 2, (n[3]! + n[13]!) / 2],
        [(n[4]! + n[10]!) / 2, (n[5]! + n[11]!) / 2],
        [(n[6]! + n[8]!) / 2, (n[7]! + n[9]!) / 2],
      ],
      origin: [svgTranslate(path, 0), svgTranslate(path, 1)] as const,
    };
  }

  return undefined;
};
const passive = async (text: string) => {
  const plain = await compiler.compile(text, { format: ['svg', 'midi'] });
  const captured = await compiler.compile(text, {
    format: ['svg', 'midi'],
    files: { 'tie-bezier-observer.ily': listener },
    includeSettings: 'tie-bezier-observer.ily',
  });
  const svgNames = Object.keys(plain.files)
    .filter((name) => name.endsWith('.svg'))
    .sort();

  assert.ok(svgNames.length);

  for (const name of svgNames) {
    assert.deepEqual(
      captured.files[name],
      plain.files[name],
      'final tie observer preserves exact source SVG bytes',
    );
  }

  assert.ok(
    Object.keys(captured.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  const callbacks = (logs: readonly string[]) =>
    logs.filter((line) => line.startsWith('TIE-SOURCE-POST '));

  if (text.includes('tie-source-post')) {
    assert.ok(callbacks(plain.logs).length);
  }

  assert.deepEqual(
    callbacks(captured.logs),
    callbacks(plain.logs),
    'page callback sequence is unchanged',
  );

  return { plain, captured };
};

type Geometry = {
  'tie-id': number;
  system: number;
  'from-note-id': number;
  'to-note-id': number;
  'from-head-id': number;
  'to-head-id': number;
  'from-staff-context': number;
  'to-staff-context': number;
  'from-staff-symbol-context': number;
  'to-staff-symbol-context': number;
  units: string;
  points: [number, number][];
  'curve-origin': [number, number];
  'from-note-origin': [number, number];
  'to-note-origin': [number, number];
  'from-staff-top-y': number;
  'to-staff-top-y': number;
  'output-scale': number;
  'layout-staff-space-mm': number;
  'from-local-staff-space-mm': number;
  'to-local-staff-space-mm': number;
  'global-staff-space-mm': number;
};

test('standard final Tie centerline is captured passively at default, scaled, offset, and changed-height layouts', async () => {
  const variants = [
    { staff: '', prefix: '', scale: 1, offset: [0, 0] as const },
    {
      staff: String.raw`\override StaffSymbol.staff-space = #0.7`,
      prefix: '',
      scale: 0.7,
      offset: [0, 0] as const,
    },
    {
      staff: '',
      prefix: String.raw`\once \override Tie.extra-offset = #'(1/3 . -2/3)`,
      scale: 1,
      offset: [1 / 3, -2 / 3] as const,
    },
    {
      staff: '',
      prefix: String.raw`\once \override Tie.height-limit = #3 \once \override Tie.ratio = #0.5`,
      scale: 1,
      offset: [0, 0] as const,
    },
  ];

  for (const variant of variants) {
    const music = String.raw`c'1~ c'1`;
    const body = marker + score(music, variant.staff, variant.prefix);
    const text = String.raw`\version "2.26.0"` + '\n' + body;
    const { captured } = await passive(text);
    const events = rows(captured.files);
    const ties = events.filter((event) => event.k === 'tiegraphic');

    assert.equal(ties.length, 1);
    const geometry = ties[0]!.geometry as Geometry | undefined;

    assert.ok(geometry, 'standard same-system one-head tie has resolved geometry');
    assert.equal(geometry.units, 'lilypond-final-layout-coordinates');
    assert.equal(geometry.system, 1);
    assert.equal(geometry['tie-id'], ties[0]!.id);
    assert.deepEqual(ties[0]!.from, [geometry['from-head-id']]);
    assert.deepEqual(ties[0]!.to, [geometry['to-head-id']]);
    assert.equal(geometry['from-staff-context'], geometry['from-staff-symbol-context']);
    assert.equal(geometry['to-staff-context'], geometry['to-staff-symbol-context']);
    assert.equal(geometry['global-staff-space-mm'], geometry['layout-staff-space-mm']);
    assert.ok(
      Math.abs(
        geometry['from-local-staff-space-mm'] / geometry['global-staff-space-mm'] - variant.scale,
      ) < 1e-10,
    );
    assert.ok(
      Math.abs(
        geometry['to-local-staff-space-mm'] / geometry['global-staff-space-mm'] - variant.scale,
      ) < 1e-10,
    );
    const factor = (geometry['output-scale'] * 10) / geometry['global-staff-space-mm'];

    assert.ok(factor > 0 && Number.isFinite(factor));
    const svg = svgTieCenterline(parseSvg(captured.files));

    assert.ok(svg, 'actual source tie ribbon was rendered as two cubic boundaries');

    for (let i = 0; i < 4; i++) {
      const [x, y] = geometry.points[i]!;
      const [ox, oy] = geometry['curve-origin'];
      const svgPoint = svg.points[i]!;

      assert.ok(Math.abs(x - ox - svgPoint[0]!) < 0.0002, `P${i} SVG X centerline`);
      assert.ok(Math.abs(-(y - oy) - svgPoint[1]!) < 0.0002, `P${i} SVG Y centerline`);
    }

    const [svgOx, svgOy] = svg.origin;
    const [curveX, curveY] = geometry['curve-origin'];

    assert.ok(Number.isFinite(svgOx + curveX) && Number.isFinite(svgOy - curveY));
    assert.ok(geometry.points.every((point) => point.every(Number.isFinite)));
  }
});

test('only uniquely owned standard same-system chord-member ties receive geometry', async () => {
  const { captured } = await passive(marker + score(String.raw`<c' e' g'>1~ <c' e' g'>1`));
  const ties = rows(captured.files).filter((event) => event.k === 'tiegraphic');

  assert.ok(ties.length >= 3);
  assert.ok(
    ties.every((tie) => Array.isArray(tie.geometry?.points) && tie.geometry.points.length === 4),
  );

  for (const tie of ties) {
    assert.ok(tie.geometry);
    assert.equal(tie.from.length, 1);
    assert.equal(tie.to.length, 1);
    assert.equal(tie.from[0], tie.geometry['from-head-id']);
    assert.equal(tie.to[0], tie.geometry['to-head-id']);
  }
});

test('broken and delegated custom tie drawing stay without resolved geometry', async () => {
  const custom = String.raw`#(define (tie-source-stencil g) (format #t "TIE-SOURCE-STENCIL\n") (ly:tie::print g))
#(define (tie-source-after g) (format #t "TIE-SOURCE-AFTER\n") #t)
`;
  const broken = await passive(
    marker + score(String.raw`c'1~ \break c'1 d'1\repeatTie e'1\laissezVibrer`),
  );
  const brokenTies = rows(broken.captured.files).filter((event) => event.k === 'tiegraphic');

  assert.ok(brokenTies.length);
  assert.ok(brokenTies.every((tie) => !tie.geometry));
  const customSource =
    custom +
    marker +
    score(
      String.raw`\override Tie.stencil=#tie-source-stencil \override Tie.after-line-breaking=#tie-source-after \tieUp c'1~ c'1`,
    );
  const customResult = await passive(customSource);
  const customTies = (await converter.convert(customSource)).scores.flatMap((score) =>
    score.document.events.filter((event) => event.kind === 'tieGraphic'),
  );

  assert.ok(customTies.length);
  assert.ok(customTies.every((tie) => !tie.resolvedGeometry));
  assert.equal(
    customResult.plain.logs.filter((line) => line.startsWith('TIE-SOURCE-STENCIL')).length,
    1,
  );
  assert.equal(
    customResult.plain.logs.filter((line) => line.startsWith('TIE-SOURCE-AFTER')).length,
    1,
  );
});
