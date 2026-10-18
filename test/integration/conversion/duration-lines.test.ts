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
  String.raw`\score { \new Staff = "solo" \new Voice = "voice" \with { \consists Duration_line_engraver ${config} } { \override DurationLine.color = #red ${music} } \layout {} \midi { \tempo 4=120 } }`;
const lines = (document: ScoreDocument) => document.events.filter((e) => e.kind === 'durationLine');
const value = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const at = (document: ScoreDocument) =>
  lines(document).map((l) => [value(l.moment.main), l.endMoment && value(l.endMoment.main)]);

test('DurationLine actual final bounds and physical baseline agree with independent source SVG and MIDI', async () => {
  const text = source(String.raw`c'1\- d'1`);
  const [{ scores }, independent] = await Promise.all([
    converter.convert(text),
    compiler.compile(text, { format: ['svg', 'midi'] }),
  ]);
  const result = scores[0]!;

  validate(result.musicxml);
  const [line] = lines(result.document);

  assert.ok(line);
  assert.deepEqual(at(result.document), [[0, 1]]);
  assert.equal(line.leftKind, 'NoteHead');
  assert.equal(line.rightKind, 'NoteColumn');
  assert.deepEqual(line.fromNotes, [1]);
  assert.deepEqual(line.toNotes, [2]);
  assert.ok(
    result.document.events.some(
      (e) => e.kind === 'finalLayout' && e.attempted && e.status === 'complete',
    ),
  );
  const svg = parse(
    new TextDecoder().decode(
      Object.entries(independent.files).find(([n]) => n.endsWith('.svg'))![1],
    ),
  );
  const red = all(svg, 'g').find(
    (g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
  )!;
  const rect = all(red, 'rect')[0]!;
  const translateY = (element: Element) =>
    Number(/translate\(([-\d.]+), ([-\d.]+)\)/.exec(element.getAttribute('transform')!)![2]);
  const center =
    translateY(all(red, 'g')[0]!) +
    Number(rect.getAttribute('y')) +
    Number(rect.getAttribute('height')) / 2;
  const staffTop = Math.min(
    ...all(svg, 'line')
      .filter((l) => Number(l.getAttribute('x2')) > 20)
      .map((l) => translateY(l.parentNode as Element)),
  );

  assert.ok(Math.abs((staffTop - center) * 10 - line.yTenths!) < 0.001);
  assert.ok(Math.abs(Number(rect.getAttribute('height')) - line.thickness!) < 0.0001);
  const native = all(parse(result.musicxml), 'bracket');

  assert.deepEqual(
    native.map((b) => b.getAttribute('type')),
    ['start', 'stop'],
  );
  assert.ok(
    native.every(
      (b) => b.getAttribute('color') === '#FF0000' && b.getAttribute('default-y') === '-50',
    ),
  );
  assert.equal(reader.loadData(result.musicxml), 1);
  const span = all(parse(reader.getMEI()), 'bracketSpan')[0]!;

  assert.equal(span.getAttribute('tstamp'), '1');
  assert.equal(span.getAttribute('tstamp2'), '1m+1');
  assert.equal(span.getAttribute('vo'), null);
  assert.ok(
    all(parse(reader.renderToSVG(1)), 'g').some((g) => g.getAttribute('class') === 'bracketSpan'),
  );
  const original = midiTimedNotes(
    Object.entries(independent.files).find(([n]) => n.endsWith('.midi'))![1],
  );
  const played = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    played.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    original.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - original[i]!.duration!) < 0.01));
  assert.deepEqual(
    all(parse(result.musicxml), 'type').map((n) => n.textContent),
    ['whole', 'whole'],
  );
  assert.ok(!result.diagnostics.some((d) => d.code === 'duration-line-reader'));
});

