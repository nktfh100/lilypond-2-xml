import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolvedSlurBezierAttributes,
  type ResolvedSlurGeometry,
} from '../../../src/musicxml/notation/spans/curves.js';
import { toMusicXML } from '../../../src/index.js';
import { converter, elements, parse } from '../../support/conversion-support.js';
import { validate } from '../../support/schema.js';

const geometry: ResolvedSlurGeometry = {
  slurId: 7,
  system: 1,
  staffContext: 2,
  fromNoteId: 11,
  toNoteId: 12,
  fromHeadId: 11,
  toHeadId: 12,
  staffSymbolContext: 2,
  units: 'lilypond-final-layout-coordinates',
  points: [
    [10, 20],
    [14, 26],
    [27, 28],
    [30, 25],
  ],
  curveOrigin: [9, 19],
  fromNoteOrigin: [8, 15],
  toNoteOrigin: [28, 17],
  staffTopY: 5,
  outputScale: 2,
  layoutStaffSpaceMm: 2,
  localStaffSpaceMm: 1.5,
  globalStaffSpaceMm: 2,
};
const expected = { slurId: 7, staff: 2, fromNoteId: 11, toNoteId: 12 };
const assertNear = (actual: number, wanted: number, message: string) =>
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - wanted) < 1e-8,
    `${message}: ${actual} vs ${wanted}`,
  );

test('resolved slur endpoints and outgoing/incoming Bezier vectors use global MusicXML tenths', () => {
  assert.deepEqual(resolvedSlurBezierAttributes(geometry, expected, 'start', 2), {
    'default-x': 20,
    'default-y': 150,
    'bezier-x': 40,
    'bezier-y': 60,
  });
  assert.deepEqual(resolvedSlurBezierAttributes(geometry, expected, 'stop', 2), {
    'default-x': 20,
    'default-y': 200,
    'bezier-x': -30,
    'bezier-y': 30,
  });
});

test('resolved slur geometry fails closed for unproven ownership, units or scale', () => {
  assert.equal(resolvedSlurBezierAttributes(undefined, expected, 'start', 2), null);
  assert.equal(
    resolvedSlurBezierAttributes({ ...geometry, fromHeadId: 99 }, expected, 'start', 2),
    null,
  );
  assert.equal(
    resolvedSlurBezierAttributes({ ...geometry, staffSymbolContext: 3 }, expected, 'start', 2),
    null,
  );
  assert.equal(
    resolvedSlurBezierAttributes(
      { ...geometry, units: 'unknown' as ResolvedSlurGeometry['units'] },
      expected,
      'start',
      2,
    ),
    null,
  );
  assert.equal(
    resolvedSlurBezierAttributes({ ...geometry, outputScale: 0 }, expected, 'start', 2),
    null,
  );
  assert.equal(
    resolvedSlurBezierAttributes({ ...geometry, globalStaffSpaceMm: 3 }, expected, 'start', 2),
    null,
  );
  assert.equal(
    resolvedSlurBezierAttributes(
      {
        ...geometry,
        points: [
          [10, 20],
          [14, Number.NaN],
          [27, 28],
          [30, 25],
        ],
      },
      expected,
      'start',
      2,
    ),
    null,
  );
});

