import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import xmlbuilder from 'xmlbuilder2/lib/xmlbuilder2.min.js';
import { evaluationNotes } from '../../../tools/evaluation/playback.js';
import { musicXmlWrittenNotes } from '../../../tools/evaluation/written.js';
import { anchorOctaveDirections } from '../../../src/musicxml/postprocess/octave-directions.js';
import { validate } from '../../support/schema.js';

const toolkit = new VerovioToolkit(await createModule());

after(() => toolkit.destroy());
const note = (
  step: string,
  octave: number,
  { staff = 1, voice = 1, grace = false, chord = false, duration = 1 } = {},
) =>
  `<note>${grace ? '<grace slash="yes"/>' : ''}${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch>${grace ? '' : `<duration>${duration}</duration>`}<voice>${voice}</voice><type>${grace ? '16th' : duration === 4 ? 'whole' : duration === 2 ? 'half' : 'quarter'}</type><staff>${staff}</staff></note>`;
const direction = (offset: number, type = 'down', staff = 1) =>
  `<direction><direction-type><octave-shift type="${type}" size="8" number="1"/></direction-type><offset sound="yes">${offset}</offset><staff>${staff}</staff></direction>`;
const score = (measures: string[], staves = 1) =>
  xmlbuilder
    .create(
      `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures.map((music, index) => `<measure number="${index + 1}">${index === 0 ? `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>${staves}</staves></attributes>` : ''}${music}</measure>`).join('')}</part></score-partwise>`,
    )
    .root();
const pitches = (xml: string) => {
  assert.equal(toolkit.loadData(xml), 1);

  return evaluationNotes(Buffer.from(toolkit.renderToMIDI(), 'base64')).map((note) => [
    note.pitch,
    note.start,
  ]);
};
const normalize = (root: ReturnType<typeof score>) => {
  const before = musicXmlWrittenNotes(root.toString());
  const markings = root
    .filter((node) => node.node.nodeName === 'octave-shift', false, true)
    .map((node) => node.toString());

  anchorOctaveDirections(root.find((node) => node.node.nodeName === 'part')!);
  validate(root.toString());
  assert.deepEqual(musicXmlWrittenNotes(root.toString()), before);
  assert.deepEqual(
    root
      .filter((node) => node.node.nodeName === 'octave-shift', false, true)
      .map((node) => node.toString()),
    markings,
  );

  return root.toString();
};
const crossStaff = () =>
  direction(1, 'down', 2) +
  direction(3, 'stop', 2) +
  ['C', 'D', 'E', 'F'].map((step) => note(step, 5)).join('') +
  '<backup><duration>4</duration></backup>' +
  note('C', 3, { staff: 2, voice: 2 }) +
  note('D', 4, { staff: 2, voice: 2 }) +
  note('E', 4, { staff: 2, voice: 2 }) +
  note('F', 3, { staff: 2, voice: 2 });

test('octave endpoints anchor on their own staff without transposing simultaneous notes on another staff', () => {
  const xml = normalize(score([crossStaff()], 2));

  assert.deepEqual(pitches(xml), [
    [48, 0],
    [72, 0],
    [62, 1],
    [74, 1],
    [64, 2],
    [76, 2],
    [53, 3],
    [77, 3],
  ]);
});

test('chords and a later serialized voice retain native pitches before, within and after an octave span', () => {
  const music =
    direction(1) +
    direction(2, 'stop') +
    note('C', 5) +
    note('D', 6) +
    note('F', 6, { chord: true }) +
    note('G', 5) +
    note('A', 5) +
    '<backup><duration>4</duration></backup>' +
    ['C', 'D', 'E', 'F'].map((step) => note(step, 4, { voice: 2 })).join('');

  assert.deepEqual(pitches(normalize(score([music]))), [
    [60, 0],
    [72, 0],
    [62, 1],
    [86, 1],
    [89, 1],
    [64, 2],
    [79, 2],
    [65, 3],
    [81, 3],
  ]);
});

test('grace notes inside a safely anchored octave span keep all native pitches', () => {
  const music =
    direction(1) +
    direction(3, 'stop') +
    note('C', 5) +
    note('D', 6) +
    note('E', 6, { grace: true }) +
    note('F', 6, { grace: true }) +
    note('G', 6) +
    note('A', 5);

  assert.deepEqual(
    pitches(normalize(score([music]))).map((note) => note[0]),
    [72, 86, 88, 89, 91, 81],
  );
});

