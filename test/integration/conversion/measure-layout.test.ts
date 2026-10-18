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
  compiler = createReusableCompiler(),
  reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const rows = (d: ScoreDocument) => d.events.filter((e) => e.kind === 'measureLayout');
const ratio = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const source = (music: string, setup = '', staff = '') =>
  `${setup}\n` +
  String.raw`\score { \new Staff = "solo" \with { ${staff} } { \override Staff.BarLine.color = #red ${music} } \layout {} \midi { \tempo 4=120 } }`;

function translate(e: Element, axis: 0 | 1): number {
  let sum = 0;

  for (
    let p: Element | null = e;
    p;
    p = p.parentNode?.nodeType === 1 ? (p.parentNode as Element) : null
  ) {
    for (const m of (p.getAttribute('transform') ?? '').matchAll(
      /translate\(([-\d.]+)[, ]+([-\d.]+)\)/g,
    )) {
      sum += Number(m[axis + 1]);
    }
  }

  return sum;
}

function proveSVG(svg: string, document: ScoreDocument, localSpace = 1, ordinaryBars = true) {
  const d = parse(svg),
    lines = all(d, 'line').filter(
      (e) => Number(e.getAttribute('x2')) - Number(e.getAttribute('x1')) > 5,
    );

  assert.equal(lines.length % 5, 0);
  const rectangles = all(d, 'rect').filter((r) => {
    for (
      let e: Element | null = r;
      e;
      e = e.parentNode?.nodeType === 1 ? (e.parentNode as Element) : null
    ) {
      if (e.getAttribute('color')?.startsWith('rgba(100.0000%, 0.0000%, 0.0000%')) {
        return true;
      }
    }

    return false;
  });

  for (let index = 0; index < lines.length / 5; index++) {
    const staff = lines.slice(index * 5, index * 5 + 5),
      line = staff[0]!;
    const ys = staff.map((e) => translate(e, 1) + Number(e.getAttribute('y1')));
    const top = Math.min(...ys),
      bottom = Math.max(...ys),
      space = (bottom - top) / 4 / localSpace;
    const start =
      translate(line, 0) +
      Number(line.getAttribute('x1')) -
      Number(line.getAttribute('stroke-width')) / 2;
    const end =
      translate(line, 0) +
      Number(line.getAttribute('x2')) +
      Number(line.getAttribute('stroke-width')) / 2;
    const pieces = rows(document).filter((r) => r.system === index + 1);

    assert.ok(pieces.length, `actual system${index + 1}`);
    assert.ok(
      Math.abs(pieces.reduce((sum, r) => sum + r.widthTenths!, 0) - ((end - start) * 10) / space) <
        0.008,
      'source staff-line box span equals sum of actual measure widths',
    );
    assert.ok(pieces[0]!.firstOnSystem && pieces.at(-1)!.lastOnSystem);

    if (ordinaryBars) {
      for (const row of pieces) {
        const expected = start + ((row.endXTenths! - pieces[0]!.startXTenths!) * space) / 10;
        const nearby = rectangles.filter(
          (r) =>
            Math.abs(translate(r, 1) + Number(r.getAttribute('y')) - (top - 0.05 * localSpace)) <
            0.02,
        );

        assert.ok(
          nearby.some(
            (r) =>
              Math.abs(
                translate(r, 0) +
                  Number(r.getAttribute('x')) +
                  (row.lastOnSystem ? Number(r.getAttribute('width')) : 0) -
                  expected,
              ) < 0.001,
          ),
          'internal bar LEFT / final bar RIGHT agrees with actual source boundary, without using last note or ink bbox',
        );
      }
    }
  }
}

