import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('per-staff piano timing retains both meters and matches independent LilyPond MIDI seconds', async () => {
  const source = String.raw`\score { \new PianoStaff <<
    \new Staff { \tempo 4 = 120 \time 3/4 c'2. d'2. } \new Staff { \time 2/4 e'2 f'2 g'2 }
    >> \layout { \enablePerStaffTiming } \midi { \enablePerStaffTiming } }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI());

  assert.deepEqual(
    elements(mei, 'meterSig').map((m) => [m.getAttribute('count'), m.getAttribute('unit')]),
    [
      ['3', '4'],
      ['2', '4'],
    ],
  );
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );

  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i]!.duration! - expected[i]!.duration!) < 0.01);
  }

  assert.ok(toolkit.renderToSVG(1).includes('meterSig'));
  assert.ok(score.diagnostics.some((d) => d.code === 'staff-timing-staves'));
});

test('independent part measure streams match source playback while Verovio rejects native multimetric measures', async () => {
  const source = String.raw`\score { \new StaffGroup <<
    \new Staff { \tempo 4 = 120 \time 3/4 c'2. d'2. } \new Staff { \time 2/4 e'2 f'2 g'2 }
    >> \layout { \enablePerStaffTiming } \midi { \enablePerStaffTiming } }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const written = elements(xml, 'part')
    .flatMap((part) => {
      const divisions = Number(part.getElementsByTagName('divisions')[0]!.textContent);
      let onset = 0;

      return elements(part, 'note').map((note) => {
        const step = note.getElementsByTagName('step')[0]!.textContent!,
          octave = Number(note.getElementsByTagName('octave')[0]!.textContent);
        const pitch =
          12 * (octave + 1) +
          ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<string, number>)[step]!;
        const duration =
          Number(note.getElementsByTagName('duration')[0]!.textContent) / divisions / 2;
        const result = { pitch, onset, duration };

        onset += duration;

        return result;
      });
    })
    .sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
  const expected = midiTimedNotes(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
  );

  assert.deepEqual(
    written,
    expected.map(({ pitch, onset, duration }) => ({ pitch, onset, duration })),
  );
  const reader = spawnSync(process.execPath, ['--import', 'tsx', 'test/support/read-musicxml.ts'], {
    input: score.musicxml,
    encoding: 'utf8',
  });

  assert.equal(reader.status, 1);
  assert.match(reader.stderr, /Multimetric music detected/);
  assert.ok(!score.diagnostics.some((d) => d.code === 'polymeter-reader'));
});
