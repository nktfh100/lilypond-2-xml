import { type ConvertedScore, convert, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  childElements,
  converter,
  elements,
  parse,
  texts,
} from '../../support/conversion-support.js';
import { navigationPlayback } from '../../support/navigation-playback.js';
import { validate } from '../../support/schema.js';

test('a cadenza at the start keeps one stretched measure and restores metered time invisibly', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \cadenzaOn c'4 d' e' f' g' a' b' \cadenzaOff c''1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 1);
  assert.equal(elements(xml, 'note').length, 8);
  assert.equal(
    navigationPlayback(scores[0]!.musicxml).reduce((sum, n) => sum + n[3], 0),
    11,
  );
  const times = elements(xml, 'time');

  assert.deepEqual(
    times.map((t) => [elements(t, 'senza-misura').length, t.getAttribute('print-object')]),
    [
      [0, null],
      [1, 'no'],
      [0, 'no'],
    ],
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'cadenza'));
});

test('a wholly unmetered passage does not acquire metered note splits or a final barline', async () => {
  const { scores } = await converter.convert(String.raw`{ \cadenzaOn \repeat unfold 13 { c'8 } }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 1);
  assert.equal(elements(xml, 'note').length, 13);
  assert.equal(elements(xml, 'tie').length, 0);
  assert.deepEqual(texts(xml, 'bar-style'), ['none']);
  assert.deepEqual(
    navigationPlayback(scores[0]!.musicxml).map((n) => n[3]),
    Array(13).fill(0.5),
  );
});

test('a mid-measure cadenza keeps note attacks and time changes at their actual positions', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4 \cadenzaOn d'8 e' f' g' a' \cadenzaOff b'2 c''4 d''1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const measures = elements(xml, 'measure');

  assert.equal(measures.length, 2);
  assert.equal(elements(xml, 'note').length, 9);
  assert.equal(elements(xml, 'tie').length, 0);
  assert.deepEqual(
    navigationPlayback(scores[0]!.musicxml).map((n) => n[3]),
    [1, 0.5, 0.5, 0.5, 0.5, 0.5, 2, 1, 4],
  );
  let cursor = 0;
  const divisions = Number(texts(xml, 'divisions')[0]);
  const changes = [];

  for (const node of childElements(measures[0]!)) {
    if (node.nodeName === 'note') {
      cursor += Number(texts(node, 'duration')[0]) / divisions;
    }

    if (node.nodeName === 'attributes' && elements(node, 'time').length) {
      changes.push([cursor, elements(node, 'senza-misura').length]);
    }
  }

  assert.deepEqual(changes, [
    [0, 0],
    [1, 1],
    [3.5, 0],
  ]);
});

test('manual barlines inside a cadenza retain their positions without starting new measures', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \cadenzaOn c'4 \bar "||" d'8 e' \bar "!" f'2 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 1);
  const bars = elements(xml, 'barline');

  assert.deepEqual(
    bars.map((b) => [b.getAttribute('location'), texts(b, 'bar-style')[0]]),
    [
      ['middle', 'light-light'],
      ['middle', 'dashed'],
      ['right', 'none'],
    ],
  );
  assert.equal(elements(xml, 'note').length, 4);
});

test('an unmetered passage in a piano score keeps both staves aligned', async () => {
  const { scores } = await converter.convert(
    String.raw`\new PianoStaff << \new Staff { \cadenzaOn c'2 d'4 \cadenzaOff e'1 } \new Staff { c1*7/4 } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 1);
  assert.equal(elements(xml, 'note').length, 4);
  const divisions = Number(texts(xml, 'divisions')[0]);

  assert.deepEqual(
    texts(xml, 'backup').map((d) => Number(d) / divisions),
    [7],
  );
});

test('a forced break in a cadenza creates a barless continuation fragment', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \cadenzaOn c'2 \break d'4 e'4 \cadenzaOff f'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const measures = elements(xml, 'measure');

  assert.equal(measures.length, 2);
  assert.equal(measures[1]!.getAttribute('implicit'), 'yes');
  assert.equal(elements(measures[1], 'print')[0]!.getAttribute('new-system'), 'yes');
  assert.deepEqual(texts(measures[0], 'bar-style'), ['none']);
  assert.deepEqual(
    navigationPlayback(scores[0]!.musicxml).map((n) => n[3]),
    [2, 1, 1, 4],
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'mid-measure-break'));
});

