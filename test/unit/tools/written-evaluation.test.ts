import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type WrittenNote,
  compareWrittenNotes,
  musicXmlWrittenNotes,
  nativeWrittenNotes,
  summarizeWrittenComparisons,
} from '../../../tools/evaluation/written.js';

const xml = (body: string) =>
  `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>12</divisions></attributes>${body}</measure></part></score-partwise>`;
const note = (step: string, duration = 12, extra = '', after = '') =>
  `<note>${extra}<pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>${after}</note>`;
const reference = (pitch = 'C:0:4', start = 0, duration = 1): WrittenNote => ({
  pitch,
  start,
  duration,
  grace: 0,
  voice: '1',
});

test('written comparisons check spelling, order, length and missing or extra notes', () => {
  const expected = [reference(), reference('D:0:4', 1)];

  assert.equal(
    compareWrittenNotes(expected, musicXmlWrittenNotes(xml(note('C') + note('D')))).percent,
    100,
  );

  for (const body of [
    note('D') + note('C'),
    note('C', 6) + note('D', 18),
    note('C'),
    note('C') + note('D') + note('E'),
  ]) {
    assert.ok(compareWrittenNotes(expected, musicXmlWrittenNotes(xml(body))).percent! < 100);
  }

  assert.equal(compareWrittenNotes([reference('C:1:4')], [reference('D:-1:4')]).percent, 0);
});

test('MusicXML durations and forwards are read exactly without relying on tuplet playback', () => {
  const body =
    note(
      'C',
      4,
      '',
      '<type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>',
    ) +
    '<forward><duration>8</duration></forward>' +
    note('D');
  const result = compareWrittenNotes(
    [reference('C:0:4', 0, 1 / 3), reference('D:0:4', 1)],
    musicXmlWrittenNotes(xml(body)),
  );

  assert.equal(result.percent, 100);
});

test('tied barline fragments reconstruct a source note but untied or wrong-voice fragments do not', () => {
  const start = note('C', 12, '', '<voice>1</voice><tie type="start"/>');
  const stop = note('C', 12, '', '<voice>1</voice><tie type="stop"/>');
  const body = `${start}</measure><measure number="2">${stop}`;
  const result = compareWrittenNotes([reference('C:0:4', 0, 2)], musicXmlWrittenNotes(xml(body)));

  assert.equal(result.percent, 100);
  assert.equal(result.normalizedFragments, 1);
  assert.equal(result.exportedFragments, 2);
  assert.equal(
    compareWrittenNotes(
      [reference('C:0:4', 0, 2)],
      musicXmlWrittenNotes(xml(note('C') + note('C'))),
    ).percent,
    0,
  );
  assert.equal(
    compareWrittenNotes(
      [reference('C:0:4', 0, 2)],
      musicXmlWrittenNotes(
        xml(
          body.replace('<voice>1</voice><tie type="stop"/>', '<voice>2</voice><tie type="stop"/>'),
        ),
      ),
    ).percent,
    0,
  );
  assert.equal(
    compareWrittenNotes(
      [reference(), reference('C:0:4', 1)],
      musicXmlWrittenNotes(xml(note('C', 24))),
    ).percent,
    0,
  );
});

test('simultaneous same-pitch voices retain their multiplicity', () => {
  const body =
    note('C', 12, '', '<voice>1</voice>') +
    '<backup><duration>12</duration></backup>' +
    note('C', 12, '', '<voice>2</voice>');

  assert.equal(
    compareWrittenNotes([reference(), reference()], musicXmlWrittenNotes(xml(body))).percent,
    100,
  );
  const missing = compareWrittenNotes(
    [reference(), reference()],
    musicXmlWrittenNotes(xml(note('C'))),
  );

  assert.equal(missing.matched, 1);
  assert.equal(missing.missing, 1);
  assert.ok(missing.percent! < 100);
});

test('native fractions and MusicXML grace notes compare written timing rather than performed timing', () => {
  const expected = nativeWrittenNotes(
    '3\t4\t0\t1\t-1/2\t1/4\t1\n4\t4\t0\t1\t-1/4\t1/4\t1\n5\t4\t0\t1\t0\t1\t1\n',
  );
  const grace = (step: string) =>
    `<note><grace/><pitch><step>${step}</step><octave>4</octave></pitch><type>16th</type></note>`;
  const actual = musicXmlWrittenNotes(
    xml('<forward><duration>12</duration></forward>' + grace('F') + grace('G') + note('A')),
  );

  assert.equal(compareWrittenNotes(expected, actual).percent, 100);
  assert.ok(
    compareWrittenNotes(
      expected,
      musicXmlWrittenNotes(
        xml('<forward><duration>12</duration></forward>' + grace('G') + grace('F') + note('A')),
      ),
    ).percent! < 100,
  );
});

test('written summaries weight note counts and unsupported inputs fail explicitly', () => {
  const scores = [
    compareWrittenNotes([reference()], [reference()]),
    compareWrittenNotes([reference(), reference()], []),
  ];

  assert.equal(summarizeWrittenComparisons(scores).percent, 50);
  assert.throws(() => musicXmlWrittenNotes('<score-timewise/>'), /score-partwise/);
  assert.throws(
    () => musicXmlWrittenNotes(xml('<note><unpitched/><duration>12</duration></note>')),
    /percussion/,
  );
  assert.throws(() => nativeWrittenNotes('invalid'), /reference/);
  assert.throws(
    () => nativeWrittenNotes('unavailable\tUncaptured pitched notes in contexts: (CustomVoice)\n'),
    /Native written reference unavailable: Uncaptured pitched notes.*CustomVoice/,
  );
});

test('grace rests preserve the offsets of surrounding grace notes without adding pitched notes', () => {
  const body =
    '<forward><duration>12</duration></forward><note><grace/><pitch><step>F</step><octave>4</octave></pitch><type>16th</type></note>' +
    '<note><grace/><rest/><type>16th</type></note><note><grace/><pitch><step>G</step><octave>4</octave></pitch><type>16th</type></note>' +
    note('A');
  const expected = nativeWrittenNotes(
    '3\t4\t0\t1\t-3/4\t1/4\t1\n4\t4\t0\t1\t-1/4\t1/4\t1\n5\t4\t0\t1\t0\t1\t1\n',
  );

  assert.equal(compareWrittenNotes(expected, musicXmlWrittenNotes(xml(body))).percent, 100);
});

test('after-grace notes retain their explicit XML cursor before a forward and barline', () => {
  const grace = (step: string) =>
    `<note><grace/><pitch><step>${step}</step><octave>4</octave></pitch><type>16th</type></note>`;
  const body =
    note('C', 48) +
    '<backup><duration>12</duration></backup>' +
    grace('D') +
    grace('E') +
    '<forward><duration>12</duration></forward></measure><measure number="2">' +
    note('F', 48);
  const expected = nativeWrittenNotes(
    '0\t4\t0\t0\t0\t4\t1\n1\t4\t0\t3\t-1/2\t1/4\t1\n2\t4\t0\t3\t-1/4\t1/4\t1\n3\t4\t0\t4\t0\t4\t1\n',
  );

  assert.equal(compareWrittenNotes(expected, musicXmlWrittenNotes(xml(body))).percent, 100);
});
