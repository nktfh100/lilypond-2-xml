import type { Moment } from '@sightread/lilypond-eventdocument';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { systemBoundaries } from '../../../src/musicxml/layout/system-boundaries.js';
import type { MeasureLayoutEvent, ScoreDocument } from '../../../src/model/document.js';

const at = (n: number, d = 1, g = 0): Moment => ({
  main: { numerator: n, denominator: d },
  grace: { numerator: g, denominator: 16 },
});
const row = (system = 1, staff = 1, start = system - 1): MeasureLayoutEvent => ({
  kind: 'measureLayout',
  id: system * 100 + staff,
  piece: 1,
  staff,
  system,
  moment: at(start),
  endMoment: at(start + 1),
  columnMoment: at(start),
  endColumnMoment: at(start + 1),
  startXTenths: 10,
  endXTenths: 110,
  widthTenths: 100,
  lineWidthTenths: 120,
  systemLeftXTenths: 10,
  systemRightXTenths: 110,
  layoutStaffSpace: 1,
  firstOnSystem: true,
  lastOnSystem: true,
  startKind: 'measure',
  endKind: 'measure',
});
const document = (rows: readonly MeasureLayoutEvent[]): ScoreDocument => ({
  version: 1,
  source: 'cache.ly',
  lilypondVersion: '2.26.0',
  header: {},
  contexts: [],
  paper: {},
  measureLayoutsCaptured: true,
  events: [
    {
      kind: 'finalLayout',
      moment: at(0),
      status: 'complete',
      stage: 'book',
      attempted: true,
      failure: null,
    },
    ...rows,
  ],
});

function plan(rows: readonly MeasureLayoutEvent[], staffs: readonly number[] = [1]) {
  const warnings: string[] = [];

  return {
    value: systemBoundaries(document(rows), staffs, (code) => warnings.push(code)),
    warnings,
  };
}

test('selects actual midmeasure System LEFT independently of segment width and boundary kinds', () => {
  const first = {
    ...row(2, 1, 0.5),
    endMoment: at(3, 4),
    endColumnMoment: at(3, 4),
    endXTenths: 60,
    widthTenths: 50,
    lastOnSystem: false,
    startKind: 'system' as const,
    endKind: 'system' as const,
  };
  const tail = {
    ...first,
    id: 203,
    moment: at(3, 4),
    columnMoment: at(3, 4),
    endMoment: at(1),
    endColumnMoment: at(1),
    startXTenths: 60,
    endXTenths: 110,
    firstOnSystem: false,
    lastOnSystem: true,
  };
  // Row moments must be exact rationals, not decimal numerators.
  const a = { ...first, moment: at(1, 2), columnMoment: at(1, 2) };
  const b = { ...a, id: 202, staff: 2, columnMoment: at(2, 4) };
  const p = plan([tail, b, a], [1, 2]);

  assert.deepEqual(p.value, [
    {
      system: 2,
      moment: at(1, 2),
      box: { left: 10, right: 110, layoutStaffSpace: 1 },
    },
  ]);
  assert.deepEqual(p.warnings, []);
});

test('sorts actual System identities and accepts rational equality without floating matching', () => {
  const rows = [row(3), row(1), row(2)];

  assert.deepEqual(
    plan(rows).value.map((r) => r.system),
    [1, 2, 3],
  );
  const a = {
    ...row(),
    endMoment: at(1),
    endColumnMoment: at(1),
    moment: at(1, 2),
    columnMoment: at(2, 4),
  };
  const b = {
    ...a,
    id: 102,
    staff: 2,
    moment: at(2, 4),
    columnMoment: at(3, 6),
  };

  assert.equal(plan([a, b], [1, 2]).value.length, 1);
  const near = at(4000000000000001, 8000000000000000);
  const c = { ...b, moment: near, columnMoment: near };
  const mismatch = plan([a, c], [1, 2]);

  assert.equal(mismatch.value.length, 0);
  assert.ok(mismatch.warnings.includes('system-boundary-ownership'));
});

test('requires completed unique book capture and valid native Staff ownership', () => {
  const doc = document([row()]);
  const { measureLayoutsCaptured: _capture, ...legacy } = doc;
  const variants: ScoreDocument[] = [
    {
      ...doc,
      events: doc.events.map((e) => (e.kind === 'finalLayout' ? { ...e, attempted: false } : e)),
    },
    legacy,
    { ...doc, events: [] },
    { ...doc, events: [...doc.events, ...doc.events] },
    {
      ...doc,
      events: doc.events.map((e) =>
        e.kind === 'finalLayout' ? { ...e, status: 'failed' as const } : e,
      ),
    },
    {
      ...doc,
      events: doc.events.map((e) =>
        e.kind === 'finalLayout' ? { ...e, stage: 'score' as const } : e,
      ),
    },
  ];

  for (const v of variants) {
    assert.deepEqual(
      systemBoundaries(v, [1], () => {}),
      [],
    );
  }

  for (const staffs of [[], [1, 1], [0], [NaN]]) {
    assert.deepEqual(plan([row()], staffs).value, []);
  }
});

