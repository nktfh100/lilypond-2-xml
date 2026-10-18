import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Event } from '../../../src/musicxml/planning/events.js';
import { planMeasureEvents } from '../../../src/musicxml/planning/measure-events.js';

const moment = (at: number, grace = 0) => ({
  main: { numerator: at, denominator: 1 },
  grace: { numerator: grace, denominator: 16 },
});
const note = (at: number, grace = 0): Event => ({
  kind: 'note',
  staff: 1,
  voice: 2,
  moment: moment(at, grace),
  duration: { log: 2, dots: 0, scale: { numerator: 1, denominator: 1 } },
  attachments: [],
});
const section = (at: number): Event => ({
  kind: 'navigation',
  class: 'fine-event',
  text: 'Fine',
  direction: 1,
  hidden: false,
  finalVisible: true,
  enclosure: 'none',
  bold: false,
  italic: false,
  segno: 0,
  coda: 0,
  returnCount: 0,
  alternativeNumber: 0,
  moment: moment(at),
});
const target = (at: number): Event => ({
  kind: 'navigationTarget',
  target: 'end',
  moment: moment(at),
});
const endsSection = (event: Event) => event.class === 'fine-event';

test('section endings belong to the preceding measure and grace events keep their main-time owner', () => {
  const start = note(0),
    endFirst = section(1),
    startSecond = note(1),
    grace = note(1, -1);
  const endSecond = section(2),
    startThird = note(2),
    endScore = section(3);
  const events = [start, endFirst, startSecond, grace, endSecond, startThird, endScore];

  assert.deepEqual(planMeasureEvents(events, [0, 1, 2], 3, endsSection), [
    [start, endFirst],
    [startSecond, grace, endSecond],
    [startThird, endScore],
  ]);
});

test('terminal markers remain in the final measure while terminal notes and layout events stay outside', () => {
  const end = target(2);
  const layout: Event = {
    kind: 'layout',
    class: 'line-break-event',
    permission: 'force',
    moment: moment(2),
  };

  assert.deepEqual(planMeasureEvents([note(2), layout, end, note(3)], [0, 1], 2, endsSection), [
    [],
    [end],
  ]);
});

test('grouping preserves input order, pickup ownership, and score-wide event identities', () => {
  const first = note(1),
    pickup = note(-1),
    second = note(0),
    marker = target(1);
  const events = [first, pickup, second, marker];

  assert.deepEqual(planMeasureEvents(events, [-1, 0, 1], 2, endsSection), [
    [pickup],
    [second],
    [first, marker],
  ]);
  assert.deepEqual(events, [first, pickup, second, marker]);
  assert.deepEqual(planMeasureEvents(events, [0, 1], 2, endsSection), [[second], [first, marker]]);
});

test('empty scores retain eligible terminal markers and empty boundary tables have no measures', () => {
  const end = target(0);

  assert.deepEqual(planMeasureEvents([note(0), end], [0], 0, endsSection), [[end]]);
  assert.deepEqual(planMeasureEvents([end], [], 0, endsSection), []);
});
