import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { LilyPondCompileError } from '@sightread/lilypond-wasm';
import { type ScoreDocument, convert, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  childElements,
  converter,
  elements,
  parse,
  texts,
} from '../../support/conversion-support.js';
import { validate } from '../../support/schema.js';

test('articulation and technique marks use compiler-resolved placement and native shapes', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4_\marcato d'4\espressivo e'4\snappizzicato f'4_\upbow | c'4_\downbow d'4^\portato e'4\thumb f'4\halfopen }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'strong-accent')[0]!.getAttribute('type'), 'down');
  assert.equal(elements(xml, 'strong-accent')[0]!.getAttribute('placement'), 'below');
  assert.equal(elements(xml, 'soft-accent')[0]!.getAttribute('placement'), 'below');
  assert.equal(elements(xml, 'snap-pizzicato').length, 1);
  assert.equal(elements(xml, 'up-bow')[0]!.getAttribute('placement'), 'below');
  assert.equal(elements(xml, 'down-bow')[0]!.getAttribute('placement'), 'below');
  assert.equal(elements(xml, 'detached-legato')[0]!.getAttribute('placement'), 'above');
  assert.equal(elements(xml, 'thumb-position').length, 1);
  assert.equal(elements(xml, 'half-muted').length, 1);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'technical-reader'));
});

test('hidden articulations retain native meaning without printing their marks', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \omit Script c'4\staccato \once \override Script.transparent = ##t d'4\tenuto e'4\accent f'4_\fermata }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  for (const tag of ['staccato', 'tenuto']) {
    assert.equal(
      elements(xml, tag)[0]!.parentElement!.parentElement!.getAttribute('print-object'),
      'no',
    );
  }

  assert.equal(elements(xml, 'fermata')[0]!.getAttribute('type'), 'inverted');
  assert.notEqual(
    elements(xml, 'accent')[0]!.parentElement!.parentElement!.getAttribute('print-object'),
    'no',
  );
});

test('fermata variants and ordinary or multi-measure rest fermatas remain native', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4\veryshortfermata d'4\verylongfermata e'4\henzeshortfermata f'4_\henzelongfermata | R1\fermata r1_\shortfermata }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'fermata'), [
    'double-angled',
    'double-square',
    'half-curve',
    'double-dot',
    '',
    'angled',
  ]);
  assert.equal(elements(xml, 'fermata')[3]!.getAttribute('type'), 'inverted');
  const restNotes = elements(xml, 'note').filter((n) => elements(n, 'rest').length);

  assert.equal(restNotes.length, 2);
  assert.ok(restNotes.every((n) => elements(n, 'fermata').length === 1));
});

test('native heel and toe techniques retain side placement and report unmapped variants', async () => {
  const { scores } = await converter.convert(String.raw`{ c'4\rheel d'4\lheel e'4\rtoe f'4\ltoe }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'heel').map((e) => e.getAttribute('placement')),
    ['above', 'below'],
  );
  assert.deepEqual(
    elements(xml, 'toe').map((e) => e.getAttribute('placement')),
    ['above', 'below'],
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'technical-reader'));
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'technical-variant'));
});

test('removed Script engravers keep playing-technique semantics hidden', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Voice \with { \remove Script_engraver } { c'4\staccato d'4\marcato e'4\upbow f'4\snappizzicato }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'notations').length, 4);
  assert.ok(elements(xml, 'notations').every((n) => n.getAttribute('print-object') === 'no'));
});

test('resolved glyph substitutions replace articulation shapes and retain explicit diagnostics', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \override Script.script-stencil = #'(feta . ("sforzato" . "sforzato")) c'4\staccato \once \override Script.script-stencil = #'(feta . ("dmarcato" . "dmarcato")) d'4^\marcato \once \override Script.stencil = #ly:text-interface::print e'4\accent f'4\tenuto }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'staccato').length, 0);
  assert.equal(elements(xml, 'accent').length, 2);
  assert.equal(elements(xml, 'strong-accent')[0]!.getAttribute('type'), 'down');
  assert.equal(elements(xml, 'strong-accent')[0]!.getAttribute('placement'), 'above');
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'script-glyph'));
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'script-stencil'));
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'articulation-orientation-reader'));
});

test('chord-wide scripts print once while per-note scripts retain separate identities', async () => {
  const { scores } = await converter.convert(
    String.raw`{ <c' e' g'>2\accent <d'\tenuto f'\staccato a'>2\snappizzicato }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  for (const tag of ['accent', 'tenuto', 'staccato', 'snap-pizzicato']) {
    assert.equal(elements(xml, tag).length, 1);
  }
});

test('multi-measure-rest scripts remain attached to rests beside quoted notes', async () => {
  const { scores } = await converter.convert(
    String.raw`\addQuote "flute" {c'2 d'2} { \cueDuring "flute" #UP {R1\fermata} }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'fermata').length, 1);
  const parent = elements(xml, 'fermata')[0]!.parentNode!.parentNode;

  assert.equal(elements(parent, 'rest').length, 1);
  assert.ok(
    scores[0]!.document.events.some(
      (e) => e.kind === 'voice' && e.class === 'articulation-event' && e.multiMeasureRest,
    ),
  );
  assert.ok(
    !scores[0]!.diagnostics.some(
      (d) => d.code === 'unmapped-event' && d.message.includes('multi-measure-articulation'),
    ),
  );
});

test('compound ornaments retain native lengths, approaches, departures, and placement', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4^\upprall d'4_\downprall e'4\upmordent f'4\downmordent | c'4\prallup d'4\pralldown e'4\prallprall f'4\prallmordent | c'4\slashturn d'4\haydnturn e'4\bachschleifer f'4\lineprall }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const marks = elements(xml, 'ornaments').map(
    (o) => o.firstElementChild || [...o.childNodes].find((n): n is Element => n?.nodeType === 1),
  );

  assert.deepEqual(
    marks.map((e) => [
      e!.nodeName,
      e!.getAttribute('long'),
      e!.getAttribute('approach'),
      e!.getAttribute('departure'),
    ]),
    [
      ['inverted-mordent', 'yes', 'below', null],
      ['inverted-mordent', 'yes', 'above', null],
      ['mordent', 'yes', 'below', null],
      ['mordent', 'yes', 'above', null],
      ['inverted-mordent', 'yes', null, 'above'],
      ['inverted-mordent', 'yes', null, 'below'],
      ['inverted-mordent', 'yes', null, null],
      ['mordent', 'yes', null, null],
      ['turn', null, null, null],
      ['haydn', null, null, null],
      ['schleifer', null, null, null],
      ['inverted-mordent', 'yes', 'above', null],
    ],
  );
  assert.equal(marks[0]!.getAttribute('placement'), 'above');
  assert.equal(marks[1]!.getAttribute('placement'), 'below');
  assert.equal(marks[8]!.getAttribute('slash'), 'yes');
  assert.equal(scores[0]!.document.events.filter((e) => e.kind === 'script').length, 12);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'ornament-variant'));
});

test('removing the Script engraver does not resurrect the ornament from its event', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Voice \with { \remove Script_engraver } { c'1\trill }`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(scores[0]!.document.scriptsCaptured, true);
  assert.equal(elements(parse(scores[0]!.musicxml), 'trill-mark').length, 0);
});

test('per-note ornaments inside chords keep their own script identity', async () => {
  const { scores } = await converter.convert(String.raw`{ <c'\turn e'\reverseturn>1 }`);

  validate(scores[0]!.musicxml);
  const notes = elements(parse(scores[0]!.musicxml), 'note');

  assert.equal(elements(notes[0], 'turn').length, 1);
  assert.equal(elements(notes[1], 'inverted-turn').length, 1);
});

test('resolved ornament glyph overrides and custom drawings are explicitly reported', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \override Script.script-stencil = #'(feta . ("turn" . "turn")) c'4\trill \once \override Script.stencil = #ly:text-interface::print d'4\prall \once \override Script.font-size = #2 e'4\mordent f'4\lineprall }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'trill-mark').length, 0);
  assert.equal(elements(xml, 'turn').length, 1);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'ornament-glyph'));
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'ornament-stencil'));
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'script-size-reader'));
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'ornament-variant'));
});

