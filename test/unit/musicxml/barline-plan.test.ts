import type { Moment } from '@sightread/lilypond-eventdocument';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { barlineLayoutPlan } from '../../../src/musicxml/layout/barlines.js';
import type {
  BarlineEvent,
  BarlineLayoutEvent,
  ScoreDocument,
} from '../../../src/model/document.js';

type Event = ScoreDocument['events'][number];
const moment = (main = 1, grace = 0, denominator = 1): Moment => ({
  main: { numerator: main, denominator },
  grace: { numerator: grace, denominator },
});
const initial = (id = 1, staff = 1, at = moment()): BarlineEvent => ({
  kind: 'barline',
  id,
  staff,
  moment: at,
  glyph: ':|.|:',
  hidden: false,
});
const piece = (
  breakDirection: -1 | 0 | 1 = 0,
  glyph = '|',
  hidden = false,
  system = 1,
): BarlineLayoutEvent['pieces'][number] => ({
  system,
  breakDirection,
  glyph,
  hidden,
  custom: false,
});
const row = (
  pieces: BarlineLayoutEvent['pieces'] = [piece()],
  barlineId = 1,
  staff = 1,
  at = moment(),
): BarlineLayoutEvent => ({
  kind: 'barlineLayout',
  barlineId,
  staff,
  moment: at,
  pieces,
});
const stage: Event = {
  kind: 'finalLayout',
  status: 'complete',
  attempted: true,
  failure: null,
  moment: moment(0),
};
const document = (events: Event[]): ScoreDocument => ({
  version: 1,
  source: 'cache.ly',
  lilypondVersion: '2.26.0',
  header: {},
  contexts: [],
  barlineLayoutsCaptured: true,
  events: [stage, ...events],
});

function plan(doc: ScoreDocument) {
  const diagnostics: string[] = [];

  return {
    value: barlineLayoutPlan(doc, (code) => {
      diagnostics.push(code);
    }),
    diagnostics,
  };
}

test('barline planner preserves distinct actual left and right broken repeat pieces without borrowing the other side', () => {
  const { value } = plan(
    document([initial(), row([piece(-1, ':|.', false, 1), piece(1, '.|:', true, 2)])]),
  );

  assert.deepEqual(value.at(moment(), [1], 'right'), {
    status: 'resolved',
    bars: [{ glyph: ':|.', hidden: false, custom: false }],
  });
  assert.deepEqual(value.at(moment(), [1], 'left'), {
    status: 'resolved',
    bars: [{ glyph: '.|:', hidden: true, custom: false }],
  });
  assert.deepEqual(value.at(moment(), [1], 'middle'), {
    status: 'resolved',
    bars: [],
  });
});

test('barline planner joins reduced full Moments but canonicalizes only nonpositive source grace columns', () => {
  const { value } = plan(
    document([initial(1, 1, moment(2, -2, 2)), row([piece()], 1, 1, moment(1, -1))]),
  );

  assert.equal(value.at(moment(4, 0, 4), [1], 'right').status, 'resolved');
  assert.equal(value.at(moment(1, -1), [1], 'right').status, 'unresolved');
  const wrongFull = plan(document([initial(1, 1, moment(1, -1)), row([piece()], 1, 1, moment(1))]));

  assert.equal(wrongFull.value.at(moment(), [1], 'right').status, 'unresolved');
  const positive = plan(
    document([initial(1, 1, moment(1, 1)), row([piece()], 1, 1, moment(1, 1))]),
  );

  assert.equal(positive.value.at(moment(), [1], 'right').status, 'unresolved');
  assert.ok(positive.diagnostics.includes('barline-layout-grace'));
});

