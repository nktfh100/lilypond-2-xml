import type { Duration, Moment } from '@sightread/lilypond-eventdocument';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { evaluationNotes } from '../../../tools/evaluation/playback.js';
import { musicXmlWrittenNotes } from '../../../tools/evaluation/written.js';
import { toMusicXML } from '../../../src/musicxml/convert.js';
import type { ScoreDocument } from '../../../src/model/document.js';
import { validate } from '../../support/schema.js';
import { elements, parse, texts } from '../../support/xml-support.js';

const at = (numerator: number, denominator = 1): Moment => ({
  main: { numerator, denominator },
  grace: { numerator: 0, denominator: 1 },
});
const length = (log: number, numerator = 1, denominator = 1): Duration => ({
  log,
  dots: 0,
  scale: { numerator, denominator },
});
const note = (
  step: number,
  octave: number,
  moment: Moment,
  duration: Duration,
  voice = 2,
): ScoreDocument['events'][number] => ({
  kind: 'note',
  moment,
  duration,
  voice,
  staff: 1,
  hidden: false,
  slash: false,
  stemHidden: false,
  parenthesized: false,
  mergeDifferentlyHeaded: false,
  mergeDifferentlyDotted: false,
  ignoreCollision: false,
  pitch: { step, octave, alteration: { numerator: 0, denominator: 1 } },
  attachments: [],
});
const document = (events: ScoreDocument['events']): ScoreDocument => ({
  version: 1,
  source: 'rhythm.ly',
  lilypondVersion: '2.26.0',
  header: {},
  contexts: [
    { id: 0, type: 'Score', name: '', parent: null },
    { id: 1, type: 'Staff', name: '', parent: 0 },
    ...[2, 3, 4].map((id) => ({
      id,
      type: 'Voice',
      name: String(id),
      parent: 1,
    })),
  ],
  events,
});
const overlapping = [
  note(4, -1, at(0), length(0)),
  note(5, 0, at(1, 4), length(2), 3),
  note(6, 0, at(1, 2), length(2), 3),
  note(0, 1, at(3, 4), length(2), 3),
  note(2, 0, at(3, 4), length(2)),
  note(1, 0, at(1), length(0), 4),
];
const toolkit = new VerovioToolkit(await createModule());

after(() => toolkit.destroy());

test('overlapping notes move backwards without lengthening this or the following measure', () => {
  const xml = toMusicXML(document(overlapping)).musicxml;

  validate(xml);
  const notes = musicXmlWrittenNotes(xml);

  assert.equal(notes.find((n) => n.pitch === 'E:0:4')!.start, 3);
  assert.equal(notes.find((n) => n.pitch === 'D:0:4')!.start, 4);
});

test('an attribute between overlapping notes receives exactly one backward movement', () => {
  const xml = toMusicXML(
    document([
      ...overlapping,
      {
        kind: 'clef',
        staff: 1,
        moment: at(3, 4),
        glyph: 'clefs.G',
        position: -2,
        transposition: 0,
      },
    ]),
  ).musicxml;

  validate(xml);
  const notes = musicXmlWrittenNotes(xml);

  assert.equal(notes.find((n) => n.pitch === 'E:0:4')!.start, 3);
  assert.equal(notes.find((n) => n.pitch === 'D:0:4')!.start, 4);
});

test('chord members keep the same start while overlapping later notes retain their own start', () => {
  const xml = toMusicXML(document([...overlapping, note(0, 0, at(0), length(0))])).musicxml;

  validate(xml);
  const notes = musicXmlWrittenNotes(xml);

  assert.equal(notes.find((n) => n.pitch === 'C:0:4')!.start, 0);
  assert.equal(notes.find((n) => n.pitch === 'E:0:4')!.start, 3);
});