test('horizontal Schleifer keeps its native staff position without treating left as below', async () => {
  const { scores } = await converter.convert(String.raw`{ c'1\bachschleifer }`);

  validate(scores[0]!.musicxml);
  const graphic = scores[0]!.document.events.find((e) => e.kind === 'script');
  const mark = elements(parse(scores[0]!.musicxml), 'schleifer')[0];

  assert.equal(graphic!.axis, 0);
  assert.equal(mark!.getAttribute('placement'), null);
  assert.equal(mark!.getAttribute('default-y'), String((graphic!.staffPosition! - 4) * 5));
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'ornament-placement'));
});

test('older decoded documents retain native ornament mapping without resolved script graphics', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4_\prallprall d'4\haydnturn e'4\slashturn f'4\trill }`,
  );
  const document = structuredClone(scores[0]!.document);

  delete document.scriptsCaptured;
  document.events = document.events.filter((e) => e.kind !== 'script');
  const result = toMusicXML(document);

  validate(result.musicxml);
  const xml = parse(result.musicxml);

  assert.equal(elements(xml, 'inverted-mordent')[0]!.getAttribute('placement'), 'below');
  assert.equal(elements(xml, 'haydn').length, 1);
  assert.equal(elements(xml, 'turn')[0]!.getAttribute('slash'), 'yes');
});

test('separate scores reset script identifiers and resolved visibility', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { { \omit Script c'1\turn } } \score { { d'1\turn } }`,
  );

  for (const score of scores) {
    validate(score.musicxml);
  }

  assert.deepEqual(
    scores.map((s) => s.document.events.find((e) => e.kind === 'script')!.id),
    [1, 1],
  );
  assert.deepEqual(
    scores.map((s) => elements(parse(s.musicxml), 'turn').length),
    [0, 1],
  );
});

test('percent repeats retain ornament shapes and original visibility on hidden playback copies', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \repeat percent 2 { c'4\prallprall \once \omit Script d'4\trill e'4\haydnturn f'4\turn } }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'inverted-mordent').length, 2);
  assert.equal(elements(xml, 'haydn').length, 2);
  assert.equal(elements(xml, 'turn').length, 2);
  assert.equal(elements(xml, 'trill-mark').length, 0);
  assert.equal(
    elements(xml, 'notations').filter((e) => e.getAttribute('print-object') === 'no').length,
    3,
  );
});

test('explicit cue voices retain smaller notes and rests without muting playback', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff << \new CueVoice { c'4 r4 <d' f'>2 } \new Voice { g'1 } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'type').map((e) => e.getAttribute('size')),
    ['cue', 'cue', 'cue', 'cue', null],
  );
  assert.equal(elements(xml, 'cue').length, 0);
  const sizes = scores[0]!.document.events.filter((e) => e.kind === 'noteSize');

  assert.deepEqual(
    sizes.map((e) => e.fontSize),
    [-4, -4, -4, -4, 0],
  );
  assert.ok(Math.abs(Number(texts(xml, 'note-size')[0]) - 100 * 2 ** (-4 / 6)) < 1e-6);
});

test('grace notes and cue grace notes retain their separate size defaults', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { { \grace { c'16 d' } e'1 } } \score { \new CueVoice { \grace { c'16 d' } e'1 } }`,
  );

  for (const score of scores) {
    validate(score.musicxml);
  }

  const normal = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(normal, 'type').map((e) => e.getAttribute('size')),
    [null, null, null],
  );
  assert.equal(elements(normal, 'note-size')[0]!.getAttribute('type'), 'grace');
  const cue = parse(scores[1]!.musicxml);

  assert.deepEqual(
    elements(cue, 'type').map((e) => e.getAttribute('size')),
    ['grace-cue', 'grace-cue', 'cue'],
  );
  assert.deepEqual(
    elements(cue, 'note-size').map((e) => e.getAttribute('type')),
    ['grace-cue', 'cue'],
  );
  assert.equal(elements(cue, 'cue').length, 0);
});