test('barline planner confirms absent engraving and requires every part staff to agree', () => {
  assert.deepEqual(plan(document([])).value.at(moment(), [1, 2], 'right'), {
    status: 'resolved',
    bars: [],
  });
  assert.deepEqual(plan(document([initial(), row([])])).value.at(moment(), [1], 'right'), {
    status: 'resolved',
    bars: [],
  });
  const disagree = plan(document([initial(), row(), initial(2, 2), row([piece(0, '||')], 2, 2)]));

  assert.equal(disagree.value.at(moment(), [1, 2], 'right').status, 'unresolved');
  assert.ok(disagree.diagnostics.includes('barline-layout-ownership'));
  const differentGraces = plan(
    document([
      initial(1, 1, moment(4, -1, 4)),
      row([piece()], 1, 1, moment(4, -1, 4)),
      initial(2, 2, moment(8, -1, 8)),
      row([piece()], 2, 2, moment(8, -1, 8)),
    ]),
  );

  assert.equal(differentGraces.value.at(moment(), [1, 2], 'middle').status, 'unresolved');
  assert.ok(differentGraces.diagnostics.includes('barline-layout-ownership'));
  assert.equal(
    plan(document([initial(), row()])).value.at(moment(), [1, 2], 'right').status,
    'unresolved',
  );
  const custom = plan(
    document([initial(), row([{ ...piece(), custom: true }]), initial(2, 2), row([piece()], 2, 2)]),
  );

  assert.equal(custom.value.at(moment(), [1, 2], 'right').bars[0]!.custom, true);
  assert.ok(custom.diagnostics.includes('barline-layout-stencil'));
});

test('barline planner rejects duplicate global IDs, orphan final rows and source-side cache contradictions', () => {
  const invalid = [
    [initial(), initial(1, 2), row(), row([piece()], 1, 2)],
    [initial(), row(), row()],
    [initial(), row([piece(), piece()])],
    [initial(), row([piece(0, '|', false, 1), piece(0, '|', false, 2)])],
    [initial(), row([piece()], 2)],
    [row()],
    [initial()],
    [initial(), row(), initial(2, 1, moment(1, -1)), row([piece()], 2, 1, moment(1, -1))],
    [initial(), row(), initial(1, 2, moment(2)), row([piece()], 1, 2, moment(2))],
  ];

  for (const events of invalid) {
    assert.equal(plan(document(events)).value.at(moment(), [1], 'right').status, 'unresolved');
  }

  const nullable = plan(
    document([initial(), row([{ ...piece(-1), glyph: null }, piece(1, '.|:', false, 2)])]),
  );

  assert.equal(nullable.value.at(moment(), [1], 'right').status, 'unresolved');
  assert.equal(
    nullable.value.at(moment(), [1], 'left').status,
    'resolved',
    'unknown right piece does not erase independently proven left piece',
  );
});

test('barline planner keeps malformed caches unresolved instead of certifying missing ink', () => {
  const malformed = [
    { ...row(), staff: Infinity },
    { ...row(), barlineId: 0 },
    row([{ ...piece(), system: NaN }]),
    row([{ ...piece(), system: 0 }]),
    { ...row(), moment: moment(1, 0, 0) },
    { ...row(), pieces: null },
    { ...row(), pieces: [null] },
    { ...row(), pieces: [{ ...piece(), hidden: 'false' }] },
    { ...row(), pieces: [{ ...piece(), breakDirection: 2 }] },
    { ...row(), pieces: [{ ...piece(), custom: null }] },
  ];

  for (const event of malformed) {
    const { value } = plan(document([initial(), event as BarlineLayoutEvent]));

    assert.equal(value.at(moment(), [1], 'right').status, 'unresolved');
  }

  const value = plan(document([initial(), row()])).value;

  assert.equal(value.at(moment(), [1, 1], 'right').status, 'unresolved');
  assert.equal(value.at(moment(), [], 'right').status, 'unresolved');
});

test('barline planner requires one completed final stage and keeps legacy history distinct from known absence', () => {
  const legacy = document([initial(), row()]);

  delete legacy.barlineLayoutsCaptured;
  const old = plan(legacy);

  assert.equal(old.value.at(moment(), [1], 'right').status, 'legacy');
  assert.ok(old.diagnostics.includes('barline-layout-history'));

  for (const stages of [
    [],
    [stage, stage],
    [{ ...stage, status: 'failed', failure: 'source callback failed' }],
  ]) {
    const doc = document([initial(), row()]);

    doc.events = [...stages, initial(), row()] as Event[];
    const { value, diagnostics } = plan(doc);

    assert.equal(value.at(moment(), [1], 'right').status, 'unresolved');
    assert.ok(diagnostics.includes('barline-layout-capture'));
  }
});
