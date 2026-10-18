import { convert, toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { create } from 'xmlbuilder2';
import {
  converter,
  directionTexts,
  elements,
  millimeters,
  near,
  parse,
  texts,
} from '../../support/conversion-support.js';
import { navigationPlayback } from '../../support/navigation-playback.js';
import { validate } from '../../support/schema.js';

test('chord symbols preserve harmonic kinds, slash basses, extensions, and no-chord marks', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \chords { c1 a:m g:7/b f:9 r1 } \new Staff { c'1 d' e' f' g' } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'part').length, 1);
  assert.deepEqual(texts(xml, 'kind'), ['major', 'minor', 'dominant', 'dominant', 'none']);
  assert.deepEqual(texts(xml, 'root-step'), ['C', 'A', 'G', 'F', 'C']);
  assert.deepEqual(texts(xml, 'bass-step'), ['B']);
  assert.deepEqual(texts(xml, 'inversion'), ['1']);
  assert.deepEqual(texts(xml, 'degree-value'), ['9']);
  assert.deepEqual(texts(xml, 'degree-alter'), ['0']);
  assert.deepEqual(texts(xml, 'degree-type'), ['add']);
  assert.deepEqual(
    elements(xml, 'kind').map((k) => k.getAttribute('text')),
    ['C', 'A m', 'G 7 / B', 'F 9', 'N.C.'],
  );
  const hidden = elements(xml, 'note').filter((n) => n.getAttribute('print-object') === 'no');

  assert.equal(hidden.length, 15);
  assert.deepEqual(elements(xml, 'measure')[2]!.getElementsByTagName('note').length, 5);
});

test('standalone chord charts retain timing without adding printed staff lines or notes', async () => {
  const { scores } = await converter.convert(String.raw`\chords { c1 g:7 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 2);
  assert.deepEqual(texts(xml, 'staff-lines'), ['0']);
  assert.equal(elements(xml, 'time')[0]!.getAttribute('print-object'), 'no');
  assert.ok(elements(xml, 'note').every((n) => n.getAttribute('print-object') === 'no'));
  assert.deepEqual(texts(xml, 'kind'), ['major', 'dominant']);
});

test('altered chord degrees retain their chromatic changes', async () => {
  const { scores } = await converter.convert(String.raw`\chords { c1:7.5- d:7.9- }`);

  validate(scores[0]!.musicxml);
  const chords = elements(parse(scores[0]!.musicxml), 'harmony');

  assert.deepEqual(texts(chords[0], 'kind'), ['dominant']);
  assert.deepEqual(texts(chords[0], 'degree-value'), ['5']);
  assert.deepEqual(texts(chords[0], 'degree-alter'), ['-1']);
  assert.deepEqual(texts(chords[0], 'degree-type'), ['alter']);
  assert.deepEqual(texts(chords[1], 'degree-value'), ['9']);
  assert.deepEqual(texts(chords[1], 'degree-alter'), ['-1']);
  assert.deepEqual(texts(chords[1], 'degree-type'), ['add']);
});

test('chord changes suppress repeated labels and restore them after explicit system breaks', async () => {
  const { scores } = await converter.convert(
    String.raw`\new ChordNames \with { chordChanges = ##t } \chordmode { c1 c1 \break c1 g1 }`,
  );

  validate(scores[0]!.musicxml);
  const chords = elements(parse(scores[0]!.musicxml), 'harmony');

  assert.equal(chords.length, 4);
  assert.deepEqual(
    chords.map((c) => c.getAttribute('print-object')),
    [null, 'no', null, null],
  );
});

test('chord text overrides preserve their printed label while retaining native harmony', async () => {
  const { scores } = await converter.convert(
    String.raw`\new ChordNames \chordmode { \once \override ChordName.text = \markup "custom label" c1:7 }`,
  );

  validate(scores[0]!.musicxml);
  const kind = elements(parse(scores[0]!.musicxml), 'kind')[0];

  assert.equal(kind!.textContent, 'dominant');
  assert.equal(kind!.getAttribute('text'), 'custom label');
});

test('trailing skips in chord-only scores retain their full timeline without a no-chord symbol', async () => {
  const { scores } = await converter.convert(String.raw`\chords { c1 s1 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'measure').length, 2);
  assert.equal(elements(xml, 'harmony').length, 1);
  assert.deepEqual(texts(elements(xml, 'measure')[1], 'duration'), ['4']);
});

test('chord symbols that change within a measure keep their musical offsets', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \chords { c2 d:m } \new Staff { c'1 } >>`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const chords = elements(xml, 'harmony');

  assert.deepEqual(texts(chords[0], 'offset'), []);
  assert.deepEqual(texts(chords[1], 'offset'), ['2']);
  assert.deepEqual(texts(xml, 'kind'), ['major', 'minor']);
});

test('chord clusters retain simultaneous natural and altered versions of a degree', async () => {
  const { scores } = await converter.convert(String.raw`\new ChordNames { <c' e' g' gis'>1 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'kind'), ['major']);
  assert.deepEqual(texts(xml, 'degree-value'), ['5']);
  assert.deepEqual(texts(xml, 'degree-alter'), ['1']);
  assert.deepEqual(texts(xml, 'degree-type'), ['add']);
  assert.equal(elements(xml, 'note').length, 4);
});

test('paper size, margins and staff scaling preserve physical dimensions', async () => {
  const { scores } = await converter.convert(String.raw`#(set-global-staff-size 16)
\paper { paper-width = 180\mm paper-height = 250\mm left-margin = 11\mm right-margin = 17\mm top-margin = 13\mm bottom-margin = 19\mm indent = 8\mm short-indent = 2\mm } { c'1 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const page = elements(xml, 'page-layout')[0];

  near(millimeters(xml, page, 'page-width'), 180);
  near(millimeters(xml, page, 'page-height'), 250);

  for (const [tag, expected] of [
    ['left-margin', 11],
    ['right-margin', 17],
    ['top-margin', 13],
    ['bottom-margin', 19],
  ] as const) {
    near(millimeters(xml, page, tag), expected);
  }

  near(Number(texts(xml, 'millimeters')[0]), (16 * 25.4) / 72.27);
  near(
    millimeters(
      xml,
      elements(xml, 'defaults')[0]!.getElementsByTagName('system-layout')[0],
      'left-margin',
    ),
    2,
  );
  near(
    millimeters(
      xml,
      elements(xml, 'print')[0]!.getElementsByTagName('system-layout')[0],
      'left-margin',
    ),
    8,
  );
});

test('book and bookpart paper overrides inherit without leaking into other books', async () => {
  const { scores } = await converter.convert(String.raw`\paper { left-margin = 11\mm }
\book { \paper { paper-width = 180\mm right-margin = 17\mm } \score { { c'1 } } \bookpart { \paper { top-margin = 19\mm } \score { { d'1 } } } }
\book { \score { { e'1 } } }`);

  assert.equal(scores.length, 3);
  const docs = scores.map((s) => {
    validate(s.musicxml);

    return parse(s.musicxml);
  });
  const pages = docs.map((d) => elements(d, 'page-layout')[0]);

  near(millimeters(docs[0], pages[0], 'page-width'), 180);
  near(millimeters(docs[1], pages[1], 'page-width'), 180);
  near(millimeters(docs[2], pages[2], 'page-width'), 210);
  near(millimeters(docs[1], pages[1], 'top-margin'), 19);
  near(millimeters(docs[1], pages[1], 'left-margin'), 11);
  near(millimeters(docs[1], pages[1], 'right-margin'), 17);
});

test('line-width-only settings center the music using LilyPond margin rules', async () => {
  const { scores } = await converter.convert(
    String.raw`\paper { paper-width = 200\mm line-width = 140\mm } { c'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const margins = elements(xml, 'page-margins')[0];

  near(millimeters(xml, margins, 'left-margin'), 30);
  near(millimeters(xml, margins, 'right-margin'), 30);
});

test('two-sided paper settings create mirrored odd and even page margins', async () => {
  const { scores } = await converter.convert(
    String.raw`\paper { two-sided = ##t inner-margin = 20\mm outer-margin = 12\mm binding-offset = 3\mm } { c'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const margins = elements(elements(xml, 'defaults')[0], 'page-margins');

  assert.deepEqual(
    margins.map((m) => m.getAttribute('type')),
    ['odd', 'even'],
  );
  near(millimeters(xml, margins[0], 'left-margin'), 23);
  near(millimeters(xml, margins[0], 'right-margin'), 12);
  near(millimeters(xml, margins[1], 'left-margin'), 12);
  near(millimeters(xml, margins[1], 'right-margin'), 23);
  const printed = elements(elements(xml, 'print')[0], 'page-margins');

  assert.deepEqual(
    printed.map((m) => m.getAttribute('type')),
    ['both'],
  );
  near(millimeters(xml, printed[0], 'left-margin'), 23);
  near(millimeters(xml, printed[0], 'right-margin'), 12);
});

test('score layout indentation overrides the inherited paper indentation', async () => {
  const { scores } = await converter.convert(
    String.raw`\paper { indent = 15\mm short-indent = 1\mm } \score { { c'1 } \layout { indent = 4\mm } }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const system = elements(elements(xml, 'print')[0], 'system-layout')[0];

  near(millimeters(xml, system, 'left-margin'), 4);
});

test('a bookpart can disable inherited two-sided margins with an explicit false value', async () => {
  const { scores } = await converter.convert(
    String.raw`\book { \paper { two-sided = ##t inner-margin = 20\mm outer-margin = 12\mm } \score { { c'1 } } \bookpart { \paper { two-sided = ##f left-margin = 8\mm right-margin = 9\mm } \score { { d'1 } } } }`,
  );

  scores.forEach((s) => validate(s.musicxml));
  const first = parse(scores[0]!.musicxml);
  const second = parse(scores[1]!.musicxml);

  assert.deepEqual(
    elements(elements(first, 'defaults')[0], 'page-margins').map((m) => m.getAttribute('type')),
    ['odd', 'even'],
  );
  assert.deepEqual(
    elements(elements(second, 'defaults')[0], 'page-margins').map((m) => m.getAttribute('type')),
    ['both'],
  );
  near(millimeters(second, elements(second, 'page-margins')[0], 'left-margin'), 8);
  near(millimeters(second, elements(second, 'page-margins')[0], 'right-margin'), 9);
  const printed = elements(elements(second, 'print')[0], 'page-margins');

  assert.deepEqual(
    printed.map((m) => m.getAttribute('type')),
    ['both'],
  );
  near(millimeters(second, printed[0], 'left-margin'), 8);
  near(millimeters(second, printed[0], 'right-margin'), 9);
});

test('inconsistent explicit margins follow LilyPond default-margin fallback', async () => {
  const { scores } = await converter.convert(
    String.raw`\paper { paper-width = 210\mm line-width = 170\mm left-margin = 30\mm right-margin = 30\mm } { c'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const margins = elements(xml, 'page-margins')[0];

  near(millimeters(xml, margins, 'left-margin'), 15);
  near(millimeters(xml, margins, 'right-margin'), 15);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'paper-margins'));
});

test('score line width changes system margins without changing paper margins', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { { c'1 } \layout { line-width = 120\mm } }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const page = elements(xml, 'page-margins')[0];

  near(millimeters(xml, page, 'left-margin'), 15);
  near(millimeters(xml, page, 'right-margin'), 15);
  const system = elements(elements(xml, 'defaults')[0], 'system-layout')[0];

  near(millimeters(xml, system, 'right-margin'), 60);
});

test('automatic rehearsal labels retain compiler numbering and custom formatters', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \mark \default c'1 \mark \default d'1 \set Score.rehearsalMarkFormatter = #format-mark-numbers \mark 7 e'1 \mark \default f'1 }`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'rehearsal'), ['A', 'B', '7', '8']);
});

test('dal segno returns reference the matching native segno target', async () => {
  const { scores } = await converter.convert(String.raw`{ c'1 \repeat segno 2 { d'1 e'1 } f'1 }`);

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'segno').length, 1);
  const sounds = elements(xml, 'sound');

  assert.equal(sounds.find((s) => s.hasAttribute('segno'))!.getAttribute('segno'), 'segno-1');
  assert.equal(sounds.find((s) => s.hasAttribute('dalsegno'))!.getAttribute('dalsegno'), 'segno-1');
  assert.ok(texts(xml, 'words').includes('D.S. 𝄋'));
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'navigation'));
});

test('da capo al fine preserves its final return instruction and fine playback stop', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \repeat segno 2 { c'1 \volta 2 \fine d'1 } }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'segno').length, 0);
  assert.ok(texts(xml, 'words').includes('Fine'));
  assert.ok(directionTexts(xml).includes('D.C.\nal Fine'));
  const sounds = elements(xml, 'sound');

  assert.equal(sounds.find((s) => s.hasAttribute('dacapo'))!.getAttribute('dacapo'), 'yes');
  assert.equal(sounds.find((s) => s.hasAttribute('fine'))!.getAttribute('fine'), 'yes');
  const jump = sounds.find((s) => s.hasAttribute('dacapo'))!.parentNode;

  assert.equal(texts(jump, 'offset')[0], '4');
});

