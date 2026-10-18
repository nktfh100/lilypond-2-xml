import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolvedTieBezierAttributes,
  type ResolvedTieGeometry,
} from '../../../src/musicxml/notation/spans/curves.js';

const geometry: ResolvedTieGeometry = {
  tieId: 4,
  system: 2,
  fromNoteId: 11,
  toNoteId: 12,
  fromHeadId: 11,
  toHeadId: 12,
  fromStaffContext: 7,
  toStaffContext: 7,
  fromStaffSymbolContext: 7,
  toStaffSymbolContext: 7,
  units: 'lilypond-final-layout-coordinates',
  points: [
    [17.12082677, -3.776],
    [18.302, -4.622],
    [23.922, -4.622],
    [25.93187177, -3.776],
  ],
  curveOrigin: [17.12082677, -3.776],
  fromNoteOrigin: [16.7, 0],
  toNoteOrigin: [25.5, 0],
  fromStaffTopY: 0,
  toStaffTopY: 0,
  outputScale: 1.7572990175729903,
  layoutStaffSpaceMm: 1.7572990175729903,
  fromLocalStaffSpaceMm: 1.7572990175729903,
  toLocalStaffSpaceMm: 1.7572990175729903,
  globalStaffSpaceMm: 1.7572990175729903,
};
const expected = {
  tieId: 4,
  fromNoteId: 11,
  toNoteId: 12,
  fromStaffContext: 7,
  toStaffContext: 7,
  fromStaffSymbolContext: 7,
  toStaffSymbolContext: 7,
};

test('projects measured tie endpoints and outgoing/incoming controls to global MusicXML tenths', () => {
  const factor = (geometry.outputScale * 10) / geometry.globalStaffSpaceMm;

  assert.deepEqual(
    resolvedTieBezierAttributes(geometry, expected, 'start', geometry.globalStaffSpaceMm),
    {
      'default-x': (geometry.points[0][0] - geometry.fromNoteOrigin[0]) * factor,
      'default-y': (geometry.points[0][1] - geometry.fromStaffTopY) * factor,
      'bezier-x': (geometry.points[1][0] - geometry.points[0][0]) * factor,
      'bezier-y': (geometry.points[1][1] - geometry.points[0][1]) * factor,
    },
  );
  assert.deepEqual(
    resolvedTieBezierAttributes(geometry, expected, 'stop', geometry.globalStaffSpaceMm),
    {
      'default-x': (geometry.points[3][0] - geometry.toNoteOrigin[0]) * factor,
      'default-y': (geometry.points[3][1] - geometry.toStaffTopY) * factor,
      'bezier-x': (geometry.points[2][0] - geometry.points[3][0]) * factor,
      'bezier-y': (geometry.points[2][1] - geometry.points[3][1]) * factor,
    },
  );
});

test('uses each endpoint staff top for a cross-staff tie', () => {
  const crossStaff = {
    ...geometry,
    toStaffContext: 8,
    toStaffSymbolContext: 8,
    toStaffTopY: -5,
  };
  const crossExpected = {
    ...expected,
    toStaffContext: 8,
    toStaffSymbolContext: 8,
  };
  const start = resolvedTieBezierAttributes(
    crossStaff,
    crossExpected,
    'start',
    geometry.globalStaffSpaceMm,
  )!;
  const stop = resolvedTieBezierAttributes(
    crossStaff,
    crossExpected,
    'stop',
    geometry.globalStaffSpaceMm,
  )!;

  assert.equal(start['default-y'], (geometry.points[0][1] - crossStaff.fromStaffTopY) * 10);
  assert.equal(stop['default-y'], (geometry.points[3][1] - crossStaff.toStaffTopY) * 10);
});

test('fails closed for missing, mismatched, malformed, or non-finite tie source geometry', () => {
  const invalid: unknown[] = [
    undefined,
    { ...geometry, tieId: 5 },
    { ...geometry, toStaffSymbolContext: 8 },
    { ...geometry, units: 'unknown' },
    {
      ...geometry,
      points: [
        [0, 0],
        [1, Number.NaN],
        [2, 3],
        [4, 5],
      ],
    },
    { ...geometry, points: [[0, 0], null, [2, 3], [4, 5]] },
    { ...geometry, fromNoteOrigin: [0] },
    { ...geometry, curveOrigin: null },
    { ...geometry, fromLocalStaffSpaceMm: 0 },
    { ...geometry, layoutStaffSpaceMm: 1 },
    { ...geometry, outputScale: Number.POSITIVE_INFINITY },
    { ...geometry, tieId: -4 },
    { ...geometry, fromStaffSymbolContext: 0 },
    { ...geometry, globalStaffSpaceMm: null },
    {
      ...geometry,
      points: [
        [Number.MAX_VALUE, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      fromNoteOrigin: [-Number.MAX_VALUE, 0],
    },
  ];

  for (const item of invalid) {
    assert.equal(
      resolvedTieBezierAttributes(
        item as ResolvedTieGeometry | undefined,
        expected,
        'start',
        geometry.globalStaffSpaceMm,
      ),
      null,
    );
  }

  assert.equal(resolvedTieBezierAttributes(geometry, expected, 'start', 3), null);
});