test('DurationLine ties, skips, terminal pieces, chords and rest bounds use actual graphical ownership', async () => {
  for (const [name, music, expected] of [
    ['tie', String.raw`c'1\-~ c'1 d'1`, [[0, 2]]],
    ['skip', String.raw`c'4\- s2 d'4 e'1`, [[0, 0.75]]],
    ['endSkip', String.raw`\set endAtSkip = ##t c'4\- s2 d'4 e'1`, [[0, 0.25]]],
    ['terminal', String.raw`c'1\-`, [[0, 1]]],
    [
      'chord',
      String.raw`<c' e'>1\- <d' f'>1`,
      [
        [0, 1],
        [0, 1],
      ],
    ],
    ['rest', String.raw`r1\- c'1`, [[0, 1]]],
    [
      'broken',
      String.raw`c'1\-~ \break c'1 d'1`,
      [
        [0, 1],
        [1, 2],
      ],
    ],
  ] as const) {
    const { scores } = await converter.convert(source(music));
    const result = scores[0]!;

    validate(result.musicxml);
    assert.deepEqual(at(result.document), expected, name);
    assert.equal(all(parse(result.musicxml), 'bracket').length, expected.length * 2, name);

    if (name === 'chord') {
      assert.deepEqual(
        lines(result.document).map((l) => l.fromNotes),
        [[1], [2]],
      );
    }

    if (name === 'rest') {
      assert.equal(lines(result.document)[0]!.leftKind, 'Rest');
    }

    if (name === 'broken') {
      assert.deepEqual(
        lines(result.document).map((l) => [l.id, l.piece]),
        [
          [1, 1],
          [1, 2],
        ],
      );
    }
  }
});

test('DurationLine standard appearance and source absence remain distinct from custom drawing', async () => {
  for (const [name, setup, config, hidden, custom] of [
    ['transparent', String.raw`\override DurationLine.transparent = ##t`, '', true, false],
    ['omit', String.raw`\omit DurationLine`, '', true, false],
    ['none', String.raw`\override DurationLine.style = #'none`, '', true, false],
    ['removed', '', String.raw`\remove Duration_line_engraver`, true, false],
    [
      'custom',
      String.raw`\override DurationLine.stencil = #ly:text-interface::print \override DurationLine.text = \markup \italic "hold"`,
      '',
      false,
      true,
    ],
  ] as const) {
    const text = source(setup + String.raw` c'1\- d'1`, config);
    const [{ scores }, original] = await Promise.all([
      converter.convert(text),
      compiler.compile(text, { format: 'svg' }),
    ]);
    const result = scores[0]!;

    validate(result.musicxml);
    const native = all(parse(result.musicxml), 'bracket');

    if (name === 'removed') {
      assert.equal(lines(result.document).length, 0);
      assert.equal(native.length, 0);
    } else {
      assert.equal(lines(result.document)[0]!.custom, custom, name);
      assert.equal(lines(result.document)[0]!.hidden, hidden, name);

      if (custom) {
        assert.equal(native.length, 0);
        assert.ok(result.diagnostics.some((d) => d.code === 'duration-line-stencil'));
        assert.ok(
          Object.entries(original.files).some(
            ([n, b]) => n.endsWith('.svg') && new TextDecoder().decode(b).includes('hold'),
          ),
        );
      } else {
        assert.ok(
          native.every((b) => b.getAttribute('color') === '#00000000'),
          name,
        );
      }
    }
  }

  const { scores } = await converter.convert(
    source(
      String.raw`\override DurationLine.style = #'dashed-line \override DurationLine.bound-details.right.end-style = #'arrow c'1\- d'1`,
    ),
  );

  validate(scores[0]!.musicxml);
  const marks = all(parse(scores[0]!.musicxml), 'bracket');

  assert.ok(marks.every((b) => b.getAttribute('line-type') === 'dashed'));
  assert.equal(marks[1]!.getAttribute('line-end'), 'arrow');
  reader.loadData(scores[0]!.musicxml);
  const arrow = all(parse(reader.getMEI()), 'bracketSpan')[0]!;

  assert.equal(arrow.getAttribute('lendsym'), 'arrow');
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'duration-line-arrow-reader'));
  const standalone = source(
    String.raw`\override DurationLine.style = #'dashed-line \override DurationLine.dash-period = #0 \override DurationLine.bound-details.right.end-style = #'arrow c'1\- d'1`,
  );
  const [{ scores: isolated }, original] = await Promise.all([
    converter.convert(standalone),
    compiler.compile(standalone, { format: 'svg' }),
  ]);
  const svg = parse(
    new TextDecoder().decode(Object.entries(original.files).find(([n]) => n.endsWith('.svg'))![1]),
  );

  assert.ok(
    all(svg, 'g').some(
      (g) =>
        g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)' &&
        all(g, 'path').length > 0,
    ),
  );
  assert.ok(isolated[0]!.diagnostics.some((d) => d.code === 'duration-line-end-visibility'));
  assert.ok(
    all(parse(isolated[0]!.musicxml), 'bracket').every(
      (b) => b.getAttribute('color') === '#00000000',
    ),
  );
});

