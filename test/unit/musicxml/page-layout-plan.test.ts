import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageLayoutPlan } from '../../../src/musicxml/layout/page-layout.js';
import { planStaffLines, type StaffLinePlan } from '../../../src/musicxml/layout/staff-lines.js';
import type { PageSystemLayout, ScoreDocument } from '../../../src/model/document.js';
const stave = (staff = 1, baselineY = 30): PageSystemLayout['staves'][number] => ({
  staff,
  baselineY,
  staffSpace: 1,
  layoutStaffSpace: 1,
  linePositions: [-4, -2, 0, 2, 4],
  hidden: false,
  custom: false,
  present: true,
});
const row = (system = 1, page = 1): PageSystemLayout => ({
  book: 1,
  bookpart: 0,
  scope: 1,
  page,
  displayedPage: page + 16,
  system,
  outputScale: 2,
  width: 100,
  height: 150,
  topMargin: 10,
  bottomMargin: 12,
  leftMargin: 8,
  rightMargin: 9,
  systemX: 12,
  systemY: 25,
  staves: [stave()],
});
const document = (rows: readonly PageSystemLayout[]): ScoreDocument => ({
  version: 1,
  source: 'cache.ly',
  lilypondVersion: '2.26.0',
  header: {},
  contexts: [],
  paper: { 'staff-space': 2 },
  pageLayoutsCaptured: true,
  pageLayouts: rows,
  events: [
    {
      kind: 'finalLayout',
      status: 'complete',
      stage: 'book',
      attempted: true,
      failure: null,
      moment: {
        main: { numerator: 0, denominator: 1 },
        grace: { numerator: 0, denominator: 1 },
      },
    },
  ],
});
const standard = planStaffLines({
  count: 5,
  positions: [-4, -2, 0, 2, 4],
  staffSpace: 1,
  layoutStaffSpace: 1,
});

function plan(
  doc: ScoreDocument,
  staffs = [1],
  gridForSystem: (_staff: number, _system: number) => StaffLinePlan | null = () => standard,
) {
  const warnings: string[] = [];

  return {
    value: pageLayoutPlan(
      doc,
      staffs,
      (code) => {
        warnings.push(code);
      },
      { gridForSystem },
    ),
    warnings,
  };
}

