import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeDocument } from '../../../src/lilypond/decode/document.js';
import { numeric, rational } from '../../../src/lilypond/decode/values.js';
import type { WireEvent } from '../../../src/lilypond/wire.js';

const document = (events: readonly WireEvent[] = []) => ({
  version: 1,
  source: 'decoder.ly',
  lilypond: '2.26.0',
  header: {},
  contexts: [],
  events,
});
const final: WireEvent = {
  k: 'finallayout',
  m: '1/2',
  g: '0',
  status: 'complete',
  stage: 'book',
  attempted: true,
  failure: null,
};

test('document decoding preserves capture provenance and typed extension moments without a compiler', () => {
  const decoded = decodeDocument({
    ...document([final]),
    'names-captured': true,
    'finger-glides-captured': true,
    'page-credits-captured': true,
    'scripts-captured': false,
    'layout-requested': false,
  });

  assert.equal(decoded.namesCaptured, true);
  assert.equal(decoded.fingerGlidesCaptured, true);
  assert.equal(decoded.pageCreditsCaptured, true);
  assert.equal(decoded.scriptsCaptured, undefined);
  assert.equal(decoded.pageLayoutsCaptured, undefined);
  assert.equal(decoded.layoutRequested, false);
  assert.deepEqual(decoded.events, [
    {
      kind: 'finalLayout',
      moment: {
        main: { numerator: 1, denominator: 2 },
        grace: { numerator: 0, denominator: 1 },
      },
      status: 'complete',
      stage: 'book',
      attempted: true,
      failure: null,
    },
  ]);
});

test('wire failures retain source, event kind, field and original cause', () => {
  let failure: Error | undefined;

  try {
    decodeDocument(document([{ ...final, m: '1/0' }]));
  } catch (error) {
    failure = error as Error;
  }

  assert.ok(failure);
  assert.match(failure.message, /Event 0 in decoder\.ly/);
  assert.ok(failure.cause instanceof Error);
  assert.match(failure.cause.message, /finallayout/);
  assert.ok(failure.cause.cause instanceof Error);
  assert.match(failure.cause.cause.message, /rational field m.*1\/0/);
});

test('collector numbers reject malformed time and nonfinite geometry', () => {
  for (const value of ['', '1/0', '1/-2', '1/2/3', '.5', '9007199254740992']) {
    assert.throws(() => rational(value), TypeError);
  }

  assert.deepEqual(rational('-3/4'), { numerator: -3, denominator: 4 });
  assert.equal(numeric('3/4'), 0.75);
  assert.equal(numeric(0.75), 0.75);
  assert.throws(() => numeric(Infinity), TypeError);
});

test('auxiliary graphics enrich their owner without becoming standalone events', () => {
  const decoded = decodeDocument(
    document([
      {
        k: 'percent',
        m: '0',
        g: '0',
        id: 7,
        v: 1,
        s: 2,
        c: 'percent-event',
        length: '1',
        count: 2,
        slashes: 1,
      },
      {
        k: 'percentgraphic',
        m: '1',
        g: '0',
        id: 7,
        name: 'PercentRepeat',
        text: false,
        hidden: false,
      },
      {
        k: 'figuregraphic',
        m: '0',
        g: '0',
        id: 9,
        row: false,
        hidden: false,
        implicit: false,
      },
      { k: 'figureline', m: '0', g: '0', from: 9, to: 10 },
    ]),
  );

  assert.equal(decoded.events.length, 1);
  const repeat = decoded.events[0];

  assert.equal(repeat?.kind, 'percentRepeat');

  if (repeat?.kind !== 'percentRepeat') {
    assert.fail('Missing percent repeat');
  }

  assert.deepEqual(repeat.graphics, [
    {
      name: 'PercentRepeat',
      text: '',
      hidden: false,
      moment: {
        main: { numerator: 1, denominator: 1 },
        grace: { numerator: 0, denominator: 1 },
      },
    },
  ]);
});

const tieGraphic: Extract<WireEvent, { k: 'tiegraphic' }> = {
  k: 'tiegraphic',
  id: 12,
  v: 3,
  s: 2,
  m: '0',
  g: '0',
  kind: 'normal',
  from: [21],
  to: [22],
  'resolved-start': true,
  'end-m': '1/4',
  'end-g': '0',
  direction: 1,
  color: false,
  offset: [0, 0],
  dash: [],
  'custom-controls': false,
  controls: null,
  'custom-details': false,
  thickness: 1,
  'line-thickness': 1,
  hidden: false,
  custom: false,
  geometry: {
    'tie-id': 12,
    system: 4,
    'from-note-id': 21,
    'to-note-id': 22,
    'from-head-id': 31,
    'to-head-id': 32,
    'from-staff-context': 2,
    'to-staff-context': 2,
    'from-staff-symbol-context': 2,
    'to-staff-symbol-context': 2,
    units: 'lilypond-final-layout-coordinates',
    points: [
      [0, 0],
      [1, 2],
      [2, 2],
      [3, 0],
    ],
    'curve-origin': [0, 0],
    'from-note-origin': [0, 0],
    'to-note-origin': [3, 0],
    'from-staff-top-y': 0,
    'to-staff-top-y': 0,
    'output-scale': 1,
    'layout-staff-space-mm': 1,
    'from-local-staff-space-mm': 1,
    'to-local-staff-space-mm': 1,
    'global-staff-space-mm': 1,
  },
};