test('final Fine visibility follows the compiler setting', async () => {
  for (const [setting, count] of [
    ['##f', 0],
    ['##t', 1],
  ]) {
    const { scores } = await converter.convert(
      `{ \\set Score.finalFineTextVisibility = ${setting} c'1 \\fine }`,
    );

    validate(scores[0]!.musicxml);
    const xml = parse(scores[0]!.musicxml);

    assert.equal(texts(xml, 'words').filter((s) => s === 'Fine').length, count);
    assert.equal(elements(xml, 'sound').filter((s) => s.hasAttribute('fine')).length, 1);
  }
});

test('repeated returns preserve the compiler return count', async () => {
  const { scores } = await converter.convert(String.raw`{ \repeat segno 4 { c'1 } }`);

  validate(scores[0]!.musicxml);
  const jump = elements(parse(scores[0]!.musicxml), 'sound').find((s) => s.hasAttribute('dacapo'));

  assert.equal(jump!.getAttribute('time-only'), '1,2,3');
});

test('ad hoc rehearsal marks, section labels, and custom jump text remain native text', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \mark "Intro" c'1 \section \sectionLabel "Bridge" d'1 \textEndMark "Return softly" }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(texts(xml, 'rehearsal'), ['Intro']);
  assert.ok(texts(xml, 'words').includes('Bridge'));
  assert.ok(texts(xml, 'words').includes('Return softly'));
});

