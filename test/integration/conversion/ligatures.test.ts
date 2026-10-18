import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { elements as all, parse } from '../../support/xml-support.js';

const converter = createConverter(),
  compiler = createReusableCompiler();
const reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const source = (music: string, config = '') =>
  String.raw`\score { \new Staff = "solo" \new Voice = "voice" \with { ${config} } { \override LigatureBracket.color = #red ${music} } \layout {} \midi { \tempo 4=120 } }`;
const graphics = (document: ScoreDocument) => document.events.filter((e) => e.kind === 'ligature');
const value = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const spans = (document: ScoreDocument) =>
  graphics(document).map((g) => [value(g.moment.main), g.endMoment && value(g.endMoment.main)]);
const isRed = (g: Element) =>
  g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)';
const translation = (g: Element) =>
  /translate\(([-\d.]+), ([-\d.]+)\)/.exec(g.getAttribute('transform')!)!;

test('ordinary ligature native bounds and coordinates agree with independent source SVG and MIDI', async () => {
  const text = source(String.raw`\[ c'2 d'2 \]`);
  const [{ scores }, original] = await Promise.all([
    converter.convert(text),
    compiler.compile(text, { format: ['svg', 'midi'] }),
  ]);
  const result = scores[0]!;

  validate(result.musicxml);
  assert.deepEqual(spans(result.document), [[0, 0.5]]);
  const [graphic] = graphics(result.document);

  assert.ok(graphic);
  assert.equal(graphic.name, 'LigatureBracket');
  assert.equal(graphic.custom, false);
  assert.deepEqual(graphic.fromNotes, [1]);
  assert.deepEqual(graphic.toNotes, [2]);
  assert.ok(
    result.document.events.some(
      (e) => e.kind === 'finalLayout' && e.status === 'complete' && e.attempted,
    ),
  );
  const svg = parse(
    new TextDecoder().decode(Object.entries(original.files).find(([n]) => n.endsWith('.svg'))![1]),
  );
  const red = all(svg, 'g').find(isRed)!;

  assert.ok(red);
  const ink = all(red, 'line'),
    baseline = Number(translation(ink[0]!.parentNode as Element)[2]);
  const staffTop = Math.min(
    ...all(svg, 'line')
      .filter(
        (l) =>
          !isRed(l.parentNode!.parentNode as Element) &&
          Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) > 5,
      )
      .map((l) => Number(translation(l.parentNode as Element)[2])),
  );
  const verticals = ink.filter((l) => l.getAttribute('x1') === l.getAttribute('x2'));

  assert.equal(verticals.length, 2);
  assert.ok(
    verticals.every(
      (l) => Math.abs(Number(l.getAttribute('y2')) - Number(l.getAttribute('y1')) - 0.7) < 0.0001,
    ),
  );
  assert.ok(graphic.yTenths!.every((y) => Math.abs(y - 10 * (staffTop - baseline)) < 0.001));
  const marks = all(parse(result.musicxml), 'bracket');

  assert.deepEqual(
    marks.map((b) => b.getAttribute('type')),
    ['start', 'stop'],
  );
  assert.ok(
    marks.every(
      (b) => b.getAttribute('line-end') === 'down' && b.getAttribute('end-length') === '7',
    ),
  );
  assert.ok(
    marks.every(
      (b) => Math.abs(Number(b.getAttribute('default-y')) - 10 * (staffTop - baseline)) < 0.001,
    ),
  );
  assert.equal(reader.loadData(result.musicxml), 1);
  const imported = all(parse(reader.getMEI()), 'bracketSpan')[0]!;

  assert.equal(imported.getAttribute('tstamp'), '1');
  assert.equal(imported.getAttribute('tstamp2'), '0m+3');
  assert.equal(imported.getAttribute('vo'), null);
  assert.ok(
    all(parse(reader.renderToSVG(1)), 'g').some((g) => g.getAttribute('class') === 'bracketSpan'),
  );
  const played = midiTimedNotes(reader.renderToMIDI());
  const expected = midiTimedNotes(
    Object.entries(original.files).find(([n]) => n.endsWith('.midi'))![1],
  );

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  assert.deepEqual(
    all(parse(result.musicxml), 'type').map((n) => n.textContent),
    ['half', 'half'],
  );
  assert.ok(!result.diagnostics.some((d) => d.code === 'ligature-reader'));
});

