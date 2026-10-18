import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMidiAttacks } from '../../../tools/evaluation/midi.js';

const encode = new TextEncoder();
const uint16 = (n: number) => [(n >>> 8) & 255, n & 255];
const uint32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (tag: string, data: readonly number[]) => [
  ...encode.encode(tag),
  ...uint32(data.length),
  ...data,
];
const end = [0, 255, 47, 0];
const smf = (
  tracks: readonly (readonly number[])[],
  format = tracks.length === 1 ? 0 : 1,
  division = 480,
) =>
  new Uint8Array([
    ...chunk('MThd', [...uint16(format), ...uint16(tracks.length), ...uint16(division)]),
    ...tracks.flatMap((track) => chunk('MTrk', track)),
  ]);
const name = (text: string) => [0, 255, 3, encode.encode(text).length, ...encode.encode(text)];

test('SMF channel running status preserves exact ticks, track names, programs and positive attacks', () => {
  const input = smf([
    [
      ...name('Piano'),
      0,
      0xc2,
      40,
      5,
      41,
      0,
      0x92,
      60,
      80,
      127,
      62,
      96,
      0,
      60,
      0,
      0,
      0x82,
      62,
      64,
      0,
      0xa2,
      60,
      4,
      0,
      0xb2,
      7,
      100,
      0,
      0xd2,
      40,
      0,
      0xe2,
      0,
      64,
      3,
      255,
      3,
      0,
      ...end,
    ],
  ]);
  const padded = new Uint8Array(input.length + 9);

  padded.set(input, 4);
  const result = readMidiAttacks(padded.subarray(4, 4 + input.length));

  assert.deepEqual(result, {
    format: 0,
    division: 480,
    tracks: [
      {
        index: 0,
        names: [
          { tick: 0, text: 'Piano' },
          { tick: 135, text: '' },
        ],
        programs: [
          { tick: 0, channel: 2, program: 40 },
          { tick: 5, channel: 2, program: 41 },
        ],
        controls: [{ tick: 132, channel: 2, controller: 7, value: 100 }],
        pitchBends: [{ tick: 132, channel: 2, value: 8192 }],
        attacks: [
          { tick: 5, channel: 2, pitch: 60, velocity: 80, endTick: 132 },
          { tick: 132, channel: 2, pitch: 62, velocity: 96, endTick: 132 },
        ],
      },
    ],
  });
});

test('SMF controls and 14-bit pitch wheels retain channel, running status and independent track timing', () => {
  const result = readMidiAttacks(
    smf([
      [0, 0xb3, 64, 127, 10, 11, 45, 0, 0xe3, 0, 0, 20, 127, 127, 0, 0, 64, ...end],
      [5, 0xb9, 7, 80, 0, 0xe9, 1, 64, ...end],
    ]),
  );

  assert.deepEqual(
    result.tracks.map((t) => t.controls),
    [
      [
        { tick: 0, channel: 3, controller: 64, value: 127 },
        { tick: 10, channel: 3, controller: 11, value: 45 },
      ],
      [{ tick: 5, channel: 9, controller: 7, value: 80 }],
    ],
  );
  assert.deepEqual(
    result.tracks.map((t) => t.pitchBends),
    [
      [
        { tick: 10, channel: 3, value: 0 },
        { tick: 30, channel: 3, value: 16383 },
        { tick: 30, channel: 3, value: 8192 },
      ],
      [{ tick: 5, channel: 9, value: 8193 }],
    ],
  );
  assert.throws(() => readMidiAttacks(smf([[0, 0xe0, 0, 128, ...end]])), /data/);
});

test('format 1 tracks reset running status and retain independent absolute tick sequences', () => {
  const result = readMidiAttacks(
    smf([
      [...name('Tempo'), ...end],
      [...name('First'), 0, 0x90, 60, 80, ...end],
      [0x81, 0, 0x91, 67, 100, ...end],
    ]),
  );

  assert.equal(result.format, 1);
  assert.equal(result.tracks.length, 3);
  assert.deepEqual(
    result.tracks.map((t) => t.attacks),
    [
      [],
      [{ tick: 0, channel: 0, pitch: 60, velocity: 80, endTick: null }],
      [{ tick: 128, channel: 1, pitch: 67, velocity: 100, endTick: null }],
    ],
  );
  assert.throws(
    () =>
      readMidiAttacks(
        smf([
          [0, 0x90, 60, 80, ...end],
          [0, 60, 80, ...end],
        ]),
      ),
    /running status/,
  );
});