test('coda alternatives retain resolved return text and native playback routing', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1 \repeat segno 2 { d'1 \alternative { { e'1 } { f'1 } } } g'1 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);

  assert.equal(elements(xml, 'coda').length, 1);
  assert.ok(directionTexts(xml).includes('D.S. 𝄋 al 𝄌\ne poi la 𝄌𝄌'));
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'navigation-coda'));
  const sounds = elements(xml, 'sound');
  const jump = sounds.find((s) => s.hasAttribute('tocoda'));

  assert.equal(jump!.getAttribute('time-only'), '2');
  assert.ok(sounds.some((s) => s.getAttribute('coda') === jump!.getAttribute('tocoda')));
  const document = scores[0]!.document;
  const result = toMusicXML({
    ...document,
    events: document.events.filter((e) => !('class' in e) || e.class !== 'coda-mark-event'),
  });

  validate(result.musicxml);
  assert.ok(result.diagnostics.some((d) => d.code === 'navigation-coda'));
  assert.ok(directionTexts(parse(result.musicxml)).includes('D.S. 𝄋 al 𝄌\ne poi la 𝄌𝄌'));
});

test('rehearsal frames and basic text styles use native MusicXML attributes', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \mark \default c'1 \set Score.rehearsalMarkFormatter = #format-mark-circle-numbers \mark 3 d'1 \mark \markup \box \italic "Solo" e'1 }`,
  );

  validate(scores[0]!.musicxml);
  const marks = elements(parse(scores[0]!.musicxml), 'rehearsal');

  assert.deepEqual(
    marks.map((m) => m.getAttribute('enclosure')),
    ['none', 'circle', 'rectangle'],
  );
  assert.equal(marks[0]!.getAttribute('font-weight'), 'bold');
  assert.equal(marks[2]!.getAttribute('font-style'), 'italic');
});