test('page planner converts actual physical baselines and page/System origins without treating margins as System X', () => {
  const { value } = plan(document([row()]));
  const f = value.at(1)!;

  assert.deepEqual(f.page, {
    width: 1000,
    height: 1500,
    top: 100,
    bottom: 120,
    left: 80,
    right: 90,
  });
  assert.equal(f.topSystemDistance, 180);
  assert.equal(f.systemDistance, null);
  assert.deepEqual(f.systemMargins(15, 750, 1), { left: 55, right: 40 });
  assert.deepEqual(f.attrs, { 'new-page': 'yes', 'page-number': 17 });
  assert.equal(f.nativePage, 1);
});
test('page planner uses native logical grids rather than sparse visible extrema, retaining hidden staff spacing', () => {
  const a = { ...stave(), linePositions: [0, 2, 4], hidden: true };
  const b = { ...stave(2, 45), linePositions: [-8, 0, 4], staffSpace: 0.7 };
  const r = { ...row(), staves: [a, b] };
  const grids = [
    planStaffLines({
      count: 3,
      positions: a.linePositions,
      staffSpace: 1,
      layoutStaffSpace: 1,
      hidden: true,
    }),
    planStaffLines({
      count: 3,
      positions: b.linePositions,
      staffSpace: 0.7,
      layoutStaffSpace: 1,
    }),
  ];
  const f = plan(document([r]), [1, 2], (s) => grids[s - 1]!).value.at(1)!;

  assert.equal(f.topSystemDistance, 180);
  assert.equal(f.staffDistances.get(2), 102);

  for (const inkOffset of [[7, 30] as const, null]) {
    const changed = plan(
      document([{ ...row(), staves: [{ ...stave(), custom: true, inkOffset }] }]),
    );

    assert.equal(changed.value.at(1)!.topSystemDistance, 180);
    assert.ok(changed.warnings.includes('page-layout-staff-ink'));
  }

  const plain = plan(document([{ ...row(), staves: [{ ...stave(), inkOffset: [0, 0] }] }]));

  assert.equal(plain.value.at(1)!.topSystemDistance, 180);
  assert.ok(!plain.warnings.includes('page-layout-staff-ink'));
});
test('page planner measures later systems from prior logical bottom and resets top distance on actual page changes', () => {
  const rows = [row(), { ...row(2), staves: [stave(1, 60)] }, row(3, 2)];
  const { value } = plan(document(rows));

  assert.equal(value.at(2)!.systemDistance, 260);
  assert.equal(value.at(2)!.topSystemDistance, null);
  assert.deepEqual(value.at(2)!.attrs, {
    'new-page': 'no',
    'new-system': 'yes',
  });
  assert.equal(value.at(3)!.systemDistance, null);
  assert.equal(value.at(3)!.topSystemDistance, 180);
  assert.equal(value.at(3)!.nativePage, 2);
  const missing = plan(document(rows), [1], (_staff, system) =>
    system === 1 ? null : standard,
  ).value;

  assert.equal(missing.at(2)!.systemDistance, null);
});
test('page planner requires completed book capture and unique monotonic source page ownership', () => {
  const doc = document([row()]);

  for (const changed of [
    { ...doc, pageLayoutsCaptured: false },
    { ...doc, events: [] },
    { ...doc, events: [...doc.events, ...doc.events] },
    {
      ...doc,
      events: doc.events.map((e) =>
        e.kind === 'finalLayout' ? { ...e, stage: 'score' as const } : e,
      ),
    },
  ]) {
    assert.equal(plan(changed).value.at(1), null);
  }

  for (const rows of [
    [row(2)],
    [row(), row(3)],
    [row(), row()],
    [row(2), row(1)],
    [row(), { ...row(2), scope: 2 }],
    [row(), { ...row(2), width: 101 }],
    [row(1, 2), row(2, 1)],
  ]) {
    const p = plan(document(rows));

    assert.equal(p.value.at(1), null);
    assert.ok(p.warnings.includes('page-layout-ownership'));
  }
});
test('page planner does not invent missing, duplicate or incompatible staff frames but retains pagination', () => {
  const r = row();
  const cases = [
    [],
    [{ ...stave(), present: false }],
    [{ ...stave(), baselineY: null }],
    [{ ...stave(), hidden: null }],
    [stave(), stave()],
    [{ ...stave(), linePositions: [-8, 0, 8] }],
  ];

  for (const staves of cases) {
    const p = plan(document([{ ...r, staves }])).value.at(1)!;

    assert.equal(p.topSystemDistance, null);
    assert.equal(p.staffDistances.size, 0);
    assert.equal(p.attrs['new-page'], 'yes');
  }

  assert.equal(
    plan(document([r]), [1], () => ({
      ...standard,
      represented: false,
    })).value.at(1)!.topSystemDistance,
    null,
  );
  assert.equal(
    plan(document([r]), [1], () => ({ ...standard, legacy: true })).value.at(1)!.topSystemDistance,
    null,
  );
});
test('page planner scales score-only staff sizes in the physical global frame and abstains from unproven horizontal units', () => {
  const r = {
    ...row(),
    outputScale: 2,
    staves: [{ ...stave(), staffSpace: 1.5, layoutStaffSpace: 1.5 }],
  };
  const doc = { ...document([r]), paper: { 'staff-space': 3 } };
  const p = plan(doc).value.at(1)!;

  assert.ok(Math.abs(p.topSystemDistance! - (((30 - 10) * 20) / 3 - 20)) < 1e-9);
  const margins = p.systemMargins(15, 500, 1.5)!;

  assert.ok(Math.abs(margins.left - ((12 * 20) / 3 + 15 - (8 * 20) / 3)) < 1e-9);
  assert.ok(
    Math.abs(margins.right - ((100 * 20) / 3 - (9 * 20) / 3 - ((12 * 20) / 3 + 500))) < 1e-9,
  );
  const w = plan(document([row()]));

  assert.equal(w.value.at(1)!.systemMargins(0, 500, 2), null);
  assert.ok(w.warnings.includes('page-layout-horizontal'));
});
test('page planner renumbers standalone pages independently of displayed labels without inventing blank pages or inherited distances', () => {
  const rows = [
    { ...row(1, 3), displayedPage: 17 },
    { ...row(2, 5), displayedPage: 2, staves: [] },
  ];
  const p = plan(document(rows));

  assert.equal(p.value.at(1)!.nativePage, 1);
  assert.equal(p.value.at(2)!.nativePage, 2);
  assert.equal(p.value.at(2)!.attrs['page-number'], 2);
  assert.equal(p.value.at(2)!.topSystemDistance, null);
  assert.ok(p.warnings.includes('page-layout-content'));
  const reset = plan(document([]));

  assert.equal(reset.value.at(1), null);
});

