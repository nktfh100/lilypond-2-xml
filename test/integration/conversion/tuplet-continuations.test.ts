import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import xmlbuilder from 'xmlbuilder2/lib/xmlbuilder2.min.js';
import { compareNotes, evaluationNotes } from '../../../tools/evaluation/playback.js';
import { musicXmlWrittenNotes } from '../../../tools/evaluation/written.js';
import { createConverter } from '../../../src/index.js';
import type { Add } from '../../../src/musicxml/types.js';
import { xmlElement } from '../../../src/musicxml/primitives.js';
import { completeTupletContinuations } from '../../../src/musicxml/postprocess/tuplet-continuations.js';
import { validate } from '../../support/schema.js';

const add: Add = (parent, name, value, attributes = {}) => {
  const node = parent.ele(name, attributes);

  if (value !== undefined) {
    node.txt(String(value));
  }

  return node;
};
const note = (marks = '', actual = 3) =>
  `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><time-modification><actual-notes>${actual}</actual-notes><normal-notes>2</normal-notes></time-modification><notations>${marks}</notations></note>`;
const start =
  '<tuplet type="start" number="1" bracket="yes" placement="above" show-number="both"><tuplet-actual><tuplet-number>3</tuplet-number><tuplet-type>eighth</tuplet-type></tuplet-actual></tuplet>';
const stop = '<tuplet type="stop" number="1" placement="above"/>';
const source = (secondActual = 3) =>
  xmlbuilder
    .create(
      `<part><measure number="1">${note(start)}</measure><measure number="2">${note('', secondActual)}${note(stop)}</measure></part>`,
    )
    .root();

test('graphical continuations preserve every original source span attribute and child', () => {
  const part = source();
  const original = part.filter((node) => node.node.nodeName === 'tuplet', true, true);
  const before = original.map((node) => node.toString());

  completeTupletContinuations(part, add);
  assert.deepEqual(
    original.map((node) => node.toString()),
    before,
  );
  const all = part.filter((node) => node.node.nodeName === 'tuplet', true, true);

  assert.equal(all.length, 4);
  const supplements = all.filter((node) => !original.some((mark) => mark.node === node.node));

  assert.ok(supplements.every((node) => xmlElement(node).getAttribute('number') === '2'));
});

test('mixed cumulative ratios receive separate continuations without changing source marks', () => {
  const part = source(5);
  const originals = part.filter((node) => node.node.nodeName === 'tuplet', true, true);
  const before = originals.map((node) => node.toString());

  completeTupletContinuations(part, add);
  assert.deepEqual(
    originals.map((node) => node.toString()),
    before,
  );
  const starts = part
    .filter((node) => node.node.nodeName === 'tuplet', true, true)
    .filter(
      (node) =>
        xmlElement(node).getAttribute('bracket') === 'no' &&
        xmlElement(node).getAttribute('type') === 'start',
    );

  assert.deepEqual(
    starts.map(
      (node) =>
        node
          .find((child) => child.node.nodeName === 'tuplet-actual')!
          .find((child) => child.node.nodeName === 'tuplet-number')!.node.textContent,
    ),
    ['5', '3'],
  );
});

test('nested source tuplets remain unchanged', () => {
  const nestedStart = '<tuplet type="start" number="2"/>';
  const nestedStop = '<tuplet type="stop" number="2"/>';
  const part = xmlbuilder
    .create(
      `<part><measure number="1">${note(start + nestedStart)}</measure><measure number="2">${note(nestedStop + stop)}</measure></part>`,
    )
    .root();
  const before = part.toString();

  completeTupletContinuations(part, add);
  assert.equal(part.toString(), before);
});

const compiler = createReusableCompiler(),
  converter = createConverter();
const reader = new VerovioToolkit(await createModule());

after(() => {
  compiler.dispose();
  converter.dispose();
  reader.destroy();
});

test('a source tuplet with a canceled endpoint duration keeps native playback across barlines', async () => {
  const source = String.raw`\score { { \time 4/4
    \tuplet 3/2 { c'1 d'1 e'1 f'8*3/2 } g'2..
  } \layout {} \midi {} }`;
  const native = await compiler.compile(source, { format: ['midi'] });
  const midi = Object.entries(native.files).find(([name]) => name.endsWith('.midi'))?.[1];

  assert.ok(midi);
  const score = (await converter.convert(source)).scores[0]!;

  validate(score.musicxml);
  assert.equal(reader.loadData(score.musicxml), 1);
  const playback = compareNotes(
    evaluationNotes(midi),
    evaluationNotes(Buffer.from(reader.renderToMIDI(), 'base64')),
  );

  assert.equal(playback.startsPercent, 100);
  const notes = musicXmlWrittenNotes(score.musicxml);

  assert.equal(notes.find((note) => note.pitch === 'F:0:4')?.duration, 0.5);
  assert.equal(notes.find((note) => note.pitch === 'G:0:4')?.start, 8.5);
});
