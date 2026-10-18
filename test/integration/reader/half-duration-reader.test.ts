import assert from 'node:assert/strict';
import { test } from 'node:test';
import { musicXmlWrittenNotes } from '../../../tools/evaluation/written.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';
import { validate } from '../../support/schema.js';

test('half-duration quarters retain their written types without reader-specific diagnostics', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \time 2/4 c'4*1/2 d'4*1/2 e'4*1/2 f'4*1/2 }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code === 'half-duration-reader'));
  const xml = parse(score.musicxml);

  assert.deepEqual(texts(xml, 'type'), ['quarter', 'quarter', 'quarter', 'quarter']);
  assert.deepEqual(texts(xml, 'actual-notes'), ['2', '2', '2', '2']);
  assert.deepEqual(texts(xml, 'normal-notes'), ['1', '1', '1', '1']);
  assert.deepEqual(
    musicXmlWrittenNotes(score.musicxml).map((note) => [note.start, note.duration]),
    [
      [0, 0.5],
      [0.5, 0.5],
      [1, 0.5],
      [1.5, 0.5],
    ],
  );
  assert.ok(elements(xml, 'tuplet').every((mark) => mark.getAttribute('show-number') === 'none'));
});

test('actual two-note tremolos retain their native notation without reader-specific diagnostics', async () => {
  const { scores } = await converter.convert(String.raw`{ \repeat tremolo 8 { c'16 d'16 } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.equal(elements(xml, 'tremolo').length, 2);
  assert.ok(
    elements(xml, 'time-modification').some(
      (modification) =>
        texts(modification, 'actual-notes')[0] === '2' &&
        texts(modification, 'normal-notes')[0] === '1',
    ),
  );
  assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code === 'half-duration-reader'));
});
