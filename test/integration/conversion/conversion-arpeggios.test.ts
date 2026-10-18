import { toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

test('arpeggio styles retain resolved arrows and bracket endpoints in pitch order', async () => {
  const { scores } = await converter.convert(
    String.raw`{ <g' c' e'>4\arpeggio \arpeggioArrowUp <c' e' g'>4\arpeggio \arpeggioArrowDown <d' f' a'>4\arpeggio \arpeggioBracket <g' c' e'>4\arpeggio }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const wavy = elements(xml, 'arpeggiate');

  assert.equal(wavy.length, 9);
  assert.deepEqual(
    wavy.map((node) => node.getAttribute('direction')),
    [null, null, null, 'up', 'up', 'up', 'down', 'down', 'down'],
  );
  const bracket = elements(xml, 'non-arpeggiate');

  assert.equal(bracket.length, 2);
  assert.deepEqual(
    bracket.map((node) => [
      texts(node.parentNode?.parentNode, 'step')[0],
      node.getAttribute('type'),
    ]),
    [
      ['G', 'top'],
      ['C', 'bottom'],
    ],
  );
  assert.equal(score.document.arpeggiosCaptured, true);
  assert.deepEqual(
    score.document.events
      .filter((event) => event.kind === 'arpeggio')
      .map((event) => event.noteIds.length),
    [3, 3, 3, 3],
  );
});

test('modern non-arpeggiato and chord-slur commands retain resolved chord marking groups', async () => {
  const { scores } = await converter.convert(
    String.raw`{ <c' e' g'>2\nonArpeggiato <d' f' a'>2\chordSlur | \arpeggioParenthesisDashed <e' g' b'>1\arpeggio }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.equal(elements(xml, 'arpeggiate').length, 0);
  assert.equal(elements(xml, 'non-arpeggiate').length, 6);
  const groups = score.document.events.filter((event) => event.kind === 'arpeggio');

  assert.deepEqual(
    groups.map((event) => [event.style, event.dashed]),
    [
      ['bracket', false],
      ['parenthesis', false],
      ['parenthesis', true],
    ],
  );
  assert.ok(score.diagnostics.some((diagnostic) => diagnostic.code === 'arpeggio-parenthesis'));
  assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code.startsWith('unmapped')));
});

for (const connected of [false, true]) {
  test(`piano arpeggio groups remain ${connected ? 'connected' : 'separate'} across staves`, async () => {
    const { scores } = await converter.convert(
      String.raw`\new PianoStaff \with { connectArpeggios = ${connected ? '##t' : '##f'} } << \new Staff { <c' e' g'>1\arpeggio } \new Staff { \clef bass <c e g>1\arpeggio } >>`,
    );
    const score = scores[0]!;

    validate(score.musicxml);
    const marks = elements(parse(score.musicxml), 'arpeggiate');

    assert.equal(marks.length, 6);
    assert.deepEqual(
      [...new Set(marks.map((mark) => mark.getAttribute('number')))],
      connected ? ['1'] : ['1', '2'],
    );
    assert.ok(marks.every((mark) => mark.getAttribute('unbroken') === (connected ? 'yes' : null)));
    const groups = score.document.events.filter((event) => event.kind === 'arpeggio');

    assert.equal(groups.length, connected ? 1 : 2);
    assert.deepEqual(
      groups.map((group) => group.noteIds.length),
      connected ? [6] : [3, 3],
    );
  });
}

test('connected piano non-arpeggiato brackets mark only the outer chord notes', async () => {
  const { scores } = await converter.convert(
    String.raw`\new PianoStaff \with { connectChordBrackets = ##t } << \new Staff { <c' e' g'>1\nonArpeggiato } \new Staff { \clef bass <c e g>1\nonArpeggiato } >>`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const marks = elements(xml, 'non-arpeggiate');

  assert.equal(marks.length, 2);
  assert.deepEqual(
    marks.map((mark) => [
      mark.getAttribute('type'),
      texts(mark.parentNode?.parentNode, 'staff')[0],
      texts(mark.parentNode?.parentNode, 'step')[0],
    ]),
    [
      ['top', '1', 'G'],
      ['bottom', '2', 'C'],
    ],
  );
  assert.ok(marks.every((mark) => mark.getAttribute('number') === '1'));
});

test('hidden and removed arpeggios retain native semantics without resurrected graphics', async () => {
  for (const source of [
    String.raw`{ \once \omit Arpeggio <c' e' g'>1\arpeggio }`,
    String.raw`{ \once \override Arpeggio.transparent = ##t <c' e' g'>1\arpeggio }`,
    String.raw`\new Voice \with { \remove Arpeggio_engraver } { <c' e' g'>1\arpeggio }`,
  ]) {
    const { scores } = await converter.convert(source);
    const score = scores[0]!;

    validate(score.musicxml);
    const marks = elements(parse(score.musicxml), 'arpeggiate');

    assert.equal(marks.length, 3);
    assert.ok(marks.every((mark) => mark.parentElement!.getAttribute('print-object') === 'no'));
  }
});

test('arpeggio drawing overrides retain their resolved data and explicit native limitations', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \override Arpeggio.direction = #RIGHT <c' e' g'>4\arpeggio \once \override Arpeggio.font-size = #2 <d' f' a'>4\arpeggio \once \override Arpeggio.positions = #'(-3 . 4) <e' g' b'>4\arpeggio \once \override Arpeggio.stencil = #ly:text-interface::print \once \override Arpeggio.text = "roll" <f' a' c''>4\arpeggio }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const groups = score.document.events.filter((event) => event.kind === 'arpeggio');

  assert.equal(groups[0]!.side, 1);
  assert.equal(groups[1]!.fontSize, 2);
  assert.deepEqual(groups[2]!.positions, [-3, 4]);
  assert.equal(groups[3]!.custom, true);

  for (const code of ['arpeggio-side', 'arpeggio-layout', 'arpeggio-stencil']) {
    assert.ok(
      score.diagnostics.some((diagnostic) => diagnostic.code === code),
      code,
    );
  }
});

test('arpeggio identity follows percent-repeat note copies and does not repeat on tied continuations', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \repeat percent 3 { <c' e' g'>1\arpeggio } <d' f' a'>1*2\arpeggio }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const measures = elements(xml, 'measure');

  assert.deepEqual(
    measures.map((measure) => elements(measure, 'arpeggiate').length),
    [3, 3, 3, 3, 0],
  );
  assert.ok(
    elements(measures[1], 'arpeggiate').every(
      (mark) => mark.parentElement!.getAttribute('print-object') === 'no',
    ),
  );
  assert.ok(
    elements(measures[2], 'arpeggiate').every(
      (mark) => mark.parentElement!.getAttribute('print-object') === 'no',
    ),
  );
  const pitches = texts(xml, 'step');

  assert.deepEqual(pitches, [
    'C',
    'E',
    'G',
    'C',
    'E',
    'G',
    'C',
    'E',
    'G',
    'D',
    'F',
    'A',
    'D',
    'F',
    'A',
  ]);
});

