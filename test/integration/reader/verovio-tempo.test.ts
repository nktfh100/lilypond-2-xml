import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('bar-boundary tempo changes preserve absolute LilyPond playback times', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 c'1( \tempo 4 = 60 d'1) } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: 'midi' }),
  ]);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(xml.getElementsByTagName('metronome').length, 2);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const original = Object.entries(compiled.files).find(([name]) => name.endsWith('.midi'))!;
  const expected = midiTimedNotes(original[1]),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    expected.map((n) => n.onset),
    [0, 2],
  );
  assert.deepEqual(
    expected.map((n) => n.duration),
    [2, 4],
  );
  assert.deepEqual(
    actual.map(({ pitch, onset }) => ({ pitch, onset })),
    expected.map(({ pitch, onset }) => ({ pitch, onset })),
  );

  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i]!.duration! - expected[i]!.duration!) < 0.02);
  }

  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'tempo-mid-measure-reader'));
});