test('page planner preserves independently known outer frames and adjacent pairs without bridging a missing or duplicate middle staff', () => {
  const staves = [stave(1, 30), stave(3, 70), stave(4, 90)];
  const rows = [
    { ...row(), staves },
    {
      ...row(2),
      staves: [stave(1, 120), stave(2, 140), stave(3, 160), stave(4, 180)],
    },
  ];
  const p = plan(document(rows), [1, 2, 3, 4]).value;

  assert.equal(p.at(1)!.topSystemDistance, 180);
  assert.deepEqual([...p.at(1)!.staffDistances], [[4, 160]]);
  assert.equal(p.at(2)!.systemDistance, 260);
  const duplicate = plan(
    document([{ ...row(), staves: [...staves, stave(2, 50), stave(2, 51)] }]),
    [1, 2, 3, 4],
  ).value.at(1)!;

  assert.equal(duplicate.topSystemDistance, 180);
  assert.deepEqual([...duplicate.staffDistances], [[4, 160]]);
  const noFirst = plan(
    document([{ ...row(), staves: [stave(2, 50), stave(3, 70), stave(4, 90)] }]),
    [1, 2, 3, 4],
  ).value.at(1)!;

  assert.equal(noFirst.topSystemDistance, null);
  assert.deepEqual(
    [...noFirst.staffDistances],
    [
      [3, 160],
      [4, 160],
    ],
  );
  const noLast = plan(
    document([{ ...row(), staves: [stave(1, 30), stave(2, 50), stave(3, 70)] }, rows[1]!]),
    [1, 2, 3, 4],
  ).value;

  assert.equal(noLast.at(2)!.systemDistance, null);
});

test('page planner rejects malformed custom provenance and nonfinite converted cache results without throwing or erasing independent fields', () => {
  const invalidCustom = stave();

  Reflect.set(invalidCustom, 'custom', null);
  const p = plan(
    document([{ ...row(), staves: [invalidCustom, stave(2, 50), stave(3, 70)] }]),
    [1, 2, 3],
  ).value.at(1)!;

  assert.equal(p.topSystemDistance, null);
  assert.deepEqual([...p.staffDistances], [[3, 160]]);
  const factor = plan(document([{ ...row(), outputScale: 1e308 }])).value.at(1)!;

  assert.equal(factor.page, null);
  assert.equal(factor.topSystemDistance, null);
  assert.equal(factor.systemMargins(0, 100, 1), null);
  const page = plan(document([{ ...row(), width: 1e308 }])).value.at(1)!;

  assert.equal(page.page, null);
  const baseline = plan(document([{ ...row(), staves: [stave(1, 1e308)] }])).value.at(1)!;

  assert.equal(baseline.topSystemDistance, null);
  const margins = plan(document([{ ...row(), systemX: 1e308 }])).value.at(1)!;

  assert.equal(margins.systemMargins(0, 100, 1), null);
  const signed = plan(document([{ ...row(), leftMargin: -2, topMargin: -3 }])).value.at(1)!;

  assert.equal(signed.page!.left, -20);
  assert.equal(signed.topSystemDistance, 310);
});

const at = (main = 0, grace = 0, denominator = 1) => ({
  main: { numerator: main, denominator },
  grace: { numerator: grace, denominator },
});
const member = (
  originalId = 1,
  piece = 1,
  startMoment = at(0),
  endMoment = at(1),
): PageSystemLayout['staves'][number] => ({
  ...stave(),
  originalId,
  piece,
  startMoment,
  endMoment,
});

