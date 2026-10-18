import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toMusicXML } from '../../../src/index.js';
import type { TieResolvedGeometry } from '../../../src/model/document.js';
import { converter, elements, parse } from '../../support/conversion-support.js';
import { validate } from '../../support/schema.js';

const sourceVariants = [
  {
    name: 'literal control-point override',
    source: String.raw`\score { \new Staff { \once \override Tie.control-points = #'((0 . 0) (0 . 2) (0 . 2) (0 . 0)) c'1~ c'1 } \layout{} \midi{} }`,
  },
  {
    name: 'shape-transformed tie',
    source: String.raw`\score { \new Staff { \shape #'((0 . 0) (0 . 2) (0 . 2) (0 . 0)) Tie c'1~ c'1 } \layout{} \midi{} }`,
  },
];

function verifyResolvedNative(
  score: Awaited<ReturnType<typeof converter.convert>>['scores'][number],
  name: string,
) {
  validate(score.musicxml);
  const span = score.document.events.find((event) => event.kind === 'tieGraphic');

  assert.ok(
    span?.kind === 'tieGraphic' && span.customControls,
    `${name} must retain its custom-controls provenance`,
  );
  const geometry = span.resolvedGeometry as TieResolvedGeometry | undefined;

  assert.ok(geometry, `${name} must use the final cached printed Tie stencil`);
  assert.deepEqual(span.fromNotes, [geometry.fromHeadId]);
  assert.deepEqual(span.toNotes, [geometry.toHeadId]);
  const staffSpace = score.document.paper?.['staff-space'];

  assert.ok(typeof staffSpace === 'number' && Number.isFinite(staffSpace) && staffSpace > 0);
  const factor = (geometry.outputScale * 10) / staffSpace;
  const marks = elements(parse(score.musicxml), 'tied');

  assert.equal(marks.length, 2);

  for (const type of ['start', 'stop'] as const) {
    const mark = marks.find((item) => item.getAttribute('type') === type)!;
    const endpoint = type === 'start' ? geometry.points[0] : geometry.points[3];
    const control = type === 'start' ? geometry.points[1] : geometry.points[2];
    const noteOrigin = type === 'start' ? geometry.fromNoteOrigin : geometry.toNoteOrigin;
    const staffTop = type === 'start' ? geometry.fromStaffTopY : geometry.toStaffTopY;
    const expected = {
      'default-x': (endpoint[0] - noteOrigin[0]) * factor,
      'default-y': (endpoint[1] - staffTop) * factor,
      'bezier-x': (control[0] - endpoint[0]) * factor,
      'bezier-y': (control[1] - endpoint[1]) * factor,
    };

    for (const [attribute, value] of Object.entries(expected)) {
      assert.ok(
        Math.abs(Number(mark.getAttribute(attribute)) - value) < 1e-8,
        `${name} ${type} ${attribute}`,
      );
    }

    assert.equal(
      mark.hasAttribute('relative-x'),
      false,
      'captured stencil points already include source offsets',
    );
    assert.equal(
      mark.hasAttribute('relative-y'),
      false,
      'captured stencil points already include source offsets',
    );
  }

  assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code === 'tie-bezier-reader'));
  assert.ok(
    !score.diagnostics.some((diagnostic) => diagnostic.code === 'tie-layout'),
    `${name} retains its measured centerline instead of reporting it as unsupported`,
  );

  const cachedDocument = JSON.parse(JSON.stringify(score.document)) as typeof score.document;
  const cached = toMusicXML(cachedDocument);

  validate(cached.musicxml);
  const cachedSpan = cachedDocument.events.find((event) => event.kind === 'tieGraphic');

  assert.ok(cachedSpan?.kind === 'tieGraphic');
  assert.deepEqual(cachedSpan.resolvedGeometry, geometry, `${name} cached geometry is stable`);
  const attrs = (xml: string) =>
    elements(parse(xml), 'tied').map((mark) => [
      mark.getAttribute('type'),
      ...['default-x', 'default-y', 'bezier-x', 'bezier-y'].map((key) => mark.getAttribute(key)),
    ]);

  assert.deepEqual(attrs(cached.musicxml), attrs(score.musicxml));
}

test('native tie Beziers follow literal and shape-controlled cached stencils', async () => {
  for (const variant of sourceVariants) {
    const score = (await converter.convert(variant.source)).scores[0]!;

    verifyResolvedNative(score, variant.name);
  }
});

test('selected chord tie members remain independently paired when the standard stencil is transformed', async () => {
  const score = (
    await converter.convert(
      String.raw`\score { \new Staff { \shape #'((0 . 0) (0 . 2) (0 . 2) (0 . 0)) Tie <c'~ e' g'~>2 <c' f' g'>2 } \layout{} \midi{} }`,
    )
  ).scores[0]!;

  validate(score.musicxml);
  const spans = score.document.events.filter((event) => event.kind === 'tieGraphic');

  assert.equal(spans.length, 2);
  assert.ok(
    spans.every(
      (span) => span.kind === 'tieGraphic' && span.customControls && span.resolvedGeometry,
    ),
  );
  assert.deepEqual(
    spans.map((span) => (span.kind === 'tieGraphic' ? [span.fromNotes, span.toNotes] : null)),
    [
      [[1], [4]],
      [[3], [6]],
    ],
  );
  const marks = elements(parse(score.musicxml), 'tied');

  assert.equal(marks.length, 4);
  assert.ok(
    marks.every(
      (mark) =>
        mark.hasAttribute('default-x') &&
        mark.hasAttribute('default-y') &&
        mark.hasAttribute('bezier-x') &&
        mark.hasAttribute('bezier-y'),
    ),
  );
});