test('legacy arpeggio events retain brackets and explicitly report unavailable resolved graphics', async () => {
  const { scores } = await converter.convert(String.raw`{ \arpeggioBracket <c' e' g'>1\arpeggio }`);
  const document = {
    ...scores[0]!.document,
    events: scores[0]!.document.events.filter((event) => event.kind !== 'arpeggio'),
  };

  delete document.arpeggiosCaptured;
  const result = toMusicXML(document);

  validate(result.musicxml);
  assert.equal(elements(parse(result.musicxml), 'non-arpeggiate').length, 2);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 'arpeggio-history'));
});

test('arpeggio identifiers reset between independent scores', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { { <c' e' g'>1\arpeggio } } \score { { <d' f' a'>1\arpeggio } }`,
  );

  assert.equal(scores.length, 2);

  for (const score of scores) {
    validate(score.musicxml);
    assert.deepEqual(
      score.document.events.filter((event) => event.kind === 'arpeggio').map((event) => event.id),
      [1],
    );
    assert.ok(
      elements(parse(score.musicxml), 'arpeggiate').every(
        (mark) => mark.getAttribute('number') === '1',
      ),
    );
  }
});

for (const connected of [false, true]) {
  test(`simultaneous voices keep ${connected ? 'connected' : 'separate'} arpeggio ownership on one staff`, async () => {
    const { scores } = await converter.convert(
      String.raw`\new Staff \with { \consists Span_arpeggio_engraver connectArpeggios = ${connected ? '##t' : '##f'} } << \new Voice { \voiceOne <e' g' b'>1\arpeggio } \new Voice { \voiceTwo <c' e'>1\arpeggio } >>`,
    );
    const score = scores[0]!;

    validate(score.musicxml);
    const marks = elements(parse(score.musicxml), 'arpeggiate');

    assert.equal(marks.length, 5);
    assert.equal(new Set(marks.map((mark) => mark.getAttribute('number'))).size, connected ? 1 : 2);
    assert.ok(marks.every((mark) => mark.getAttribute('unbroken') === null));
    assert.equal(
      score.document.events.filter((event) => event.kind === 'arpeggio').length,
      connected ? 1 : 2,
    );
  });
}

