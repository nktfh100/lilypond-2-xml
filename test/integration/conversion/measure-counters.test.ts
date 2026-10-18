import type { Document, Element } from '@oozcitak/dom/lib/dom/interfaces.js';
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
  compiler = createReusableCompiler(),
  reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const counters = (doc: ScoreDocument) => doc.events.filter((e) => e.kind === 'measureCounter');
const labels = (xml: string) =>
  all(parse(xml), 'words').filter((w) => w.getAttribute('color')?.startsWith('#FF0000'));
const value = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const source = (music: string, config = '') =>
  String.raw`\score { \new Staff = "solo" \with { \consists Measure_counter_engraver \override MeasureCounter.color = #red \override MeasureCounter.output-attributes = #'((data-counter . "counter")) ${config} } { ${music} } \layout {} \midi { \tempo 4=120 } }`;
const normal = String.raw`\startMeasureCount c'1 d'1 \stopMeasureCount`;

function translate(node: Element, axis: number) {
  let value = 0;

  for (
    let e: Element | null = node;
    e;
    e = e.parentNode?.nodeType === 1 ? (e.parentNode as Element) : null
  ) {
    for (const m of (e.getAttribute('transform') ?? '').matchAll(
      /translate\(([-\d.]+)[, ]+([-\d.]+)\)/g,
    )) {
      value += Number(m[axis + 1]);
    }
  }

  return value;
}

const sourceGroups = (doc: Document) =>
  all(doc, 'g').filter((g) => g.getAttribute('data-counter') === 'counter');

test('measure counts use actual final text spanners and native words without changing bar numbers or MIDI', async () => {
  const text = source(normal),
    converted = await converter.convert(text),
    result = converted.scores[0]!;
  const original = await compiler.compile(text, { format: ['svg', 'midi'] });

  validate(result.musicxml);
  const actual = counters(result.document);

  assert.equal(actual.length, 2);
  assert.deepEqual(
    actual.map((c) => [value(c.moment.main), value(c.endMoment!.main), c.text?.trim()]),
    [
      [0, 1, '1'],
      [1, 2, '2'],
    ],
  );
  assert.ok(actual.every((c) => c.resolvedStart && c.fontEncoding === 'fetaText' && c.xReference));
  assert.deepEqual(
    labels(result.musicxml).map((w) => w.textContent?.trim()),
    ['1', '2'],
  );
  assert.deepEqual(
    all(parse(result.musicxml), 'measure').map((m) => m.getAttribute('number')),
    ['1', '2'],
  );
  const svg = parse(new TextDecoder().decode(file(original.files, '.svg')));

  assert.equal(sourceGroups(svg).length, 2);
  assert.equal(reader.loadData(result.musicxml), 1);
  assert.deepEqual(
    all(parse(reader.getMEI()), 'dir').map((e) => e.textContent?.trim()),
    ['1', '2'],
  );
  const played = midiTimedNotes(reader.renderToMIDI()),
    expected = midiTimedNotes(file(original.files, '.midi'));

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  assert.ok(!result.diagnostics.some((d) => d.code === 'measure-counter-reader'));
});

