import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textColumnPositionPlans } from '../../../src/musicxml/layout/text-column-positions.js';
import type {
  FormattedEvent,
  MeasureLayoutEvent,
  PaperSettings,
  ScoreDocument,
  TextColumnPositionEvent,
} from '../../../src/model/document.js';

type TextScript = Extract<FormattedEvent, { kind: 'voice' }> & {
  class: 'text-script-event';
};
type Note = Extract<FormattedEvent, { kind: 'note' }>;

const moment = (n: number, d = 1) => ({
  main: { numerator: n, denominator: d },
  grace: { numerator: 0, denominator: 1 },
});
const attachment = (overrides: Partial<TextScript> = {}): TextScript => ({
  kind: 'voice',
  class: 'text-script-event',
  voice: 8,
  staff: 7,
  moment: moment(1, 2),
  text: 'First Second',
  textColumnId: 41,
  ...overrides,
});
const measure = (overrides: Partial<MeasureLayoutEvent> = {}): MeasureLayoutEvent => ({
  kind: 'measureLayout',
  id: 3,
  piece: 1,
  staff: 7,
  system: 2,
  moment: moment(0),
  endMoment: moment(1),
  columnMoment: moment(0),
  endColumnMoment: moment(1),
  startXTenths: 92,
  endXTenths: 230,
  widthTenths: 138,
  lineWidthTenths: 138,
  systemLeftXTenths: 80,
  systemRightXTenths: 230,
  layoutStaffSpace: 1,
  firstOnSystem: false,
  lastOnSystem: true,
  startKind: 'measure',
  endKind: 'measure',
  ...overrides,
});
const sidecar = (overrides: Partial<TextColumnPositionEvent> = {}): TextColumnPositionEvent => ({
  kind: 'textColumnPosition',
  id: 41,
  context: 8,
  staffContext: 7,
  system: 2,
  moment: moment(1, 2),
  units: 'system-left/staff-top-global-tenths',
  systemLeftOriginXTenths: 80,
  outputScale: 1.757299,
  globalLayoutStaffSpace: 1,
  globalStaffSpaceMm: 1.757299,
  lines: [
    {
      index: 0,
      text: 'First',
      systemLeftRelativeXTenths: 3,
      staffTopYTenths: 11,
    },
    {
      index: 1,
      text: 'Second',
      systemLeftRelativeXTenths: 4,
      staffTopYTenths: -2,
    },
  ],
  ...overrides,
});
const doc = (
  extra: {
    attachment?: TextScript;
    sidecar?: TextColumnPositionEvent;
    measure?: MeasureLayoutEvent;
    duplicate?: boolean;
    paper?: Partial<PaperSettings>;
  } = {},
): ScoreDocument => ({
  version: 1,
  source: 'text-columns.ly',
  lilypondVersion: '2.26.0',
  header: {},
  contexts: [],
  measureLayoutsCaptured: true,
  paper: { 'staff-space': 1.757299, ...extra.paper },
  events: [
    extra.attachment ?? attachment(),
    extra.measure ?? measure(),
    extra.sidecar ?? sidecar(),
    ...(extra.duplicate ? [sidecar()] : []),
  ],
});
const run = (input: ScoreDocument) => {
  const warnings: string[] = [];
  const plans = textColumnPositionPlans(input, (code) => {
    if (!warnings.includes(code)) {
      warnings.push(code);
    }
  });

  return { plans, warnings };
};

test('line positions combine actual System-left origin and measure start exactly once', () => {
  const { plans, warnings } = run(doc());

  assert.deepEqual(plans.get(41)?.lines, [
    { text: 'First', 'default-x': 80 + 3 - 92, 'default-y': 11 },
    { text: 'Second', 'default-x': 80 + 4 - 92, 'default-y': -2 },
  ]);
  assert.deepEqual(warnings, []);
});

const note = (attachments: Note['attachments']): Note => ({
  kind: 'note',
  voice: 8,
  staff: 7,
  moment: moment(1, 2),
  duration: null,
  slash: false,
  hidden: false,
  stemHidden: false,
  parenthesized: false,
  mergeDifferentlyHeaded: false,
  mergeDifferentlyDotted: false,
  ignoreCollision: false,
  attachments,
});

test('late geometry binds through a nested original note attachment', () => {
  const nested = note([{ class: 'text-script-event', text: 'First Second', textColumnId: 41 }]);
  const input = doc();
  const { plans, warnings } = run({
    ...input,
    events: [nested, ...input.events.slice(1)],
  });

  assert.equal(plans.get(41)?.lines.length, 2);
  assert.deepEqual(warnings, []);
});

test("text nested inside another attachment inherits the note's voice, staff and moment", () => {
  const nested = note([
    {
      class: 'breathing-event',
      attachments: [{ class: 'text-script-event', text: 'First Second', textColumnId: 41 }],
    },
  ]);
  const input = doc();
  const { plans, warnings } = run({
    ...input,
    events: [nested, ...input.events.slice(1)],
  });

  assert.deepEqual(plans.get(41)?.lines, [
    { text: 'First', 'default-x': 80 + 3 - 92, 'default-y': 11 },
    { text: 'Second', 'default-x': 80 + 4 - 92, 'default-y': -2 },
  ]);
  assert.deepEqual(warnings, []);
});

test('duplicate IDs, wrong staff/system/Moment, bad scale, and malformed lines fail closed', () => {
  const cases = [
    doc({ duplicate: true }),
    doc({ attachment: attachment({ staff: 9 }) }),
    doc({ sidecar: sidecar({ system: 1 }) }),
    doc({ sidecar: sidecar({ moment: moment(3, 4) }) }),
    doc({ sidecar: sidecar({ globalStaffSpaceMm: 2 }) }),
    doc({
      sidecar: sidecar({
        lines: [
          {
            index: 1,
            text: 'bad',
            systemLeftRelativeXTenths: NaN,
            staffTopYTenths: 0,
          },
        ],
      }),
    }),
    doc({ measure: measure({ system: 3 }) }),
  ];

  for (const input of cases) {
    const { plans, warnings } = run(input);

    assert.equal(plans.size, 0);
    assert.deepEqual(warnings, ['text-column-position']);
  }
});

test('a missing sidecar retains the legacy direction and reports unavailable geometry', () => {
  const input = doc();
  const events = input.events.filter((event) => event.kind !== 'textColumnPosition');
  const { plans, warnings } = run({ ...input, events });

  assert.equal(plans.size, 0);
  assert.deepEqual(warnings, ['text-column-position']);
});
