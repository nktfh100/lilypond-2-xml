import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Event } from '../../../src/musicxml/planning/events.js';
import {
  uncertainStaffTop,
  uncertainStaffTopAt,
} from '../../../src/musicxml/layout/staff-reference.js';

const moment = (n: number) => ({
  main: { numerator: n, denominator: 1 },
  grace: { numerator: 0, denominator: 1 },
});
const grid = (
  positions: readonly number[],
  n = 0,
  staff = 1,
): Extract<Event, { kind: 'staffLines' }> => ({
  kind: 'staffLines',
  staff,
  moment: moment(n),
  count: positions.length,
  positions,
  staffSpace: 1,
  layoutStaffSpace: 1,
  hidden: false,
  custom: false,
  present: true,
});
const clef = (glyph: string): Extract<Event, { kind: 'clef' }> => ({
  kind: 'clef',
  staff: 1,
  moment: moment(0),
  glyph,
  position: -2,
  transposition: 0,
});

test('ordinary staff references remain usable while custom, asymmetric and fallback grids stay conservative', () => {
  const ordinary = grid([-4, -2, 0, 2, 4]);

  assert.equal(uncertainStaffTop(undefined, undefined), false);
  assert.equal(uncertainStaffTop(ordinary, undefined), false);
  assert.equal(uncertainStaffTop({ ...ordinary, custom: true }, clef('clefs.G')), true);
  assert.equal(uncertainStaffTop(grid([-8, -4, 0]), undefined), true);
  const even = grid([-3, -1, 1, 3]);

  assert.equal(uncertainStaffTop(even, undefined), true);
  assert.equal(uncertainStaffTop(even, clef('clefs.G')), true);
  assert.equal(uncertainStaffTop(even, clef('clefs.percussion')), false);
});

test('reference selection respects exact time, staff ownership and later changes', () => {
  const initial = grid([-4, -2, 0, 2, 4]);
  const later = { ...grid([-4, -2, 0, 2, 4], 1), custom: true };
  const otherStaff = { ...grid([-4, -2, 0, 2, 4], 0, 2), custom: true };
  const events = [later, otherStaff, initial];

  assert.equal(uncertainStaffTopAt(events, 1, moment(0)), false);
  assert.equal(uncertainStaffTopAt(events, 1, moment(1)), true);
  assert.equal(uncertainStaffTopAt(events, 3, moment(1)), false);
});
