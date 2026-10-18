import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, toolkit, playback } = await createReaderHarness();

for (const [name, music, midi, quote = String.raw`c'2 d'2`] of [
  [
    'default quoted cues',
    String.raw`\new Voice { \cueDuring "flute" #UP { R1 } e'1 }`,
    String.raw`\midi {}`,
  ],
  [
    'quoted cues sharing a voice with their main rest',
    String.raw`{ \cueDuring "flute" #UP { R1 } e'1 }`,
    String.raw`\midi { \context { \Score quotedCueEventTypes = #'(rest-event) } }`,
  ],
  [
    'suppressed quoted cues',
    String.raw`\new Voice { \cueDuring "flute" #UP { R1 } e'1 }`,
    String.raw`\midi { \context { \Score quotedCueEventTypes = #'(rest-event) } }`,
  ],
  [
    'voice-level cue filter overrides',
    String.raw`\new Voice { \cueDuring "flute" #UP { R1 } e'1 }`,
    String.raw`\midi { \context { \Score quotedCueEventTypes = #'(rest-event) } \context { \Voice quotedCueEventTypes = #'(note-event) } }`,
  ],
  [
    'ordinary quotes beside suppressed cues',
    String.raw`<< \new Staff \new Voice { \cueDuring "flute" #UP { R1 } e'1 } \new Staff \new Voice { \quoteDuring "flute" { s1 } f'1 } >>`,
    String.raw`\midi { \context { \Score quotedCueEventTypes = #'(rest-event) } }`,
  ],
  [
    'audible notes sharing a suppressed cue pitch',
    String.raw`\new Staff << \new Voice { c'1 e'1 } \new Voice { \cueDuring "flute" #UP { s1 } s1 } >>`,
    String.raw`\midi { \context { \Score quotedCueEventTypes = #'(rest-event) } }`,
  ],
  [
    'ordinary quotes starting inside a skip',
    String.raw`\new Voice { \quoteDuring "flute" { s1 } e'1 }`,
    String.raw`\midi {}`,
    String.raw`s2 c'2`,
  ],
]) {
  test(`printed quote notation ignores MIDI settings for ${name}`, async () => {
    const printed =
      String.raw`\addQuote "flute" { ` +
      quote +
      String.raw` } \score { ` +
      music +
      String.raw` \layout {} `;
    const [{ scores }, control] = await Promise.all([
      converter.convert(printed + midi + ' }'),
      converter.convert(printed + ' }'),
    ]);

    validate(scores[0]!.musicxml);
    const notes = (score: (typeof scores)[number]) =>
      score.document.events
        .filter((e) => e.kind === 'note')
        .map((e) => ({
          pitch: e.pitch,
          duration: e.duration,
          moment: e.moment,
          cue: e.cue,
          quotedCue: e.quotedCue,
        }));

    assert.deepEqual(notes(scores[0]!), notes(control.scores[0]!));
    assert.ok(
      scores[0]!.document.events
        .filter((e) => e.kind === 'note')
        .filter((e) => e.quotedCue)
        .every((e) => e.cue),
    );
    assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
    assert.ok(toolkit.renderToSVG(1).includes('class="notehead"'));
  });
}

test('quoted grace notes retain printed cue notation and source playback diagnostics', async () => {
  const source = String.raw`\addQuote "flute" { \grace { c'16 d' } e'1 } \score { \new Voice { \cueDuring "flute" #UP { \grace { s8 } R1 } f'1 } \layout {} \midi { \context { \Score quotedCueEventTypes = #'(rest-event) } } }`;
  const { scores } = await converter.convert(source);

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'grace-playback'));
  const cueIds = elements(parse(scores[0]!.musicxml), 'note')
    .filter((note) => note.getElementsByTagName('cue').length)
    .map((note) => note.getAttribute('id'));

  assert.equal(cueIds.length, 3);
  const scheduled = toolkit.renderToTimemap().flatMap((e) => e.on || []);

  assert.ok(cueIds.every((id) => scheduled.includes(id!)));
});

test('Verovio renders explicit cue notes and rests smaller while retaining their playback', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff << \new CueVoice { c'4 r4 <d' f'>2 } \new Voice { g'1 } >>`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const mei = toolkit.getMEI();

  assert.equal((mei.match(/<note [^>]*cue="true"/g) || []).length, 3);
  assert.equal((mei.match(/<rest [^>]*cue="true"/g) || []).length, 1);
  const svg = toolkit.renderToSVG(1);

  assert.match(svg, /scale\(0\.54, 0\.54\)/);
  assert.match(svg, /scale\(0\.72, 0\.72\)/);
  const actual = playback();

  assert.deepEqual(
    actual.map((e) => e.pitch).sort((a, b) => a - b),
    [60, 62, 65, 67],
  );
  const normal = await converter.convert(
    String.raw`\new Staff << \new Voice { c'4 r4 <d' f'>2 } \new Voice { g'1 } >>`,
  );

  assert.equal(toolkit.loadData(normal.scores[0]!.musicxml), 1);
  assert.deepEqual(actual, playback());
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'note-size-reader'));
});

test('cue grace and large note sizes remain native when Verovio drops their sizes', async () => {
  const { scores } = await converter.convert(
    String.raw`\new CueVoice { \grace { c'16 d' } e'1 \set fontSize = #2 f'1 }`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  const mei = toolkit.getMEI();

  assert.equal((mei.match(/<note [^>]*grace="acc"/g) || []).length, 2);
  assert.equal((mei.match(/<note [^>]*cue="true"/g) || []).length, 1);
  assert.equal((mei.match(/<note /g) || []).length, 4);
  assert.ok(toolkit.renderToSVG(1).includes('class="notehead"'));
  assert.deepEqual(
    playback().map((e) => e.pitch),
    [60, 62, 64, 65],
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'note-size-reader'));
});