test('captured one-system slur geometry survives MusicXML schema and JSON cache replay', async () => {
  const source = String.raw`\score { \new Staff { c'2( d'2 e'2 f'2) } \layout {} \midi {} }`;
  const score = (await converter.convert(source)).scores[0]!;

  validate(score.musicxml);
  const span = score.document.events.find((event) => event.kind === 'slur');

  assert.ok(span && span.kind === 'slur');
  const geometry = (span as typeof span & { resolvedGeometry?: ResolvedSlurGeometry })
    .resolvedGeometry;

  assert.ok(
    geometry,
    'final one-system source slur geometry is retained in the public event document',
  );
  assert.equal(geometry.system, 1);
  assert.deepEqual(geometry.fromNoteId, span.fromNotes[0]);
  assert.deepEqual(geometry.toNoteId, span.toNotes[0]);
  const marks = elements(parse(score.musicxml), 'slur').filter(
    (mark) => mark.getAttribute('number') !== null,
  );

  assert.equal(marks.length, 2);
  const start = marks.find((mark) => mark.getAttribute('type') === 'start')!;
  const stop = marks.find((mark) => mark.getAttribute('type') === 'stop')!;
  const paperStaffSpace = score.document.paper?.['staff-space'];

  assert.ok(
    typeof paperStaffSpace === 'number' && Number.isFinite(paperStaffSpace) && paperStaffSpace > 0,
  );
  const factor = (geometry.outputScale * 10) / paperStaffSpace;
  const expectedProjection = (type: 'start' | 'stop') => {
    const endpoint = type === 'start' ? geometry.points[0] : geometry.points[3];
    const control = type === 'start' ? geometry.points[1] : geometry.points[2];
    const noteOrigin = type === 'start' ? geometry.fromNoteOrigin : geometry.toNoteOrigin;

    return {
      'default-x': (endpoint[0] - noteOrigin[0]) * factor,
      'default-y': (endpoint[1] - geometry.staffTopY) * factor,
      'bezier-x': (control[0] - endpoint[0]) * factor,
      'bezier-y': (control[1] - endpoint[1]) * factor,
    };
  };
  const assertProjection = (mark: Element, type: 'start' | 'stop') => {
    const actual = Object.fromEntries(
      ['default-x', 'default-y', 'bezier-x', 'bezier-y'].map((name) => [
        name,
        Number(mark.getAttribute(name)),
      ]),
    );
    const expected = expectedProjection(type);

    for (const name of Object.keys(expected) as (keyof typeof expected)[]) {
      assert.ok(
        Math.abs(Number(actual[name]) - expected[name]) < 1e-8,
        `${type} ${name} must match the independent source-to-tenths equation`,
      );
    }
  };

  assertProjection(start, 'start');
  assertProjection(stop, 'stop');
  const cachedDocument = JSON.parse(JSON.stringify(score.document)) as typeof score.document;
  const cached = toMusicXML(cachedDocument);

  validate(cached.musicxml);
  const cachedSpan = cachedDocument.events.find((event) => event.kind === 'slur');

  assert.ok(cachedSpan?.kind === 'slur');
  assert.deepEqual(cachedSpan.resolvedGeometry, geometry);
  const slurAttributes = (xml: string) =>
    elements(parse(xml), 'slur').map((mark) =>
      Array.from(mark.attributes)
        .map((attr) => [attr.name, attr.value] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );

  assert.deepEqual(slurAttributes(cached.musicxml), slurAttributes(score.musicxml));
  assert.ok(!cached.diagnostics.some((diagnostic) => diagnostic.code === 'slur-bezier-reader'));
  const invalid = {
    ...score.document,
    events: score.document.events.map((event) =>
      event.kind === 'slur'
        ? {
            ...event,
            resolvedGeometry: {
              ...geometry,
              staffSymbolContext: geometry.staffSymbolContext + 100,
            },
          }
        : event,
    ),
  };
  const failClosed = toMusicXML(invalid);

  validate(failClosed.musicxml);
  assert.ok(
    !elements(parse(failClosed.musicxml), 'slur').some((mark) => mark.hasAttribute('bezier-x')),
  );
  assert.ok(failClosed.diagnostics.some((diagnostic) => diagnostic.code === 'slur-layout'));
});

test('measured shape, dimensioned, and phrasing curves survive native projection', async () => {
  const cases = [
    [
      'shape',
      String.raw`\once \override Slur.control-points = #'((0 . 0) (0 . 2) (0 . 2) (0 . 0))`,
      String.raw`c'2( d'2)`,
    ],
    ['height', String.raw`\once \override Slur.height-limit = #1`, String.raw`c'2( d'2)`],
    ['ratio', String.raw`\once \override Slur.ratio = #0.4`, String.raw`c'2( d'2)`],
    ['thickness', String.raw`\once \override Slur.thickness = #2`, String.raw`c'2( d'2)`],
    ['phrasing', '', String.raw`c'2\( d'2\)`],
  ] as const;

  for (const [label, override, notes] of cases) {
    const source = String.raw`\score { \new Staff { ${override} ${notes} } \layout {} \midi {} }`;
    const score = (await converter.convert(source)).scores[0]!;

    validate(score.musicxml);
    const span = score.document.events.find((event) => event.kind === 'slur');

    assert.ok(span?.kind === 'slur', `${label} source retains its semantic slur`);
    const geometry = span.resolvedGeometry as ResolvedSlurGeometry | undefined;

    assert.ok(geometry, `${label} source geometry is present`);
    assert.equal(geometry.slurId, span.id);
    assert.equal(geometry.fromNoteId, span.fromNotes[0]);
    assert.equal(geometry.toNoteId, span.toNotes[0]);
    const space = score.document.paper?.['staff-space'];

    assert.ok(typeof space === 'number' && Number.isFinite(space) && space > 0);
    const factor = (geometry.outputScale * 10) / space;
    const marks = elements(parse(score.musicxml), 'slur');

    assert.equal(marks.length, 2);

    for (const type of ['start', 'stop'] as const) {
      const mark = marks.find((candidate) => candidate.getAttribute('type') === type)!;
      const endpoint = type === 'start' ? geometry.points[0]! : geometry.points[3]!;
      const control = type === 'start' ? geometry.points[1]! : geometry.points[2]!;
      const origin = type === 'start' ? geometry.fromNoteOrigin : geometry.toNoteOrigin;
      const independent = {
        'default-x': (endpoint[0] - origin[0]) * factor,
        'default-y': (endpoint[1] - geometry.staffTopY) * factor,
        'bezier-x': (control[0] - endpoint[0]) * factor,
        'bezier-y': (control[1] - endpoint[1]) * factor,
      };

      for (const key of Object.keys(independent) as (keyof typeof independent)[]) {
        assertNear(
          Number(mark.getAttribute(key)),
          independent[key],
          `${label} ${type} ${key} independently projects to MusicXML tenths`,
        );
      }

      assert.equal(
        mark.hasAttribute('relative-x'),
        false,
        'measured source offset is not applied again',
      );
      assert.equal(
        mark.hasAttribute('relative-y'),
        false,
        'measured source offset is not applied again',
      );
    }

    assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code === 'slur-bezier-reader'));
    const layoutDiagnostics = score.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'slur-layout',
    );

    if (label === 'thickness') {
      assert.ok(
        layoutDiagnostics.some((diagnostic) => diagnostic.message.includes('thickness')),
        'measured centerline is retained while unrepresented ribbon thickness remains diagnosed',
      );
    } else {
      assert.equal(
        layoutDiagnostics.length,
        0,
        `${label} measured curve removes the unrepresented-curve diagnostic`,
      );
    }

    const cachedDocument = JSON.parse(JSON.stringify(score.document)) as typeof score.document;
    const cached = toMusicXML(cachedDocument);

    validate(cached.musicxml);
    const cachedSpan = cachedDocument.events.find((event) => event.kind === 'slur');

    assert.ok(cachedSpan?.kind === 'slur');
    assert.deepEqual(
      cachedSpan.resolvedGeometry,
      geometry,
      `${label} geometry survives public JSON cache replay`,
    );
    const same = (xml: string) =>
      elements(parse(xml), 'slur').map((mark) =>
        Array.from(mark.attributes)
          .map((attr) => [attr.name, attr.value] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      );

    assert.deepEqual(
      same(cached.musicxml),
      same(score.musicxml),
      `${label} native curve is stable across cached conversion`,
    );
  }
});