test('ligature hooks and translated positions use measured source staff and layout units', async () => {
  for (const setup of ['', '#(set-global-staff-size 30)']) {
    const variants = [];

    for (const offset of [false, true]) {
      const text =
        setup +
        source(
          String.raw`\override Staff.StaffSymbol.staff-space = #0.7 ${offset ? String.raw`\override LigatureBracket.extra-offset = #'(2 . 3)` : ''} \[ c'2 d'2 \]`,
        );
      const [{ scores }, original] = await Promise.all([
        converter.convert(text),
        compiler.compile(text, { format: 'svg' }),
      ]);
      const result = scores[0]!;

      validate(result.musicxml);
      const svg = parse(
        new TextDecoder().decode(
          Object.entries(original.files).find(([n]) => n.endsWith('.svg'))![1],
        ),
      );
      const red = all(svg, 'g').find(isRed)!,
        ink = all(red, 'line');
      const t = translation(ink[0]!.parentNode as Element);

      assert.ok(
        ink
          .filter((l) => l.getAttribute('x1') === l.getAttribute('x2'))
          .every(
            (l) =>
              Math.abs(Number(l.getAttribute('y2')) - Number(l.getAttribute('y1')) - 0.49) < 0.0001,
          ),
      );
      const marks = all(parse(result.musicxml), 'bracket');

      assert.ok(marks.every((b) => Math.abs(Number(b.getAttribute('end-length')) - 4.9) < 1e-8));
      assert.ok(marks.every((b) => b.getAttribute('relative-x') === (offset ? '14' : null)));
      variants.push({
        x: Number(t[1]),
        y: Number(t[2]),
        nativeY: Number(marks[0]!.getAttribute('default-y')),
      });
    }

    assert.ok(Math.abs(variants[1]!.x - variants[0]!.x - 1.4) < 0.0001);
    assert.ok(Math.abs(variants[1]!.y - variants[0]!.y + 2.1) < 0.0001);
    assert.ok(Math.abs(variants[1]!.nativeY - variants[0]!.nativeY - 21) < 0.0001);
  }
});

test('ligature bounds include actual chords, rests and final broken pieces without adjacent voice contamination', async () => {
  for (const [music, expected] of [
    [String.raw`\[ <c' e'>2 <d' f'>2 \]`, [[0, 0.5]]],
    [String.raw`\[ c'4 r4 d'4 \] e'4`, [[0, 0.5]]],
    [
      String.raw`\[ c'1 \break d'1 e'1 \]`,
      [
        [0, 1],
        [1, 2],
      ],
    ],
    [String.raw`\[ c'1 \]`, [[0, 0]]],
  ] as const) {
    const { scores } = await converter.convert(source(music));
    const result = scores[0]!;

    validate(result.musicxml);
    assert.deepEqual(spans(result.document), expected);
    assert.equal(all(parse(result.musicxml), 'bracket').length, expected.length * 2);

    if (music.includes('<')) {
      assert.deepEqual(graphics(result.document)[0]!.fromNotes, [1, 2]);
      assert.deepEqual(graphics(result.document)[0]!.toNotes, [3, 4]);
    }
  }

  const { scores } = await converter.convert(
    String.raw`\score { \new Staff << \new Voice { \[ c'2 d'2 \] } \new Voice { g4 g g g } >> \layout {} }`,
  );

  assert.deepEqual(spans(scores[0]!.document), [[0, 0.5]]);
});

