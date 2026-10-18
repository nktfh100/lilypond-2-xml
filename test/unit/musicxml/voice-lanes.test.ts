import assert from 'node:assert/strict';
import { test } from 'node:test';
import { musicXmlWrittenNotes } from '../../../tools/evaluation/written.js';
import { toMusicXML } from '../../../src/musicxml/convert.js';
import type { ScoreDocument } from '../../../src/model/document.js';
import { validate } from '../../support/schema.js';
import { elements, parse, texts } from '../../support/xml-support.js';

const moment = (at: number) => ({
  main: { numerator: at, denominator: 1 },
  grace: { numerator: 0, denominator: 1 },
});
const note = (voice: number, at: number, staff = 1): ScoreDocument['events'][number] => ({
  kind: 'note',
  voice,
  staff,
  moment: moment(at),
  duration: { log: 2, dots: 0, scale: { numerator: 1, denominator: 1 } },
  pitch: { step: 0, octave: 0, alteration: { numerator: 0, denominator: 1 } },
  hidden: false,
  slash: false,
  stemHidden: false,
  parenthesized: false,
  mergeDifferentlyHeaded: false,
  mergeDifferentlyDotted: false,
  ignoreCollision: false,
  attachments: [],
});
const document = (events: ScoreDocument['events']): ScoreDocument => ({
  version: 1,
  source: 'voices.ly',
  lilypondVersion: '2.26.0',
  header: {},
  contexts: [
    { id: 0, type: 'Score', name: '', parent: null },
    { id: 1, type: 'Staff', name: '', parent: 0 },
    { id: 2, type: 'Staff', name: '', parent: 0 },
    ...[
      ...new Set(
        events.flatMap((event) =>
          'voice' in event && typeof event.voice === 'number' ? [event.voice] : [],
        ),
      ),
    ].map((id) => ({ id, type: 'Voice', name: String(id), parent: 1 })),
  ],
  events: [
    ...Array.from({ length: 8 }, (_, at): ScoreDocument['events'][number] => ({
      kind: 'step',
      moment: moment(at),
      bar: at + 1,
      position: { numerator: 0, denominator: 1 },
      length: { numerator: 1, denominator: 1 },
      time: { numerator: 4, denominator: 4 },
      timing: true,
    })),
    ...events,
  ],
});
const writtenVoices = (xml: string) =>
  elements(parse(xml), 'note').map((node) => texts(node, 'voice')[0]);

test('sequential source voices reuse an XML lane without changing written notes or source identities', () => {
  const input = document(Array.from({ length: 8 }, (_, index) => note(10 + index, index)));
  const xml = toMusicXML(input).musicxml;

  validate(xml);
  assert.deepEqual(writtenVoices(xml), Array(8).fill('1'));
  assert.equal(musicXmlWrittenNotes(xml).length, 8);
  const stored = elements(parse(xml), 'miscellaneous-field').find(
    (node) => node.getAttribute('name') === 'lilypond-event-document',
  )!;

  assert.deepEqual(JSON.parse(stored.textContent!).events, input.events);
});

test('voices active in the same measure retain distinct XML lanes', () => {
  const xml = toMusicXML(document([note(10, 0), note(11, 0), note(12, 0)])).musicxml;

  assert.deepEqual(writtenVoices(xml), ['1', '2', '3']);
});

test('a source voice keeps its lane across silence and cross-staff notes', () => {
  const xml = toMusicXML(document([note(10, 0), note(11, 1), note(10, 2, 2)])).musicxml;
  const notes = elements(parse(xml), 'note');

  assert.deepEqual(
    notes.map((node) => texts(node, 'voice')[0]),
    ['1', '2', '1'],
  );
});

test('voice-owned span endpoints reserve their silent intervening measures', () => {
  const xml = toMusicXML(
    document([
      note(10, 0),
      note(11, 1),
      {
        kind: 'voice',
        voice: 10,
        staff: 1,
        moment: moment(2),
        class: 'slur-event',
        direction: 1,
        spanDirection: 1,
      },
    ]),
  ).musicxml;

  assert.deepEqual(writtenVoices(xml), ['1', '2']);
});

test('sequential voices within one measure reuse a lane at exclusive note ends', () => {
  const later = {
    ...note(11, 0),
    moment: {
      main: { numerator: 1, denominator: 4 },
      grace: { numerator: 0, denominator: 1 },
    },
  };
  const xml = toMusicXML(document([note(10, 0), later])).musicxml;

  validate(xml);
  assert.deepEqual(writtenVoices(xml), ['1', '1']);
  assert.deepEqual(
    musicXmlWrittenNotes(xml).map((note) => note.start),
    [0, 1],
  );
});

test("a grace and another voice's principal note keep separate lanes at the same moment", () => {
  const ornament = {
    ...note(10, 1),
    moment: {
      main: { numerator: 1, denominator: 1 },
      grace: { numerator: -1, denominator: 8 },
    },
  };
  const xml = toMusicXML(document([ornament, note(11, 1)])).musicxml;

  assert.deepEqual(writtenVoices(xml), ['1', '2']);
});