test('resolved note and rest sizes follow local overrides and report category collisions', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \tiny c'4 r4 \small d'4 \normalsize e'4 \override NoteHead.font-size = #2 f'4 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'type').map((e) => e.getAttribute('size')),
    ['cue', 'cue', 'cue', null, 'large'],
  );
  assert.ok(scores[0]!.diagnostics.some((e) => e.code === 'note-size-variation'));
  assert.ok(scores[0]!.diagnostics.some((e) => e.code === 'note-size-components'));
  assert.ok(!scores[0]!.diagnostics.some((e) => e.code === 'note-size-reader'));
  assert.deepEqual(
    scores[0]!.document.events.filter((e) => e.kind === 'noteSize').map((e) => e.fontSize),
    [-2, -2, -1, 0, 2],
  );
});

test('quoted cues retain printed notation while ordinary quotes and explicit cue voices stay distinct', async () => {
  const { scores } = await converter.convert(
    String.raw`\addQuote "flute" { c'2 d'2 } \score { { \cueDuring "flute" #UP { R1 } } } \score { { \quoteDuring "flute" { s1 } } } \score { \new CueVoice = "cue" { e'1 } }`,
  );

  assert.equal(scores.length, 3);

  for (const score of scores) {
    validate(score.musicxml);
  }

  assert.deepEqual(
    scores.map((s) => s.document.cueQuotes === true),
    [true, false, false],
  );
  assert.deepEqual(
    scores.map((s) => s.diagnostics.some((d) => d.code === 'cue-playback')),
    [true, false, false],
  );
  assert.deepEqual(
    scores[0]!.document.events.filter((e) => e.kind === 'note').map((e) => [e.quotedCue, e.cue]),
    [
      [true, true],
      [true, true],
    ],
  );
  assert.equal(elements(parse(scores[0]!.musicxml), 'pitch').length, 2);
  assert.deepEqual(
    elements(parse(scores[0]!.musicxml), 'note')
      .filter((e) => elements(e, 'pitch').length)
      .map((e) => elements(e, 'type')[0]!.getAttribute('size')),
    ['cue', 'cue'],
  );
});

test('decoded documents without size graphics preserve their existing note representation', async () => {
  const { scores } = await converter.convert(String.raw`\new CueVoice { c'1 }`);
  const document = structuredClone(scores[0]!.document);

  document.events = document.events.filter((e) => e.kind !== 'noteSize');
  const { musicxml } = toMusicXML(document);

  validate(musicxml);
  assert.equal(elements(parse(musicxml), 'type')[0]!.getAttribute('size'), null);
});