for (const [name, music] of [
  ['da capo coda', String.raw`\repeat segno 2 { c'1 \alternative { { d'1 } { e'1 } } } f'1`],
  ['dal segno coda', String.raw`c'1 \repeat segno 2 { d'1 \alternative { { e'1 } { f'1 } } } g'1`],
  [
    'three coda alternatives',
    String.raw`c'1 \repeat segno 3 { d'1 \alternative { { e'1 } { f'1 } { g'1 } } } a'1`,
  ],
  [
    'repeated first coda alternative',
    String.raw`c'1 \repeat segno 3 { d'1 \alternative { \volta 1,2 { e'1 } \volta 3 { f'1 } } } g'1`,
  ],
  [
    'repeated second coda alternative',
    String.raw`c'1 \repeat segno 4 { d'1 \alternative { \volta 1 { e'1 } \volta 2,3 { f'1 } \volta 4 { g'1 } } } a'1`,
  ],
  [
    'empty final coda alternative',
    String.raw`\repeat segno 2 { c'1 \alternative { { d'1 } {} } } e'1`,
  ],
  [
    'coda leading to another segno repeat',
    String.raw`\repeat segno 2 { c'1 \alternative { { d'1 } {} } } \repeat segno 2 { e'1 } f'1`,
  ],
  [
    'two successive coda groups',
    String.raw`\repeat segno 2 { c'1 \alternative { { d'1 } { e'1 } } } \repeat segno 2 { f'1 \alternative { { g'1 } { a'1 } } } b'1`,
  ],
  [
    'reused printed segno labels',
    String.raw`c'1 \repeat segno 2 { d'1 } \segnoMark 1 \repeat segno 2 { e'1 } f'1`,
  ],
  [
    'coda within a measure',
    String.raw`c'4 \repeat segno 2 { d'4 \alternative { { e'4 } { f'4 } } } g'4`,
  ],
]) {
  test(`${name} playback matches the compiler's unfolded score`, async () => {
    const [{ scores }, unfolded] = await Promise.all([
      converter.convert(`{ ${music} }`),
      convert(`\\unfoldRepeats { ${music} }`),
    ]);

    validate(scores[0]!.musicxml);
    assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'navigation-coda'));
    assert.deepEqual(
      navigationPlayback(scores[0]!.musicxml),
      navigationPlayback(unfolded.scores[0]!.musicxml),
    );
  });
}