test('unknown chunks, extended headers, bounded meta events and UTF8 names remain compatible', () => {
  const header = [...uint16(1), ...uint16(1), ...uint16(96), 23, 42];
  const track = [...name('\ufeff鍵盤'), 0, 255, 0x7f, 4, 255, 128, 0, 1, ...end];
  const input = new Uint8Array([
    ...chunk('MThd', header),
    ...chunk('TEST', [1, 2]),
    ...chunk('MTrk', track),
    ...chunk('TAIL', []),
  ]);
  const result = readMidiAttacks(input);

  assert.equal(result.division, 96);
  assert.deepEqual(result.tracks[0]!.names, [{ tick: 0, text: '\ufeff鍵盤' }]);
});

test('complete and split SysEx packets are bounded and cancel channel running status', () => {
  const result = readMidiAttacks(
    smf([
      [
        0,
        0xf0,
        4,
        0x7e,
        0x7f,
        9,
        0xf7,
        0,
        0xf0,
        2,
        1,
        2,
        10,
        0xf7,
        2,
        3,
        0xf7,
        0,
        0x90,
        60,
        80,
        ...end,
      ],
    ]),
  );

  assert.deepEqual(result.tracks[0]!.attacks, [
    { tick: 10, channel: 0, pitch: 60, velocity: 80, endTick: null },
  ]);

  for (const middle of [
    [0, 255, 1, 0],
    [0, 0xf0, 1, 0xf7],
  ]) {
    assert.throws(
      () => readMidiAttacks(smf([[0, 0x90, 60, 80, ...middle, 0, 61, 90, ...end]])),
      /running status/,
    );
  }
});

test('maximum four-byte delta values accumulate without signed overflow', () => {
  const delta = [255, 255, 255, 127];
  const result = readMidiAttacks(smf([[...delta, 0x90, 60, 80, ...delta, 62, 90, ...end]]));

  assert.deepEqual(
    result.tracks[0]!.attacks.map((a) => a.tick),
    [0x0fffffff, 0x1ffffffe],
  );
});

test('actual Note Off and zero-velocity Note On resolve releases while orphan and missing offs remain distinct', () => {
  const parsed = readMidiAttacks(
    smf([
      [
        0,
        0x80,
        55,
        0,
        0,
        0x90,
        60,
        80,
        10,
        0x80,
        60,
        64,
        0,
        0x90,
        62,
        90,
        15,
        62,
        0,
        0,
        64,
        100,
        ...end,
      ],
    ]),
  );

  assert.deepEqual(parsed.tracks[0]!.attacks, [
    { tick: 0, channel: 0, pitch: 60, velocity: 80, endTick: 10 },
    { tick: 10, channel: 0, pitch: 62, velocity: 90, endTick: 25 },
    { tick: 25, channel: 0, pitch: 64, velocity: 100, endTick: null },
  ]);
});

test('overlapping same-pitch attacks keep the entire active cluster unresolved without FIFO or LIFO guesses', () => {
  const parsed = readMidiAttacks(
    smf([
      [
        0,
        0x90,
        60,
        80,
        10,
        60,
        90,
        5,
        0x80,
        60,
        0,
        5,
        0x90,
        60,
        100,
        5,
        0x80,
        60,
        0,
        5,
        60,
        0,
        5,
        0x90,
        60,
        110,
        5,
        0x80,
        60,
        0,
        ...end,
      ],
    ]),
  );

  assert.deepEqual(
    parsed.tracks[0]!.attacks.map((a) => ({
      tick: a.tick,
      endTick: a.endTick,
    })),
    [
      { tick: 0, endTick: null },
      { tick: 10, endTick: null },
      { tick: 20, endTick: null },
      { tick: 35, endTick: 40 },
    ],
  );
  const missing = readMidiAttacks(
    smf([
      [0, 0x90, 60, 80, 10, 60, 90, 10, 0x80, 60, 0, 10, 0x90, 60, 100, 10, 0x80, 60, 0, ...end],
    ]),
  );

  assert.deepEqual(
    missing.tracks[0]!.attacks.map((a) => a.endTick),
    [null, null, null],
  );
});

test('overlapping attacks retain identical Note Off times without guessing off-event identity', () => {
  for (const secondOnDelta of [0, 5]) {
    const parsed = readMidiAttacks(
      smf([
        [0, 0x90, 60, 80, secondOnDelta, 60, 90, 10 - secondOnDelta, 0x80, 60, 0, 0, 60, 0, ...end],
      ]),
    );

    assert.deepEqual(
      parsed.tracks[0]!.attacks.map((a) => [a.tick, a.endTick]),
      [
        [0, 10],
        [secondOnDelta, 10],
      ],
    );
  }
});