test('missing or competing LEFT owners omit only their affected System', () => {
  const good = [row(1), row(1, 2), row(3), row(3, 2)];

  assert.deepEqual(
    plan([...good, row(2)], [1, 2]).value.map((r) => r.system),
    [1, 3],
  );
  const duplicate = { ...row(2), id: 299 };

  assert.deepEqual(
    plan([...good, row(2), row(2, 2), duplicate], [1, 2]).value.map((r) => r.system),
    [1, 3],
  );
  assert.deepEqual(
    plan([row(), { ...row(2), id: 101 }, row(3)]).value.map((r) => r.system),
    [3],
  );
});

test('rejects corrupt actual boxes, column references, flags and interior evidence locally', () => {
  const middle = row(2);
  const bad: Partial<MeasureLayoutEvent>[] = [
    { widthTenths: 99 },
    { systemRightXTenths: NaN },
    { layoutStaffSpace: 0 },
    { columnMoment: null },
    { columnMoment: at(9) },
    { endColumnMoment: at(1) },
    { moment: at(1, 0) },
    { firstOnSystem: false },
    { lastOnSystem: false },
    { id: 0 },
    { piece: Infinity },
  ];

  for (const patch of bad) {
    const p = plan([row(), { ...middle, ...patch }, row(3)]);

    assert.deepEqual(
      p.value.map((r) => r.system),
      [1, 3],
      JSON.stringify(patch),
    );
    assert.ok(p.warnings.includes('system-boundary-data'));
  }

  const interior = {
    ...middle,
    id: 299,
    firstOnSystem: false,
    startXTenths: 50,
    widthTenths: 60,
    columnMoment: null,
  };

  assert.deepEqual(
    plan([row(), middle, interior, row(3)]).value.map((r) => r.system),
    [1, 3],
  );
  const conflictingBox = {
    ...middle,
    id: 299,
    moment: at(3, 2),
    columnMoment: at(3, 2),
    startXTenths: 60,
    widthTenths: 50,
    firstOnSystem: false,
    systemLeftXTenths: 11,
  };

  assert.deepEqual(
    plan([row(), middle, conflictingBox, row(3)]).value.map((r) => r.system),
    [1, 3],
  );
  assert.deepEqual(
    plan([row(), middle, { ...middle, id: 299, staff: 9 }, row(3)]).value.map((r) => r.system),
    [1, 3],
  );
});

test("requires every Staff's exact nongrace LEFT Moment and unanimous physical System box", () => {
  const a = row(2),
    b = row(2, 2);

  for (const patch of [
    { moment: at(5, 4), columnMoment: at(5, 4) },
    { systemLeftXTenths: 11, startXTenths: 11, widthTenths: 99 },
    { systemRightXTenths: 111, endXTenths: 111, widthTenths: 101 },
    { layoutStaffSpace: 1.5 },
    { lineWidthTenths: 121 },
  ]) {
    const p = plan([a, { ...b, ...patch }], [1, 2]);

    assert.deepEqual(p.value, []);
    assert.ok(p.warnings.includes('system-boundary-ownership'));
  }

  const grace = plan([row(), { ...a, columnMoment: at(1, 1, 1) }, row(3)]);

  assert.deepEqual(
    grace.value.map((r) => r.system),
    [1, 3],
  );
  assert.ok(grace.warnings.includes('system-boundary-grace'));
});

test('omits all temporal contradiction participants without reordering or losing unrelated Systems', () => {
  const p = plan([row(1), row(2, 1, 2), row(3, 1, 1), row(4)]);

  assert.deepEqual(
    p.value.map((r) => r.system),
    [1, 4],
  );
  assert.ok(p.warnings.includes('system-boundary-order'));
  assert.deepEqual(
    plan([row(1), row(2, 1, 1), row(3, 1, 1), row(4)]).value.map((r) => r.system),
    [1, 4],
  );
});

test('retains exact negative grace LEFT Moments and ordered zero-main source intervals', () => {
  const a = {
    ...row(2),
    columnMoment: at(1, 1, -2),
    endMoment: at(1),
    endColumnMoment: at(1, 1, -1),
    endXTenths: 60,
    widthTenths: 50,
    lastOnSystem: false,
  };
  const tail = {
    ...row(2),
    id: 203,
    columnMoment: at(1, 1, -1),
    startXTenths: 60,
    widthTenths: 50,
    firstOnSystem: false,
  };
  const b = {
    ...a,
    id: 202,
    staff: 2,
    columnMoment: {
      main: { numerator: 2, denominator: 2 },
      grace: { numerator: -1, denominator: 8 },
    },
  };
  const other = { ...tail, id: 204, staff: 2 };
  const p = plan([tail, a, other, b], [1, 2]);

  assert.deepEqual(p.value, [
    {
      system: 2,
      moment: at(1, 1, -2),
      box: { left: 10, right: 110, layoutStaffSpace: 1 },
    },
  ]);
  assert.deepEqual(p.warnings, []);
  const reversed = { ...a, endColumnMoment: at(1, 1, -3) };

  assert.equal(plan([reversed, tail]).value.length, 0);
});