test('arpeggio connections across separate parts retain local markings and report the unsupported span', async () => {
  const { scores } = await converter.convert(
    String.raw`\new StaffGroup \with { connectArpeggios = ##t } << \new Staff { <c' e' g'>1\arpeggio } \new Staff { \clef bass <c e g>1\arpeggio } >>`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.equal(elements(xml, 'part').length, 2);
  assert.equal(elements(xml, 'arpeggiate').length, 6);
  assert.ok(score.diagnostics.some((diagnostic) => diagnostic.code === 'arpeggio-parts'));
});

test('hidden modern non-arpeggiato brackets preserve their native simultaneous-playing indication', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \omit ChordBracket <c' e' g'>1\nonArpeggiato }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.equal(elements(xml, 'arpeggiate').length, 0);
  const bracket = elements(xml, 'non-arpeggiate');

  assert.equal(bracket.length, 2);
  assert.ok(bracket.every((mark) => mark.parentElement!.getAttribute('print-object') === 'no'));
  assert.ok(
    !score.diagnostics.some((diagnostic) => diagnostic.code === 'arpeggio-playback-reader'),
  );
});

test('too many simultaneous arpeggio groups fail instead of joining unrelated markings', async () => {
  const { scores } = await converter.convert(String.raw`{ <c' e' g'>1\arpeggio }`);
  const document = scores[0]!.document;
  const graphic = document.events.find((event) => event.kind === 'arpeggio')!;

  assert.throws(
    () =>
      toMusicXML({
        ...document,
        events: [
          ...document.events.filter((event) => event.kind !== 'arpeggio'),
          ...Array.from({ length: 17 }, (_, index) => ({
            ...graphic,
            id: index + 1,
          })),
        ],
      }),
    /More than 16 simultaneous arpeggio groups/,
  );
});

test('connected piano arpeggios stay grouped when percent repeats copy both voices', async () => {
  const { scores } = await converter.convert(
    String.raw`\new PianoStaff \with { connectArpeggios = ##t } << \new Staff { \repeat percent 3 { <c' e' g'>1\arpeggio } } \new Staff { \clef bass \repeat percent 3 { <c e g>1\arpeggio } } >>`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const measures = elements(parse(score.musicxml), 'measure');

  assert.equal(measures.length, 3);

  for (const measure of measures) {
    const marks = elements(measure, 'arpeggiate');

    assert.equal(marks.length, 6);
    assert.ok(marks.every((mark) => mark.getAttribute('number') === '1'));
    assert.ok(marks.every((mark) => mark.getAttribute('unbroken') === 'yes'));
  }
});

test('arpeggio standard stencil substitutions follow the actual resolved drawing', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \override Arpeggio.stencil = #ly:chord-bracket::print <c' e' g'>2\arpeggio \once \override ChordBracket.stencil = #ly:arpeggio::print <d' f' a'>2\nonArpeggiato }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const groups = score.document.events.filter((event) => event.kind === 'arpeggio');

  assert.deepEqual(
    groups.map((event) => [event.style, event.custom]),
    [
      ['bracket', false],
      ['normal', false],
    ],
  );
  const xml = parse(score.musicxml);

  assert.equal(elements(xml, 'non-arpeggiate').length, 2);
  assert.equal(elements(xml, 'arpeggiate').length, 3);
});

test('grace chord arpeggios retain separate group numbers from each other and the following main chord', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \grace { <c' e'>16\arpeggio <d' f'>16\arpeggio } <e' g'>1\arpeggio }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const marks = elements(parse(score.musicxml), 'arpeggiate');

  assert.deepEqual(
    marks.map((mark) => mark.getAttribute('number')),
    ['1', '1', '2', '2', '3', '3'],
  );
  assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code === 'arpeggio-grace-reader'));
});