test('mid-measure tempo and return offsets explicitly affect playback', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4 \tempo 4 = 72 d'4 \repeat segno 2 { e'4 } f'4 }`,
  );

  validate(scores[0]!.musicxml);
  const xml = parse(scores[0]!.musicxml);
  const offsets = elements(xml, 'sound').flatMap((sound) => {
    const own = elements(sound, 'offset')[0];

    if (own) {
      return [own];
    }

    return sound.parentNode!.nodeName === 'direction' ? elements(sound.parentNode, 'offset') : [];
  });

  assert.ok(offsets.length >= 2);
  assert.ok(
    offsets.every((e) => e.parentNode!.nodeName === 'sound' || e.getAttribute('sound') === 'yes'),
  );
});

test('text markup retains mixed bold and italic words without changing the text', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1^\markup \bold { molto \italic dolce } }`,
  );

  validate(scores[0]!.musicxml);
  const words = elements(
    create({ skipWhitespaceOnlyText: false }, scores[0]!.musicxml).node,
    'words',
  );

  assert.equal(words.map((w) => w.textContent).join(''), 'molto dolce');
  assert.equal(
    words.find((w) => w.textContent?.includes('molto'))!.getAttribute('font-weight'),
    'bold',
  );
  assert.equal(words.find((w) => w.textContent === 'dolce')!.getAttribute('font-style'), 'italic');
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'markup-command'));
});

test('columns preserve line breaks, alignment and native frames', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1_\markup \center-column { "first" \box "second" } }`,
  );

  validate(scores[0]!.musicxml);
  const words = elements(
    create({ skipWhitespaceOnlyText: false }, scores[0]!.musicxml).node,
    'words',
  );

  assert.equal(words.map((w) => w.textContent).join(''), 'first\nsecond');
  assert.ok(words.every((w) => w.getAttribute('justify') === 'center'));
  assert.equal(
    words.find((w) => w.textContent === 'second')!.getAttribute('enclosure'),
    'rectangle',
  );
  assert.ok(words.every((w) => w.getAttribute('xml:space') === 'preserve'));
});