test('page planner requires consensus of every actual segment while allowing hidden/custom drawing and different sparse subsets', () => {
  const first = member(1, 1, at(0), at(1, 0, 4));
  const second = {
    ...member(2, 1, at(1, 0, 2), at(1)),
    hidden: true,
    custom: true,
    inkOffset: [0, 2] as const,
    linePositions: [-4, 0, 4],
  };
  const p = plan(document([{ ...row(), staves: [first, second, stave(2, 50)] }]), [1, 2]);

  assert.equal(p.value.at(1)!.topSystemDistance, 180);
  assert.deepEqual([...p.value.at(1)!.staffDistances], [[2, 160]]);
  assert.ok(p.warnings.includes('page-layout-staff-ink'));
  assert.ok(!p.warnings.includes('page-layout-staves'));
  assert.equal(
    plan(document([{ ...row(), staves: [second, first] }])).value.at(1)!.topSystemDistance,
    180,
  );
  const cached = JSON.parse(
    JSON.stringify(document([{ ...row(), staves: [first, second] }])),
  ) as ScoreDocument;

  assert.equal(plan(cached).value.at(1)!.topSystemDistance, 180);
  const overlap = plan(
    document([
      {
        ...row(),
        staves: [member(1, 1, at(0), at(3, 0, 4)), member(2, 1, at(1, 0, 2), at(1))],
      },
    ]),
  );

  assert.equal(overlap.value.at(1)!.topSystemDistance, 180);
  assert.ok(overlap.warnings.includes('page-layout-piece-overlap'));
  const adjacent = plan(
    document([
      {
        ...row(),
        staves: [member(1, 1, at(0), at(1, 0, 2)), member(2, 1, at(2, 0, 4), at(1))],
      },
    ]),
  );

  assert.equal(adjacent.value.at(1)!.topSystemDistance, 180);
  assert.ok(!adjacent.warnings.includes('page-layout-piece-overlap'));
});
test('page planner retains actual original ownership across Systems but rejects duplicate member identities and cross-staff originals', () => {
  const rows = [
    { ...row(), staves: [member(1, 1, at(0), at(1))] },
    { ...row(2), staves: [{ ...member(1, 2, at(1), at(2)), baselineY: 60 }] },
  ];
  const p = plan(document(rows));

  assert.equal(p.value.at(2)!.systemDistance, 260);
  const duplicate = plan(
    document([rows[0]!, { ...rows[1]!, staves: [{ ...rows[1]!.staves[0]!, piece: 1 }] }]),
  );

  assert.equal(duplicate.value.at(1)!.topSystemDistance, null);
  assert.equal(duplicate.value.at(2)!.systemDistance, null);
  assert.ok(duplicate.warnings.includes('page-layout-piece-ownership'));
  const cross = plan(
    document([
      {
        ...row(),
        staves: [member(), { ...member(), staff: 2, baselineY: 50 }, stave(3, 70), stave(4, 90)],
      },
    ]),
    [1, 2, 3, 4],
  );

  assert.equal(cross.value.at(1)!.topSystemDistance, null);
  assert.deepEqual([...cross.value.at(1)!.staffDistances], [[4, 160]]);
  assert.ok(cross.warnings.includes('page-layout-piece-ownership'));
});
test('page planner preserves legacy singletons but cannot promote duplicate or partially identified cache rows', () => {
  assert.equal(plan(document([row()])).value.at(1)!.topSystemDistance, 180);
  const { piece: _missingPiece, ...withoutPiece } = member();
  const cases = [
    [stave(), stave()],
    [member(), stave()],
    [withoutPiece],
    [{ ...member(), originalId: 0 }],
    [{ ...member(), piece: 1.5 }],
  ];

  for (const staves of cases) {
    const p = plan(document([{ ...row(), staves }]));

    assert.equal(p.value.at(1)!.topSystemDistance, null);
    assert.ok(
      p.warnings.some(
        (c) => c === 'page-layout-piece-ownership' || c === 'page-layout-piece-history',
      ),
    );
  }
});
test('page planner validates actual reduced full bound Moments without guessing null or reversed segment spans', () => {
  const first = member(1, 1, at(0), at(0, -2, 4));
  const second = member(2, 1, at(0, -1, 2), at(2, 0, 2));

  // Negative grace precedes the ordinary onset, so the deliberately reversed first interval cannot own geometry.
  assert.equal(
    plan(document([{ ...row(), staves: [first, second] }])).value.at(1)!.topSystemDistance,
    null,
  );
  const ordered = { ...first, startMoment: at(0, -1), endMoment: at(0, -2, 4) };

  assert.equal(
    plan(document([{ ...row(), staves: [ordered, second] }])).value.at(1)!.topSystemDistance,
    180,
  );

  for (const changed of [
    { startMoment: null },
    { endMoment: null },
    { endMoment: at(0, -2) },
    { startMoment: at(0, 0, 0) },
  ]) {
    const p = plan(document([{ ...row(), staves: [{ ...ordered, ...changed }, second] }]));

    assert.equal(p.value.at(1)!.topSystemDistance, null);
    assert.ok(p.warnings.includes('page-layout-piece-bounds'));
  }
});
test('page planner cannot ignore a contradictory or unresolved segment in favor of a convenient valid frame', () => {
  for (const changed of [
    { baselineY: null },
    { baselineY: 31 },
    { staffSpace: 0.7 },
    { layoutStaffSpace: 0.7 },
    { linePositions: [-8, 0, 8] },
    { custom: null },
  ]) {
    const second = {
      ...member(2),
      ...changed,
    } as PageSystemLayout['staves'][number];
    const p = plan(
      document([{ ...row(), staves: [member(), second, stave(2, 50), stave(3, 70)] }]),
      [1, 2, 3],
    );

    assert.equal(p.value.at(1)!.topSystemDistance, null);
    assert.deepEqual([...p.value.at(1)!.staffDistances], [[3, 160]]);
    assert.ok(p.warnings.includes('page-layout-staff-consensus'));
  }

  // Adjacent near-equalities must not drift into accepting disagreeing endpoints.
  const chain = [
    member(1),
    { ...member(2), baselineY: 30.000002 },
    { ...member(3), baselineY: 30.000004 },
  ];

  assert.equal(plan(document([{ ...row(), staves: chain }])).value.at(1)!.topSystemDistance, null);
  assert.equal(
    plan(document([{ ...row(), staves: [chain[1]!, chain[0]!, chain[2]!] }])).value.at(1)!
      .topSystemDistance,
    null,
  );
});