test('a scaled note and silent span form an invisible complete tuplet with exact reader timing', () => {
  const xml = toMusicXML(
    document([
      note(0, 0, at(0), length(3, 2, 3)),
      {
        kind: 'skip',
        voice: 2,
        staff: 1,
        moment: at(1, 12),
        duration: length(2, 2, 3),
      },
      note(1, 0, at(1, 4), length(2)),
      {
        kind: 'rest',
        voice: 2,
        staff: 1,
        moment: at(1, 2),
        duration: length(1),
      },
    ]),
  ).musicxml;

  validate(xml);
  const parsed = parse(xml);
  const rests = elements(parsed, 'note').filter(
    (n) => elements(n, 'rest').length && n.getAttribute('print-object') === 'no',
  );

  assert.equal(rests.length, 1);
  assert.deepEqual(texts(rests[0], 'type'), ['quarter']);
  assert.deepEqual(texts(rests[0], 'actual-notes'), ['3']);
  const tuplets = elements(parsed, 'tuplet');

  assert.equal(tuplets.length, 2);
  assert.equal(tuplets[0]!.getAttribute('show-number'), 'none');
  assert.equal(tuplets[0]!.getAttribute('bracket'), 'no');
  assert.equal(toolkit.loadData(xml), 1);
  const notes = evaluationNotes(Buffer.from(toolkit.renderToMIDI(), 'base64'));

  assert.deepEqual(
    notes.map((n) => [n.pitch, n.start]),
    [
      [60, 0],
      [62, 1],
    ],
  );
});

test('source tuplet markings remain visible and are not wrapped in invented nested tuplets', () => {
  const span = (moment: Moment, spanDirection: -1 | 1): ScoreDocument['events'][number] => ({
    kind: 'voice',
    class: 'tuplet-span-event',
    moment,
    voice: 2,
    staff: 1,
    spanDirection,
  });
  const xml = toMusicXML(
    document([
      span(at(0), -1),
      note(0, 0, at(0), length(3, 2, 3)),
      note(1, 0, at(1, 12), length(3, 2, 3)),
      note(2, 0, at(1, 6), length(3, 2, 3)),
      span(at(1, 4), 1),
    ]),
  ).musicxml;

  validate(xml);
  const tuplets = elements(parse(xml), 'tuplet');

  assert.equal(tuplets.length, 2);
  assert.equal(tuplets[0]!.getAttribute('show-number'), null);
  assert.equal(tuplets[0]!.getAttribute('bracket'), null);
});

test('quintuplet gaps preserve their scale instead of becoming triplets', () => {
  const xml = toMusicXML(
    document([
      note(0, 0, at(0), length(3, 4, 5)),
      {
        kind: 'skip',
        staff: 1,
        voice: 2,
        moment: at(1, 10),
        duration: length(1, 4, 5),
      },
      note(1, 0, at(1, 2), length(1)),
    ]),
  ).musicxml;

  validate(xml);
  const notes = musicXmlWrittenNotes(xml);

  assert.equal(notes.find((n) => n.pitch === 'D:0:4')!.start, 2);
  assert.ok(texts(parse(xml), 'actual-notes').every((n) => n === '5'));
  assert.equal(toolkit.loadData(xml), 1);
  const played = evaluationNotes(Buffer.from(toolkit.renderToMIDI(), 'base64'));

  assert.deepEqual(
    played.map((n) => [n.pitch, n.start]),
    [
      [60, 0],
      [62, 2],
    ],
  );
});

test('adding hidden tuplet boundaries keeps lyrics in MusicXML schema order', () => {
  const events: ScoreDocument['events'] = [
    note(0, 0, at(0), length(3, 2, 3)),
    {
      kind: 'skip',
      staff: 1,
      voice: 2,
      moment: at(1, 12),
      duration: length(2, 2, 3),
    },
    {
      kind: 'lyric',
      moment: at(0),
      verse: 5,
      voice: 2,
      duration: length(3, 2, 3),
      class: 'lyric-event',
      text: 'word',
    },
  ];
  const xml = toMusicXML(document(events)).musicxml;

  validate(xml);
  assert.deepEqual(texts(parse(xml), 'text'), ['word']);
});

test('a scaled whole-measure skip uses its exact dotted rest length', () => {
  const xml = toMusicXML(
    document([
      {
        kind: 'skip',
        voice: 2,
        staff: 1,
        moment: at(0),
        duration: length(0, 3, 4),
      },
      note(0, 0, at(3, 4), length(2)),
    ]),
  ).musicxml;

  validate(xml);
  const hidden = elements(parse(xml), 'note').find((n) => n.getAttribute('print-object') === 'no')!;

  assert.deepEqual(texts(hidden, 'type'), ['half']);
  assert.equal(elements(hidden, 'dot').length, 1);
  assert.equal(elements(hidden, 'time-modification').length, 0);
  assert.equal(toolkit.loadData(xml), 1);
  assert.deepEqual(
    evaluationNotes(Buffer.from(toolkit.renderToMIDI(), 'base64')).map((n) => [n.pitch, n.start]),
    [[60, 3]],
  );
});