test('a later overlapping attack retains its forced final end while earlier off times remain ambiguous', () => {
  const parsed = readMidiAttacks(
    smf([
      [
        0,
        0x90,
        60,
        80,
        1,
        60,
        90,
        1,
        0x80,
        60,
        0,
        1,
        0x90,
        60,
        100,
        2,
        0x80,
        60,
        0,
        0,
        60,
        0,
        ...end,
      ],
    ]),
  );

  assert.deepEqual(
    parsed.tracks[0]!.attacks.map((a) => [a.tick, a.endTick]),
    [
      [0, null],
      [1, null],
      [3, 5],
    ],
  );
});

test('incomplete busy periods do not infer release times from their currently identical offs', () => {
  const parsed = readMidiAttacks(
    smf([[0, 0x90, 60, 80, 1, 60, 90, 1, 0x80, 60, 0, 1, 0x90, 60, 100, 2, 0x80, 60, 0, ...end]]),
  );

  assert.deepEqual(
    parsed.tracks[0]!.attacks.map((a) => a.endTick),
    [null, null, null],
  );
  const sameTime = readMidiAttacks(smf([[0, 0x90, 60, 80, 0, 60, 90, 10, 0x80, 60, 0, ...end]]));

  assert.deepEqual(
    sameTime.tracks[0]!.attacks.map((a) => a.endTick),
    [null, null],
  );
});

test('unique release times agree with every causal matching of small complete overlapping streams', () => {
  const orders: string[] = [];
  const order = (events: string, ons: number, offs: number) => {
    if (offs === 4) {
      orders.push(events);

      return;
    }

    if (ons < 4) {
      order(events + '+', ons + 1, offs);
    }

    if (offs < ons) {
      order(events + '-', ons, offs + 1);
    }
  };

  order('', 0, 0);

  for (const events of orders) {
    for (let mask = 0; mask < 256; mask++) {
      const ticks: number[] = [],
        track: number[] = [];
      let tick = 0;

      for (let i = 0; i < events.length; i++) {
        const delta = (mask >>> i) & 1;

        tick += delta;
        ticks.push(tick);
        track.push(delta, events[i] === '+' ? 0x90 : 0x80, 60, events[i] === '+' ? 80 : 0);
      }

      const possibilities = Array.from({ length: 4 }, () => new Set<number>());
      const match = (index: number, nextOn: number, active: number[], ends: number[]) => {
        if (index === events.length) {
          ends.forEach((at, i) => possibilities[i]!.add(at));

          return;
        }

        if (events[index] === '+') {
          match(index + 1, nextOn + 1, [...active, nextOn], ends);
        } else {
          for (const id of active) {
            const next = ends.slice();

            next[id] = ticks[index]!;
            match(
              index + 1,
              nextOn,
              active.filter((other) => other !== id),
              next,
            );
          }
        }
      };

      match(0, 0, [], []);
      const expected = possibilities.map((values) => (values.size === 1 ? [...values][0]! : null));
      const actual = readMidiAttacks(smf([[...track, ...end]])).tracks[0]!.attacks.map(
        (a) => a.endTick,
      );

      assert.deepEqual(actual, expected, `${events}, tick mask ${mask}`);
    }
  }
});

test('track and channel boundaries keep identical simultaneous pitches independent', () => {
  const parsed = readMidiAttacks(
    smf([
      [0, 0x90, 60, 80, 0, 0x91, 60, 90, 10, 0x80, 60, 0, 10, 0x81, 60, 0, ...end],
      [0, 0x90, 60, 100, 30, 0x80, 60, 0, ...end],
    ]),
  );

  assert.deepEqual(
    parsed.tracks.map((t) => t.attacks.map((a) => [a.channel, a.endTick])),
    [
      [
        [0, 10],
        [1, 20],
      ],
      [[0, 30]],
    ],
  );
});