test('a time signature change during a cadenza retains its printed signature and unmetered state', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \cadenzaOn c'4 \time 3/4 d'4 \cadenzaOff e'2. }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const times = elements(xml, 'time');

  assert.deepEqual(
    times.filter((t) => t.getAttribute('print-object') !== 'no').map((t) => texts(t, 'beats')[0]),
    ['4', '3'],
  );
  assert.equal(elements(xml, 'senza-misura').length, 2);
  assert.equal(elements(xml, 'note').length, 3);
});

test('semantic unmetered repeats end at a native measure boundary before following music', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \cadenzaOn \repeat volta 2 { c'4 d'4 } \cadenzaOff e'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.ok(
    elements(xml, 'barline').some(
      (bar) =>
        bar.getAttribute('location') === 'right' &&
        elements(bar, 'repeat').some(
          (r) => r.getAttribute('direction') === 'backward' && r.getAttribute('times') === '2',
        ),
    ),
  );
  assert.deepEqual(
    elements(xml, 'measure').map((m) => texts(m, 'step')),
    [['C', 'D'], ['E']],
  );
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'cadenza-repeat'));
});

test('decoded documents without barline grobs retain manual cadenza bars and report the missing graphics', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \cadenzaOn c'4 \bar "||" d'4 \cadenzaOff e'1 }`,
  );
  const { barlinesCaptured, barlineLayoutsCaptured, ...document } = scores[0]!.document;
  const result = toMusicXML({
    ...document,
    events: document.events.filter((e) => e.kind !== 'barline' && e.kind !== 'barlineLayout'),
  });

  validate(result.musicxml);
  assert.ok(
    elements(parse(result.musicxml), 'barline').some(
      (bar) =>
        bar.getAttribute('location') === 'middle' && texts(bar, 'bar-style')[0] === 'light-light',
    ),
  );
  assert.ok(result.diagnostics.some((d) => d.code === 'cadenza-barlines'));
});

test('single-measure percent repeats retain every repeated note and native repeat symbols', async () => {
  const { scores } = await converter.convert(String.raw`{ \repeat percent 3 { c'4 d' e' f' } }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 3);
  assert.equal(elements(xml, 'note').length, 12);
  assert.deepEqual(texts(xml, 'symbol'), ['repeat1Bar', 'repeat1Bar']);
  assert.deepEqual(
    elements(xml, 'note').map((n) => n.getAttribute('print-object')),
    [null, null, null, null, 'no', 'no', 'no', 'no', 'no', 'no', 'no', 'no'],
  );
  assert.deepEqual(texts(xml, 'step'), [
    'C',
    'D',
    'E',
    'F',
    'C',
    'D',
    'E',
    'F',
    'C',
    'D',
    'E',
    'F',
  ]);
});

test('double-measure percent repeats preserve both pattern measures and stop before following music', async () => {
  const { scores } = await converter.convert(String.raw`{ \repeat percent 3 { c'1 d'1 } e'1 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 7);
  assert.deepEqual(texts(xml, 'step'), ['C', 'D', 'C', 'D', 'C', 'D', 'E']);
  assert.deepEqual(texts(xml, 'symbol'), ['repeat2Bars', 'repeat2Bars']);
  assert.deepEqual(
    elements(xml, 'note').map((n) => n.getAttribute('print-object')),
    [null, null, 'no', 'no', 'no', 'no', null],
  );
});

test('percent repeats shorter than a measure use native slash symbols at their actual positions', async () => {
  const { scores } = await converter.convert(String.raw`{ c'4 \repeat percent 3 { d'8 e'8 } f'4 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'step'), ['C', 'D', 'E', 'D', 'E', 'D', 'E', 'F']);
  assert.deepEqual(texts(xml, 'symbol'), ['repeatBarSlash', 'repeatBarSlash']);
  assert.deepEqual(
    elements(xml, 'direction')
      .filter((d) => elements(d, 'symbol').length)
      .map((d) => Number(texts(d, 'offset')[0]) / Number(texts(xml, 'divisions')[0])),
    [2, 3],
  );
  assert.deepEqual(
    navigationPlayback(scores[0]!.musicxml).map((n) => n[3]),
    [1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1],
  );
});

test('percent repeat counters retain compiler visibility decisions and native text', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \set countPercentRepeats = ##t \repeat percent 3 { c'1 } }`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'words').filter(Boolean), ['2', '3']);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'percent-counter'));
});