test('ligature visibility, source removal and custom or curved drawing remain explicit', async () => {
  for (const [setup, config, hidden, diagnostic] of [
    [String.raw`\override LigatureBracket.transparent = ##t`, '', true, ''],
    [String.raw`\omit LigatureBracket`, '', true, ''],
    [String.raw`\override LigatureBracket.bracket-visibility = ##f`, '', true, ''],
    ['', String.raw`\remove Ligature_bracket_engraver`, true, 'removed'],
    [String.raw`\override LigatureBracket.tuplet-slur = ##t`, '', false, 'ligature-slur'],
    [
      String.raw`\override LigatureBracket.stencil = #ly:text-interface::print \override LigatureBracket.text = \markup "hold"`,
      '',
      false,
      'ligature-stencil',
    ],
  ] as const) {
    const text = source(setup + String.raw` \[ c'2 d'2 \]`, config);
    const [{ scores }, original] = await Promise.all([
      converter.convert(text),
      compiler.compile(text, { format: 'svg' }),
    ]);
    const result = scores[0]!;

    validate(result.musicxml);
    const marks = all(parse(result.musicxml), 'bracket');

    if (diagnostic === 'removed') {
      assert.equal(graphics(result.document).length, 0);
      assert.equal(marks.length, 0);
    } else {
      assert.equal(graphics(result.document)[0]!.hidden, hidden);

      if (diagnostic) {
        assert.equal(marks.length, 0);
        assert.ok(result.diagnostics.some((d) => d.code === diagnostic));
      } else {
        assert.ok(marks.every((b) => b.getAttribute('color') === '#00000000'));
      }
    }

    const svg = parse(
      new TextDecoder().decode(
        Object.entries(original.files).find(([n]) => n.endsWith('.svg'))![1],
      ),
    );

    if (diagnostic === 'ligature-stencil') {
      assert.ok(svg.documentElement.textContent?.includes('hold'));
    }

    if (diagnostic === 'removed' || hidden) {
      assert.ok(
        !all(svg, 'g').some((g) => isRed(g) && (all(g, 'line').length || all(g, 'path').length)),
      );
    }
  }
});

test('analysis, duration and ligature brackets share native numbering and staff ownership', async () => {
  const text = String.raw`\score { \new PianoStaff << \new Staff \new Voice \with { \consists Horizontal_bracket_engraver \consists Duration_line_engraver } { \[ c'1\-\startGroup d'1 \]\stopGroup } \new Staff { \override LigatureBracket.color = #blue \[ c1 d1 \] } >> \layout {} }`;
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const starts = all(parse(result.musicxml), 'bracket').filter(
    (b) => b.getAttribute('type') === 'start',
  );

  assert.equal(starts.length, 4);
  assert.equal(new Set(starts.map((b) => b.getAttribute('number'))).size, 4);
  assert.equal(new Set(graphics(result.document).map((g) => g.staff)).size, 2);
  assert.ok(
    starts.some((b) => all(b.parentNode!.parentNode as Element, 'staff')[0]?.textContent === '2'),
  );
  reader.loadData(result.musicxml);
  assert.ok(
    all(parse(reader.getMEI()), 'bracketSpan').every((b) => b.getAttribute('staff') === '1'),
  );
  assert.ok(!result.diagnostics.some((d) => d.code === 'bracket-staff-reader'));
  const adjacent = (
    await converter.convert(
      source(String.raw`\[ c'2 d'2\- \] e'1`, String.raw`\consists Duration_line_engraver`),
    )
  ).scores[0]!;

  validate(adjacent.musicxml);
  assert.deepEqual(spans(adjacent.document), [[0, 0.5]]);
  const duration = adjacent.document.events.find((e) => e.kind === 'durationLine')!;

  assert.equal(value(duration.moment.main), 0.5);
  assert.equal(value(duration.endMoment!.main), 1);
  const endpoints = all(parse(adjacent.musicxml), 'bracket');

  assert.deepEqual(
    endpoints.map((b) => b.getAttribute('type')),
    ['start', 'stop', 'start', 'stop'],
  );
  assert.ok(endpoints.every((b) => b.getAttribute('number') === '1'));
  const coincident = (
    await converter.convert(
      source(String.raw`\[ c'1\- \] d'1`, String.raw`\consists Duration_line_engraver`),
    )
  ).scores[0]!;

  validate(coincident.musicxml);
  assert.deepEqual(spans(coincident.document), [[0, 0]]);
  const single = all(parse(coincident.musicxml), 'bracket');

  assert.deepEqual(
    single.map((b) => b.getAttribute('type')),
    ['start', 'stop', 'start', 'stop'],
  );
  assert.ok(single.every((b) => b.getAttribute('number') === '1'));
});

