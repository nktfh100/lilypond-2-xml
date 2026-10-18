import { toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

test('resolved chord glissandi retain every notehead pair and custom glissandoMap', async () => {
  for (const [map, expected] of [
    [
      '',
      [
        ['C', 'D'],
        ['E', 'F'],
        ['G', 'A'],
      ],
    ],
    [
      String.raw`\set glissandoMap = #'((0 . 2) (2 . 0))`,
      [
        ['C', 'A'],
        ['G', 'D'],
      ],
    ],
    [
      String.raw`\set glissandoMap = #'((0 . 1) (1 . 1) (2 . 0))`,
      [
        ['C', 'F'],
        ['E', 'F'],
        ['G', 'D'],
      ],
    ],
  ] as const) {
    const { scores } = await converter.convert(`{ ${map} <c' e' g'>2\\glissando <d' f' a'>2 }`);
    const score = scores[0]!;

    validate(score.musicxml);
    assert.equal(score.document.glissandosCaptured, true);
    const xml = parse(score.musicxml),
      pairs = new Map<string, [string | null, string | null]>();

    for (const note of elements(xml, 'note')) {
      for (const mark of elements(note, 'glissando')) {
        assert.equal(mark.getAttribute('line-type'), 'solid');
        const id = mark.getAttribute('number')!,
          pair = pairs.get(id) ?? [null, null];

        pair[mark.getAttribute('type') === 'start' ? 0 : 1] = texts(note, 'step')[0]!;
        pairs.set(id, pair);
      }
    }

    assert.deepEqual([...pairs.values()], expected);
    assert.equal(
      score.document.events.filter((e) => e.kind === 'glissando').length,
      expected.length,
    );
  }
});

test('glissando bounds skip intermediate columns and support grace and cross-staff notes', async () => {
  const fixtures = [
    String.raw`{ c'4\glissando \override NoteColumn.glissando-skip = ##t d'4 \revert NoteColumn.glissando-skip e'2 }`,
    String.raw`{ \grace { c'8\glissando d'8 } e'1 }`,
    String.raw`\new PianoStaff << \new Staff = "up" { c'2\glissando \change Staff = "down" d'2 } \new Staff = "down" { s1 } >>`,
    String.raw`\new TabStaff { e'2\glissando fis'2 }`,
  ];

  for (const source of fixtures) {
    const { scores } = await converter.convert(source);

    validate(scores[0]!.musicxml);
    const xml = parse(scores[0]!.musicxml);

    assert.equal(elements(xml, 'glissando').length, 2);
    assert.ok(
      !scores[0]!.diagnostics.some((d) =>
        ['glissando-anchor', 'glissando-endpoints'].includes(d.code),
      ),
    );
  }

  const { scores } = await converter.convert(fixtures[0]!);
  const xml = parse(scores[0]!.musicxml);

  assert.deepEqual(
    elements(xml, 'note')
      .filter((n) => elements(n, 'glissando').length)
      .map((n) => texts(n, 'step')[0]),
    ['C', 'E'],
  );
});

test('glissando line styles, exact colors, hidden graphics and offsets use native attributes', async () => {
  const { scores } = await converter.convert(String.raw`{
    \once \override Glissando.style = #'dashed-line
    \once \override Glissando.color = #'(1/2 0 1)
    \once \override Glissando.extra-offset = #'(1/2 . -1/4) c'4\glissando d'4
    \once \override Glissando.style = #'dotted-line e'4\glissando f'4 |
    \once \override Glissando.style = #'zigzag g'4\glissando a'4
    \once \omit Glissando b'4\glissando c''4 |
    \once \override Glissando.style = #'none d''2\glissando e''2 }`);

  validate(scores[0]!.musicxml);
  const marks = elements(parse(scores[0]!.musicxml), 'glissando').filter(
    (e) => e.getAttribute('type') === 'start',
  );

  assert.deepEqual(
    marks.map((e) => e.getAttribute('line-type')),
    ['dashed', 'dotted', 'wavy', 'solid', 'solid'],
  );
  assert.equal(marks[0]!.getAttribute('color'), '#8000FF');
  assert.equal(marks[0]!.getAttribute('relative-x'), '5');
  assert.equal(marks[0]!.getAttribute('relative-y'), '-2.5');
  assert.equal(marks[0]!.getAttribute('dash-length'), '4');
  assert.equal(marks[0]!.getAttribute('space-length'), '6');

  for (const e of marks.slice(3)) {
    assert.equal(e.getAttribute('color'), '#00000000');
  }

  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'glissando-wave'));
});

test('glissando custom drawing and bounds, missing endpoints and legacy documents have explicit limits', async () => {
  const { scores } =
    await converter.convert(String.raw`{ \once \override Glissando.bound-details.right.arrow = ##t
    \once \override Glissando.thickness = #2 c'2\glissando d'2 | e'1\glissando }`);

  validate(scores[0]!.musicxml);
  assert.equal(elements(parse(scores[0]!.musicxml), 'glissando').length, 2);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'glissando-layout'));
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'glissando-endpoints'));
  const legacy = structuredClone(scores[0]!.document);

  delete legacy.glissandosCaptured;
  legacy.events = legacy.events.filter((e) => e.kind !== 'glissando');
  const { musicxml: xml, diagnostics } = toMusicXML(legacy);

  assert.ok(elements(parse(xml), 'glissando').length >= 2);
  assert.ok(diagnostics.some((d) => d.code === 'glissando-history'));
});

test('percent-repeat glissandi remap both bounds while rejecting incomplete repeated spans', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \repeat percent 3 { <c' e'>2\glissando <d' f'>2 } }`,
  );

  validate(scores[0]!.musicxml);
  const marks = elements(parse(scores[0]!.musicxml), 'glissando');

  assert.equal(marks.length, 12);
  assert.equal(marks.filter((e) => e.getAttribute('color') === '#00000000').length, 8);
  const repeated = await converter.convert(
    String.raw`{ \repeat percent 2 { c'4 d'2.\glissando } e'1 }`,
  );

  validate(repeated.scores[0]!.musicxml);
  assert.equal(elements(parse(repeated.scores[0]!.musicxml), 'glissando').length, 2);
  assert.ok(repeated.scores[0]!.diagnostics.some((d) => d.code === 'glissando-percent'));
});

test('native glissando numbers are reused after closure and reject over sixteen overlapping pairs', async () => {
  const { scores } = await converter.convert(String.raw`{ c'4\glissando d'4 e'4\glissando f'4 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.deepEqual(
    elements(parse(score.musicxml), 'glissando').map((g) => g.getAttribute('number')),
    ['1', '1', '1', '1'],
  );
  const document = structuredClone(score.document),
    span = document.events.find((e) => e.kind === 'glissando')!;

  assert.equal(span.kind, 'glissando');
  document.events = document.events.filter((e) => e.kind !== 'glissando');
  document.events = [
    ...document.events,
    ...Array.from({ length: 17 }, (_, i) => ({ ...span, id: i + 1 })),
  ];
  assert.throws(() => toMusicXML(document), /More than 16 overlapping glissandi/);
});
