import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import xmlbuilder from 'xmlbuilder2/lib/xmlbuilder2.min.js';
import { musicXmlWrittenNotes } from '../../../tools/evaluation/written.js';
import { createConverter } from '../../../src/index.js';
import type { Add } from '../../../src/musicxml/types.js';
import { completeTupletGapStops } from '../../../src/musicxml/postprocess/tuplet-gap-stops.js';
import { validate } from '../../support/schema.js';
import { elements, parse } from '../../support/xml-support.js';

const source = String.raw`{ \tuplet 3/2 { c'8 << { d'8 e'8 } \\ { f'8 g'8 } >> } c'2. }`;
const converter = createConverter();

after(() => converter.dispose());

test("a tuplet ending in simultaneous child voices closes on its parent voice's existing silence", async () => {
  const score = (await converter.convert(source)).scores[0]!;

  validate(score.musicxml);
  const document = parse(score.musicxml);
  const first = elements(document, 'note').find(
    (note) => elements(note, 'step')[0]?.textContent === 'C',
  )!;
  const number = elements(first, 'tuplet')[0]!.getAttribute('number');
  const voice = elements(first, 'voice')[0]!.textContent;
  const stop = elements(document, 'note').find(
    (note) =>
      elements(note, 'voice')[0]?.textContent === voice &&
      elements(note, 'tuplet').some(
        (mark) => mark.getAttribute('type') === 'stop' && mark.getAttribute('number') === number,
      ),
  );

  assert.ok(stop, 'the source tuplet must have a stop in its original parent voice');
  assert.equal(stop.getAttribute('print-object'), 'no');
  assert.equal(elements(stop, 'rest').length, 1);
  assert.equal(elements(stop, 'type')[0]?.textContent, 'quarter');
  assert.equal(elements(stop, 'actual-notes')[0]?.textContent, '3');
  assert.equal(elements(stop, 'normal-notes')[0]?.textContent, '2');
  assert.deepEqual(
    musicXmlWrittenNotes(score.musicxml).map((note) => [note.pitch, note.start, note.duration]),
    [
      ['C:0:4', 0, 1 / 3],
      ['C:0:4', 1, 3],
      ['D:0:4', 1 / 3, 1 / 3],
      ['E:0:4', 2 / 3, 1 / 3],
      ['F:0:4', 1 / 3, 1 / 3],
      ['G:0:4', 2 / 3, 1 / 3],
    ],
  );
});

test('a tuplet note split at a native barline retains the source ratio on binary fragments', async () => {
  const score = (
    await converter.convert(String.raw`{ \time 3/4 \partial 8 \tuplet 3/2 { c'4 d'4 e'4 } f'4. }`)
  ).scores[0]!;

  validate(score.musicxml);
  const notes = elements(parse(score.musicxml), 'note').filter(
    (note) => elements(note, 'step')[0]?.textContent === 'C',
  );

  assert.equal(notes.length, 2);
  assert.deepEqual(
    notes.map((note) => [
      elements(note, 'type')[0]?.textContent,
      elements(note, 'actual-notes')[0]?.textContent,
      elements(note, 'normal-notes')[0]?.textContent,
    ]),
    [
      ['eighth', '3', '2'],
      ['16th', '3', '2'],
    ],
  );
  assert.equal(elements(notes[0]!, 'dot').length, 1);
  assert.deepEqual(
    musicXmlWrittenNotes(score.musicxml)
      .filter((note) => note.pitch === 'C:0:4')
      .map((note) => [note.start, note.duration]),
    [
      [0, 0.5],
      [0.5, 1 / 6],
    ],
  );
});

test('the source tuplet ratio survives a first note whose duration multiplier cancels it', async () => {
  const score = (await converter.convert(String.raw`{ \tuplet 3/2 { c'8*3/2 d'8 e'8 } }`))
    .scores[0]!;

  validate(score.musicxml);
  const tuplet = elements(parse(score.musicxml), 'tuplet').find(
    (mark) => mark.getAttribute('type') === 'start',
  )!;

  assert.equal(
    elements(elements(tuplet, 'tuplet-actual')[0]!, 'tuplet-number')[0]?.textContent,
    '3',
  );
  assert.equal(
    elements(elements(tuplet, 'tuplet-normal')[0]!, 'tuplet-number')[0]?.textContent,
    '2',
  );
  const actual = musicXmlWrittenNotes(score.musicxml).map((note) => [note.start, note.duration]);
  const expected = [
    [0, 0.5],
    [0.5, 1 / 3],
    [5 / 6, 1 / 3],
  ];

  assert.equal(actual.length, expected.length);
  assert.ok(
    actual.every((note, index) =>
      note.every((value, field) => Math.abs(value - expected[index]![field]!) < 1e-8),
    ),
  );
});

test('a parent gap continues normally after its actual source tuplet ends', async () => {
  const score = (
    await converter.convert(String.raw`{ << { \tuplet 3/2 { c'8 << d'8 e'8 >> } } \\ { g'1 } >> }`)
  ).scores[0]!;

  validate(score.musicxml);
  const document = parse(score.musicxml);
  const first = elements(document, 'note').find(
    (note) => elements(note, 'step')[0]?.textContent === 'C',
  )!;
  const voice = elements(first, 'voice')[0]!.textContent;
  const stop = elements(document, 'note').find(
    (note) =>
      elements(note, 'voice')[0]?.textContent === voice &&
      elements(note, 'tuplet').some((mark) => mark.getAttribute('type') === 'stop'),
  );

  assert.ok(stop);
  const forwards = elements(document, 'forward').filter(
    (node) => elements(node, 'voice')[0]?.textContent === voice,
  );
  const divisions = Number(elements(document, 'divisions')[0]!.textContent);

  assert.equal(forwards.length, 1);
  assert.ok(
    Math.abs(Number(elements(forwards[0]!, 'duration')[0]!.textContent) / divisions - 10 / 3) <
      1e-8,
  );
  assert.deepEqual(
    musicXmlWrittenNotes(score.musicxml)
      .map((note) => note.pitch)
      .sort(),
    ['C:0:4', 'D:0:4', 'E:0:4', 'G:0:4'],
  );
});

for (const [attributes, contents] of [
  ['', '<notations><fermata/></notations>'],
  ['', '<lyric><text>word</text></lyric>'],
  [' color="#112233"', ''],
]) {
  test(`an existing hidden rest retains its attached source data: ${attributes || contents}`, () => {
    const part = xmlbuilder
      .create(
        `<part><measure number="1"><attributes><divisions>3</divisions></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type>
      <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>
      <notations><tuplet type="start" number="1"/></notations></note>
    <note print-object="no"${attributes}><rest/><duration>2</duration><voice>1</voice><type>quarter</type>
      <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>${contents}</note>
  </measure></part>`,
      )
      .root();
    const before = part.toString();
    const add: Add = (parent, name, value, attributes = {}) => {
      const node = parent.ele(name, attributes);

      if (value !== undefined) {
        node.txt(String(value));
      }

      return node;
    };

    completeTupletGapStops(part, [{ voice: 1, number: 1, start: 0, end: 1 }], add, () =>
      assert.fail('source rest must remain'),
    );
    assert.equal(part.toString(), before);
  });
}