test('long grace arpeggio sequences retain valid native group numbers', async () => {
  const grace = Array(17)
    .fill(String.raw`<c' e'>16\arpeggio`)
    .join(' ');
  const { scores } = await converter.convert(`{ \\grace { ${grace} } <e' g'>1\\arpeggio }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const marks = elements(parse(score.musicxml), 'arpeggiate');

  assert.equal(marks.length, 36);
  assert.equal(new Set(marks.map((mark) => mark.getAttribute('number'))).size, 16);
  assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code === 'arpeggio-grace-reader'));
});

test('arpeggio colors, offsets and exact rational appearance values use native attributes', async () => {
  const { scores } =
    await converter.convert(String.raw`{ \once \override Arpeggio.color = #'(1/2 0 1)
    \once \override Arpeggio.extra-offset = #'(1/2 . -1/4) <c' e' g'>2\arpeggio
    \once \override ChordBracket.color = #blue \once \override ChordBracket.extra-offset = #'(-1 . 2) <d' f' a'>2\nonArpeggiato }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const wave = elements(xml, 'arpeggiate'),
    bracket = elements(xml, 'non-arpeggiate');

  assert.equal(wave.length, 3);
  assert.equal(bracket.length, 2);

  for (const m of wave) {
    assert.equal(m.getAttribute('color'), '#8000FF');
    assert.equal(m.getAttribute('relative-x'), '5');
    assert.equal(m.getAttribute('relative-y'), '-2.5');
  }

  for (const m of bracket) {
    assert.equal(m.getAttribute('color'), '#0000FF');
    assert.equal(m.getAttribute('relative-x'), '-10');
    assert.equal(m.getAttribute('relative-y'), '20');
  }

  assert.ok(!score.diagnostics.some((d) => d.code === 'arpeggio-position-reader'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'arpeggio-layout'));
});

test('manual arpeggio ranges retain native nominal endpoint coordinates and source head positions', async () => {
  const { scores } =
    await converter.convert(String.raw`{ \once \override Arpeggio.positions = #'(-3/2 . 4)
    \once \override Arpeggio.staff-position = #2 <c' e' g'>2\arpeggio
    \once \override ChordBracket.positions = #'(-3 . 4) <c' e' g'>2\nonArpeggiato }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const groups = score.document.events.filter((e) => e.kind === 'arpeggio');

  assert.deepEqual(groups[0]!.headPositions, [
    [1, -6],
    [2, -4],
    [3, -2],
  ]);
  assert.equal(groups[0]!.rangeBase, 1);
  assert.deepEqual(
    elements(xml, 'arpeggiate').map((m) => m.getAttribute('default-y')),
    ['-25', null, '30'],
  );
  assert.deepEqual(
    elements(xml, 'non-arpeggiate').map((m) => [
      m.getAttribute('type'),
      m.getAttribute('default-y'),
    ]),
    [
      ['bottom', '-50'],
      ['top', '20'],
    ],
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'arpeggio-range-reference'));
});

test('physical head positions select percussion and reversed tablature bracket endpoints', async () => {
  const fixtures = [
    String.raw`\layout { \context { \DrumVoice \consists Arpeggio_engraver } } \new DrumStaff \drummode { <bd hh sn>1\nonArpeggiato }`,
    String.raw`\new TabStaff \with { stringOneTopmost = ##f } { <e'\1 b\2 g\3>1\nonArpeggiato }`,
  ];
  const drum = (await converter.convert(fixtures[0]!)).scores[0]!;

  validate(drum.musicxml);
  const drumNotes = elements(parse(drum.musicxml), 'note');

  assert.equal(elements(drumNotes[0], 'non-arpeggiate')[0]!.getAttribute('type'), 'bottom');
  assert.equal(elements(drumNotes[1], 'non-arpeggiate')[0]!.getAttribute('type'), 'top');
  assert.equal(elements(drumNotes[2], 'non-arpeggiate').length, 0);
  const tab = (await converter.convert(fixtures[1]!)).scores[0]!;

  validate(tab.musicxml);
  const tabNotes = elements(parse(tab.musicxml), 'note');

  assert.equal(elements(tabNotes[0], 'non-arpeggiate')[0]!.getAttribute('type'), 'bottom');
  assert.equal(elements(tabNotes[2], 'non-arpeggiate')[0]!.getAttribute('type'), 'top');
  assert.ok(!tab.diagnostics.some((d) => d.code === 'arpeggio-tab-reader'));
});

test('arpeggio copies, hidden graphics and legacy appearance data retain native transparency and diagnostics', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \repeat percent 2 { \once \override ChordBracket.color = #red <c' e' g'>1\nonArpeggiato } }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const marks = elements(parse(score.musicxml), 'non-arpeggiate');

  assert.deepEqual(
    marks.map((m) => m.getAttribute('color')),
    ['#FF0000', '#FF0000', '#00000000', '#00000000'],
  );
  const legacy = structuredClone(score.document);

  for (const e of legacy.events) {
    if (e.kind === 'arpeggio') {
      delete e.color;
      delete e.offset;
      delete e.headPositions;
      delete e.rangeReference;
      delete e.rangeBase;
    }
  }

  const result = toMusicXML(legacy);

  validate(result.musicxml);
  assert.ok(result.diagnostics.some((d) => d.code === 'arpeggio-appearance-history'));
});

test('one-note custom arpeggio ranges and unresolved coordinate references have explicit limits', async () => {
  const { scores } =
    await converter.convert(String.raw`{ \once \override Arpeggio.positions = #'(-4 . 4) c'2\arpeggio
    \once \override Arpeggio.positions = #'(-4 . 4) \once \override Arpeggio.Y-offset = #(lambda (g) 2) <d' f' a'>2\arpeggio }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(elements(parse(score.musicxml), 'arpeggiate').length, 5);
  assert.ok(!score.diagnostics.some((d) => d.code === 'arpeggio-single-note-reader'));
  assert.ok(score.diagnostics.some((d) => d.code === 'arpeggio-range-reference'));
  assert.ok(score.diagnostics.some((d) => d.code === 'arpeggio-layout'));
});

test('percent copies retain physical bracket ordering and nominal range coordinates', async () => {
  const { scores } =
    await converter.convert(String.raw`\layout { \context { \DrumVoice \consists Arpeggio_engraver } }
    \new DrumStaff \drummode { \repeat percent 2 { \once \override ChordBracket.positions = #'(-2 . 2) <bd hh sn>1\nonArpeggiato } }`);
  const score = scores[0]!;

  validate(score.musicxml);

  for (const measure of elements(parse(score.musicxml), 'measure')) {
    const notes = elements(measure, 'note');

    assert.deepEqual(
      elements(notes[0], 'non-arpeggiate').map((m) => [
        m.getAttribute('type'),
        m.getAttribute('default-y'),
      ]),
      [['bottom', '-40']],
    );
    assert.deepEqual(
      elements(notes[1], 'non-arpeggiate').map((m) => [
        m.getAttribute('type'),
        m.getAttribute('default-y'),
      ]),
      [['top', '0']],
    );
    assert.equal(elements(notes[2], 'non-arpeggiate').length, 0);
  }
});

test('numeric arpeggio coordinate overrides retain native nominal x and y positions', async () => {
  const { scores } = await converter.convert(String.raw`{ \once \override Arpeggio.X-offset = #2
    \once \override Arpeggio.Y-offset = #2 \once \override Arpeggio.positions = #'(-3 . 4) <c' e' g'>1\arpeggio }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const marks = elements(parse(score.musicxml), 'arpeggiate');
  const space = score.document.paper!['staff-space'];

  assert.equal(typeof space, 'number');
  const expectedX = 20;

  assert.ok(marks.every((m) => Math.abs(Number(m.getAttribute('default-x')) - expectedX) < 1e-9));
  assert.ok(Math.abs(Number(marks[0]!.getAttribute('default-y')) - (-50 + expectedX)) < 1e-9);
  assert.equal(marks[1]!.getAttribute('default-y'), null);
  assert.ok(Math.abs(Number(marks[2]!.getAttribute('default-y')) - (20 + expectedX)) < 1e-9);
  assert.ok(!score.diagnostics.some((d) => d.code === 'arpeggio-range-reference'));
});

test('connected arpeggios retain numeric x positions with a layout reference and diagnose unresolved cross-staff ranges', async () => {
  const { scores } =
    await converter.convert(String.raw`\new PianoStaff \with { connectArpeggios = ##t
    \override Arpeggio.X-offset = #2 \override Arpeggio.positions = #'(-10 . 3) } <<
    \new Staff { <c' e' g'>1\arpeggio } \new Staff { \clef bass <c e g>1\arpeggio } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const marks = elements(parse(score.musicxml), 'arpeggiate');

  assert.equal(marks.length, 6);
  const space = score.document.paper!['staff-space'];

  assert.equal(typeof space, 'number');
  assert.ok(marks.every((m) => Math.abs(Number(m.getAttribute('default-x')) - 20) < 1e-9));
  assert.ok(score.diagnostics.some((d) => d.code === 'arpeggio-range-reference'));
});
