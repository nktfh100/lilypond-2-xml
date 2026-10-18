import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Event } from '../../../src/musicxml/planning/events.js';
import { expandPercentRepeats } from '../../../src/musicxml/planning/percent-repeats.js';
import { fingerGlidePoints } from '../../../src/musicxml/notation/spans/finger-glides.js';
import { isNoteBoundSpan } from '../../../src/musicxml/notation/spans/note-bound-spans.js';

const moment = (numerator: number, denominator = 1) => ({
  main: { numerator, denominator },
  grace: { numerator: 0, denominator: 1 },
});
const note = (noteId: number, numerator: number): Event => ({
  kind: 'note',
  noteId,
  voice: 1,
  staff: 1,
  moment: moment(numerator, 2),
  duration: { log: 1, dots: 0, scale: { numerator: 1, denominator: 1 } },
  attachments: [],
});
const repeat: Event = {
  kind: 'percentRepeat',
  id: 10,
  voice: 1,
  staff: 1,
  class: 'percent-event',
  length: { numerator: 1, denominator: 1 },
  count: 2,
  slashes: 1,
  moment: moment(1),
  graphics: [],
};
const glide: Extract<Event, { kind: 'fingerGlide' }> = {
  kind: 'fingerGlide',
  id: 1,
  piece: 0,
  voice: 1,
  staff: 1,
  moment: moment(0),
  endMoment: moment(1, 2),
  resolvedStart: true,
  leftKind: 'note',
  rightKind: 'note',
  fromNotes: [1],
  toNotes: [2],
  style: 'line',
  color: null,
  hidden: false,
  custom: false,
  dashFraction: 1,
  dashPeriod: 1,
  staffSpace: null,
  layoutStaffSpace: null,
  xTenths: [0, 10],
  yTenths: [1, 1],
  xReference: [moment(0), moment(1, 2)],
  fromLabel: { id: 1, kind: 'finger', text: '1', noteIds: [1, 99] },
  toLabel: { id: 2, kind: 'finger', text: '2', noteIds: [2] },
};

test('percent copies remap spans and labels, shift references, and preserve original input', () => {
  const input = [note(1, 0), note(2, 1), glide, repeat];
  const before = structuredClone(input);
  const warnings: string[] = [];
  const output = expandPercentRepeats(input, (code) => warnings.push(code));
  const copy = output.find((e) => e.kind === 'fingerGlide' && e.percentCopy === 10);

  assert.ok(copy && copy.kind === 'fingerGlide');
  assert.ok(isNoteBoundSpan(copy));
  assert.deepEqual(copy.fromNotes, [3]);
  assert.deepEqual(copy.toNotes, [4]);
  assert.deepEqual(copy.fromLabel?.noteIds, [3]);
  assert.deepEqual(copy.toLabel?.noteIds, [4]);
  assert.deepEqual(copy.endMoment, moment(3, 2));
  assert.deepEqual(copy.xReference, [moment(1), moment(3, 2)]);
  assert.equal(copy.hidden, true);
  assert.deepEqual(input, before);
  assert.deepEqual(warnings, []);
});

test('crossing span rejection remains separate from copying labels and references', () => {
  for (const change of [{ endMoment: null }, { endMoment: moment(2) }, { toNotes: [99] }]) {
    const warnings: string[] = [];
    const span = { ...glide, ...change };
    const output = expandPercentRepeats([note(1, 0), note(2, 1), span, repeat], (code) =>
      warnings.push(code),
    );

    assert.deepEqual(warnings, ['finger-glide-percent']);
    assert.equal(output.filter((e) => e.kind === 'fingerGlide').length, 1);
    assert.equal(output.filter((e) => e.kind === 'note' && e.percentCopy === 10).length, 2);
  }
});

test('episema references shift while unavailable references remain null', () => {
  const { fromLabel: _from, toLabel: _to, ...line } = glide;
  const span: Event = {
    ...line,
    kind: 'episema',
    xReference: [null, moment(1, 2)],
  };
  const output = expandPercentRepeats([note(1, 0), note(2, 1), span, repeat], () => {});
  const copy = output.find((e) => e.kind === 'episema' && e.percentCopy === 10);

  assert.ok(copy && copy.kind === 'episema');
  assert.deepEqual(copy.xReference, [null, moment(3, 2)]);
  assert.deepEqual(copy.fromNotes, [3]);
});

test('span identities use exact equivalent times and retain grace positions', () => {
  const key = (main: number, denominator: number, graceNumerator = 0) => {
    const points = fingerGlidePoints(
      [
        {
          ...glide,
          moment: {
            main: { numerator: main, denominator },
            grace: { numerator: graceNumerator, denominator: 16 },
          },
          endMoment: moment(1),
        },
      ],
      () => {},
    );
    const point = points.find((event) => event.kind === 'fingerGlidePoint');

    assert.ok(point && point.kind === 'fingerGlidePoint');

    return point.spanKey;
  };

  assert.equal(key(1, 2), key(2, 4));
  assert.notEqual(key(1, 2), key(1, 2, -1));
});