test('an isolated scaled quarter retains its printed type and exact playback length', () => {
  const xml = toMusicXML(
    document([note(0, 0, at(0), length(2, 1, 2)), note(1, 0, at(1, 8), length(3))]),
  ).musicxml;

  validate(xml);
  const parsed = parse(xml);

  assert.deepEqual(texts(elements(parsed, 'note')[0]!, 'type'), ['quarter']);
  assert.equal(elements(parsed, 'tuplet').length, 2);
  assert.equal(elements(parsed, 'tuplet')[0]!.getAttribute('show-number'), 'none');
  assert.equal(musicXmlWrittenNotes(xml)[0]!.duration, 0.5);
  assert.equal(toolkit.loadData(xml), 1);
  assert.deepEqual(
    evaluationNotes(Buffer.from(toolkit.renderToMIDI(), 'base64')).map((n) => [n.pitch, n.start]),
    [
      [60, 0],
      [62, 0.5],
    ],
  );
});

test('an isolated augmented note retains its printed type and exact playback length', () => {
  const xml = toMusicXML(
    document([note(0, 0, at(0), length(3, 3)), note(1, 0, at(3, 8), length(3))]),
  ).musicxml;

  validate(xml);
  assert.deepEqual(texts(elements(parse(xml), 'note')[0]!, 'type'), ['eighth']);
  assert.equal(toolkit.loadData(xml), 1);
  assert.deepEqual(
    evaluationNotes(Buffer.from(toolkit.renderToMIDI(), 'base64')).map((n) => [n.pitch, n.start]),
    [
      [60, 0],
      [62, 1.5],
    ],
  );
});

const tupletSpan = (moment: Moment, spanDirection: -1 | 1): ScoreDocument['events'][number] => ({
  kind: 'voice',
  class: 'tuplet-span-event',
  moment,
  voice: 2,
  staff: 1,
  spanDirection,
});
const shortBars: ScoreDocument['events'] = [0, 1].map((index) => ({
  kind: 'step',
  moment: at(index, 4),
  bar: index + 1,
  position: { numerator: 0, denominator: 1 },
  length: { numerator: 1, denominator: 4 },
  time: { numerator: 1, denominator: 4 },
  timing: true,
}));

test('a cross-measure source tuplet retains its visible span and gains exact reader timing', () => {
  const xml = toMusicXML(
    document([
      ...shortBars,
      tupletSpan(at(0), -1),
      ...Array.from({ length: 6 }, (_, index) => note(index, 0, at(index, 12), length(3, 2, 3))),
      tupletSpan(at(1, 2), 1),
    ]),
  ).musicxml;

  validate(xml);
  const parsed = parse(xml);
  const marks = elements(parsed, 'tuplet');
  const original = marks.filter((mark) => mark.getAttribute('show-number') !== 'none');

  assert.deepEqual(
    original.map((mark) => [
      mark.getAttribute('type'),
      mark.getAttribute('number'),
      mark.getAttribute('bracket'),
    ]),
    [
      ['start', '1', null],
      ['stop', '1', null],
    ],
  );
  assert.equal(
    original[0]!.parentElement!.parentElement!.parentElement!.getAttribute('number'),
    '1',
  );
  assert.equal(
    original[1]!.parentElement!.parentElement!.parentElement!.getAttribute('number'),
    '2',
  );
  assert.equal(marks.length, 4);
  assert.ok(
    marks
      .filter((mark) => mark.getAttribute('show-number') === 'none')
      .every(
        (mark) => mark.getAttribute('bracket') === 'no' && mark.getAttribute('number') !== '1',
      ),
  );
  assert.equal(toolkit.loadData(xml), 1);
  const played = evaluationNotes(Buffer.from(toolkit.renderToMIDI(), 'base64'));

  assert.deepEqual(
    played.map((n) => n.pitch),
    [60, 62, 64, 65, 67, 69],
  );
  assert.ok(played.every((n, index) => Math.abs(n.start - index / 3) <= 1 / 120 + 1e-8));
});

test('nested source tuplets crossing measures receive no additional spans', () => {
  const xml = toMusicXML(
    document([
      ...shortBars,
      tupletSpan(at(0), -1),
      tupletSpan(at(0), -1),
      ...Array.from({ length: 9 }, (_, index) =>
        note(index % 7, 0, at(index, 18), length(3, 4, 9)),
      ),
      tupletSpan(at(1, 2), 1),
      tupletSpan(at(1, 2), 1),
    ]),
  ).musicxml;

  validate(xml);
  assert.ok(
    elements(parse(xml), 'tuplet').every((mark) => mark.getAttribute('show-number') !== 'none'),
  );
});