test('DurationLine staves and analysis brackets share distinct native numbering and retain staff ownership', async () => {
  const text = String.raw`\score { \new PianoStaff << \new Staff = "up" \new Voice \with { \consists Duration_line_engraver \consists Horizontal_bracket_engraver } { c'1\-\startGroup d'1\stopGroup } \new Staff = "down" \new Voice \with { \consists Duration_line_engraver } { \override DurationLine.color = #blue c1\- d1 } >> \layout {} \midi { \tempo 4=120 } }`;
  const { scores } = await converter.convert(text);
  const result = scores[0]!;

  validate(result.musicxml);
  assert.equal(new Set(lines(result.document).map((l) => l.staff)).size, 2);
  const xml = parse(result.musicxml),
    starts = all(xml, 'bracket').filter((b) => b.getAttribute('type') === 'start');

  assert.equal(starts.length, 3);
  assert.equal(new Set(starts.map((b) => b.getAttribute('number'))).size, 3);
  assert.deepEqual(
    starts.map((b) => all(b.parentNode!.parentNode as Element, 'staff')[0]?.textContent).sort(),
    ['1', '1', '2'],
  );
  reader.loadData(result.musicxml);
  assert.ok(
    all(parse(reader.getMEI()), 'bracketSpan').every((b) => b.getAttribute('staff') === '1'),
  );
  assert.ok(!result.diagnostics.some((d) => d.code === 'bracket-staff-reader'));
});

test('DurationLine cache, invalid endpoints and multi-score state reset do not fabricate lines', async () => {
  const { scores } = await converter.convert(
    source(String.raw`c'1\- d'1`) + source(String.raw`e'1 f'1`),
  );

  assert.equal(lines(scores[0]!.document).length, 1);
  assert.equal(lines(scores[1]!.document).length, 0);
  assert.equal(all(parse(scores[1]!.musicxml), 'bracket').length, 0);
  const cached = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;
  const cachedXml = toMusicXML(cached).musicxml;

  validate(cachedXml);
  const attributes = (xml: string) =>
    all(parse(xml), 'bracket').map((b) => Array.from(b.attributes).map((a) => [a.name, a.value]));

  assert.deepEqual(attributes(cachedXml), attributes(scores[0]!.musicxml));

  for (const endMoment of [
    null,
    {
      main: { numerator: -1, denominator: 1 },
      grace: { numerator: 0, denominator: 1 },
    },
  ]) {
    const result = toMusicXML({
      ...cached,
      events: cached.events.map((e) => (e.kind === 'durationLine' ? { ...e, endMoment } : e)),
    });

    validate(result.musicxml);
    assert.equal(all(parse(result.musicxml), 'bracket').length, 0);
    assert.ok(result.diagnostics.some((d) => d.code === 'duration-line-endpoints'));
  }
});

test('DurationLine hook and dash units follow actual staff space and global layout coordinates', async () => {
  for (const setup of ['', '#(set-global-staff-size 30)']) {
    const text =
      setup +
      source(
        String.raw`\override Staff.StaffSymbol.staff-space = #0.7 \override DurationLine.bound-details.right.end-style = #'hook c'1\- d'1 \override DurationLine.style = #'dashed-line \override DurationLine.dash-period = #2 e'1\- f'1`,
      );
    const [{ scores }, original] = await Promise.all([
      converter.convert(text),
      compiler.compile(text, { format: 'svg' }),
    ]);
    const result = scores[0]!;

    validate(result.musicxml);
    const [hook, dashed] = lines(result.document);

    assert.ok(hook && dashed);
    assert.equal(hook.staffSpace, 0.7);
    assert.equal(hook.layoutStaffSpace, 1);
    const marks = all(parse(result.musicxml), 'bracket'),
      stop = marks.find((b) => b.getAttribute('line-end') === 'up')!;

    assert.ok(
      Math.abs(Number(stop.getAttribute('end-length')) - (hook.hookHeight + hook.thickness!) * 10) <
        1e-8,
    );
    const dash = marks.find((b) => b.getAttribute('line-type') === 'dashed')!;

    assert.ok(Math.abs(Number(dash.getAttribute('dash-length')) - 5.6) < 1e-8);
    assert.ok(Math.abs(Number(dash.getAttribute('space-length')) - 8.4) < 1e-8);
    const svg = parse(
      new TextDecoder().decode(
        Object.entries(original.files).find(([n]) => n.endsWith('.svg'))![1],
      ),
    );
    const red = all(svg, 'g').filter(
      (g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
    );
    const heights = red.flatMap((g) => all(g, 'rect').map((r) => Number(r.getAttribute('height'))));

    // Independent source ink contains both the beam width and its full vertical hook.
    assert.ok(heights.some((h) => Math.abs(h - hook.thickness!) < 0.0001));
    assert.ok(heights.some((h) => Math.abs(h - (hook.hookHeight + hook.thickness!)) < 0.0001));
  }

  const { scores } = await converter.convert(
    source(String.raw`\override Staff.StaffSymbol.line-positions = #'(-4 0 2) c'1\- d'1`),
  );

  assert.ok(lines(scores[0]!.document)[0]!.yTenths !== null);
  assert.ok(
    all(parse(scores[0]!.musicxml), 'bracket').every((b) => b.getAttribute('default-y') === null),
  );
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'duration-line-position'));
});

