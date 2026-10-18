import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse, texts } from '../../support/xml-support.js';

const { converter, toolkit, playback } = await createReaderHarness();

test('Verovio displays stacked figured bass at the corresponding bass note positions', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { \clef bass \tempo 4=60 c2 d2 } \figures { <6 4>2 <5 3>2 } >>`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const mei = toolkit.getMEI();

  assert.match(mei, /<harm[^>]*staff="1" tstamp="1">/);
  assert.match(mei, /<harm[^>]*staff="1" tstamp="3">/);
  assert.deepEqual(
    [...mei.matchAll(/<f [^>]*>([^<]+)<\/f>/g)].map((m) => m[1]),
    ['6', '4', '5', '3'],
  );
  assert.equal((toolkit.renderToSVG(1).match(/class="fb"/g) || []).length, 2);
  assert.deepEqual(
    playback().map((n) => ({
      pitch: n.pitch,
      time: n.time,
      duration: n.duration,
    })),
    [
      { pitch: 48, time: 0, duration: 2000 },
      { pitch: 50, time: 2000, duration: 2000 },
    ],
  );
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'figured-bass').map((f) => texts(f, 'figure-number')),
    [
      ['6', '4'],
      ['5', '3'],
    ],
  );
  assert.deepEqual(texts(xml, 'step'), ['C', 'D']);
});

test('Verovio reads changing figures under one sustained bass note', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { \clef bass \tempo 4=60 c1 } \figures { <6>4 <5>4 <4 3>2 } >>`,
  );

  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.deepEqual(
    [...toolkit.getMEI().matchAll(/<harm[^>]*tstamp="([^"]+)"/g)].map((m) => m[1]),
    ['1', '2', '3'],
  );
  assert.equal(playback().length, 1);
  assert.equal(playback()[0]!.duration, 4000);
  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const divisions = Number(texts(xml, 'divisions')[0]);

  assert.deepEqual(
    elements(xml, 'figured-bass').map((f) => Number(texts(f, 'duration')[0]) / divisions),
    [1, 1, 2],
  );
  assert.equal(elements(xml, 'note').length, 1);
});

test('Verovio associates named figured bass with the lower piano staff', async () => {
  const { scores } = await converter.convert(
    String.raw`\new PianoStaff << \new Staff = "upper" { c'1 } \new Staff = "lower" { \clef bass c1 } \new FiguredBass \with { alignBelowContext = "lower" } \figuremode { <6 4>1 } >>`,
  );

  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.match(toolkit.getMEI(), /<harm[^>]*staff="2" tstamp="1">/);
  assert.deepEqual(
    playback()
      .map((n) => n.pitch)
      .sort((a, b) => a - b),
    [48, 60],
  );
  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'part').length, 1);
  const f = elements(xml, 'figured-bass')[0];
  let anchor = f!.nextSibling;

  while (anchor && anchor.nodeName !== 'note') {
    anchor = anchor.nextSibling;
  }

  assert.deepEqual(texts(anchor, 'staff'), ['2']);
  assert.deepEqual(texts(xml, 'figure-number'), ['6', '4']);
});

test('Verovio drops the leading blank figure offset retained in native XML', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { \clef bass c1 } \figures { s4 <6>4 <5>2 } >>`,
  );

  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.deepEqual(
    [...toolkit.getMEI().matchAll(/<harm[^>]*tstamp="([^"]+)"/g)].map((m) => m[1]),
    ['1', '2'],
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'figured-bass-reader'));
  assert.equal(playback().length, 1);
  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const groups = elements(xml, 'figured-bass');

  assert.deepEqual(
    groups.map((f) => texts(f, 'figure-number')),
    [[], ['6'], ['5']],
  );
  const divisions = Number(texts(xml, 'divisions')[0]);

  assert.deepEqual(
    groups.map((f) => Number(texts(f, 'duration')[0]) / divisions),
    [1, 1, 2],
  );
});

test('standalone figures retain no sounding notes while the reader draws an initial staff', async () => {
  const { scores } = await converter.convert(String.raw`\figures { <6 4>2 <5 3>2 }`);

  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.equal((toolkit.getMEI().match(/<fb /g) || []).length, 2);
  assert.deepEqual(playback(), []);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'staff-lines-reader'));
  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'figure-number'), ['6', '4', '5', '3']);
  assert.deepEqual(texts(xml, 'staff-lines'), ['0']);
  assert.equal(elements(xml, 'pitch').length, 0);
  assert.equal(elements(xml, 'rest').length, 2);
  assert.deepEqual(
    elements(xml, 'note').map((n) => n.getAttribute('print-object')),
    ['no', 'no'],
  );
});
