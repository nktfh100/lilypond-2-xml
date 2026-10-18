import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createConverter, toMusicXML } from '../../../src/index.js';
import { validate } from '../../support/schema.js';
import { elements as all, parse, texts } from '../../support/xml-support.js';

const converter = createConverter();

after(() => converter.dispose());

test('ordinary and mensural staves preserve every source note and staff', async () => {
  const result = await converter.convert(
    String.raw`\version "2.26.0" << \new Staff { c'1 d'1 } \new MensuralStaff { e'1 f'1 } >>`,
  );
  const score = result.scores[0]!;
  const xml = parse(score.musicxml);

  validate(score.musicxml);
  assert.deepEqual(
    all(xml, 'step').map((step) => step.textContent),
    ['C', 'D', 'E', 'F'],
  );
  assert.equal(all(xml, 'part').length, 2);
  assert.equal(all(xml, 'note').length, 4);
  assert.deepEqual(
    all(xml, 'clef').map((clef) => all(clef, 'sign')[0]!.textContent),
    ['G', 'G'],
  );
  assert.deepEqual(texts(xml, 'line'), ['2', '2']);
  assert.ok(texts(xml, 'staff-lines').every((count) => count === '5'));
  assert.equal(score.document.events.filter((event) => event.kind === 'note').length, 4);
  assert.equal(score.document.events.filter((event) => event.kind === 'staffLines').length, 2);
  assert.ok(score.diagnostics.some((diagnostic) => diagnostic.code === 'clef-historical'));
  assert.ok(score.diagnostics.some((diagnostic) => diagnostic.code === 'notehead-style'));

  const cached = toMusicXML(JSON.parse(JSON.stringify(score.document)));

  validate(cached.musicxml);
  assert.deepEqual(texts(parse(cached.musicxml), 'step'), ['C', 'D', 'E', 'F']);
});

test('standalone mensural music preserves pitches, durations, rests and clef transitions', async () => {
  const { scores } = await converter.convert(
    String.raw`\version "2.26.0" \new MensuralStaff {
      c'1 d'1
      \clef "mensural-f" \key g \major \time 3/4 e2 fis4
      \clef "mensural-c3" g4 a4 r4
      \clef "treble" b'2.
    }`,
  );
  const score = scores[0]!;
  const xml = parse(score.musicxml);

  validate(score.musicxml);
  assert.equal(all(xml, 'part').length, 1);
  assert.deepEqual(texts(xml, 'step'), ['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  assert.deepEqual(texts(xml, 'octave'), ['4', '4', '3', '3', '3', '3', '4']);
  assert.deepEqual(texts(xml, 'alter'), ['1']);
  const divisions = Number(texts(xml, 'divisions')[0]);

  assert.deepEqual(
    texts(xml, 'duration').map((duration) => Number(duration) / divisions),
    [4, 4, 2, 1, 1, 1, 1, 3],
  );
  assert.equal(all(xml, 'rest').length, 1);
  assert.deepEqual(texts(xml, 'sign'), ['G', 'F', 'C', 'G']);
  assert.deepEqual(texts(xml, 'line'), ['2', '4', '3', '2']);
  assert.deepEqual(texts(xml, 'fifths'), ['1']);
  assert.deepEqual(texts(xml, 'beats'), ['4', '3']);
  assert.deepEqual(texts(xml, 'beat-type'), ['4', '4']);
});

test('mensural staves retain their own notes when preceding an ordinary staff', async () => {
  const { scores } = await converter.convert(
    String.raw`\version "2.26.0" <<
      \new MensuralStaff { e'1 f'1 }
      \new Staff { c'1 d'1 }
    >>`,
  );
  const xml = parse(scores[0]!.musicxml);

  validate(scores[0]!.musicxml);
  assert.deepEqual(
    all(xml, 'part').map((part) => texts(part, 'step')),
    [
      ['E', 'F'],
      ['C', 'D'],
    ],
  );
});

test('mensural ligatures preserve their notes and diagnose historical drawing limits', async () => {
  const { scores } = await converter.convert(
    String.raw`\version "2.26.0" \new MensuralStaff { \time 4/2 \[ c'\breve d'\breve \] }`,
  );
  const score = scores[0]!;
  const xml = parse(score.musicxml);

  validate(score.musicxml);
  assert.deepEqual(texts(xml, 'step'), ['C', 'D']);
  assert.deepEqual(texts(xml, 'type'), ['breve', 'breve']);
  assert.ok(score.diagnostics.some((diagnostic) => diagnostic.code === 'ligature-historical'));
  assert.equal(all(xml, 'bracket').length, 0);
});