function decodingFailure(event: WireEvent): Error {
  try {
    decodeDocument(document([event]));
  } catch (error) {
    assert.ok(error instanceof Error);

    return error;
  }

  assert.fail('Expected malformed wire geometry to fail');
}

test('resolved tie geometry decodes exactly four numeric control points', () => {
  assert.ok(tieGraphic.geometry);
  const points = [
    ['0', '1/2'],
    [1, 2],
    [2, 2],
    [3, 0],
  ] as const;
  const decoded = decodeDocument(
    document([{ ...tieGraphic, geometry: { ...tieGraphic.geometry, points } }]),
  );
  const tie = decoded.events.find((event) => event.kind === 'tieGraphic');

  assert.deepEqual(tie?.resolvedGeometry?.points, [
    [0, 0.5],
    [1, 2],
    [2, 2],
    [3, 0],
  ]);

  for (const invalidPoints of [[], points.slice(0, 3), [...points, [4, 0] as const]]) {
    const failure = decodingFailure({
      ...tieGraphic,
      geometry: { ...tieGraphic.geometry, points: invalidPoints },
    });

    assert.ok(failure.cause instanceof Error && failure.cause.cause instanceof TypeError);
    assert.match(failure.cause.cause.message, /geometry\.points: expected four control points/);
  }
});

test('curve geometry errors identify the event, voice, system and exact coordinate while retaining causes', () => {
  assert.ok(tieGraphic.geometry);
  const failure = decodingFailure({
    ...tieGraphic,
    geometry: {
      ...tieGraphic.geometry,
      points: [
        [0, 0],
        [1, Infinity],
        [2, 2],
        [3, 0],
      ],
    },
  });

  assert.match(failure.message, /Event 0 in decoder\.ly/);
  assert.ok(failure.cause instanceof TypeError);
  assert.match(failure.cause.message, /tiegraphic id=12 voice=3 staff=2 system=4/);
  assert.ok(failure.cause.cause instanceof TypeError);
  assert.match(failure.cause.cause.message, /numeric field geometry\.points\[1\]\[1\]: Infinity/);

  const origin = decodingFailure({
    ...tieGraphic,
    geometry: {
      ...tieGraphic.geometry,
      'from-note-origin': [0, '1/0'],
    },
  });

  assert.ok(origin.cause instanceof Error && origin.cause.cause instanceof TypeError);
  assert.match(origin.cause.cause.message, /rational field geometry\.from-note-origin\[1\]: 1\/0/);
});

test('malformed curve rows report the field row and preserve the shape error', () => {
  const failure = decodingFailure({ ...tieGraphic, controls: [[0, 1], [2]] });

  assert.ok(failure.cause instanceof Error && failure.cause.cause instanceof TypeError);
  assert.match(failure.cause.cause.message, /controls\[1\]: expected two coordinates/);
});

test('nullable geometry coordinate wrappers retain the field and note identity', () => {
  const event = {
    k: 'note-position',
    m: '0',
    g: '0',
    id: 8,
    nid: 21,
    voice: 3,
    s: 2,
    'x-tenths': null,
    'y-tenths': '1/0',
  } as Extract<WireEvent, { k: 'note-position' }>;
  const failure = decodingFailure(event);

  assert.ok(failure.cause instanceof Error && failure.cause.cause instanceof TypeError);
  assert.match(failure.cause.message, /note-position id=8 note=21 voice=3 staff=2/);
  assert.match(failure.cause.cause.message, /rational field y-tenths: 1\/0/);
});

test('slur geometry distinguishes scale fields from coordinate failures', () => {
  assert.ok(tieGraphic.geometry);
  const { geometry, ...common } = tieGraphic;
  const slur: Extract<WireEvent, { k: 'slur' }> = {
    ...common,
    k: 'slur',
    label: '',
    phrasing: false,
    'from-head': true,
    'to-head': true,
    'height-limit': 2,
    ratio: 1,
    geometry: {
      ...geometry,
      'slur-id': 12,
      'staff-context': 2,
      'staff-symbol-context': 2,
      'staff-top-y': 0,
      'local-staff-space-mm': Infinity,
    },
  };
  const failure = decodingFailure(slur);

  assert.ok(failure.cause instanceof Error && failure.cause.cause instanceof TypeError);
  assert.match(failure.cause.message, /slur id=12 voice=3 staff=2 system=4/);
  assert.match(
    failure.cause.cause.message,
    /numeric field geometry\.local-staff-space-mm: Infinity/,
  );
});