test('measure-counter actual music-font em and baselines follow global size while local staff space changes only geometry', async () => {
  for (const [setup, config] of [
    ['', ''],
    [
      '#(set-global-staff-size 30)',
      String.raw`\override StaffSymbol.staff-space = #0.7 \override MeasureCounter.extra-offset = #'(3/2 . -7/4)`,
    ],
    [String.raw`\paper { text-font-size = #20 }`, ''],
  ] as const) {
    const text = setup + source(normal, config),
      result = (await converter.convert(text)).scores[0]!;
    const original = await compiler.compile(text, { format: 'svg' });

    validate(result.musicxml);
    const doc = parse(new TextDecoder().decode(file(original.files, '.svg'))),
      event = counters(result.document)[0]!,
      word = labels(result.musicxml)[0]!;
    const group = sourceGroups(doc)[0]!,
      ink = all(group, 'path')[0]!;

    assert.ok(ink);
    const glyphScale = Number(ink.getAttribute('transform')!.match(/scale\(([-\d.]+)/)![1]);
    const root = doc.documentElement,
      mm = Number(root.getAttribute('width')!.replace('mm', ''));
    const viewWidth = Number(root.getAttribute('viewBox')!.split(/\s+/)[2]);
    const actualPoints = (((1000 * glyphScale * mm) / viewWidth) * 72) / 25.4;

    assert.ok(
      Math.abs(actualPoints - Number(word.getAttribute('font-size'))) < 0.26,
      'SVG glyph scale quantized to four decimals',
    );
    const expected = ((setup.includes('staff-size 30') ? 30 : 20) * 2 ** (-2 / 6) * 72) / 72.27;

    assert.ok(Math.abs(Number(word.getAttribute('font-size')) - expected) < 0.003);
    const staff = all(doc, 'line').filter(
      (l) => Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) > 5,
    );
    const top = Math.min(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
    const bottom = Math.max(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
    const factor = 10 / ((bottom - top) / 4 / (event.staffSpace! / event.layoutStaffSpace!));

    assert.ok(
      Math.abs((translate(ink, 0) - translate(staff[0]!, 0)) * factor - event.xTenths!) < 0.008,
    );
    assert.ok(Math.abs((top - translate(ink, 1)) * factor - event.yTenths!) < 0.008);
    assert.ok(Math.abs(Number(word.getAttribute('default-x')) - event.xTenths!) < 0.00001);
    assert.ok(Math.abs(Number(word.getAttribute('default-y')) - event.yTenths!) < 0.00001);
  }
});

test('measure-counter custom text is observed once during real print and retains actual colored text', async () => {
  const setup = String.raw`#(define (observed-counter-text grob) (format #t "MEASURE-TEXT-CALL\n") (markup #:with-color blue #:italic "Count"))`;
  const text =
    setup +
    source(
      normal,
      String.raw`\override MeasureCounter.text = #observed-counter-text \override MeasureCounter.font-encoding = #'latin1 \override MeasureCounter.font-size = #3`,
    );
  const converted = await converter.convert(text),
    original = await compiler.compile(text, { format: 'svg' }),
    result = converted.scores[0]!;
  const calls = (logs: readonly string[]) =>
    logs.filter((l) => l.startsWith('MEASURE-TEXT-CALL')).length;

  assert.ok(calls(original.logs) > 0);
  assert.equal(calls(converted.logs), calls(original.logs));
  const native = all(parse(result.musicxml), 'words').filter((w) => w.textContent === 'Count');

  assert.equal(native.length, 2);
  assert.ok(
    native.every(
      (w) => w.getAttribute('color') === '#0000FF' && w.getAttribute('font-style') === 'italic',
    ),
  );
  assert.ok(
    counters(result.document).every((c) => c.text === 'Count' && c.fontEncoding === 'latin1'),
  );
  const sourceDoc = parse(new TextDecoder().decode(file(original.files, '.svg')));

  assert.ok(all(sourceDoc, 'tspan').some((t) => t.textContent === 'Count'));
  validate(result.musicxml);
});

test('measure-counter hidden, removed, unfinished and custom stencils never invent visible counts', async () => {
  for (const [music, config, count] of [
    [normal, String.raw`\override MeasureCounter.transparent = ##t`, 2],
    [normal, String.raw`\omit MeasureCounter`, 2],
    [normal, String.raw`\remove Measure_counter_engraver`, 0],
    [String.raw`\startMeasureCount c'1 d'1`, '', 2],
    [
      normal,
      String.raw`\override MeasureCounter.stencil = #(lambda(g)(ly:text-interface::print g))`,
      2,
    ],
  ] as const) {
    const result = (await converter.convert(source(music, config))).scores[0]!;

    validate(result.musicxml);

    if (!count) {
      assert.equal(counters(result.document).length, 0);
    } else if (config.includes('lambda')) {
      assert.ok(result.diagnostics.some((d) => d.code === 'measure-counter-stencil'));
    } else if (music !== normal) {
      assert.ok(
        counters(result.document).some((c) => c.hidden),
        'unfinished final count suicides',
      );
    } else {
      assert.ok(counters(result.document).every((c) => c.hidden));
    }

    const visible = labels(result.musicxml).filter(
      (w) => !/00$/.test(w.getAttribute('color') ?? ''),
    );

    if (music === normal) {
      assert.equal(visible.length, 0);
    }
  }
});

test('measure-counter final broken pieces, compressed ranges and independent staves retain actual text', async () => {
  const text = source(
    String.raw`\compressMMRests { \startMeasureCount R1*3 c'2 \break d'2 e'1 \stopMeasureCount }`,
    String.raw`\override MeasureCounter.count-from = #5`,
  );
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const original = await compiler.compile(text, { format: 'svg' });

  assert.ok(
    sourceGroups(parse(new TextDecoder().decode(file(original.files, '.svg')))).length >= 3,
  );
  const actual = counters(result.document);

  assert.ok(actual.some((c) => c.text?.includes('5') && c.text?.includes('7')));
  assert.ok(labels(result.musicxml).some((w) => w.textContent?.includes('5')));
  assert.ok(actual.some((c) => c.piece > 1));
  assert.ok(
    labels(result.musicxml).some((w) => w.textContent?.includes('(')),
    'broken-count parentheses remain text',
  );
  const multi = (
    await converter.convert(
      String.raw`\score { << \new Staff = "upper" \with { \consists Measure_counter_engraver } { \startMeasureCount c'1 d'1 \stopMeasureCount } \new Staff = "lower" \with { \consists Measure_counter_engraver \override MeasureCounter.count-from = #9 } { \startMeasureCount c1 d1 \stopMeasureCount } >> \layout {} }`,
    )
  ).scores[0]!;

  validate(multi.musicxml);
  assert.equal(new Set(counters(multi.document).map((c) => c.staff)).size, 2);
  assert.deepEqual(
    counters(multi.document)
      .map((c) => c.text?.trim())
      .sort(),
    ['1', '10', '2', '9'],
  );
});

test('measure-counter JSON cache, missing fonts/origins, layout failure and following score reset remain explicit', async () => {
  const text = source(normal),
    scores = (await converter.convert(text + source(String.raw`e'1`))).scores;

  assert.equal(counters(scores[1]!.document).length, 0);
  const cached = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;
  const attrs = (xml: string) =>
    labels(xml).map((w) => [
      w.textContent,
      ...Array.from(w.attributes).map((a) => [a.name, a.value]),
    ]);

  assert.deepEqual(attrs(toMusicXML(cached).musicxml), attrs(scores[0]!.musicxml));
  const missing = toMusicXML({
    ...cached,
    events: cached.events.map((e) => {
      if (e.kind !== 'measureCounter') {
        return e;
      }

      const { fontContext, ...rest } = e;

      return { ...rest, xReference: null };
    }),
  });

  assert.ok(
    labels(missing.musicxml).every(
      (w) => !w.hasAttribute('font-size') && !w.hasAttribute('default-x'),
    ),
  );
  assert.ok(missing.diagnostics.some((d) => d.code === 'measure-counter-font-history'));
  assert.ok(missing.diagnostics.some((d) => d.code === 'measure-counter-position'));
  const failed = (
    await converter.convert(
      source(
        normal,
        String.raw`\override MeasureCounter.after-line-breaking = #(lambda(g)(error "counter-final"))`,
      ) + text,
    )
  ).scores;

  assert.equal(counters(failed[0]!.document).length, 0);
  assert.ok(failed[0]!.diagnostics.some((d) => d.code === 'measure-counter-capture'));
  assert.equal(counters(failed[1]!.document).length, 2);
});