test('percent repetition in one piano staff does not replace music on the other staff', async () => {
  const { scores } = await converter.convert(
    String.raw`\new PianoStaff << \new Staff { \repeat percent 3 { c'1 } } \new Staff { e1 f1 g1 } >>`,
  );

  validate(scores[0]!.musicxml);
  const signs = elements(parse(scores[0]!.musicxml), 'direction').filter(
    (d) => elements(d, 'symbol').length,
  );

  assert.deepEqual(
    signs.map((d) => texts(d, 'staff')[0]),
    ['1', '1'],
  );
  assert.equal(elements(parse(scores[0]!.musicxml), 'note').length, 6);
});

test('percent repetition mixed with another voice keeps its voice scope', async () => {
  const { scores } = await converter.convert(
    String.raw`<< { \repeat percent 3 { c'1 } } \\ { e'1 f'1 g'1 } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'note').length, 6);
  assert.equal(elements(xml, 'measure-repeat').length, 0);
  assert.deepEqual(
    elements(xml, 'direction')
      .filter((d) => elements(d, 'symbol').length)
      .map((d) => texts(d, 'voice')[0]),
    ['1', '1'],
  );
  assert.deepEqual(
    elements(xml, 'note')
      .filter((n) => texts(n, 'voice')[0] === '2')
      .map((n) => n.getAttribute('print-object')),
    [null, null, null],
  );
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'percent-layout'));
});

for (const [name, music] of [
  ['single measure', String.raw`\repeat percent 4 { c'4 d' e' f' }`],
  ['double measure', String.raw`\repeat percent 3 { c'1 d'1 }`],
  ['beat pattern', String.raw`c'4 \repeat percent 3 { d'8 e'8 } f'4`],
  ['tuplets', String.raw`\repeat percent 3 { \tuplet 3/2 { c'8 d' e' } f'2. }`],
  ['chords', String.raw`\repeat percent 3 { <c' e' g'>2 <d' f' a'>2 }`],
  ['rests', String.raw`\repeat percent 3 { r2 c'2 }`],
  ['nested patterns', String.raw`\repeat percent 2 { \repeat percent 2 { c'1 } }`],
]) {
  test(`percent ${name} written copies match the compiler's unfolded notation`, async () => {
    const [{ scores }, unfolded] = await Promise.all([
      converter.convert(`{ ${music} }`),
      convert(`\\unfoldRepeats { ${music} }`),
    ]);

    validate(scores[0]!.musicxml);
    const pitches = (score: ConvertedScore | undefined) =>
      elements(parse(score!.musicxml), 'pitch').map((p) => [
        texts(p, 'step')[0],
        texts(p, 'alter')[0] || '0',
        texts(p, 'octave')[0],
      ]);

    assert.deepEqual(pitches(scores[0]), pitches(unfolded.scores[0]));
    assert.ok(
      elements(parse(scores[0]!.musicxml), 'note').every((n) => !n.hasAttribute('dynamics')),
    );
  });
}

test('percent repeats in percussion keep repeated printed instruments and positions', async () => {
  const music = String.raw`\new DrumStaff \drummode { \repeat percent 3 { bd4 hho sn hhc } }`;
  const [{ scores }, unfolded] = await Promise.all([
    converter.convert(music),
    convert(`\\unfoldRepeats ${music}`),
  ]);

  validate(scores[0]!.musicxml);

  const pitches = (score: ConvertedScore | undefined) => {
    const xml = parse(score!.musicxml);

    return elements(xml, 'note').map((n) => [
      texts(n, 'display-step')[0],
      texts(n, 'display-octave')[0],
      texts(n, 'notehead')[0],
    ]);
  };

  assert.equal(elements(parse(scores[0]!.musicxml), 'note').length, 12);
  assert.deepEqual(pitches(scores[0]), pitches(unfolded.scores[0]));
});

test('percent repeats in tablature keep compiler-selected strings and frets', async () => {
  const { scores } = await converter.convert(
    String.raw`\new TabStaff { \repeat percent 3 { e4 a d' g' } }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'fret'), [
    '2',
    '2',
    '3',
    '3',
    '2',
    '2',
    '3',
    '3',
    '2',
    '2',
    '3',
    '3',
  ]);
  assert.deepEqual(texts(xml, 'string'), [
    '4',
    '3',
    '2',
    '1',
    '4',
    '3',
    '2',
    '1',
    '4',
    '3',
    '2',
    '1',
  ]);
});

test("multi-measure rest styles retain each staff's ownership and length", async () => {
  const { scores } = await converter.convert(
    String.raw`\new PianoStaff << \new Staff { R1*2 c''1 } \new Staff { c1 R1*2 } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'measure').flatMap((measure) =>
      elements(measure, 'measure-style').map((style) => [
        measure.getAttribute('number'),
        style.getAttribute('number'),
        texts(style, 'multiple-rest'),
      ]),
    ),
    [
      ['1', '1', ['2']],
      ['2', '2', ['2']],
    ],
  );
  assert.deepEqual(navigationPlayback(scores[0]!.musicxml), [
    ['C', 0, 3, 4],
    ['C', 0, 5, 4],
  ]);
});

test('simultaneous multi-measure rests preserve different lengths on different staves', async () => {
  const { scores } = await converter.convert(
    String.raw`\new PianoStaff << \new Staff { R1*2 c''1 } \new Staff { R1*3 } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'measure-style').map((style) => [
      style.getAttribute('number'),
      texts(style, 'multiple-rest'),
    ]),
    [
      ['1', ['2']],
      ['2', ['3']],
    ],
  );
});

test('percent repeats of multi-measure rests do not reuse the original rest display style', async () => {
  const { scores } = await converter.convert(String.raw`{ \repeat percent 3 { R1*2 } }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 6);
  assert.deepEqual(texts(xml, 'multiple-rest'), ['2']);
  assert.deepEqual(texts(xml, 'symbol'), ['repeat2Bars', 'repeat2Bars']);
});

test('hidden percent signs keep their repeated music hidden while retaining playback data', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \omit PercentRepeat \repeat percent 3 { c'1 } }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'symbol').length, 0);
  assert.deepEqual(
    elements(xml, 'note').map((n) => n.getAttribute('print-object')),
    [null, 'no', 'no'],
  );
  assert.equal(navigationPlayback(scores[0]!.musicxml).length, 3);
});

test('percent placeholders without source notes keep their length and report missing music', async () => {
  const { scores } = await converter.convert(String.raw`{ \repeat percent 3 { c'1 } }`);
  const document = scores[0]!.document;
  const result = toMusicXML({
    ...document,
    events: document.events.filter((e) => e.kind !== 'note'),
  });

  validate(result.musicxml);
  assert.ok(result.diagnostics.some((d) => d.code === 'percent-source'));
  assert.equal(elements(parse(result.musicxml), 'note').length, 0);
  assert.equal(elements(parse(result.musicxml), 'measure').length, 3);
});

test('percent pattern printed state changes are explicitly reported', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff { \repeat percent 3 { c'2 \ottava #1 d'2 } }`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(elements(parse(scores[0]!.musicxml), 'note').length, 6);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'percent-state'));
});

test('separate scores reset percent identifiers and graphics', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { { \set countPercentRepeats = ##t \repeat percent 2 { c'1 } } } \score { { \repeat percent 2 { d'1 } } }`,
  );

  assert.equal(scores.length, 2);

  for (const score of scores) {
    validate(score.musicxml);
  }

  assert.deepEqual(
    scores.map((s) => s.document.events.find((e) => e.kind === 'percentRepeat')!.id),
    [1, 1],
  );
  assert.deepEqual(
    scores.map((s) => texts(parse(s.musicxml), 'words').filter(Boolean)),
    [['2'], []],
  );
});