function compareMIDI(actual: Uint8Array | string, expected: Uint8Array | string) {
  const a = midiTimedNotes(actual),
    b = midiTimedNotes(expected);

  assert.deepEqual(
    a.map((n) => [n.pitch, n.onset, n.velocity]),
    b.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  a.forEach((n, i) => assert.ok(Math.abs(n.duration! - b[i]!.duration!) < 0.01));
}

test('actual source measure boxes include initial clef space and grace/broken-system boundaries', async () => {
  const text = source(String.raw`c'1 d'1 \break \grace { e'16 f'16 } g'1 a'1`);
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  assert.equal(result.document.measureLayoutsCaptured, true);
  const original = await compiler.compile(text, { format: ['svg', 'midi'] });

  proveSVG(new TextDecoder().decode(file(original.files, '.svg')), result.document);
  const captured = rows(result.document);

  assert.equal(captured.length, 4);
  assert.deepEqual(
    captured.map((r) => [ratio(r.moment.main), ratio(r.endMoment.main), r.system]),
    [
      [0, 1, 1],
      [1, 2, 1],
      [2, 3, 2],
      [3, 4, 2],
    ],
  );
  assert.ok(
    captured[0]!.startXTenths! > 80 && captured[0]!.widthTenths! > 100,
    'initial entire measure starts before clef and first note',
  );
  assert.ok(captured[2]!.columnMoment!.grace.numerator < 0);
  assert.deepEqual(
    all(parse(result.musicxml), 'measure').map((e) => Number(e.getAttribute('width'))),
    captured.map((r) => r.widthTenths),
  );
  assert.ok(result.diagnostics.some((d) => d.code === 'measure-layout-fitting'));
  assert.equal(reader.loadData(result.musicxml), 1);
  const positioned = reader.renderToMIDI();

  assert.deepEqual(
    midiTimedNotes(positioned).map((n) => [n.pitch, n.velocity]),
    midiTimedNotes(file(original.files, '.midi')).map((n) => [n.pitch, n.velocity]),
  );
  // Source grace stealing remains independently partial; measure layout must not change reader playback.
  assert.equal(
    reader.loadData(toMusicXML({ ...result.document, measureLayoutsCaptured: false }).musicxml),
    1,
  );
  compareMIDI(positioned, reader.renderToMIDI());
});

test('automatic source systems and ragged-right margins retain real box edges rather than ink extents', async () => {
  for (const frame of [
    String.raw`\paper { line-width = 45\mm ragged-right = ##t }`,
    String.raw`\paper { ragged-right = ##t } \layout { line-width = 45\mm }`,
  ]) {
    const text = source("c'1 d'1 e'1 f'1 g'1 a'1 b'1 c''1", frame);
    const result = (await converter.convert(text)).scores[0]!;

    validate(result.musicxml);
    const original = await compiler.compile(text, { format: 'svg' });

    proveSVG(new TextDecoder().decode(file(original.files, '.svg')), result.document);
    const starts = rows(result.document).filter((r) => r.firstOnSystem);

    assert.ok(starts.length > 1);
    assert.ok(starts.some((r) => r.lineWidthTenths! - r.systemRightXTenths! > 1));
    const xml = parse(result.musicxml),
      measures = all(xml, 'measure');
    const page = all(xml, 'page-layout')[0]!,
      pageWidth = Number(all(page, 'page-width')[0]!.textContent);
    const pageMargins = all(page, 'page-margins')[0]!,
      pageRight = Number(all(pageMargins, 'right-margin')[0]!.textContent),
      pageLeft = Number(all(pageMargins, 'left-margin')[0]!.textContent);
    const pageContent = pageWidth - pageLeft - pageRight;
    const scaling = all(xml, 'scaling')[0]!,
      mmPerTenth =
        Number(all(scaling, 'millimeters')[0]!.textContent) /
        Number(all(scaling, 'tenths')[0]!.textContent);
    const svg = parse(new TextDecoder().decode(file(original.files, '.svg'))),
      root = svg.documentElement;
    const viewBox = root.getAttribute('viewBox')!.split(/\s+/).map(Number),
      mmPerSVG = Number.parseFloat(root.getAttribute('width')!) / viewBox[2]!;
    const staffLines = all(svg, 'line').filter(
      (e) => Number(e.getAttribute('x2')) - Number(e.getAttribute('x1')) > 5,
    );

    if (frame.includes('\\layout')) {
      assert.ok(
        Math.abs(pageContent - starts[0]!.lineWidthTenths!) > 100,
        'layout line-width does not redefine physical page content width',
      );
    }

    assert.equal(
      all(xml, 'print').filter((p) => p.getAttribute('new-system') === 'yes').length,
      starts.length - 1,
    );

    for (const row of starts) {
      const i = rows(result.document).indexOf(row),
        layout = all(measures[i]!, 'system-layout')[0]!;

      assert.ok(layout);
      assert.ok(
        Math.abs(Number(all(layout, 'left-margin')[0]!.textContent) - row.systemLeftXTenths!) <
          0.00001,
      );
      const margin = Number(all(layout, 'right-margin')[0]!.textContent);

      assert.ok(Math.abs(margin - (pageContent - row.systemRightXTenths!)) < 0.00001);
      const line = staffLines[(row.system - 1) * 5]!;
      const actualSourceRightMM =
        (translate(line, 0) +
          Number(line.getAttribute('x2')) +
          Number(line.getAttribute('stroke-width')) / 2 -
          viewBox[0]!) *
        mmPerSVG;

      assert.ok(
        Math.abs(margin - (pageWidth - pageRight - actualSourceRightMM / mmPerTenth)) < 0.02,
        'native right margin is independently source SVG physical page-content edge minus actual system end',
      );
    }

    reader.setOptions({ breaks: 'encoded' });
    assert.equal(reader.loadData(result.musicxml), 1);
    assert.ok(all(parse(reader.getMEI()), 'measure').every((m) => !m.hasAttribute('width')));
    const geometry = (svg: string) =>
      all(parse(svg), 'g')
        .filter((g) => g.getAttribute('class') === 'note')
        .map((g) => all(g, 'use')[0]?.getAttribute('transform'));
    const positioned = reader.renderToSVG(1);

    assert.equal(
      all(parse(positioned), 'g').filter((g) => g.getAttribute('class') === 'system').length,
      starts.length,
    );
    const automatic = result.musicxml
      .replace(/(<measure\b[^>]*?) width="[^"]*"/g, '$1')
      .replace(/<system-margins>[\s\S]*?<\/system-margins>/g, '');

    assert.equal(reader.loadData(automatic), 1);
    assert.deepEqual(geometry(reader.renderToSVG(1)), geometry(positioned));
  }
});

test('source repeat/double bars and scaled/local staff geometry preserve measure-box dimensions', async () => {
  for (const [setup, staff, spacing] of [
    ['', '', 1],
    ['#(set-global-staff-size 30)', String.raw`\override StaffSymbol.staff-space = #0.7`, 0.7],
  ] as const) {
    const text = source(String.raw`\key es \major c'1 \bar "||" d'1 \bar "|."`, setup, staff);
    const result = (await converter.convert(text)).scores[0]!;

    validate(result.musicxml);
    const original = await compiler.compile(text, { format: ['svg', 'midi'] });

    proveSVG(
      new TextDecoder().decode(file(original.files, '.svg')),
      result.document,
      spacing,
      false,
    );
    assert.ok(
      all(parse(result.musicxml), 'measure').every((m) => Number(m.getAttribute('width')) > 0),
    );
    assert.equal(reader.loadData(result.musicxml), 1);
    compareMIDI(reader.renderToMIDI(), file(original.files, '.midi'));
  }

  const repeatText = source(String.raw`c'1 \bar ":|." d'1`),
    repeat = (await converter.convert(repeatText)).scores[0]!;
  const original = await compiler.compile(repeatText, {
    format: ['svg', 'midi'],
  });

  proveSVG(new TextDecoder().decode(file(original.files, '.svg')), repeat.document, 1, false);
  assert.equal(reader.loadData(repeat.musicxml), 1);
  const played = reader.renderToMIDI();

  compareMIDI(played, file(original.files, '.midi'));
  assert.equal(
    reader.loadData(toMusicXML({ ...repeat.document, measureLayoutsCaptured: false }).musicxml),
    1,
  );
  compareMIDI(played, reader.renderToMIDI());
});

test('actual pickup and incomplete terminal measures retain boxes while mid-measure system fragments stay explicit', async () => {
  const result = (await converter.convert(source(String.raw`\partial 4 c'4 d'1 e'2`))).scores[0]!;

  validate(result.musicxml);
  assert.ok(rows(result.document).some((r) => r.endKind === 'terminal'));
  assert.ok(
    all(parse(result.musicxml), 'measure').every((m) => Number(m.getAttribute('width')) > 0),
  );
  const split = (await converter.convert(source(String.raw`c'2 \bar "" \break d'2 e'1`)))
    .scores[0]!;

  validate(split.musicxml);
  assert.ok(split.diagnostics.some((d) => d.code === 'measure-layout-boundary'));
  assert.ok(all(parse(split.musicxml), 'measure').some((m) => !m.hasAttribute('width')));
});

test('measure layout caches reject contradictory dimensions, duplicate owners, missing history and part-staff disagreement', async () => {
  const result = (await converter.convert(source("c'1 d'1"))).scores[0]!,
    cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;

  assert.deepEqual(
    all(parse(toMusicXML(cached).musicxml), 'measure').map((m) => m.getAttribute('width')),
    all(parse(result.musicxml), 'measure').map((m) => m.getAttribute('width')),
  );
  const mutate = (patch: object) =>
    ({
      ...cached,
      events: cached.events.map((e) => (e.kind === 'measureLayout' ? { ...e, ...patch } : e)),
    }) as ScoreDocument;

  for (const document of [
    mutate({ widthTenths: -1 }),
    mutate({ widthTenths: NaN }),
    mutate({ columnMoment: null }),
    mutate({ startXTenths: 123456 }),
    mutate({ firstOnSystem: false, lastOnSystem: false }),
    mutate({ id: 1 }),
    { ...cached, events: [...cached.events, rows(cached)[0]!] },
  ]) {
    const exported = toMusicXML(document);

    assert.ok(
      exported.diagnostics.some(
        (d) => d.code === 'measure-layout-data' || d.code === 'measure-layout-boundary',
      ),
    );
    assert.ok(all(parse(exported.musicxml), 'measure').some((m) => !m.hasAttribute('width')));
  }

  const { measureLayoutsCaptured: _flag, ...legacy } = cached;

  assert.ok(toMusicXML(legacy).diagnostics.some((d) => d.code === 'measure-layout-history'));
  const piano = (
    await converter.convert(String.raw`\new PianoStaff << \new Staff { c'1 } \new Staff { c'1 } >>`)
  ).scores[0]!.document;
  const staff = rows(piano)[0]!.staff;
  const altered = {
    ...piano,
    events: piano.events.map((e) =>
      e.kind === 'measureLayout' && e.staff === staff
        ? {
            ...e,
            widthTenths: e.widthTenths! + 1,
            endXTenths: e.endXTenths! + 1,
            systemRightXTenths: e.systemRightXTenths! + 1,
          }
        : e,
    ),
  } as ScoreDocument;

  assert.ok(toMusicXML(altered).diagnostics.some((d) => d.code === 'measure-layout-ownership'));
});

test('completed measure layout capture preserves callback counts and resets after source formatting failure', async () => {
  const text =
    String.raw`#(define (measure-blue g) (format #t "MEASURE-BLUE-CALL\n") blue)` +
    source(String.raw`\override NoteHead.color = #measure-blue c'1 d'1`);
  const converted = await converter.convert(text),
    original = await compiler.compile(text, { format: ['svg', 'midi'] });
  const count = (logs: readonly string[]) =>
    logs.filter((l) => l.startsWith('MEASURE-BLUE-CALL')).length;

  assert.ok(count(original.logs) > 0);
  assert.equal(count(converted.logs), count(original.logs));
  const failed = source(
    String.raw`\override NoteHead.after-line-breaking = #(lambda(g) (error "measure-failed")) c'1`,
  );
  const reset = await converter.convert(failed + source("d'1"));

  assert.ok(reset.scores[0]!.diagnostics.some((d) => d.code === 'measure-layout-capture'));
  assert.ok(
    all(parse(reset.scores[0]!.musicxml), 'measure').every((m) => !m.hasAttribute('width')),
  );
  assert.equal(rows(reset.scores[1]!.document)[0]!.id, 1);
  assert.ok(all(parse(reset.scores[1]!.musicxml), 'measure').every((m) => m.hasAttribute('width')));
});