test('suppressed quoted cues retain native silent notes and printed ties', async () => {
  const { scores } = await converter.convert(
    String.raw`\addQuote "flute" { c'2~ c'2 } \score { \new Voice { \cueDuring "flute" #UP { R1 } d'1 } \layout {} \midi { \context { \Score quotedCueEventTypes = #'(rest-event) } } }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'cue').length, 2);
  assert.equal(elements(xml, 'tie').length, 0);
  assert.deepEqual(
    elements(xml, 'tied').map((e) => e.getAttribute('type')),
    ['start', 'stop'],
  );
  assert.deepEqual(
    elements(xml, 'note')
      .filter((e) => elements(e, 'cue').length)
      .map((e) => e.getAttribute('dynamics')),
    [null, null],
  );
  assert.deepEqual(
    scores[0]!.document.events.filter((e) => e.kind === 'note').map((e) => e.cue),
    [true, true, undefined],
  );
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'cue-playback'));
});

test('quoted event copies do not silence ordinary quotes or explicit cue voices with the same name', async () => {
  const { scores } = await converter.convert(
    String.raw`\addQuote "flute" { c'2 d'2 } \score { << \new Staff << \new Voice { \cueDuring "flute" #UP { R1 } } \new CueVoice = "cue" { e'1 } >> \new Staff \new Voice { \quoteDuring "flute" { s1 } } >> \layout {} \midi { \context { \Score quotedCueEventTypes = #'(rest-event) } } }`,
  );

  validate(scores[0]!.musicxml);
  const notes = scores[0]!.document.events.filter((e) => e.kind === 'note');

  assert.equal(notes.filter((e) => e.cue).length, 2);
  assert.equal(notes.filter((e) => e.quotedCue).length, 2);
  assert.equal(notes.filter((e) => !e.quotedCue).length, 3);
  assert.ok(notes.filter((e) => !e.quotedCue).every((e) => e.cue === undefined));
});

test('full-size quoted notes retain their full-size native type', async () => {
  const { scores } = await converter.convert(
    String.raw`\addQuote "flute" { c'1 } \score { \new Staff \new Voice { \cueDuring "flute" #UP { R1 } } \layout { \context { \CueVoice fontSize = #0 } } \layout {} \midi { \context { \Score quotedCueEventTypes = #'(rest-event) } } }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const note = elements(xml, 'note').find((e) => elements(e, 'pitch').length);

  assert.equal(elements(note, 'cue').length, 1);
  assert.equal(elements(note, 'type')[0]!.getAttribute('size'), 'full');
});

const examples: [string, string, Record<string, string>?][] = [
  [
    'relative pitches, includes, Scheme and transpose',
    String.raw`\version "2.26.0" \include "melody.ily" \header { title = "A & B" composer = "Test" } \score { \transpose c d \relative c' { \melody #(make-music 'NoteEvent 'pitch (ly:make-pitch 0 0 0) 'duration (ly:make-duration 2)) } }`,
    { 'melody.ily': String.raw`melody = { c4 d e }` },
  ],
  [
    'polyphony, piano staves and chords',
    String.raw`\version "2.26.0" \new PianoStaff << \new Staff << { <c' e' g'>2 <d' f' a'> } \\ { c'1 } >> \new Staff { \clef bass c1 } >>`,
  ],
  [
    'tuplets, ties, dynamics, slurs, accents and fingering',
    String.raw`\version "2.26.0" \relative c' { \time 4/4 \tempo "Andante" 4 = 80 \tuplet 3/2 { c8(\p d e) } f4-1-. g4~ g4 | g1\f\fermata }`,
  ],
  [
    'pickups, key changes, grace notes, rests and barlines',
    String.raw`\version "2.26.0" \relative c' { \time 3/4 \partial 4 g4 | \key d \major \grace { a16 b } cis4 r4 d4 | \key g \major g2. \bar "|." }`,
  ],
  [
    'repeats and endings',
    String.raw`\version "2.26.0" \relative c' { \repeat volta 2 { c1 } \alternative { { d1 } { e1 } } }`,
  ],
  [
    'lyrics and pedals',
    String.raw`\version "2.26.0" << \new Staff \new Voice = "melody" { c'4\sustainOn d' e'\sustainOff f' } \new Lyrics \lyricsto "melody" { Hel -- lo world now } >>`,
  ],
];

for (const [name, source, files] of examples) {
  test(name, async () => {
    const { scores } = await converter.convert(source, files ? { files } : {});

    assert.equal(scores.length, 1);
    const score = scores[0];

    validate(score!.musicxml);
    const xml = parse(score!.musicxml);
    const sourceField = elements(xml, 'miscellaneous-field').find(
      (e) => e.getAttribute('name') === 'lilypond-source',
    );

    assert.equal(sourceField!.textContent, source);
    assert.equal(
      elements(xml, 'pitch').length,
      score!.document.events.filter((e) => e.kind === 'note' && e.pitch && e.duration).length,
    );
    assert.ok(elements(xml, 'measure').length > 0);

    if (name.startsWith('relative')) {
      assert.deepEqual(texts(xml, 'step'), ['D', 'E', 'F', 'D']);
      assert.equal(texts(xml, 'work-title')[0], 'A & B');
    }

    if (name.startsWith('polyphony')) {
      assert.equal(elements(xml, 'part').length, 1);
      assert.equal(texts(xml, 'staves')[0], '2');
      assert.equal(elements(xml, 'chord').length, 4);
      assert.equal(elements(xml, 'backup').length, 2);
    }

    if (name.startsWith('tuplets')) {
      assert.equal(elements(xml, 'time-modification').length, 3);
      assert.deepEqual(texts(xml, 'actual-notes'), ['3', '3', '3']);
      assert.deepEqual(
        elements(xml, 'tie').map((e) => e.getAttribute('type')),
        ['start', 'stop'],
      );
      assert.equal(elements(xml, 'staccato').length, 1);
      assert.equal(elements(xml, 'fingering').length, 1);
    }

    if (name.startsWith('lyrics')) {
      assert.deepEqual(texts(xml, 'text'), ['Hel', 'lo', 'world', 'now']);
      assert.equal(elements(xml, 'pedal').length, 2);
    }
  });
}

test('all scores and books are returned in order without event leakage', async () => {
  const { scores } = await converter.convert(
    String.raw`\version "2.26.0" \book { \score { { c'1 } } \score { { d'1 } } } \book { \score { { e'1 } } }`,
  );

  assert.equal(scores.length, 3);
  assert.deepEqual(
    scores.map((s) => texts(parse(s.musicxml), 'step')),
    [['C'], ['D'], ['E']],
  );
  scores.forEach((s) => validate(s.musicxml));
});

test('invalid source rejects with compiler logs', async () => {
  await assert.rejects(
    converter.convert(String.raw`\version "2.26.0" { \noSuchMusic }`),
    (e) => e instanceof LilyPondCompileError && e.logs.some((l) => l.includes('error')),
  );
});

test('empty input and malformed event documents reject', async () => {
  await assert.rejects(convert(''), /nonempty/);
  assert.throws(() => toMusicXML({} as ScoreDocument), /version 1/);
});

test('aborted compilation rejects', async () => {
  const signal = AbortSignal.abort();

  await assert.rejects(converter.convert('{ c1 }', { signal }), {
    name: 'AbortError',
  });
});

test('pickup gets a separate implicit measure with correct durations', async () => {
  const { scores } = await converter.convert(
    String.raw`\relative c' { \time 3/4 \partial 4 g4 | c2. | d2. }`,
  );

  validate(scores[0]!.musicxml);
  const measures = elements(parse(scores[0]!.musicxml), 'measure');

  assert.equal(measures.length, 3);
  assert.equal(measures[0]!.getAttribute('implicit'), 'yes');
  assert.equal(measures[0]!.getAttribute('number'), '0');
  assert.deepEqual(
    measures.map((m) => texts(m, 'duration')),
    [['1'], ['3'], ['3']],
  );
});

test('multiple rests occupy every measure and preserve their bracket', async () => {
  const { scores } = await converter.convert("{ R1*3 c'1 }");

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 4);
  assert.equal(elements(xml, 'rest').length, 3);
  assert.deepEqual(texts(xml, 'duration'), ['4', '4', '4', '4']);
  assert.deepEqual(texts(xml, 'multiple-rest'), ['3']);
});

test('endings and tuplet brackets have matched starts and stops', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \repeat volta 2 { \tuplet 3/2 { c'8 d' e' } f'4 g'2 } \alternative { { a'1 } { b'1 } } }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'ending').map((e) => [e.getAttribute('number'), e.getAttribute('type')]),
    [
      ['1', 'start'],
      ['1', 'stop'],
      ['2', 'start'],
      ['2', 'discontinue'],
    ],
  );
  assert.deepEqual(
    elements(xml, 'tuplet').map((e) => [e.getAttribute('number'), e.getAttribute('type')]),
    [
      ['1', 'start'],
      ['1', 'stop'],
    ],
  );
});

test('octave shifts stop and mid-measure clefs retain their position', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \ottava #1 c'2 \clef bass c'2 \ottava #0 c'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'octave-shift').map((e) => e.getAttribute('type')),
    ['down', 'stop'],
  );
  assert.deepEqual(texts(xml, 'sign'), ['G', 'F']);
});