test('ligature cached bounds, final-layout failure and score state reset fail closed', async () => {
  const { scores } = await converter.convert(
    source(String.raw`\[ c'2 d'2 \]`) + source(String.raw`c'2 d'2`),
  );

  assert.equal(graphics(scores[1]!.document).length, 0);
  const cached = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;
  const attributes = (xml: string) =>
    all(parse(xml), 'bracket').map((b) => Array.from(b.attributes).map((a) => [a.name, a.value]));

  assert.deepEqual(attributes(toMusicXML(cached).musicxml), attributes(scores[0]!.musicxml));

  for (const endMoment of [
    null,
    {
      main: { numerator: -1, denominator: 1 },
      grace: { numerator: 0, denominator: 1 },
    },
  ]) {
    const invalid = toMusicXML({
      ...cached,
      events: cached.events.map((e) => (e.kind === 'ligature' ? { ...e, endMoment } : e)),
    });

    validate(invalid.musicxml);
    assert.equal(all(parse(invalid.musicxml), 'bracket').length, 0);
    assert.ok(invalid.diagnostics.some((d) => d.code === 'ligature-endpoints'));
  }

  const failed = (
    await converter.convert(
      source(
        String.raw`\override LigatureBracket.after-line-breaking = #(lambda(g)(error "ligature-final")) \[ c'2 d'2 \]`,
      ) + source(String.raw`\[ c'2 d'2 \]`),
    )
  ).scores;

  assert.ok(failed[0]!.diagnostics.some((d) => d.code === 'ligature-capture'));
  assert.equal(graphics(failed[0]!.document).length, 0);
  assert.equal(graphics(failed[1]!.document).length, 1);
});

test('ligature percent copies retain owned hidden spans without inventing crossing cache ownership', async () => {
  const text = source(String.raw`\repeat percent 3 { \[ c'2 d'2 \] } e'1`);
  const [{ scores }, original] = await Promise.all([
    converter.convert(text),
    compiler.compile(text.replaceAll('\\repeat percent', '\\repeat unfold'), {
      format: 'midi',
    }),
  ]);
  const result = scores[0]!;

  validate(result.musicxml);
  const marks = all(parse(result.musicxml), 'bracket');

  assert.equal(marks.length, 6);
  assert.equal(
    marks.filter((b) => /^#00[0-9A-F]{6}$/.test(b.getAttribute('color') ?? '')).length,
    4,
  );
  reader.loadData(result.musicxml);
  const played = midiTimedNotes(reader.renderToMIDI()),
    expected = midiTimedNotes(
      Object.entries(original.files).find(([n]) => n.endsWith('.midi'))![1],
    );

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset]),
    expected.map((n) => [n.pitch, n.onset]),
  );
  const crossing = toMusicXML({
    ...result.document,
    events: result.document.events.map((e) =>
      e.kind === 'ligature'
        ? {
            ...e,
            endMoment: {
              main: { numerator: 3, denominator: 2 },
              grace: { numerator: 0, denominator: 1 },
            },
            toNotes: [],
          }
        : e,
    ),
  });

  assert.ok(crossing.diagnostics.some((d) => d.code === 'ligature-percent'));
  assert.equal(all(parse(crossing.musicxml), 'bracket').length, 2);
});

