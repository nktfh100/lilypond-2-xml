import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { musicXmlWrittenNotes } from '../../../tools/evaluation/written.js';
import { createConverter } from '../../../src/index.js';
import { toMusicXML } from '../../../src/musicxml/convert.js';
import type { ScoreDocument } from '../../../src/model/document.js';
import { validate } from '../../support/schema.js';
import { parse } from '../../support/xml-support.js';

const moment = (at: number, grace = 0) => ({
  main: { numerator: at, denominator: 16 },
  grace: { numerator: grace, denominator: 16 },
});
const duration = (log: number, dots = 0) => ({
  log,
  dots,
  scale: { numerator: 1, denominator: 1 },
});
const note = (
  step: number,
  at: number,
  log: number,
  grace = 0,
  dots = 0,
): ScoreDocument['events'][number] => ({
  kind: 'note',
  voice: 2,
  staff: 1,
  moment: moment(at, grace),
  duration: duration(log, dots),
  pitch: { step, octave: 0, alteration: { numerator: 0, denominator: 1 } },
  attachments: [],
  slash: grace !== 0,
  hidden: false,
  stemHidden: false,
  parenthesized: false,
  mergeDifferentlyHeaded: false,
  mergeDifferentlyDotted: false,
  ignoreCollision: false,
});
const document: ScoreDocument = {
  version: 1,
  source: 'grace-gap.ly',
  lilypondVersion: '2.26.0',
  header: {},
  contexts: [
    { id: 0, type: 'Score', name: '', parent: null },
    { id: 1, type: 'Staff', name: '', parent: 0 },
    { id: 2, type: 'Voice', name: '', parent: 1 },
  ],
  events: [
    ...[0, 12, 24].map((at, index): ScoreDocument['events'][number] => ({
      kind: 'step',
      moment: moment(at),
      bar: index + 1,
      position: { numerator: 0, denominator: 1 },
      length: { numerator: 3, denominator: 4 },
      time: { numerator: 3, denominator: 4 },
      timing: true,
    })),
    {
      kind: 'skip',
      voice: 2,
      staff: 1,
      moment: moment(0),
      duration: duration(2),
    },
    note(1, 4, 4, -2),
    note(2, 4, 4, -1),
    note(3, 4, 2),
    note(5, 4, 2),
    note(4, 8, 2),
    note(5, 12, 4, -1),
    note(6, 12, 1, 0, 1),
    {
      kind: 'skip',
      voice: 2,
      staff: 1,
      moment: moment(24),
      duration: duration(2),
    },
    note(0, 28, 2),
    note(1, 32, 2),
  ],
};
const xml = toMusicXML(document).musicxml;
const notes = musicXmlWrittenNotes(xml);

test('one silent gap before multiple graces advances the cursor exactly once', () => {
  validate(xml);
  assert.deepEqual(
    notes.slice(0, 5).map((note) => [note.pitch, note.start, note.grace]),
    [
      ['D:0:4', 1, -0.5],
      ['E:0:4', 1, -0.25],
      ['F:0:4', 1, 0],
      ['A:0:4', 1, 0],
      ['G:0:4', 2, 0],
    ],
  );
});

test('a grace at the next measure boundary does not inherit an extra preceding gap', () => {
  assert.deepEqual(
    notes.slice(5, 7).map((note) => [note.pitch, note.start, note.grace]),
    [
      ['A:0:4', 3, -0.25],
      ['B:0:4', 3, 0],
    ],
  );
});

test('ordinary gaps without graces retain their exact following note starts', () => {
  assert.deepEqual(
    notes.slice(7).map((note) => [note.pitch, note.start]),
    [
      ['C:0:4', 7],
      ['D:0:4', 8],
    ],
  );
});

test('after-grace notes retain their main-time position inside a sustained note', async () => {
  const converter = createConverter();

  try {
    const score = (await converter.convert(String.raw`{ \afterGrace c'1 { d'16 e' } f'1 }`))
      .scores[0]!;

    validate(score.musicxml);
    const root = parse(score.musicxml);
    const measure = root.getElementsByTagName('measure')[0]!;
    const divisions = Number(measure.getElementsByTagName('divisions')[0]!.textContent);
    let cursor = 0;
    const positions: [string, number][] = [];

    for (const element of Array.from(measure.childNodes).filter(
      (node): node is Element => node?.nodeType === 1,
    )) {
      const length =
        Number(element.getElementsByTagName('duration')[0]?.textContent ?? 0) / divisions;

      if (element.tagName === 'backup') {
        cursor -= length;
      }

      if (element.tagName === 'forward') {
        cursor += length;
      }

      if (element.tagName === 'note') {
        positions.push([element.getElementsByTagName('step')[0]!.textContent!, cursor]);
        cursor += length;
      }
    }

    assert.deepEqual(positions, [
      ['C', 0],
      ['D', 3],
      ['E', 3],
    ]);
    assert.equal(cursor, 4);
    assert.deepEqual(
      score.document.events
        .filter((event) => event.kind === 'note' && event.moment.grace.numerator !== 0)
        .map((event) => (4 * event.moment.main.numerator) / event.moment.main.denominator),
      [3, 3],
    );
  } finally {
    converter.dispose();
  }
});
