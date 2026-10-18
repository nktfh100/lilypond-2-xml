import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import listener from '../../../dist/lilypond/generated/listener.js';
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

const ratio = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const near = (a: number, b: number, tolerance = 0.00001) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} versus ${b}`);
const signature = (xml: string) =>
  all(parse(xml), 'measure').map((m) => ({
    number: m.getAttribute('number'),
    implicit: m.getAttribute('implicit'),
    notes: all(m, 'note').map((n) => [
      all(n, 'step')[0]?.textContent,
      all(n, 'duration')[0]?.textContent,
      all(n, 'tie').map((t) => t.getAttribute('type')),
    ]),
  }));
const y = (node: Element) => {
  let result = Number(node.getAttribute('y1'));

  for (
    let p: Element | null = node;
    p;
    p = p.parentNode?.nodeType === 1 ? (p.parentNode as Element) : null
  ) {
    for (const t of (p.getAttribute('transform') ?? '').matchAll(
      /translate\(([-\d.]+)[, ]+([-\d.]+)\)/g,
    )) {
      result += Number(t[2]);
    }
  }

  return result;
};
const source = (music: string) =>
  String.raw`\paper { tagline=##f } \score { \new Staff { ${music} } \layout {} \midi { \tempo 4=120 } }`;

test('existing cadenza fragments retain exact source System widths and page frames without new notation splits', async () => {
  for (const br of [String.raw`\break`, String.raw`\pageBreak`]) {
    // Entering free time after a quarter retains a nonzero measurePosition, so
    // these actual System bounds genuinely have system rather than measure kind.
    const text = source(String.raw`c'4 \cadenzaOn d'4 ${br} e'2`);
    const score = (await converter.convert(text)).scores[0]!;

    validate(score.musicxml);
    const boxes = score.document.events.filter((e) => e.kind === 'measureLayout');

    assert.deepEqual(
      boxes.map((e) => [ratio(e.moment.main), ratio(e.endMoment.main), e.startKind, e.endKind]),
      [
        [0, 0.5, 'measure', 'system'],
        [0.5, 1, 'system', 'terminal'],
      ],
    );
    const xml = parse(score.musicxml),
      measures = all(xml, 'measure');

    assert.equal(measures.length, 2);
    assert.equal(all(xml, 'note').length, 3);
    boxes.forEach((b, i) => near(Number(measures[i]!.getAttribute('width')), b.widthTenths!));
    assert.ok(all(xml, 'top-system-distance').length >= 1);
    assert.ok(
      !score.diagnostics.some(
        (d) => d.code === 'page-layout-boundary' || d.code === 'measure-layout-boundary',
      ),
    );
    const without = toMusicXML({
      ...score.document,
      measureLayoutsCaptured: false,
      pageLayoutsCaptured: false,
    });

    assert.deepEqual(signature(score.musicxml), signature(without.musicxml));
    assert.deepEqual(
      signature(toMusicXML(JSON.parse(JSON.stringify(score.document)) as ScoreDocument).musicxml),
      signature(score.musicxml),
    );
    const baseline = await compiler.compile(text, { format: ['svg', 'midi'] });
    const observed = await compiler.compile(text, {
      format: ['svg', 'midi'],
      files: { 'free-observer.ily': listener },
      includeSettings: 'free-observer.ily',
    });
    const pages = Object.entries(baseline.files)
      .filter(([n]) => n.endsWith('.svg'))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

    assert.equal(pages.length, br.includes('page') ? 2 : 1);
    const widths: number[] = [];

    for (const [name, bytes] of pages) {
      assert.deepEqual(
        observed.files[name],
        bytes,
        'observer leaves independent source SVG unchanged',
      );
      const svg = parse(new TextDecoder().decode(bytes));
      const lines = all(svg, 'line').filter(
        (l) => Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) > 10,
      );

      assert.equal(lines.length % 5, 0);

      for (let i = 0; i < lines.length; i += 5) {
        const l = lines[i]!,
          spacing = Math.abs(y(lines[i + 1]!) - y(l));

        widths.push(
          ((Number(l.getAttribute('x2')) -
            Number(l.getAttribute('x1')) +
            Number(l.getAttribute('stroke-width'))) *
            10) /
            spacing,
        );
      }
    }

    assert.equal(widths.length, 2);
    widths.forEach((w, i) => near(w, boxes[i]!.widthTenths!, 0.003));
    const midi = Object.entries(baseline.files).find(([n]) => n.endsWith('.midi'))!;

    assert.ok(
      Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
      'notation observer emits no MIDI',
    );
    reader.setOptions({ breaks: 'encoded', header: 'none', footer: 'none' });
    assert.equal(reader.loadData(score.musicxml), 1);
    assert.equal(reader.getPageCount(), pages.length);
    const played = midiTimedNotes(reader.renderToMIDI()),
      expected = midiTimedNotes(midi[1]);

    assert.deepEqual(
      played.map((n) => [n.pitch, n.onset, n.velocity]),
      expected.map((n) => [n.pitch, n.onset, n.velocity]),
    );
    played.forEach((n, i) => near(n.duration!, expected[i]!.duration!, 0.01));
    assert.equal(reader.loadData(without.musicxml), 1);
    assert.deepEqual(midiTimedNotes(reader.renderToMIDI()), played);
  }
});

test('metered System cuts and source intervals that do not equal existing native fragments retain explicit limitations', async () => {
  const score = (await converter.convert(source(String.raw`c'2 \break d'2`))).scores[0]!;

  assert.ok(score.diagnostics.some((d) => d.code === 'measure-layout-boundary'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-midmeasure-reader'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-boundary'));
  assert.equal(all(parse(score.musicxml), 'measure').length, 1);
  assert.equal(all(parse(score.musicxml), 'measure')[0]!.hasAttribute('width'), false);
  const free = (await converter.convert(source(String.raw`c'4 \cadenzaOn d'4 \break e'2`)))
    .scores[0]!;
  const altered = {
    ...free.document,
    events: free.document.events.map((e) =>
      e.kind === 'measureLayout' && e.system === 1
        ? {
            ...e,
            endMoment: {
              main: { numerator: 3, denominator: 4 },
              grace: { numerator: 0, denominator: 1 },
            },
          }
        : e,
    ),
  } as ScoreDocument;
  const result = toMusicXML(altered);

  validate(result.musicxml);
  assert.equal(all(parse(result.musicxml), 'measure')[0]!.hasAttribute('width'), false);
  assert.deepEqual(signature(result.musicxml), signature(free.musicxml));
  const noFragment = {
    ...free.document,
    events: free.document.events.filter((e) => e.kind !== 'layout'),
  };
  const unsplit = toMusicXML(noFragment);

  validate(unsplit.musicxml);
  assert.equal(all(parse(unsplit.musicxml), 'measure').length, 1);
  assert.equal(all(parse(unsplit.musicxml), 'measure')[0]!.hasAttribute('width'), false);
  assert.ok(!unsplit.diagnostics.some((d) => d.code === 'page-layout-midmeasure-reader'));
  assert.ok(!unsplit.diagnostics.some((d) => d.code === 'page-layout-boundary'));
});