test('isolated percent signs do not infer playback from unrelated preceding notes', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1 #(make-music 'PercentEvent 'length (ly:make-moment 1)) }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'symbol'), ['repeat1Bar']);
  assert.equal(elements(xml, 'measure').length, 2);
  assert.equal(elements(xml, 'note').length, 1);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'percent-isolated'));
});

test('harmonic notehead variants preserve their open or filled appearance', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \override NoteHead.style = #'harmonic c'4 d'2. \override NoteHead.style = #'harmonic-black e'4 f'2. \override NoteHead.style = #'harmonic-mixed g'4 a'2. }`,
  );

  validate(scores[0]!.musicxml);
  const heads = elements(parse(scores[0]!.musicxml), 'notehead');

  assert.deepEqual(
    heads.map((h) => [h.textContent, h.getAttribute('filled')]),
    [
      ['diamond', 'no'],
      ['diamond', 'no'],
      ['diamond', 'yes'],
      ['diamond', 'yes'],
      ['diamond', 'yes'],
      ['diamond', 'no'],
    ],
  );
});

test('resolved arrowheads point away from the stem in both directions', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \override NoteHead.style = #'arrow \stemUp c'4 \stemDown d'4 e'2 }`,
  );

  validate(scores[0]!.musicxml);
  const heads = elements(parse(scores[0]!.musicxml), 'notehead');

  assert.deepEqual(
    heads.map((h) => [h.textContent, h.getAttribute('filled')]),
    [
      ['arrow down', 'yes'],
      ['arrow up', 'yes'],
      ['arrow up', 'no'],
    ],
  );
});

