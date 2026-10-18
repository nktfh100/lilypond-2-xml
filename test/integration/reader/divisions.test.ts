import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import xmlbuilder from 'xmlbuilder2/lib/xmlbuilder2.min.js';
import { evaluationNotes } from '../../../tools/evaluation/playback.js';
import { musicXmlWrittenNotes } from '../../../tools/evaluation/written.js';
import { reduceMeasureDivisions } from '../../../src/musicxml/postprocess/divisions.js';
import type { Add } from '../../../src/musicxml/types.js';
import { validate } from '../../support/schema.js';

const add: Add = (parent, name, value, attributes = {}) => {
  const node = parent.ele(name, attributes);

  if (value !== undefined) {
    node.txt(String(value));
  }

  return node;
};
const note = (step: string, duration: number, extra = '') =>
  `<note ${extra}><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration><type>quarter</type></note>`;
const score = (measures: string) =>
  xmlbuilder
    .create(
      `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`,
    )
    .root();
const toolkit = new VerovioToolkit(await createModule());

after(() => toolkit.destroy());

test('large graphical direction offsets retain exact timing without reader overflow', () => {
  const root = score(
    `<measure number="1"><attributes><divisions>10000</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><bracket type="start" number="1" line-end="none"/></direction-type><offset>10000</offset></direction><direction><direction-type><bracket type="stop" number="1" line-end="down"/></direction-type><offset>37500</offset></direction>${['C', 'D', 'E', 'F'].map((step) => note(step, 10000)).join('')}</measure>`,
  );
  const before = musicXmlWrittenNotes(root.toString());
  const marks = root
    .filter((node) => node.node.nodeName === 'bracket', false, true)
    .map((node) => node.toString());

  reduceMeasureDivisions(root.find((node) => node.node.nodeName === 'part')!, add);
  const xml = root.toString();

  validate(xml);
  assert.deepEqual(musicXmlWrittenNotes(xml), before);
  assert.deepEqual(
    root
      .filter((node) => node.node.nodeName === 'bracket', false, true)
      .map((node) => node.toString()),
    marks,
  );
  assert.deepEqual(
    root
      .filter((node) => node.node.nodeName === 'offset', false, true)
      .map((node) => node.node.textContent),
    ['4', '15'],
  );
  assert.equal(toolkit.loadData(xml), 1);
  assert.deepEqual(
    evaluationNotes(Buffer.from(toolkit.renderToMIDI(), 'base64')).map((n) => [n.pitch, n.start]),
    [
      [60, 0],
      [62, 1],
      [64, 2],
      [65, 3],
    ],
  );
});

test('per-measure units restore the original scale when a later measure needs finer timing', () => {
  const root = score(
    `<measure number="1"><attributes><divisions>100</divisions></attributes>${note('C', 100)}</measure><measure number="2">${note('D', 3)}<forward><duration>97</duration></forward></measure><measure number="3">${note('E', 100)}</measure>`,
  );
  const before = musicXmlWrittenNotes(root.toString());

  reduceMeasureDivisions(root.find((node) => node.node.nodeName === 'part')!, add);
  validate(root.toString());
  assert.deepEqual(
    root
      .filter((node) => node.node.nodeName === 'divisions', false, true)
      .map((node) => node.node.textContent),
    ['1', '100', '1'],
  );
  assert.deepEqual(musicXmlWrittenNotes(root.toString()), before);
});

test('attack, release and offset units share the same exact reduction', () => {
  const root = score(
    `<measure number="1"><attributes><divisions>100</divisions></attributes><direction><direction-type><words>Test</words></direction-type><offset>50</offset></direction>${note('C', 100, 'attack="25" release="-25"')}</measure>`,
  );

  reduceMeasureDivisions(root.find((node) => node.node.nodeName === 'part')!, add);
  validate(root.toString());
  assert.equal(
    root.find((node) => node.node.nodeName === 'divisions', false, true)!.node.textContent,
    '4',
  );
  assert.match(root.toString(), /attack="1" release="-1"/);
});

test('a mid-measure key change does not delay the units for preceding notes', () => {
  const root = score(
    `<measure number="1"><attributes><divisions>100</divisions></attributes>${note('C', 3)}<forward><duration>97</duration></forward></measure><measure number="2"><print new-system="yes"/>${note('D', 100)}<attributes><key><fifths>1</fifths></key></attributes>${note('E', 100)}</measure>`,
  );
  const before = musicXmlWrittenNotes(root.toString());

  reduceMeasureDivisions(root.find((node) => node.node.nodeName === 'part')!, add);
  validate(root.toString());
  assert.deepEqual(musicXmlWrittenNotes(root.toString()), before);
  assert.equal(root.filter((node) => node.node.nodeName === 'key', false, true).length, 1);
});

test('offsets before an existing divisions change retain their original units', () => {
  const root = score(
    `<measure number="1"><direction><direction-type><words>Test</words></direction-type><offset>50</offset></direction><attributes><divisions>100</divisions></attributes>${note('C', 100)}</measure>`,
  );
  const before = root.toString();

  reduceMeasureDivisions(root.find((node) => node.node.nodeName === 'part')!, add);
  assert.equal(root.toString(), before);
});

test('grace and navigation timing attributes retain the same quarter-note units', () => {
  const root = score(
    `<measure number="1"><attributes><divisions>100</divisions></attributes><direction><direction-type><words>Test</words></direction-type><sound divisions="100"/></direction><note><grace make-time="25"/><pitch><step>D</step><octave>4</octave></pitch><type>16th</type></note>${note('C', 100)}<barline divisions="100"><bar-style>regular</bar-style></barline></measure>`,
  );

  reduceMeasureDivisions(root.find((node) => node.node.nodeName === 'part')!, add);
  validate(root.toString());
  assert.match(root.toString(), /make-time="1"/);
  assert.match(root.toString(), /sound divisions="4"/);
  assert.match(root.toString(), /barline divisions="4"/);
});
