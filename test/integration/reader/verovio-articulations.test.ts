import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';

const { converter, toolkit, playback } = await createReaderHarness();

test('Verovio renders resolved articulation glyphs and retains note playback', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4_\marcato d'4\espressivo e'4\snappizzicato f'4_\upbow | c'4_\downbow d'4^\portato e'4\veryshortfermata f'4\verylongfermata }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = toolkit.getMEI();

  for (const mark of ['marc', 'acc-soft', 'snap', 'upbow', 'dnbow']) {
    assert.ok(mei.includes(`artic="${mark}"`), mark);
  }

  const svg = toolkit.renderToSVG(1);

  for (const glyph of ['E4AD', 'ED41', 'E4C8']) {
    assert.ok(svg.includes(`#${glyph}-`), glyph);
  }

  const actual = playback();
  const plain = await converter.convert("{ c'4 d' e' f' | c' d' e' f' }");

  assert.equal(toolkit.loadData(plain.scores[0]!.musicxml), 1);
  assert.deepEqual(actual, playback());
});

test('Verovio omits hidden articulations while native techniques and variant diagnostics remain', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \omit Script c'4\staccato \once \override Script.transparent = ##t d'4\tenuto e'4\accent f'4\thumb | c'4\rheel d'4\ltoe e'4\halfopen f'4\henzeshortfermata }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = toolkit.getMEI();

  assert.ok(!mei.includes('artic="stacc"'));
  assert.ok(!mei.includes('artic="ten"'));
  assert.ok(mei.includes('artic="acc"'));
  assert.ok(mei.includes('glyph.num="U+E4CC"'));
  const svg = toolkit.renderToSVG(1);

  assert.ok(!svg.includes('#E4CC-'));

  assert.ok(score.diagnostics.some((diagnostic) => diagnostic.code === 'technical-variant'));

  for (const code of ['technical-reader', 'fermata-glyph-reader']) {
    assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code === code), code);
  }
});