test('active Systems measure vertical gaps from the previous emitted logical bottom', () => {
  const rows = [
    row(),
    { ...row(2), staves: [stave(1, 60)] },
    { ...row(3), staves: [stave(1, 90)] },
  ];
  const warnings: string[] = [];
  const p = pageLayoutPlan(document(rows), [1], (c) => warnings.push(c), {
    gridForSystem: () => standard,
    activeSystems: new Set([1, 3]),
  });

  assert.equal(p.at(2), null);
  assert.equal(p.at(1)!.firstOnPage, true);
  assert.equal(p.at(3)!.firstOnPage, false);
  // System 1 bottom=320, System 3 top=880 global tenths; omitted System 2 bottom=620.
  assert.equal(p.at(3)!.systemDistance, 560);
  assert.equal(p.at(3)!.topSystemDistance, null);
  assert.equal(p.at(3)!.nativePage, 1);
  assert.deepEqual(p.at(3)!.attrs, { 'new-page': 'no', 'new-system': 'yes' });
  assert.ok(!warnings.includes('page-layout-ownership'));
});

test('first emitted System owns its page start and native page ordinals omit unmapped source pages', () => {
  const rows = [
    row(),
    row(2, 2),
    { ...row(3, 2), staves: [stave(1, 60)] },
    row(4, 3),
    { ...row(5, 4), staves: [stave(1, 45)] },
  ];
  const warnings: string[] = [];
  const p = pageLayoutPlan(document(rows), [1], (c) => warnings.push(c), {
    gridForSystem: () => standard,
    activeSystems: new Set([3, 5]),
  });

  for (const system of [1, 2, 4]) {
    assert.equal(p.at(system), null);
  }

  const first = p.at(3)!,
    second = p.at(5)!;

  assert.equal(first.firstOnPage, true);
  assert.equal(first.nativePage, 1);
  assert.equal(first.topSystemDistance, 480);
  assert.equal(first.systemDistance, null);
  assert.deepEqual(first.attrs, { 'new-page': 'yes', 'page-number': 18 });
  assert.equal(second.firstOnPage, true);
  assert.equal(second.nativePage, 2);
  assert.equal(second.topSystemDistance, 330);
  assert.equal(second.systemDistance, null);
  assert.deepEqual(second.attrs, { 'new-page': 'yes', 'page-number': 20 });
  assert.ok(warnings.includes('page-layout-content'));
  const empty = pageLayoutPlan(document(rows), [1], () => {}, {
    gridForSystem: () => standard,
    activeSystems: new Set(),
  });

  for (const r of rows) {
    assert.equal(empty.at(r.system), null);
  }
});

test('active filtering cannot hide omitted ownership or conflicting physical page evidence', () => {
  const badRows = [
    [row(), { ...row(2), scope: 2 }, row(3)],
    [row(), row(2), { ...row(3), system: 2 }],
    [row(), { ...row(2), width: 101 }, row(3)],
    [row(), { ...row(2), displayedPage: 99 }, row(3)],
    [row(), { ...row(2), outputScale: 3 }, row(3)],
  ];

  for (const rows of badRows) {
    const warnings: string[] = [];
    const p = pageLayoutPlan(document(rows), [1], (c) => warnings.push(c), {
      gridForSystem: () => standard,
      activeSystems: new Set([1, 3]),
    });

    assert.equal(p.at(1), null);
    assert.equal(p.at(3), null);
    assert.ok(warnings.includes('page-layout-ownership'));
  }
});
