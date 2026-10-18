import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toMusicXML } from '../../../src/index.js';
import type { TieResolvedGeometry } from '../../../src/model/document.js';
import { converter, elements, parse } from '../../support/conversion-support.js';
import { validate } from '../../support/schema.js';

const attrs = (mark: Element) =>
  Object.fromEntries(
    ['default-x', 'default-y', 'bezier-x', 'bezier-y'].map((name) => [
      name,
      Number(mark.getAttribute(name)),
    ]),
  );
const assertNear = (actual: number, expected: number, message: string) =>
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8,
    `${message}: ${actual} vs ${expected}`,
  );
const tieAttributes = (xml: string) =>
  elements(parse(xml), 'tied').filter(
    (mark) => mark.getAttribute('type') === 'start' || mark.getAttribute('type') === 'stop',
  );

test('captured tie centerline projects to schema-valid MusicXML and replays from cached geometry', async () => {
  const score = (
    await converter.convert(String.raw`\score { \new Staff { c'1~ c'1 } \layout {} \midi {} }`)
  ).scores[0]!;

  validate(score.musicxml);
  const span = score.document.events.find((event) => event.kind === 'tieGraphic');

  assert.ok(span && span.kind === 'tieGraphic');
  const geometry = span.resolvedGeometry as TieResolvedGeometry | undefined;

  assert.ok(geometry, 'eligible standard tie has final geometry in the public event document');
  assert.equal(geometry.tieId, span.id);
  assert.equal(geometry.system, 1);
  assert.deepEqual(span.fromNotes, [geometry.fromHeadId]);
  assert.deepEqual(span.toNotes, [geometry.toHeadId]);
  assert.equal(geometry.fromStaffContext, geometry.fromStaffSymbolContext);
  assert.equal(geometry.toStaffContext, geometry.toStaffSymbolContext);

  const globalSpace = score.document.paper?.['staff-space'];

  assert.ok(typeof globalSpace === 'number' && Number.isFinite(globalSpace) && globalSpace > 0);
  assertNear(
    geometry.globalStaffSpaceMm,
    globalSpace,
    'captured global scale matches document paper',
  );
  assertNear(geometry.layoutStaffSpaceMm, globalSpace, 'layout staff space is global paper scale');
  assert.ok(geometry.outputScale > 0 && Number.isFinite(geometry.outputScale));
  const factor = (geometry.outputScale * 10) / globalSpace;
  const expected = (type: 'start' | 'stop') => {
    const endpoint = type === 'start' ? geometry.points[0] : geometry.points[3];
    const control = type === 'start' ? geometry.points[1] : geometry.points[2];
    const noteOrigin = type === 'start' ? geometry.fromNoteOrigin : geometry.toNoteOrigin;
    const staffTop = type === 'start' ? geometry.fromStaffTopY : geometry.toStaffTopY;

    return {
      'default-x': (endpoint[0] - noteOrigin[0]) * factor,
      'default-y': (endpoint[1] - staffTop) * factor,
      'bezier-x': (control[0] - endpoint[0]) * factor,
      'bezier-y': (control[1] - endpoint[1]) * factor,
    };
  };
  const marks = tieAttributes(score.musicxml);

  assert.equal(marks.length, 2);

  for (const type of ['start', 'stop'] as const) {
    const mark = marks.find((candidate) => candidate.getAttribute('type') === type)!;
    const actual = attrs(mark),
      want = expected(type);

    for (const key of Object.keys(want) as (keyof typeof want)[]) {
      assertNear(actual[key]!, want[key], `${type} ${key} from independent source equation`);
    }

    assert.equal(
      mark.hasAttribute('relative-x'),
      false,
      'source extra-offset is already present in absolute geometry',
    );
    assert.equal(
      mark.hasAttribute('relative-y'),
      false,
      'source extra-offset is already present in absolute geometry',
    );
  }

  assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code === 'tie-bezier-reader'));

  const cachedDocument = JSON.parse(JSON.stringify(score.document)) as typeof score.document;
  const cached = toMusicXML(cachedDocument);

  validate(cached.musicxml);
  const cachedSpan = cachedDocument.events.find((event) => event.kind === 'tieGraphic');

  assert.ok(cachedSpan?.kind === 'tieGraphic');
  assert.deepEqual(cachedSpan.resolvedGeometry, geometry);
  const nativeAttrs = (xml: string) =>
    tieAttributes(xml).map((mark) => [mark.getAttribute('type'), attrs(mark)]);

  assert.deepEqual(nativeAttrs(cached.musicxml), nativeAttrs(score.musicxml));

  const invalid = {
    ...score.document,
    events: score.document.events.map((event) =>
      event.kind === 'tieGraphic'
        ? {
            ...event,
            resolvedGeometry: {
              ...geometry,
              fromStaffSymbolContext: geometry.fromStaffSymbolContext + 100,
            },
          }
        : event,
    ),
  };
  const failClosed = toMusicXML(invalid);

  validate(failClosed.musicxml);
  assert.ok(tieAttributes(failClosed.musicxml).every((mark) => !mark.hasAttribute('bezier-x')));
  assert.ok(failClosed.diagnostics.some((diagnostic) => diagnostic.code === 'tie-layout'));
});

test('selected chord-note tie members retain independent measured native curves', async () => {
  const score = (
    await converter.convert(
      String.raw`\score { \new Staff { <c'~ e' g'~>2 <c' f' g'>2 } \layout {} \midi {} }`,
    )
  ).scores[0]!;

  validate(score.musicxml);
  const spans = score.document.events.filter((event) => event.kind === 'tieGraphic');

  assert.equal(spans.length, 2);
  assert.ok(spans.every((span) => span.kind === 'tieGraphic' && span.resolvedGeometry));
  const marks = tieAttributes(score.musicxml);

  assert.equal(marks.length, 4);
  assert.ok(marks.every((mark) => mark.hasAttribute('bezier-x') && mark.hasAttribute('bezier-y')));
});
