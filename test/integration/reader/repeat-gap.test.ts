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

const moment = (numerator: number, denominator = 1) => ({
  main: { numerator, denominator },
  grace: { numerator: 0, denominator: 1 },
});
const length = (log: number, dots = 0) => ({
  log,
  dots,
  scale: { numerator: 1, denominator: 1 },
});
const note = (
  step: number,
  at: ReturnType<typeof moment>,
  log: number,
  dots = 0,
): ScoreDocument['events'][number] => ({
  kind: 'note',
  voice: 2,
  staff: 1,
  moment: at,
  duration: length(log, dots),
  pitch: { step, octave: 0, alteration: { numerator: 0, denominator: 1 } },
  attachments: [],
  slash: false,
  hidden: false,
  stemHidden: false,
  parenthesized: false,
  mergeDifferentlyHeaded: false,
  mergeDifferentlyDotted: false,
  ignoreCollision: false,
});
const document: ScoreDocument = {
  version: 1,
  source: 'repeat-gap.ly',
  lilypondVersion: '2.26.0',
  header: {},
  contexts: [
    { id: 0, type: 'Score', name: '', parent: null },
    { id: 1, type: 'Staff', name: '', parent: 0 },
    { id: 2, type: 'Voice', name: '', parent: 1 },
  ],
  events: [
    ...Array.from({ length: 5 }, (_, index): ScoreDocument['events'][number] => ({
      kind: 'step',
      moment: moment(index * 3, 4),
      bar: index + 1,
      position: { numerator: 0, denominator: 1 },
      length: { numerator: 3, denominator: 4 },
      time: { numerator: 6, denominator: 8 },
      timing: true,
    })),
    {
      kind: 'score',
      moment: moment(0),
      class: 'volta-repeat-start-event',
      repeatCount: 2,
    },
    note(0, moment(0), 1, 1),
    {
      kind: 'score',
      moment: moment(3, 4),
      class: 'volta-span-event',
      spanDirection: -1,
      voltaNumbers: [1],
      repeatCount: 2,
    },
    note(1, moment(3, 4), 1),
    {
      kind: 'skip',
      voice: 2,
      staff: 1,
      moment: moment(5, 4),
      duration: length(2),
    },
    {
      kind: 'score',
      moment: moment(3, 2),
      class: 'volta-span-event',
      spanDirection: 1,
      voltaNumbers: [1],
      repeatCount: 2,
    },
    {
      kind: 'score',
      moment: moment(3, 2),
      class: 'volta-repeat-end-event',
      alternativeNumber: 1,
    },
    {
      kind: 'score',
      moment: moment(3, 2),
      class: 'volta-span-event',
      spanDirection: -1,
      voltaNumbers: [2],
      repeatCount: 2,
    },
    note(2, moment(3, 2), 1, 1),
    {
      kind: 'score',
      moment: moment(9, 4),
      class: 'volta-span-event',
      spanDirection: 1,
      voltaNumbers: [2],
      repeatCount: 2,
    },
    note(3, moment(9, 4), 1, 1),
  ],
};
const toolkit = new VerovioToolkit(await createModule());

after(() => toolkit.destroy());

test('an ordinary source skip before a repeat retains its complete silent duration', () => {
  const xml = toMusicXML(document).musicxml;

  validate(xml);
  assert.equal(toolkit.loadData(xml), 1);
  const notes = evaluationNotes(Buffer.from(toolkit.renderToMIDI(), 'base64'));

  assert.deepEqual(
    notes.map((note) => [note.pitch, note.start]),
    [
      [60, 0],
      [62, 3],
      [60, 6],
      [64, 9],
      [65, 12],
    ],
  );
  const hidden = elements(parse(xml), 'note').filter(
    (node) => node.getAttribute('print-object') === 'no',
  );

  assert.equal(hidden.length, 1);
  assert.deepEqual(texts(hidden[0], 'type'), ['quarter']);
  assert.equal(elements(hidden[0], 'time-modification').length, 0);
  assert.deepEqual(
    musicXmlWrittenNotes(xml).map((note) => note.start),
    [0, 3, 6, 9],
  );
});

test('an entirely silent source voice retains forward cursors without creating a reader voice', () => {
  const input: ScoreDocument = {
    ...document,
    contexts: [...document.contexts, { id: 3, type: 'Voice', name: 'silent', parent: 1 }],
    events: [
      note(0, moment(0), 2),
      {
        kind: 'skip',
        voice: 3,
        staff: 1,
        moment: moment(0),
        duration: length(1, 1),
      },
    ],
  };
  const xml = toMusicXML(input).musicxml;

  validate(xml);
  const notes = elements(parse(xml), 'note');

  assert.equal(notes.filter((node) => node.getAttribute('print-object') === 'no').length, 0);
  assert.equal(elements(parse(xml), 'forward').length, 2);
});

test('an ordinary internal skip after a scaled note retains its forward cursor', () => {
  const scaled = {
    ...note(0, moment(0), 2),
    duration: { log: 2, dots: 0, scale: { numerator: 1, denominator: 2 } },
  };
  const input: ScoreDocument = {
    ...document,
    events: [
      scaled,
      {
        kind: 'skip',
        voice: 2,
        staff: 1,
        moment: moment(1, 8),
        duration: length(3),
      },
      note(1, moment(1, 4), 2),
    ],
  };
  const xml = toMusicXML(input).musicxml;

  validate(xml);
  assert.equal(
    elements(parse(xml), 'note').filter((node) => node.getAttribute('print-object') === 'no')
      .length,
    0,
  );
  assert.equal(elements(parse(xml), 'forward').length, 1);
  assert.deepEqual(
    musicXmlWrittenNotes(xml).map((note) => [note.start, note.duration]),
    [
      [0, 0.5],
      [1, 1],
    ],
  );
});

test('a clef inside terminal source silence preserves the following repeat onset', () => {
  const xml = toMusicXML({
    ...document,
    events: [
      ...document.events,
      {
        kind: 'clef',
        staff: 1,
        moment: moment(11, 8),
        glyph: 'clefs.F',
        position: 2,
        transposition: 0,
      },
    ],
  }).musicxml;

  validate(xml);
  assert.equal(toolkit.loadData(xml), 1);
  const notes = evaluationNotes(Buffer.from(toolkit.renderToMIDI(), 'base64'));

  assert.deepEqual(
    notes.map((note) => [note.pitch, note.start]),
    [
      [60, 0],
      [62, 3],
      [60, 6],
      [64, 9],
      [65, 12],
    ],
  );
});