test('hidden note columns still suppress heads, stems and playback-independent drawing', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \hideNotes c'4 d'4 \unHideNotes e'4 f'4 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'note').map((n) => n.getAttribute('print-object')),
    ['no', 'no', null, null],
  );
  assert.equal(navigationPlayback(scores[0]!.musicxml).length, 4);
});

test('an explicit glyph override controls the shape and its fill', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \override NoteHead.style = #'diamond \override NoteHead.glyph-name = "0triangle" c'4 d'4 e'4 f'4 }`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(
    elements(parse(scores[0]!.musicxml), 'notehead').map((h) => [
      h.textContent,
      h.getAttribute('filled'),
    ]),
    Array(4).fill(['triangle', 'no']),
  );
});

test('Funk shape noteheads use native SMuFL glyphs', async () => {
  const { scores } = await converter.convert(String.raw`{ \funkHeads c'4 d' e' f' g' a' b' c'' }`);

  validate(scores[0]!.musicxml);
  const heads = elements(parse(scores[0]!.musicxml), 'notehead');

  assert.deepEqual(
    heads.map((h) => h.getAttribute('smufl')),
    [
      'noteShapeMoonLeftBlack',
      'noteShapeArrowheadLeftBlack',
      'noteShapeDiamondBlack',
      'noteShapeTriangleLeftBlack',
      'noteShapeRoundBlack',
      'noteShapeSquareBlack',
      'noteShapeTriangleRoundLeftBlack',
      'noteShapeMoonLeftBlack',
    ],
  );
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'notehead-orientation'));
});

test('custom notehead drawings and unmapped historical styles carry diagnostics', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \override NoteHead.stencil = #ly:text-interface::print \once \override NoteHead.text = \markup "X" c'4 \once \override NoteHead.style = #'mensural d'4 \once \override NoteHead.style = #'petrucci e'4 \once \override NoteHead.style = #'neomensural f'4 \once \override NoteHead.style = #'kievan g'1 }`,
  );

  validate(scores[0]!.musicxml);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'notehead-stencil'));
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'notehead-style'));
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'step'), ['C', 'D', 'E', 'F', 'G']);
});

test('unrecognized notehead names cannot escape the native shape mapping', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \override NoteHead.style = #'toString c'4 \override NoteHead.style = #'harmonic-custom d'4 e'4 f'4 }`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'notehead'), [
    'normal',
    'normal',
    'normal',
    'normal',
  ]);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'notehead-style'));
});

test('figured bass preserves accidentals, including solitary and double accidentals', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { \clef bass c1 } \figures { <7! 6+ 4->4 <5++> <3--> <_+> } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'prefix'), [
    'natural',
    'sharp',
    'flat',
    'double-sharp',
    'flat-flat',
    'sharp',
  ]);
  assert.deepEqual(texts(xml, 'figure-number'), ['7', '6', '4', '5', '3']);
  assert.equal(elements(xml, 'note').length, 1);
});