test('DurationLine final-layout failure diagnoses unavailable pieces and resets the following score', async () => {
  const { scores } = await converter.convert(
    source(
      String.raw`\override DurationLine.after-line-breaking = #(lambda (g) (error "duration-final-failure")) c'1\- d'1`,
    ) + source(String.raw`c'1\- d'1`),
  );

  assert.ok(
    scores[0]!.document.events.some((e) => e.kind === 'finalLayout' && e.status === 'failed'),
  );
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'duration-line-capture'));
  assert.equal(lines(scores[0]!.document).length, 0);
  assert.equal(lines(scores[1]!.document).length, 1);
  assert.ok(!scores[1]!.diagnostics.some((d) => d.code === 'duration-line-capture'));
});

test('DurationLine extra-offset uses actual staff space once in source and native coordinates', async () => {
  for (const space of [1, 0.7]) {
    const variants = [];

    for (const offset of [false, true]) {
      const text = source(
        String.raw`\override Staff.StaffSymbol.staff-space = #${space} ${offset ? String.raw`\override DurationLine.extra-offset = #'(2 . 3)` : ''} c'1\- d'1`,
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
      const red = all(svg, 'g').find(
        (g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
      )!;
      const translate = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(
        all(red, 'g')[0]!.getAttribute('transform')!,
      )!;
      const marks = all(parse(result.musicxml), 'bracket');

      assert.ok(
        marks.every((b) => b.getAttribute('relative-x') === (offset ? String(20 * space) : null)),
      );
      variants.push({
        x: Number(translate[1]),
        y: Number(translate[2]),
        captured: lines(result.document)[0]!.yTenths!,
      });
    }

    assert.ok(Math.abs(variants[1]!.x - variants[0]!.x - 2 * space) < 0.0001);
    assert.ok(Math.abs(variants[1]!.y - variants[0]!.y + 3 * space) < 0.0001);
    assert.ok(Math.abs(variants[1]!.captured - variants[0]!.captured - 30 * space) < 0.0001);
  }
});

test('DurationLine percent copies retain owned hidden spans and reject cached bounds beyond the pattern', async () => {
  const text = source(String.raw`\repeat percent 3 { c'2\- d'2 } e'1`);
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
  assert.equal(marks.filter((b) => b.getAttribute('color') === '#FF0000').length, 2);
  assert.equal(
    marks.filter((b) => /^#00[0-9A-F]{6}$/.test(b.getAttribute('color') ?? '')).length,
    4,
  );
  reader.loadData(result.musicxml);
  const played = midiTimedNotes(reader.renderToMIDI());
  const expected = midiTimedNotes(
    Object.entries(original.files).find(([n]) => n.endsWith('.midi'))![1],
  );

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset]),
    expected.map((n) => [n.pitch, n.onset]),
  );
  // Source percent events stop ordinary DurationLines at the pattern boundary.
  // Exercise the defensive cache path explicitly, without claiming that a tie
  // across an elided percent pattern produces this graphical endpoint.
  const crossing = toMusicXML({
    ...result.document,
    events: result.document.events.map((e) =>
      e.kind === 'durationLine'
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

  validate(crossing.musicxml);
  assert.ok(crossing.diagnostics.some((d) => d.code === 'duration-line-percent'));
  assert.equal(all(parse(crossing.musicxml), 'bracket').length, 2);
});