test('book, bookpart and score headers inherit with local precedence', async () => {
  const { scores } = await converter.convert(
    String.raw`\header { title = "Global" composer = "Composer" } \book { \header { title = "Book" } \score { { c'1 } } \bookpart { \header { title = "Movement" } \score { { d'1 } } \score { \header { title = "Local" } { e'1 } } } }`,
  );

  assert.deepEqual(
    scores.map((s) => s.document.header.title),
    ['Book', 'Movement', 'Local'],
  );
  assert.deepEqual(
    scores.map((s) => s.document.header.composer),
    ['Composer', 'Composer', 'Composer'],
  );
  scores.forEach((s) => validate(s.musicxml));
});

test('mid-measure keys and clefs precede notes at their exact musical position', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4 \key g \major d'4 \clef bass e'4 f'4 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const measure = elements(xml, 'measure')[0];
  const divisions = Number(texts(xml, 'divisions')[0]);
  let position = 0;
  const timeline = [];

  for (const child of childElements(measure!)) {
    if (child.nodeName === 'attributes') {
      if (elements(child, 'key').length) {
        timeline.push(['key', position / divisions]);
      }

      if (elements(child, 'clef').length) {
        timeline.push(['clef', position / divisions]);
      }
    }

    if (child.nodeName === 'note') {
      timeline.push(['note', texts(child, 'step')[0], position / divisions]);

      if (!elements(child, 'chord').length) {
        position += Number(texts(child, 'duration')[0] || 0);
      }
    }

    if (child.nodeName === 'forward') {
      position += Number(texts(child, 'duration')[0]);
    }

    if (child.nodeName === 'backup') {
      position -= Number(texts(child, 'duration')[0]);
    }
  }

  assert.deepEqual(timeline, [
    ['clef', 0],
    ['note', 'C', 0],
    ['key', 1],
    ['note', 'D', 1],
    ['clef', 2],
    ['note', 'E', 2],
    ['note', 'F', 3],
  ]);
  assert.equal(position / divisions, 4);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'mid-measure-key'));
});

test('independent instruments stay separate inside nested staff groups', async () => {
  const { scores } = await converter.convert(
    String.raw`\new StaffGroup << \new ChoirStaff << \new Staff { c'1 } \new Staff { e'1 } >> \new PianoStaff << \new Staff { g'1 } \new Staff { \clef bass c1 } >> >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'part').length, 3);
  assert.deepEqual(
    elements(xml, 'part').map((p) => texts(p, 'staves')),
    [[], [], ['2']],
  );
  assert.deepEqual(
    elements(xml, 'part-group').map((g) => [g.getAttribute('type'), g.getAttribute('number')]),
    [
      ['start', '1'],
      ['start', '2'],
      ['stop', '2'],
      ['stop', '1'],
    ],
  );
  assert.deepEqual(texts(xml, 'group-barline'), ['yes', 'no']);
});

test('beam hooks do not become extra full beams', async () => {
  const { scores } = await converter.convert(String.raw`{ c'16 [ d'8. e'16 f'8. ] }`);

  validate(scores[0]!.musicxml);
  const notes = elements(parse(scores[0]!.musicxml), 'note');

  assert.deepEqual(
    notes.map((n) => elements(n, 'beam').map((b) => [b.getAttribute('number'), b.textContent])),
    [
      [
        ['1', 'begin'],
        ['2', 'forward hook'],
      ],
      [['1', 'continue']],
      [
        ['1', 'continue'],
        ['2', 'forward hook'],
      ],
      [['1', 'end']],
    ],
  );
});

test('key modes and staff numbers are preserved on piano staves', async () => {
  const { scores } = await converter.convert(
    String.raw`\new PianoStaff << \new Staff { \key d \dorian d'1 } \new Staff { \clef bass \key a \minor a1 } >>`,
  );

  validate(scores[0]!.musicxml);
  const keys = elements(parse(scores[0]!.musicxml), 'key');

  assert.deepEqual(
    keys.map((k) => [k.getAttribute('number'), texts(k, 'fifths')[0], texts(k, 'mode')[0]]),
    [
      ['1', '0', 'dorian'],
      ['2', '0', 'minor'],
    ],
  );
});