test('historical ligature glyph replacements are diagnosed separately from ordinary brackets', async () => {
  const text = source(
    String.raw`\override NoteHead.style = #'mensural \[ c'\breve d'\breve \]`,
    String.raw`\remove Ligature_bracket_engraver \consists Mensural_ligature_engraver`,
  );
  const [{ scores }, original] = await Promise.all([
    converter.convert(text),
    compiler.compile(text, { format: 'svg' }),
  ]);
  const result = scores[0]!;

  validate(result.musicxml);
  assert.ok(graphics(result.document).some((g) => g.name === 'MensuralLigature'));
  assert.ok(result.diagnostics.some((d) => d.code === 'ligature-historical'));
  assert.equal(all(parse(result.musicxml), 'bracket').length, 0);
  assert.ok(Object.keys(original.files).some((n) => n.endsWith('.svg')));
});

test('ligature dashed main lines and asymmetric lower hooks retain actual print inputs without extra callbacks', async () => {
  const text =
    String.raw`#(define (observed-ligature-style grob) (format #t "LIGATURE-STYLE-CALL\n") 'dashed-line)` +
    source(String.raw`
    \override LigatureBracket.direction = #DOWN
    \override LigatureBracket.edge-height = #'(0.5 . -0.25)
    \override LigatureBracket.style = #observed-ligature-style
    \override LigatureBracket.dash-period = #2
    \override LigatureBracket.dash-fraction = #0.25
    \[ c'2 d'2 \]`);
  const [converted, original] = await Promise.all([
    converter.convert(text),
    compiler.compile(text, { format: 'svg' }),
  ]);
  const result = converted.scores[0]!;

  validate(result.musicxml);
  const calls = (logs: readonly string[]) =>
    logs.filter((l) => l.startsWith('LIGATURE-STYLE-CALL')).length;

  assert.ok(calls(original.logs) > 0);
  assert.equal(calls(converted.logs), calls(original.logs));
  const graphic = graphics(result.document)[0]!;

  assert.equal(graphic.style, 'dashed-line');
  assert.equal(graphic.dashedEdges, false);
  assert.equal(graphic.dashPeriod, 2);
  assert.equal(graphic.dashFraction, 0.25);
  const svg = parse(
    new TextDecoder().decode(Object.entries(original.files).find(([n]) => n.endsWith('.svg'))![1]),
  );
  const red = all(svg, 'g').find(isRed)!,
    ink = all(red, 'line');

  assert.ok(
    ink.some((l) => l.hasAttribute('stroke-dasharray')),
    'source main line has actual dash ink',
  );
  const hooks = ink
    .filter((l) => l.getAttribute('x1') === l.getAttribute('x2'))
    .sort((a, b) => Number(a.getAttribute('x1')) - Number(b.getAttribute('x1')));

  assert.equal(hooks.length, 2);
  assert.ok(hooks.every((l) => !l.hasAttribute('stroke-dasharray')));
  assert.ok(
    Math.abs(Number(hooks[0]!.getAttribute('y2')) - Number(hooks[0]!.getAttribute('y1')) + 0.5) <
      0.0001,
  );
  assert.ok(
    Math.abs(Number(hooks[1]!.getAttribute('y2')) - Number(hooks[1]!.getAttribute('y1')) - 0.25) <
      0.0001,
  );
  const marks = all(parse(result.musicxml), 'bracket');

  assert.deepEqual(
    marks.map((b) => b.getAttribute('line-end')),
    ['up', 'down'],
  );
  assert.deepEqual(
    marks.map((b) => b.getAttribute('end-length')),
    ['5', '2.5'],
  );
  assert.ok(
    marks.every(
      (b) =>
        b.getAttribute('line-type') === 'dashed' &&
        b.getAttribute('dash-length') === '5' &&
        b.getAttribute('space-length') === '15',
    ),
  );
  assert.ok(result.diagnostics.some((d) => d.code === 'ligature-edge-style'));
  reader.loadData(result.musicxml);
  assert.equal(all(parse(reader.getMEI()), 'bracketSpan')[0]!.getAttribute('lform'), 'dashed');
});
