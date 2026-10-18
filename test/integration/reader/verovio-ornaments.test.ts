import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, toolkit, playback } = await createReaderHarness();

test('Verovio renders compound ornament glyphs and retains the original note playback', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4\upprall c'4_\downprall c'4\upmordent c'4\downmordent | c'4\prallup c'4\pralldown c'4\haydnturn c'4\bachschleifer | c'4\prallprall c'4\prallmordent c'4\slashturn }`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const mei = toolkit.getMEI();

  assert.equal((mei.match(/<mordent /g) || []).length, 10);
  assert.equal((mei.match(/<turn /g) || []).length, 1);
  assert.equal((mei.match(/long="true"/g) || []).length, 8);
  const svg = toolkit.renderToSVG(1);

  for (const glyph of [
    'E5B5',
    'E5C6',
    'E5B8',
    'E5C7',
    'E5BB',
    'E5C8',
    'E56F',
    'E587',
    'E56E',
    'E5BD',
    'E569',
  ]) {
    assert.ok(svg.includes(`#${glyph}-`), glyph);
  }

  const original = playback();
  const plain = await converter.convert('{ ' + Array(11).fill("c'4").join(' ') + ' }');

  assert.equal(toolkit.loadData(plain.scores[0]!.musicxml), 1);
  assert.deepEqual(original, playback());
});

test('Verovio omits hidden ornaments and retains both above and below placement', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4_\turn \once \omit Script d'4\trill \once \override Script.transparent = ##t e'4\mordent f'4^\prall }`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const mei = toolkit.getMEI();

  assert.equal((mei.match(/<trill /g) || []).length, 0);
  assert.equal((mei.match(/<mordent /g) || []).length, 1);
  assert.match(mei, /<turn [^>]*place="below"/);
  assert.match(mei, /<mordent [^>]*place="above"/);
  assert.ok(toolkit.renderToSVG(1).includes('#E567-'));
  assert.deepEqual(
    playback().map((e) => e.pitch),
    [60, 62, 64, 65],
  );
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'trill-mark').length, 0);
  assert.equal(elements(xml, 'mordent').length, 0);
  assert.equal(elements(xml, 'turn')[0]!.getAttribute('placement'), 'below');
  assert.equal(elements(xml, 'inverted-mordent')[0]!.getAttribute('placement'), 'above');
});

test('multiple ornaments in one native family remain native when the reader imports only one', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1\turn\reverseturn\haydnturn\bachschleifer }`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.equal((toolkit.getMEI().match(/<turn /g) || []).length, 1);
  assert.equal((toolkit.getMEI().match(/<mordent /g) || []).length, 1);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'ornament-reader'));
  const xml = parse(scores[0]!.musicxml);

  assert.equal(xml.getElementsByTagName('ornaments').length, 4);
});