test('lyric extenders continue across skipped syllables and stop before the next word', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Voice = "v" { c'4 d' e' f' g' a' b' c'' } \new Lyrics \lyricsto "v" { Hel -- lo __ _ _ world now end } >>`,
  );

  validate(scores[0]!.musicxml);
  const notes = elements(parse(scores[0]!.musicxml), 'note');

  assert.deepEqual(
    notes.map((n) => [
      texts(n, 'text'),
      texts(n, 'syllabic'),
      elements(n, 'extend').map((e) => e.getAttribute('type')),
    ]),
    [
      [['Hel'], ['begin'], []],
      [['lo'], ['end'], ['start']],
      [[], [], ['continue']],
      [[], [], ['stop']],
      [['world'], ['single'], []],
      [['now'], ['single'], []],
      [['end'], ['single'], []],
      [[], [], []],
    ],
  );
});

test('an explicit tie survives after a note is split across measure boundaries', async () => {
  const { scores } = await converter.convert(String.raw`{ c'1*2 ~ c'1 }`);

  validate(scores[0]!.musicxml);
  const notes = elements(parse(scores[0]!.musicxml), 'note');

  assert.deepEqual(
    notes.map((n) => elements(n, 'tie').map((t) => t.getAttribute('type'))),
    [['start'], ['stop', 'start'], ['stop']],
  );
  assert.deepEqual(
    notes.map((n) => texts(n, 'duration')),
    [['4'], ['4'], ['4']],
  );
});

test('unchanged meters retain their style without reappearing in every measure', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1 d'1 \numericTimeSignature e'1 \time 3/4 f'2. g'2. }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'time').map((t) => [
      t.getAttribute('symbol'),
      texts(t, 'beats')[0],
      texts(t, 'beat-type')[0],
    ]),
    [
      ['common', '4', '4'],
      [null, '4', '4'],
      [null, '3', '4'],
    ],
  );
  assert.deepEqual(
    elements(xml, 'measure').map((m) => elements(m, 'time').length),
    [1, 0, 1, 1, 0],
  );
});

test('scaled durations still match their written types after measure splitting', async () => {
  const { scores } = await converter.convert(String.raw`{ c'1*5/3 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const divisions = Number(texts(xml, 'divisions')[0]);
  const notes = elements(xml, 'note');

  assert.equal(notes.length, 2);
  assert.deepEqual(
    notes.map((n) => Number(texts(n, 'duration')[0]) / divisions),
    [4, 8 / 3],
  );
  assert.deepEqual(
    notes.map((n) => texts(n, 'type')),
    [['whole'], ['whole']],
  );
  assert.deepEqual(
    notes.map((n) => [texts(n, 'actual-notes'), texts(n, 'normal-notes')]),
    [
      [[], []],
      [['3'], ['2']],
    ],
  );
});

test('pitched rests retain their staff position', async () => {
  const { scores } = await converter.convert(String.raw`{ e'4\rest r4 c'2 }`);

  validate(scores[0]!.musicxml);
  const rests = elements(parse(scores[0]!.musicxml), 'rest');

  assert.deepEqual(
    rests.map((r) => [texts(r, 'display-step'), texts(r, 'display-octave')]),
    [
      [['E'], ['4']],
      [[], []],
    ],
  );
});

test('forced system and page breaks become native MusicXML print instructions', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1 \break d'1 \pageBreak e'1 \noBreak f'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'measure').map((m) =>
      elements(m, 'print')
        .filter((p) => p.hasAttribute('new-system') || p.hasAttribute('new-page'))
        .map((p) => [p.getAttribute('new-system'), p.getAttribute('new-page')]),
    ),
    [[[null, 'yes']], [['yes', 'no']], [['yes', 'yes']], [['no', null]]],
  );
  assert.deepEqual(
    scores[0]!.document.pageLayouts!.map((row) => [row.system, row.page]),
    [
      [1, 1],
      [2, 1],
      [3, 2],
    ],
  );
  assert.equal(scores[0]!.document.events.filter((e) => e.kind === 'layout').length, 4);
});

test('instrument transposition preserves written pitches and sounding intervals', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \transposition bes c'1 \transposition bes, c'2 \transposition c' c'2 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'step'), ['C', 'C', 'C']);
  assert.deepEqual(
    elements(xml, 'transpose').map((t) => [
      texts(t, 'diatonic'),
      texts(t, 'chromatic'),
      texts(t, 'octave-change'),
    ]),
    [
      [['-1'], ['-2'], []],
      [['-1'], ['-2'], ['-1']],
      [['0'], ['0'], []],
    ],
  );
  const second = elements(xml, 'measure')[1];

  assert.deepEqual(
    Array.from(second!.childNodes)
      .filter((n): n is Element => n?.nodeType === 1)
      .map((n) => n.nodeName),
    ['print', 'attributes', 'note', 'attributes', 'note', 'barline'],
  );
  assert.equal(elements(second!, 'barline')[0]!.getAttribute('location'), 'right');
  assert.equal(elements(second!, 'print')[0]!.getAttribute('new-system'), 'no');
});

test('trill lines have matching endpoints and preserve auxiliary accidentals', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \pitchedTrill c'2\startTrillSpan dis' d'2\stopTrillSpan }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'trill-mark').length, 1);
  assert.deepEqual(texts(xml, 'accidental-mark'), ['sharp']);
  const spans = elements(xml, 'wavy-line');

  assert.deepEqual(
    spans.map((s) => s.getAttribute('type')),
    ['start', 'stop'],
  );
  assert.equal(spans[0]!.getAttribute('number'), spans[1]!.getAttribute('number'));
});

test('text spanners and text crescendos use words and matching dashed lines', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \override TextSpanner.bound-details.left.text = "rit." c'2\startTextSpan d'2\stopTextSpan \crescTextCresc e'2\< f'2\! }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'words'), ['rit.', 'cresc.']);
  assert.equal(elements(xml, 'wedge').length, 0);
  const spans = elements(xml, 'dashes');

  assert.deepEqual(
    spans.map((s) => s.getAttribute('type')),
    ['start', 'stop', 'start', 'stop'],
  );
  assert.equal(spans[0]!.getAttribute('number'), spans[1]!.getAttribute('number'));
  assert.equal(spans[2]!.getAttribute('number'), spans[3]!.getAttribute('number'));
});

test('a dynamic mark closes an active hairpin even without an explicit stop', async () => {
  const { scores } = await converter.convert(String.raw`{ c'2\< d'2\f }`);

  validate(scores[0]!.musicxml);
  const spans = elements(parse(scores[0]!.musicxml), 'wedge');

  assert.deepEqual(
    spans.map((s) => s.getAttribute('type')),
    ['crescendo', 'stop'],
  );
  assert.equal(spans[0]!.getAttribute('number'), spans[1]!.getAttribute('number'));
});

test('two-note tremolos preserve slash count, written values, and actual durations', async () => {
  const { scores } = await converter.convert(String.raw`{ \repeat tremolo 8 { c'16 d'16 } }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'type'), ['whole', 'whole']);
  assert.deepEqual(
    texts(xml, 'duration').map((d) => Number(d) / Number(texts(xml, 'divisions')[0])),
    [2, 2],
  );
  assert.deepEqual(
    elements(xml, 'tremolo').map((t) => [t.getAttribute('type'), t.textContent]),
    [
      ['start', '2'],
      ['stop', '2'],
    ],
  );
  assert.deepEqual(texts(xml, 'actual-notes'), ['2', '2']);
  assert.deepEqual(texts(xml, 'normal-notes'), ['1', '1']);
});

