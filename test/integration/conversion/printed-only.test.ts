import { toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { converter, elements, parse } from '../../support/conversion-support.js';
import { validate } from '../../support/schema.js';

test('only printed source scores export, retaining indexes across skipped MIDI-only scores', async () => {
  const result = await converter.convert(String.raw`\book {
    \score { { c'1 } \midi {} }
    \score { { d'1 } \layout {} \midi {} }
    \score { { e'1 } \midi {} }
    \score { { f'1 } }
  }`);

  assert.deepEqual(
    result.scores.map((score) => score.filename),
    ['score.2.musicxml', 'score.4.musicxml'],
  );
  assert.deepEqual(
    result.scores.map((score) => score.document.layoutRequested),
    [true, true],
  );
  assert.deepEqual(
    result.scores.map((score) => elements(parse(score.musicxml), 'step')[0]!.textContent),
    ['D', 'F'],
  );
  result.scores.forEach((score) => validate(score.musicxml));
  assert.ok(result.logs.every((line) => !line.includes('MIDI output to')));
});

test('MIDI performers never run on printed or skipped source scores', async () => {
  const result = await converter.convert(String.raw`
    #(define (forbidden-performer context) (error "MIDI performer must not run"))
    \score { { c'1 } \layout {} \midi { \context { \Voice \consists #forbidden-performer } } }
    \score { { d'1 } \midi { \context { \Voice \consists #forbidden-performer } } }
  `);

  assert.equal(result.scores.length, 1);
  validate(result.scores[0]!.musicxml);
  assert.ok(result.logs.every((line) => !line.includes('MIDI performer must not run')));
});

test('printed notation remains while MIDI settings and performance metadata are absent', async () => {
  const { scores } = await converter.convert(String.raw`\score {
    \new Staff \with { midiInstrument = "violin" midiPanPosition = #-1 } {
      \tempo 4 = 72 c'4\p\< d'\staccato e' f'\f | g'1~ g'1
    }
    \layout {}
    \midi { \tempo 4 = 88 \context { \Staff midiInstrument = "flute" } }
    \midi { \tempo 4 = 99 }
  }`);
  const score = scores[0]!,
    xml = parse(score.musicxml);

  validate(score.musicxml);
  assert.equal(elements(xml, 'pitch').length, 6);
  assert.equal(elements(xml, 'staccato').length, 1);
  assert.equal(elements(xml, 'tied').length, 2);
  assert.ok(elements(xml, 'dynamics').length >= 2);
  assert.ok(elements(xml, 'sound').some((sound) => sound.getAttribute('tempo') === '72'));
  assert.ok(
    elements(xml, 'sound').every(
      (sound) => !['88', '99'].includes(sound.getAttribute('tempo') ?? ''),
    ),
  );
  assert.equal(elements(xml, 'midi-instrument').length, 0);
  assert.ok(
    elements(xml, 'note').every((note) =>
      ['dynamics', 'attack', 'release'].every((name) => !note.hasAttribute(name)),
    ),
  );
  assert.ok(!('performedVelocity' in score.document));
  assert.ok(!('midiOutputCount' in score.document));
  assert.ok(!('cuePlaybackCaptured' in score.document));
  assert.ok(score.document.events.every((event) => String(event.kind) !== 'playback'));
});

test('MIDI-only tempo and controller settings do not create printed score events', async () => {
  const { scores } = await converter.convert(String.raw`\score {
    \new Staff \with { midiMinimumVolume = #0.2 midiMaximumVolume = #0.8 } { c'1 }
    \layout {} \midi { \tempo 4 = 88 }
  }`);
  const xml = parse(scores[0]!.musicxml);

  validate(scores[0]!.musicxml);
  assert.equal(elements(xml, 'metronome').length, 0);
  assert.equal(elements(xml, 'midi-instrument').length, 0);
  assert.ok(elements(xml, 'sound').every((sound) => sound.getAttribute('tempo') !== '88'));
});

test('MIDI-only inputs reject explicitly and the reusable converter recovers', async () => {
  await assert.rejects(
    converter.convert(String.raw`\score { { c'1 } \midi {} }`),
    /no printed score documents.*MIDI-only/,
  );
  const { scores } = await converter.convert(String.raw`{ d'1 }`);

  assert.equal(scores.length, 1);
  validate(scores[0]!.musicxml);
});

test('cached MIDI-only documents cannot be exported through the serializer', async () => {
  const { scores } = await converter.convert(String.raw`{ c'1 }`);

  assert.throws(
    () => toMusicXML({ ...scores[0]!.document, layoutRequested: false }),
    /MIDI-only score documents are not supported/,
  );
});

test('printed percent patterns retain notation without MIDI-derived silence', async () => {
  const { scores } = await converter.convert(String.raw`{ \repeat percent 2 { c'1 d'1 } e'1 }`);
  const xml = parse(scores[0]!.musicxml);

  validate(scores[0]!.musicxml);
  assert.equal(elements(xml, 'pitch').length, 5);
  assert.equal(elements(xml, 'symbol').length, 1);
  assert.equal(elements(xml, 'cue').length, 0);
  assert.ok(elements(xml, 'note').every((note) => !note.hasAttribute('dynamics')));
});