test('same-tick release boundaries respect event order and retain zero-duration notes', () => {
  const sequential = readMidiAttacks(
    smf([
      [
        0,
        0x90,
        60,
        80,
        10,
        0x80,
        60,
        0,
        0,
        0x90,
        60,
        90,
        10,
        0x80,
        60,
        0,
        0,
        0x90,
        62,
        100,
        0,
        0x80,
        62,
        0,
        ...end,
      ],
    ]),
  );

  assert.deepEqual(
    sequential.tracks[0]!.attacks.map((a) => [a.tick, a.endTick]),
    [
      [0, 10],
      [10, 20],
      [20, 20],
    ],
  );
  const overlap = readMidiAttacks(
    smf([[0, 0x90, 60, 80, 10, 60, 90, 0, 0x80, 60, 0, 10, 60, 0, ...end]]),
  );

  assert.deepEqual(
    overlap.tracks[0]!.attacks.map((a) => a.endTick),
    [null, null],
  );
});

test('sustain and all-notes-off controllers do not replace actual Note Off timing', () => {
  const parsed = readMidiAttacks(
    smf([
      [
        0,
        0x90,
        60,
        80,
        0,
        0xb0,
        64,
        127,
        10,
        0x80,
        60,
        0,
        10,
        0xb0,
        64,
        0,
        0,
        0x90,
        62,
        90,
        10,
        0xb0,
        123,
        0,
        ...end,
      ],
    ]),
  );

  assert.deepEqual(
    parsed.tracks[0]!.attacks.map((a) => a.endTick),
    [10, null],
  );
});

test('malformed headers, timing modes, track counts and chunk boundaries are rejected', () => {
  const valid = smf([[...end]]);
  const invalid: Uint8Array[] = [
    new Uint8Array(),
    valid.subarray(0, 7),
    valid.subarray(0, 13),
    smf([[...end]], 2),
    smf([[...end]], 0, 0),
    smf([[...end]], 0, 0xe728),
    smf([[...end], [...end]], 0),
    smf([]),
    valid.subarray(0, valid.length - 1),
    new Uint8Array([...chunk('MThd', [0, 1, 0, 1, 0, 96]), ...chunk('JUNK', [])]),
    new Uint8Array([...valid, ...chunk('MTrk', end)]),
    new Uint8Array([...valid, 0]),
    new Uint8Array([...valid, ...chunk('MThd', [0, 0, 0, 1, 0, 96])]),
  ];
  const oversized = valid.slice();

  oversized.set([255, 255, 255, 255], 18);
  invalid.push(oversized);
  const shortHeader = new Uint8Array([...chunk('MThd', [0, 0, 0, 1]), ...chunk('MTrk', end)]);

  invalid.push(shortHeader);

  for (const bytes of invalid) {
    assert.throws(() => readMidiAttacks(bytes), /Invalid MIDI/);
  }
});

test('event boundaries, channel payloads, variable lengths and terminal track markers are checked', () => {
  const tracks = [
    [],
    [0],
    [0, 60, 80],
    [0, 0x90, 60],
    [0, 0x90, 60, 0x80],
    [255, 255, 255, 255, 0, 0x90, 60, 80, ...end],
    [0, 255, 1, 255, 255, 255, 255, 0, ...end],
    [0, 255],
    [0, 255, 128, 0, ...end],
    [0, 255, 1, 5, 1, 2, ...end],
    [0, 0x90, 60, 80],
    [0, 255, 47, 1, 0],
    [...end, 0, 0x90, 60, 80],
    [0, 0xf1, 0, ...end],
    [0, 0xf8, ...end],
    [0, 0xf0, 4, 1, 2],
    [0, 0xf0, 2, 1, 0x90, ...end],
    [0, 0xf0, 2, 0xf7, 0, ...end],
    [0, 0xf0, 1, 1, ...end],
    [0, 0xf0, 1, 1, 0, 0x90, 60, 80, ...end],
    [0, 0xf0, 1, 1, 0, 0xf0, 1, 0xf7, ...end],
    [0, 0xf7, 3, 0x90, 60, 80, ...end],
    [0, 255, 3, 1, 0xff, ...end],
  ];

  for (const track of tracks) {
    assert.throws(() => readMidiAttacks(smf([track])), /Invalid MIDI/);
  }
});

test('every truncated prefix of a valid event stream fails without reading into another track', () => {
  const track = [...name('Bass'), 0, 0xc0, 32, 0, 0x90, 60, 80, 0x81, 0, 0x80, 60, 64, ...end];

  for (let length = 0; length < track.length; length++) {
    assert.throws(() => readMidiAttacks(smf([track.slice(0, length)])), /Invalid MIDI/);
  }

  const crossing = smf([
    [0, 0x90, 60],
    [0, 0x90, 67, 90, ...end],
  ]);

  assert.throws(() => readMidiAttacks(crossing), /truncated/);
});