test('figured bass suffix placement preserves augmented and slashed modifiers', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { c1 } \figures { \set figuredBassAlterationDirection = #RIGHT \set figuredBassPlusDirection = #RIGHT <6+>4 <6\+> <5/> <5\\> } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'suffix'), ['sharp', 'plus', 'slash', 'back-slash']);
  assert.deepEqual(texts(xml, 'prefix'), []);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'figured-bass-modifier'));
});

test('figured bass within a Staff retains that staff and placement', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { \override BassFigureAlignmentPositioning.direction = #DOWN } << { \clef bass c1 } \figuremode { <6 4>1 } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'part').length, 1);
  assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('placement'), 'below');
  assert.deepEqual(texts(xml, 'figure-number'), ['6', '4']);
});

test('figures above a staff retain native placement without reader-specific diagnostics', async () => {
  const { scores } = await converter.convert(String.raw`<< \figures { <6>1 } \new Staff { c1 } >>`);

  validate(scores[0]!.musicxml);
  assert.equal(
    elements(parse(scores[0]!.musicxml), 'figured-bass')[0]!.getAttribute('placement'),
    'above',
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'figured-bass-placement'));
});

test("figured-bass continuation lines preserve the compiler's row endpoints", async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { \clef bass c4 d e f } \figures { \bassFigureExtendersOn <6 4>4 <6 3> <7 3> <7 3> } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'extend').map((n) => n.getAttribute('type')),
    ['start', 'stop', 'start', 'start', 'continue', 'stop', 'stop'],
  );
  assert.equal(
    scores[0]!.document.events
      .filter((e) => e.kind === 'figuredBass')
      .flatMap((e) => e.figures)
      .filter((f) => f.extendTo !== null).length,
    3,
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'figured-bass-reader'));
});

test('custom figure markup retains supported styles while brackets have specific diagnostics', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { c1 } \figures { <[6] 4>2 <\markup { \bold "V" } 3>2 } >>`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'figure-number'), ['6', '4', 'V', '3']);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'figured-bass-bracket'));
  assert.equal(
    elements(parse(scores[0]!.musicxml), 'figure-number')[2]!.getAttribute('font-weight'),
    'bold',
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'figured-bass-markup'));
  assert.ok(
    scores[0]!.document.events
      .filter((e) => e.kind === 'figuredBass')
      .flatMap((e) => e.figures)
      .some((f) => f.markup !== null),
  );
});

test('ordinary staff rests do not create figured-bass events', async () => {
  const { scores } = await converter.convert(String.raw`{ r2 c'2 }`);

  assert.equal(scores[0]!.document.events.filter((e) => e.kind === 'figuredBass').length, 0);
});

test('figures continuing after the bass voice keep their complete timeline', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { \clef bass c1 } \figures { <6>1 <5>1 } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 2);
  assert.equal(elements(xml, 'part').length, 1);
  assert.deepEqual(texts(xml, 'figure-number'), ['6', '5']);
  assert.deepEqual(texts(xml, 'step'), ['C']);
  assert.equal(elements(xml, 'rest').length, 1);
});

test('a FiguredBass context nested inside a Staff inherits its direction', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { \override BassFigureAlignmentPositioning.direction = #DOWN } << { c1 } \figures { <6>1 } >>`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(
    elements(parse(scores[0]!.musicxml), 'figured-bass')[0]!.getAttribute('placement'),
    'below',
  );
});

test('separate scores reset figure identifiers and continuation state', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { \figures { <6>1 } } \score { \figures { <4>1 } }`,
  );

  assert.equal(scores.length, 2);

  for (const score of scores) {
    validate(score.musicxml);
  }

  assert.deepEqual(
    scores.map((s) => s.document.events.find((e) => e.kind === 'figuredBass')!.figures[0]!.id),
    [1, 1],
  );
  assert.deepEqual(
    scores.map((s) => texts(parse(s.musicxml), 'figure-number')),
    [['6'], ['4']],
  );
});

test('unnamed staves and internal staff identifiers do not become printed instrument labels', async () => {
  for (const source of [String.raw`{ c'1 }`, String.raw`\new Staff = "internal" { c'1 }`]) {
    const { scores } = await converter.convert(source);

    validate(scores[0]!.musicxml);
    assert.equal(
      elements(parse(scores[0]!.musicxml), 'part-name')[0]!.getAttribute('print-object'),
      'no',
    );
  }
});

test('staff-group labels use explicit instrument names instead of internal group identifiers', async () => {
  const { scores } = await converter.convert(
    String.raw`\new StaffGroup = "internal" \with { instrumentName = "Strings" shortInstrumentName = "Str." } << \new Staff { c'1 } \new Staff { c1 } >>`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'group-name'), ['Strings']);
});

