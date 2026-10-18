import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { parse, texts } from '../../support/xml-support.js';

const { converter, toolkit, playback } = await createReaderHarness();

test('Verovio prints no fallback label for an unnamed staff', async () => {
  const { scores } = await converter.convert(String.raw`{ c'1 }`);

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.doesNotMatch(toolkit.getMEI(), /<label[ >]/);
  assert.doesNotMatch(toolkit.renderToSVG(1), /class="label"/);
  assert.deepEqual(
    playback().map((n) => n.pitch),
    [60],
  );
});

test('Verovio retains the piano label at the group of two staves', async () => {
  const { scores } = await converter.convert(
    String.raw`\new PianoStaff \with { instrumentName = "Piano" shortInstrumentName = "Pno." } << \new Staff { c'1 } \new Staff { c1 } >>`,
  );

  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.match(toolkit.getMEI(), /<label [^>]*>Piano<\/label>/);
  assert.match(toolkit.getMEI(), /<labelAbbr [^>]*>Pno\.<\/labelAbbr>/);
  assert.match(toolkit.renderToSVG(1), /Piano/);
  assert.deepEqual(
    playback()
      .map((n) => n.pitch)
      .sort((a, b) => a - b),
    [48, 60],
  );
});

test('Verovio retains a staff-group label and its individual part labels', async () => {
  const { scores } = await converter.convert(
    String.raw`\new StaffGroup \with { instrumentName = "Strings" } << \new Staff \with { instrumentName = "Violin" } { c'1 } \new Staff \with { instrumentName = "Cello" } { c1 } >>`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const labels = [...toolkit.getMEI().matchAll(/<label [^>]*>([^<]*)<\/label>/g)].map((m) => m[1]);

  assert.deepEqual(labels, ['Strings', 'Violin', 'Cello']);
});

test('native timed label changes remain present when Verovio retains the initial abbreviation', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = "Flute" shortInstrumentName = "Fl." } { c'1 \break \set Staff.instrumentName = "Piccolo" \set Staff.shortInstrumentName = "Picc." d'1 }`,
  );

  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const mei = toolkit.getMEI();

  assert.match(mei, /<label [^>]*>Flute<\/label>/);
  assert.match(mei, /<labelAbbr [^>]*>Fl\.<\/labelAbbr>/);
  assert.doesNotMatch(mei, /Piccolo|Picc\./);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'instrument-name-change-reader'));
  assert.deepEqual(
    playback().map((n) => n.pitch),
    [60, 62],
  );
  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'part-name'), ['Flute']);
});

test('Verovio imports native label accidental text while dropping font styling', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = \markup { \italic "Clarinet" \smaller \flat } } { c'1 }`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.match(toolkit.getMEI(), /<label [^>]*>Clarinet ♭<\/label>/);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'instrument-name-reader'));
});