test('repeat ties and fermata variants retain their printed shapes', async () => {
  const { scores } = await converter.convert(
    String.raw`{ <c' e'>2\repeatTie d'4\shortfermata f'4\longfermata }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'tied').map((t) => t.getAttribute('type')),
    ['start', 'stop', 'start', 'stop'],
  );
  assert.equal(elements(xml, 'tie').length, 0);
  assert.deepEqual(texts(xml, 'fermata'), ['angled', 'square']);
});

test('dynamics attached to individual chord notes become native directions', async () => {
  const { scores } = await converter.convert(String.raw`{ <c'-\p e'>1 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'dynamics').length, 1);
  assert.equal(elements(xml, 'p').length, 1);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'note-direction'));
});

test('long scores reuse span numbers after slurs and tuplets close', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { { \repeat unfold 20 { c'4( d'4) e'2 } } } \score { { \repeat unfold 20 { \tuplet 3/2 { c'8 d'8 e'8 } f'2. } } }`,
  );

  assert.equal(scores.length, 2);

  for (const [index, score] of scores.entries()) {
    validate(score.musicxml);
    const spans = elements(parse(score!.musicxml), index === 0 ? 'slur' : 'tuplet');

    assert.equal(spans.length, 40);
    assert.deepEqual([...new Set(spans.map((s) => s.getAttribute('number')))], ['1']);
    assert.deepEqual(
      spans.map((s) => s.getAttribute('type')),
      Array.from({ length: 20 }, () => ['start', 'stop']).flat(),
    );
  }
});

test('drum notes preserve printed instrument identity, staff positions, and notehead shapes', async () => {
  const { scores } = await converter.convert(
    String.raw`\new DrumStaff \drummode { <bd hh>4 sn4 hh4 cymc4 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const notes = elements(xml, 'note');

  assert.equal(elements(xml, 'pitch').length, 0);
  assert.deepEqual(
    notes.map((n) => [
      texts(n, 'display-step')[0],
      texts(n, 'display-octave')[0],
      texts(n, 'notehead')[0],
    ]),
    [
      ['F', '4', 'normal'],
      ['E', '5', 'x'],
      ['C', '5', 'normal'],
      ['E', '5', 'x'],
      ['G', '5', 'circle-x'],
    ],
  );
  assert.equal(elements(xml, 'midi-instrument').length, 0);
  assert.equal(elements(xml, 'chord').length, 1);
  assert.ok(
    !scores[0]!.diagnostics.some(
      (d) => d.code === 'unpitched-mapping' || d.code === 'percussion-playback',
    ),
  );
});

test('custom percussion tables and one-line staves use compiler-resolved values', async () => {
  const { scores } =
    await converter.convert(String.raw`customStyle = #'((bassdrum cross #f 0) (snare diamond #f 2))
\new DrumStaff \with {
  drumStyleTable = #(alist->hash-table customStyle)
  drumPitchTable = #(alist->hash-table (list (cons 'bassdrum (ly:make-pitch -2 0 0)) (cons 'snare (ly:make-pitch -1 0 0))))
  \override StaffSymbol.line-count = #1
} \drummode { bd2 sn2 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'staff-lines'), ['1']);
  assert.deepEqual(texts(xml, 'display-step'), ['E', 'G']);
  assert.deepEqual(texts(xml, 'display-octave'), ['4', '4']);
  assert.deepEqual(texts(xml, 'notehead'), ['x', 'diamond']);
  assert.equal(elements(xml, 'midi-instrument').length, 0);
});