test('absolute text sizes, font names, underlines and concatenation use native attributes', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'2^\markup \abs-fontsize #14 \underline "large" d'2^\markup \override #'(font-name . "Example Font") \concat { A \italic B C } }`,
  );

  validate(scores[0]!.musicxml);
  const words = elements(
    create({ skipWhitespaceOnlyText: false }, scores[0]!.musicxml).node,
    'words',
  );
  const large = words.find((w) => w.textContent === 'large');

  assert.ok(Math.abs(Number(large!.getAttribute('font-size')) - 14 * (72 / 72.27)) < 1e-9);
  assert.equal(large!.getAttribute('underline'), '1');
  assert.equal(
    words
      .slice(1)
      .map((w) => w.textContent)
      .join(''),
    'ABC',
  );
  assert.ok(words.slice(1).every((w) => w.getAttribute('font-family') === 'Example Font'));
});

test('text on individual chord notes preserves formatting and placement', async () => {
  const { scores } = await converter.convert(
    String.raw`{ <c'^\markup \bold "upper" e'_\markup \italic "lower">1 }`,
  );

  validate(scores[0]!.musicxml);
  const words = elements(
    create({ skipWhitespaceOnlyText: false }, scores[0]!.musicxml).node,
    'words',
  );
  const upper = words.find((w) => w.textContent === 'upper');
  const lower = words.find((w) => w.textContent === 'lower');

  assert.equal(upper!.getAttribute('font-weight'), 'bold');
  assert.equal(lower!.getAttribute('font-style'), 'italic');
  assert.equal(upper!.parentElement!.parentElement!.getAttribute('placement'), 'above');
  assert.equal(lower!.parentElement!.parentElement!.getAttribute('placement'), 'below');
});

test('markings with identical words and distinct styles are not deduplicated', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1^\markup \bold "same" ^\markup \italic "same" }`,
  );

  validate(scores[0]!.musicxml);
  const words = elements(
    create({ skipWhitespaceOnlyText: false }, scores[0]!.musicxml).node,
    'words',
  ).filter((w) => w.textContent === 'same');

  assert.equal(words.length, 2);
  assert.ok(words.some((w) => w.getAttribute('font-weight') === 'bold'));
  assert.ok(words.some((w) => w.getAttribute('font-style') === 'italic'));
});

test('unsupported graphical markup and mixed-style frames produce specific diagnostics', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'2^\markup \draw-line #'(2 . 3) d'2^\markup \box \line { \bold "first" \italic "second" } }`,
  );

  validate(scores[0]!.musicxml);
  assert.ok(
    scores[0]!.diagnostics.some(
      (d) => d.code === 'markup-command' && d.message.includes('draw-line-markup'),
    ),
  );
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'markup-enclosure'));
  assert.ok(!scores[0]!.musicxml.includes('<image'));
});

test('a uniform framed line stays one enclosure without losing its shared font style', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1^\markup \box \bold \line { "hello" "world" } }`,
  );

  validate(scores[0]!.musicxml);
  const words = elements(parse(scores[0]!.musicxml), 'words');

  assert.equal(words.length, 1);
  assert.equal(words[0]!.textContent, 'hello world');
  assert.equal(words[0]!.getAttribute('enclosure'), 'rectangle');
  assert.equal(words[0]!.getAttribute('font-weight'), 'bold');
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'markup-enclosure'));
});

test('equivalent bold and italic nesting retains both styles inside a single frame', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1^\markup \box \concat { \bold \italic "a" \italic \bold "b" } }`,
  );

  validate(scores[0]!.musicxml);
  const words = elements(parse(scores[0]!.musicxml), 'words');

  assert.equal(words.length, 1);
  assert.equal(words[0]!.textContent, 'ab');
  assert.equal(words[0]!.getAttribute('enclosure'), 'rectangle');
  assert.equal(words[0]!.getAttribute('font-weight'), 'bold');
  assert.equal(words[0]!.getAttribute('font-style'), 'italic');
  assert.ok(!scores[0]!.diagnostics.some((diagnostic) => diagnostic.code === 'markup-enclosure'));
});

test('unsupported font weights report a diagnostic and never emit invalid native values', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'1^\markup \override #'(font-series . semibold) "warm" }`,
  );

  validate(scores[0]!.musicxml);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'markup-command'));
  assert.ok(texts(parse(scores[0]!.musicxml), 'words').includes('warm'));
});