test('piano and grand-staff labels retain their group name and abbreviation', async () => {
  for (const type of ['PianoStaff', 'GrandStaff']) {
    const { scores } = await converter.convert(
      `\\new ${type} \\with { instrumentName = "Piano" shortInstrumentName = "Pno." } << \\new Staff { c'1 } \\new Staff { c1 } >>`,
    );

    validate(scores[0]!.musicxml);
    const xml = parse(scores[0]!.musicxml);

    assert.deepEqual(texts(xml, 'part-name'), ['Piano']);
    assert.deepEqual(texts(xml, 'part-abbreviation'), ['Pno.']);
    assert.notEqual(elements(xml, 'part-name')[0]!.getAttribute('print-object'), 'no');
  }
});

test('internal staff-group identifiers do not become visible group names', async () => {
  const { scores } = await converter.convert(
    String.raw`\new StaffGroup = "internal" << \new Staff { c'1 } \new Staff { c1 } >>`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'group-name'), []);
});

test('vocal names retain the actual labels created by the compiler', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { vocalName = "Soprano" shortVocalName = "S." } { c''1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'part-name'), ['Soprano']);
  assert.deepEqual(texts(xml, 'part-abbreviation'), ['S.']);
});

test('hidden instrument names retain text without making the label visible', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = "Flute" shortInstrumentName = "Fl." \override InstrumentName.stencil = ##f } { c'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'part-name'), ['Flute']);
  assert.equal(elements(xml, 'part-name')[0]!.getAttribute('print-object'), 'no');
  assert.equal(elements(xml, 'part-abbreviation')[0]!.getAttribute('print-object'), 'no');
});

test('removing the instrument-name engraver suppresses labels despite final staff metadata', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = "Flute" \remove "Instrument_name_engraver" } { c'1 }`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(
    elements(parse(scores[0]!.musicxml), 'part-name')[0]!.getAttribute('print-object'),
    'no',
  );
  assert.equal(scores[0]!.document.namesCaptured, true);
  assert.equal(scores[0]!.document.events.filter((e) => e.kind === 'instrumentName').length, 0);
});

test('formatted instrument names retain native styled runs and accidental symbols', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = \markup { \italic "Clarinet" \smaller \flat } shortInstrumentName = \markup { \bold "Cl." } } { c'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'part-name'), ['Clarinet ♭']);
  assert.deepEqual(texts(xml, 'accidental-text'), ['flat']);
  const display = elements(xml, 'part-name-display')[0];

  assert.equal(elements(display, 'display-text')[0]!.getAttribute('font-style'), 'italic');
  const abbreviation = elements(xml, 'part-abbreviation-display')[0];

  assert.equal(elements(abbreviation, 'display-text')[0]!.getAttribute('font-weight'), 'bold');
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'instrument-name-reader'));
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'markup-font-base'));
  assert.ok(Number(elements(display, 'accidental-text')[0]!.getAttribute('font-size')) > 0);
});

test('timed instrument abbreviations use native print displays', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = "Flute" shortInstrumentName = "Fl." } { c'1 \set Staff.shortInstrumentName = "Picc." \break d'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'part-name'), ['Flute']);
  assert.deepEqual(texts(xml, 'part-abbreviation'), ['Fl.']);
  assert.deepEqual(texts(elements(xml, 'measure')[1], 'display-text'), ['Picc.']);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'instrument-name-change-reader'));
});