test('ties in drum chords stay attached to each drum independently', async () => {
  const { scores } = await converter.convert(
    String.raw`\new DrumStaff \drummode { <bd sn>2 ~ <bd sn>2 }`,
  );

  validate(scores[0]!.musicxml);
  const notes = elements(parse(scores[0]!.musicxml), 'note');

  assert.deepEqual(
    notes.map((n) => elements(n, 'tie').map((t) => t.getAttribute('type'))),
    [['start'], ['start'], ['stop'], ['stop']],
  );
});

test('open hi-hat symbols created by the drum engraver are preserved', async () => {
  const { scores } = await converter.convert(
    String.raw`\new DrumStaff \drummode { hho4 hh4 hhp4 cymc4 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'note').map((n) => elements(n, 'open-string').length),
    [1, 0, 0, 0],
  );
  assert.equal(elements(xml, 'open-string')[0]!.getAttribute('placement'), 'above');
  assert.equal(scores[0]!.document.events.filter((e) => e.kind === 'percussionScript').length, 1);
});

test('tablature captures the first automatic string choice and preserves guitar tuning', async () => {
  const { scores } = await converter.convert(String.raw`\new TabStaff { e4 a d' g' }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'sign'), ['TAB']);
  assert.deepEqual(texts(xml, 'staff-lines'), ['6']);
  assert.deepEqual(texts(xml, 'string'), ['4', '3', '2', '1']);
  assert.deepEqual(texts(xml, 'fret'), ['2', '2', '3', '3']);
  assert.deepEqual(
    elements(xml, 'staff-tuning').map((t) => [
      t.getAttribute('line'),
      texts(t, 'tuning-step')[0],
      texts(t, 'tuning-octave')[0],
    ]),
    [
      ['6', 'E', '4'],
      ['5', 'B', '3'],
      ['4', 'G', '3'],
      ['3', 'D', '3'],
      ['2', 'A', '2'],
      ['1', 'E', '2'],
    ],
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'tab-selection'));
});

test('explicit tablature strings preserve the chosen frets without duplicate string marks', async () => {
  const { scores } = await converter.convert(String.raw`\new TabStaff { c'4\5 d'4\4 e'4\3 f'4\2 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'string'), ['5', '4', '3', '2']);
  assert.deepEqual(texts(xml, 'fret'), ['15', '12', '9', '6']);
});

test('tablature chords preserve each selected string and fret', async () => {
  const { scores } = await converter.convert(String.raw`\new TabStaff { <c'\5 e'\4 g'\3>1 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'chord').length, 2);
  assert.deepEqual(texts(xml, 'string'), ['5', '4', '3']);
  assert.deepEqual(texts(xml, 'fret'), ['15', '14', '12']);
});

test('custom bass tuning sets four staff lines and uses the compiler fret calculation', async () => {
  const { scores } = await converter.convert(
    String.raw`\new TabStaff \with { stringTunings = #bass-tuning } { e,,4 a,, d, g, }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'staff-lines'), ['4']);
  assert.deepEqual(texts(xml, 'string'), ['4', '3', '2', '1']);
  assert.deepEqual(texts(xml, 'fret'), ['0', '0', '0', '0']);
  assert.deepEqual(texts(xml, 'tuning-octave'), ['2', '2', '1', '1']);
});

test('tablature keeps default hidden rhythm signs while full notation enables them', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { \new TabStaff { e4. r8 a2 } } \score { \new TabStaff { \tabFullNotation e4. r8 a2 } }`,
  );

  scores.forEach((s) => validate(s.musicxml));
  const [plain, full] = scores.map((s) => parse(s.musicxml));

  assert.equal(elements(plain, 'time')[0]!.getAttribute('print-object'), 'no');
  assert.equal(elements(full, 'time')[0]!.getAttribute('print-object'), null);
  assert.deepEqual(texts(plain, 'stem'), ['none', 'none']);
  assert.equal(elements(plain, 'dot')[0]!.getAttribute('color'), '#00000000');
  assert.equal(elements(full, 'dot')[0]!.getAttribute('color'), null);
  const plainRest = elements(plain, 'note').find((n) => elements(n, 'rest').length);
  const fullRest = elements(full, 'note').find((n) => elements(n, 'rest').length);

  assert.equal(plainRest!.getAttribute('print-object'), 'no');
  assert.equal(fullRest!.getAttribute('print-object'), null);
});

test('retuning a tablature string within a measure updates native staff tuning and fret values', async () => {
  const { scores } = await converter.convert(
    String.raw`\new TabStaff { e'4\1 \set TabStaff.stringTunings = #(cons (ly:make-pitch 0 1 0) (cdr guitar-tuning)) e'2.\1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'fret'), ['0', '2']);
  const upperString = elements(xml, 'staff-tuning').filter((t) => t.getAttribute('line') === '6');

  assert.deepEqual(
    upperString.map((t) => texts(t, 'tuning-step')[0]),
    ['E', 'D'],
  );
  const events = childElements(elements(xml, 'measure')[0]!)
    .filter((n) => ['attributes', 'note'].includes(n.nodeName))
    .map((n) => n.nodeName);

  assert.deepEqual(events, ['attributes', 'note', 'attributes', 'note']);
});

test('reversed tablature string order preserves fret placement and tuning lines', async () => {
  const { scores } = await converter.convert(
    String.raw`\new TabStaff \with { stringOneTopmost = ##f } { e1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'string'), ['3']);
  assert.deepEqual(texts(xml, 'fret'), ['2']);
  const lowLine = elements(xml, 'staff-tuning').find((t) => t.getAttribute('line') === '1');

  assert.deepEqual(texts(lowLine, 'tuning-step'), ['E']);
  assert.deepEqual(texts(lowLine, 'tuning-octave'), ['4']);
});
