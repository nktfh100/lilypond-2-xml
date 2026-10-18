import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  coordinatesNear,
  coordinatesRelativelyNear,
} from '../../../src/musicxml/layout/geometry.js';
import { matchesMeasureReference } from '../../../src/musicxml/notation/spans/line-appearance.js';
import {
  compareMoments,
  compareRational,
  durationValue,
  eventGraceTime,
  eventTime,
  gcd,
  lcm,
  mainTime,
  rationalValue,
  isMoment,
  isDuration,
  momentKey,
  rationalKey,
} from '../../../src/model/time.js';
import { hasDuration, type Event } from '../../../src/musicxml/planning/events.js';

const at = (numerator: number, denominator = 1, grace = 0) => ({
  main: { numerator, denominator },
  grace: { numerator: grace, denominator: 16 },
});

test('equivalent exact musical times share identities while grace positions stay distinct', () => {
  assert.equal(momentKey(at(2, 4)), momentKey(at(1, 2)));
  assert.equal(rationalKey({ numerator: 0, denominator: 32 }), '0/1');
  assert.equal(compareMoments(at(2, 4), at(1, 2)), 0);
  assert.equal(compareMoments(at(1, 2, -1), at(2, 4)), -1);
  assert.notEqual(momentKey(at(1, 2, -1)), momentKey(at(1, 2)));
  assert.equal(matchesMeasureReference(at(2, 4), at(1, 2)), true);
  assert.equal(matchesMeasureReference(at(1, 2, -1), at(1, 2)), false);
});

test('close large rational onsets remain ordered even when floating point rounds them together', () => {
  const n = Number.MAX_SAFE_INTEGER;
  const a = { numerator: n - 1, denominator: n };
  const b = { numerator: n - 2, denominator: n - 1 };

  assert.equal(a.numerator / a.denominator, b.numerator / b.denominator);
  assert.equal(compareRational(a, b), 1);
  assert.notEqual(rationalKey(a), rationalKey(b));
});

test('malformed cached musical time never acquires an identity', () => {
  for (const value of [
    null,
    [],
    {},
    { numerator: 1, denominator: 0 },
    { numerator: 1, denominator: -2 },
    { numerator: 0.5, denominator: 1 },
    { numerator: 2 ** 53, denominator: 1 },
    { numerator: 1, denominator: Infinity },
  ]) {
    assert.equal(rationalKey(value), null);
    assert.equal(isMoment({ main: value, grace: { numerator: 0, denominator: 1 } }), false);
    assert.equal(momentKey({ main: value, grace: { numerator: 0, denominator: 1 } }), null);
  }
});

test('physical-coordinate tolerance and numeric writer offsets stay separate from exact ownership', () => {
  assert.equal(coordinatesNear(10, 10 + 1e-8), true);
  assert.equal(coordinatesNear(10, 10 + 1e-5), false);
  assert.equal(coordinatesRelativelyNear(1e6, 1e6 + 0.01), true);
  assert.equal(coordinatesNear(1e6, 1e6 + 0.01), false);
  assert.equal(matchesMeasureReference(at(1, 3), 1 / 3 + 1e-12), true);
  assert.equal(matchesMeasureReference(null, 0), false);
});

test('numeric projections preserve main, grace and scaled duration units', () => {
  const moment = at(1, 3, -1);

  assert.equal(mainTime(moment), 1 / 3);
  assert.equal(eventTime({ moment }), rationalValue(moment.main));
  assert.equal(eventGraceTime({ moment }), -1 / 16);
  assert.equal(durationValue({ log: 2, dots: 1, scale: { numerator: 2, denominator: 3 } }), 1 / 4);
  assert.equal(gcd(-12, 18), 6);
  assert.equal(gcd(12, -18), 6);
  assert.equal(gcd(0, 0), 0);
  assert.equal(lcm(12, 18), 36);
});

test('duration validation rejects missing, malformed, zero, negative, and overflowing lengths', () => {
  const duration = { log: 2, dots: 1, scale: { numerator: 2, denominator: 3 } };

  assert.equal(isDuration(duration), true);
  assert.equal(isDuration({ ...duration, log: -1 }), true);
  const event: Event = {
    kind: 'skip',
    voice: 1,
    staff: 1,
    moment: at(0),
    duration,
  };

  assert.equal(hasDuration(event), true);

  for (const invalid of [
    undefined,
    null,
    {},
    [],
    { ...duration, log: 0.5 },
    { ...duration, dots: -1 },
    { ...duration, dots: NaN },
    { ...duration, log: -1024 },
    { ...duration, log: 2048 },
    { ...duration, scale: { numerator: 1, denominator: 0 } },
    { ...duration, scale: { numerator: 0, denominator: 1 } },
    { ...duration, scale: { numerator: -1, denominator: 1 } },
  ]) {
    assert.equal(isDuration(invalid), false);
    const malformed: Event = structuredClone(event);

    Reflect.set(malformed, 'duration', invalid);
    assert.equal(hasDuration(malformed), false);
  }
});
