import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readMidiAttacks } from '../../../tools/evaluation/midi.js';
import { midiNotes } from '../../support/midi.js';

const compiler = createReusableCompiler();

after(() => compiler.dispose());

test('independently compiled LilyPond MIDI agrees with the existing test reader and retains source track ownership', async () => {
  const result = await compiler.compile(
    String.raw`\score { <<
      \new Staff = "upper" \with { midiInstrument = "flute" } { \tempo 4=120 c'4\p d'4\f e'2 }
      \new Staff = "lower" \with { midiInstrument = "cello" } { c2 g2 }
      >> \midi {} }`,
    { format: ['midi'] },
  );
  const file = Object.entries(result.files).find(([name]) => name.endsWith('.midi'))![1];
  const parsed = readMidiAttacks(file),
    independent = midiNotes(file);

  assert.equal(parsed.format, 1);
  assert.ok(parsed.division > 0);
  assert.ok(parsed.tracks.some((t) => t.names.some((n) => n.text.startsWith('upper:'))));
  assert.ok(parsed.tracks.some((t) => t.names.some((n) => n.text.startsWith('lower:'))));
  assert.ok(parsed.tracks.flatMap((t) => t.programs).some((p) => p.program === 73));
  const actual = parsed.tracks
    .flatMap((t) => t.attacks)
    .map((a) => ({
      tick: a.tick,
      channel: a.channel,
      pitch: a.pitch,
      velocity: a.velocity,
      endTick: a.endTick,
    }))
    .sort((a, b) => a.tick - b.tick || a.pitch - b.pitch || a.channel - b.channel);

  assert.deepEqual(
    actual,
    independent.map((n) => ({
      tick: n.onset * parsed.division,
      channel: n.channel,
      pitch: n.pitch,
      velocity: n.velocity,
      endTick: n.duration === null ? null : Math.round((n.onset + n.duration) * parsed.division),
    })),
  );
  assert.equal(actual.length, 5);
  assert.ok(new Set(actual.map((a) => a.velocity)).size > 1);
});

test('independent source staccato chords and tied notes retain their actual Note Off ticks', async () => {
  const result = await compiler.compile(
    String.raw`\score { \new Staff {
      <c' e' g'>4\staccato a'4~ a'2 } \midi { \tempo 4=120 } }`,
    { format: ['midi'] },
  );
  const file = Object.entries(result.files).find(([name]) => name.endsWith('.midi'))![1];
  const parsed = readMidiAttacks(file),
    independent = midiNotes(file);
  const actual = parsed.tracks
    .flatMap((t) => t.attacks)
    .sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);

  assert.deepEqual(
    actual.map((a) => [a.pitch, a.tick, a.endTick]),
    independent.map((n) => [
      n.pitch,
      n.onset * parsed.division,
      Math.round((n.onset + n.duration!) * parsed.division),
    ]),
  );
  assert.deepEqual(
    actual.map((a) => [a.pitch, (a.endTick! - a.tick) / parsed.division]),
    [
      [60, 0.5],
      [64, 0.5],
      [67, 0.5],
      [69, 3],
    ],
  );
});