test('a grace-adjacent endpoint leaves both ends unchanged while an independent safe pair still normalizes', () => {
  const unsafe =
    direction(1) +
    direction(2, 'stop') +
    note('C', 5) +
    note('D', 6) +
    note('E', 6, { grace: true }) +
    note('F', 6, { grace: true }) +
    note('G', 5) +
    note('A', 5) +
    '<backup><duration>4</duration></backup>' +
    ['C', 'D', 'E', 'F'].map((step) => note(step, 3, { staff: 2, voice: 2 })).join('');
  const root = score([crossStaff(), unsafe], 2);
  const before = pitches(root.toString()).filter((note) => note[1]! >= 4);
  const xml = normalize(root);
  const notes = pitches(xml);

  assert.deepEqual(
    notes.filter((note) => note[1]! < 4),
    [
      [48, 0],
      [72, 0],
      [62, 1],
      [74, 1],
      [64, 2],
      [76, 2],
      [53, 3],
      [77, 3],
    ],
  );
  assert.deepEqual(
    notes.filter((note) => note[1]! >= 4),
    before,
  );
  const offsets = root
    .filter((node) => node.node.nodeName === 'offset', false, true)
    .map((node) => node.node.textContent);

  assert.deepEqual(offsets, ['0', '0', '1', '2']);
});

test('a cross-staff grace blocks endpoints on the grace staff as well as its principal staff', () => {
  const root = score(
    [
      direction(1) +
        direction(2, 'stop') +
        note('C', 5) +
        note('D', 6) +
        note('E', 6, { grace: true }) +
        note('F', 4, { staff: 2 }) +
        note('A', 5),
    ],
    2,
  );
  const before = root.toString();

  anchorOctaveDirections(root.find((node) => node.node.nodeName === 'part')!);
  assert.equal(root.toString(), before);
});

test('ambiguous, continued, unmatched and inexact octave chains remain untouched', () => {
  const notes = ['C', 'D', 'E', 'F'].map((step) => note(step, 5)).join('');

  for (const marks of [
    direction(1) + direction(2) + direction(3, 'stop'),
    direction(1) + direction(2, 'continue') + direction(3, 'stop'),
    direction(1),
    direction(2, 'stop'),
    direction(1) + direction(1.5, 'stop'),
    direction(1) + direction(2, 'stop') + direction(3),
  ]) {
    const root = score([marks + notes]);
    const before = root.toString();

    anchorOctaveDirections(root.find((node) => node.node.nodeName === 'part')!);
    assert.equal(root.toString(), before);
  }
});

test('a secondary-lane endpoint leaves the entire pair unchanged when the first lane spans that onset', () => {
  const music =
    direction(1) +
    direction(2, 'stop') +
    note('C', 5, { duration: 2 }) +
    note('G', 5, { duration: 2 }) +
    '<backup><duration>4</duration></backup>' +
    note('C', 4, { voice: 2 }) +
    note('D', 5, { voice: 2 }) +
    note('E', 4, { voice: 2 }) +
    note('F', 4, { voice: 2 });
  const root = score([music]);
  const before = root.toString();
  const attacks = pitches(before);

  anchorOctaveDirections(root.find((node) => node.node.nodeName === 'part')!);
  assert.equal(root.toString(), before);
  assert.deepEqual(pitches(root.toString()), attacks);
});

test('an unsafe zero-offset endpoint keeps its otherwise safe partner unchanged', () => {
  const root = score([
    direction(1) +
      note('C', 5) +
      note('D', 6) +
      direction(0, 'stop') +
      note('E', 6, { grace: true }) +
      note('F', 6, { grace: true }) +
      note('G', 5) +
      note('A', 5),
  ]);
  const before = root.toString();
  const attacks = pitches(before);

  anchorOctaveDirections(root.find((node) => node.node.nodeName === 'part')!);
  assert.equal(root.toString(), before);
  assert.deepEqual(pitches(root.toString()), attacks);
});

test('repeat endings retain their native playback after safely anchoring octave endpoints', () => {
  const first =
    '<barline location="left"><repeat direction="forward"/></barline>' +
    direction(1) +
    direction(2, 'stop') +
    note('C', 5) +
    note('D', 6) +
    note('E', 5, { duration: 2 });
  const ending = (number: number, step: string, repeat: boolean) =>
    `<barline location="left"><ending number="${number}" type="start"/></barline>${note(step, 5, { duration: 4 })}<barline location="right"><ending number="${number}" type="stop"/>${repeat ? '<repeat direction="backward" times="2"/>' : ''}</barline>`;
  const xml = normalize(score([first, ending(1, 'F', true), ending(2, 'G', false)]));

  assert.deepEqual(pitches(xml), [
    [72, 0],
    [86, 1],
    [76, 2],
    [77, 4],
    [72, 8],
    [86, 9],
    [76, 10],
    [79, 12],
  ]);
});