test('mid-measure abbreviation changes apply at the next measure boundary', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = "Flute" shortInstrumentName = "Fl." } { c'2 \set Staff.shortInstrumentName = "Picc." d'2 \break e'1 }`,
  );

  validate(scores[0]!.musicxml);
  const measures = elements(parse(scores[0]!.musicxml), 'measure');

  assert.deepEqual(texts(measures[0], 'part-abbreviation-display'), []);
  assert.deepEqual(texts(measures[1], 'display-text'), ['Picc.']);
});

test('clearing the short instrument name exports a hidden abbreviation display', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = "Flute" shortInstrumentName = "Fl." } { c'1 \set Staff.shortInstrumentName = "" \break d'1 }`,
  );

  validate(scores[0]!.musicxml);
  assert.equal(
    elements(parse(scores[0]!.musicxml), 'part-abbreviation-display')[0]!.getAttribute(
      'print-object',
    ),
    'no',
  );
});

test('independent piano staff labels use native margin words', async () => {
  const { scores } = await converter.convert(
    String.raw`\new PianoStaff \with { instrumentName = "Piano" } << \new Staff \with { instrumentName = "RH" } { c'1 } \new Staff \with { instrumentName = "LH" } { c1 } >>`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'part-name'), ['Piano']);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'instrument-label-reader'));
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'words'), ['RH', 'LH']);
});

test('staff-group abbreviation changes keep their initial value and report unmapped timing', async () => {
  const { scores } = await converter.convert(
    String.raw`\new StaffGroup \with { instrumentName = "Strings" shortInstrumentName = "Str." } << \new Staff { c'1 \set StaffGroup.shortInstrumentName = "Div." d'1 } \new Staff { c1 d1 } >>`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'group-abbreviation'), ['Str.']);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'group-name-change'));
});

test('decoded documents without name histories retain a reported metadata fallback', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = "Flute" } { c'1 }`,
  );
  const document = structuredClone(scores[0]!.document);

  delete document.namesCaptured;
  document.events = document.events.filter((e) => e.kind !== 'instrumentName');
  const result = toMusicXML(document);

  validate(result.musicxml);
  assert.deepEqual(texts(parse(result.musicxml), 'part-name'), ['Flute']);
  assert.ok(result.diagnostics.some((d) => d.code === 'instrument-name-history'));
});

test('a short-only instrument label stays absent on the initial system', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { shortInstrumentName = "Fl." } { c'1 \break d'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'part-name')[0]!.getAttribute('print-object'), 'no');
  assert.deepEqual(texts(xml, 'part-abbreviation'), ['Fl.']);
});

test('a hidden staff-group label uses a hidden native display', async () => {
  const { scores } = await converter.convert(
    String.raw`\new StaffGroup \with { instrumentName = "Strings" \override InstrumentName.transparent = ##t } << \new Staff { c'1 } \new Staff { c1 } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'group-name'), ['']);
  assert.equal(elements(xml, 'group-name-display')[0]!.getAttribute('print-object'), 'no');
  assert.deepEqual(texts(xml, 'display-text'), ['Strings']);
});

test('separate scores do not leak instrument labels', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { \new Staff \with { instrumentName = "Flute" } { c'1 } } \score { { d'1 } }`,
  );

  assert.equal(scores.length, 2);

  for (const score of scores) {
    validate(score.musicxml);
  }

  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'part-name'), ['Flute']);
  assert.equal(
    elements(parse(scores[1]!.musicxml), 'part-name')[0]!.getAttribute('print-object'),
    'no',
  );
  assert.equal(scores[1]!.document.events.filter((e) => e.kind === 'instrumentName').length, 0);
});

test('non-markup name settings do not overwrite labels whose compiler spanners remain active', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = "Flute" shortInstrumentName = "Fl." } { c'1 \set Staff.instrumentName = ##f \set Staff.shortInstrumentName = ##f d'1 }`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'part-name'), ['Flute']);
  assert.equal(scores[0]!.document.events.filter((e) => e.kind === 'instrumentName').length, 1);
});

test('staff-group labels first created after score start report their timed placement gap', async () => {
  const { scores } = await converter.convert(
    String.raw`\new StaffGroup << \new Staff { c'1 \set StaffGroup.instrumentName = "Strings" \set StaffGroup.shortInstrumentName = "Str." d'1 } \new Staff { c1 d1 } >>`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'group-name'), []);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'group-name-change'));
});
