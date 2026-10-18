import type { Document, Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import {
  type ConvertedScore,
  type ScoreDocument,
  createConverter,
  toMusicXML,
} from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { builder } from 'xmlbuilder2';
import listener from '../../../dist/lilypond/generated/listener.js';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { elements as all, parse } from '../../support/xml-support.js';

type MeasureRow = Extract<ScoreDocument['events'][number], { kind: 'measureLayout' }>;
const converter = createConverter(),
  compiler = createReusableCompiler(),
  reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const children = (node: Element) =>
  Array.from(node.childNodes).filter((e): e is Element => e?.nodeType === 1);
const at = (m: { numerator: number; denominator: number }) => m.numerator / m.denominator;
const close = (a: number, b: number, epsilon = 0.01) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} versus ${b}`);
const pitched = (node: Document | Element) =>
  all(node, 'note').filter((n) => all(n, 'pitch').length);
const source = (music: string, layout = '') => String.raw`
#(define (mid-source-post paper pages) (format #t "MID-SOURCE-POST ~a\n" (length pages)))
#(define (mid-source-after grob) (display "MID-SOURCE-AFTER\n") #t)
\paper { paper-width=180\mm paper-height=150\mm top-margin=5\mm bottom-margin=5\mm page-post-process=#mid-source-post }
\header { tagline=##f }
\score { ${music} \layout { \context { \Voice \override NoteHead.after-line-breaking=#mid-source-after } ${layout} } \midi { \tempo 4=120 } }`;
const standalone = (music: string) => String.raw`\new Staff="solo" { ${music} }`;
const nativeParts = (xml: string) =>
  all(parse(xml), 'part').map((part) => {
    const tree = (e: Element): unknown => [
      e.tagName,
      Array.from(e.attributes)
        .map((a) => [a.name, a.value])
        .sort(([a], [b]) => a!.localeCompare(b!)),
      children(e).length ? children(e).map(tree) : e.textContent,
    ];

    return tree(part);
  });

function cached(score: ConvertedScore) {
  const result = toMusicXML(JSON.parse(JSON.stringify(score.document)) as ScoreDocument);

  validate(result.musicxml);
  assert.deepEqual(nativeParts(result.musicxml), nativeParts(score.musicxml));
  assert.equal(all(parse(result.musicxml), 'image').length, 0);
}

async function independent(text: string, compareSourcePlayback = true) {
  const baseline = await compiler.compile(text, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(text, {
    format: ['svg', 'midi'],
    files: { 'mid-observer.ily': listener },
    includeSettings: 'mid-observer.ily',
  });
  const svgs = Object.entries(baseline.files).filter(([name]) => name.endsWith('.svg'));

  assert.ok(svgs.length);

  for (const [name, bytes] of svgs) {
    assert.deepEqual(
      observed.files[name],
      bytes,
      `actual source SVG ${name} remains byte-identical`,
    );
  }

  const file = (files: Record<string, Uint8Array>, suffix: string) =>
    Object.entries(files).find(([name]) => name.endsWith(suffix))![1];
  const expected = midiTimedNotes(file(baseline.files, '.midi'));

  assert.ok(
    Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  const converted = await converter.convert(text),
    score = converted.scores[0]!;

  validate(score.musicxml);

  for (const prefix of ['MID-SOURCE-POST', 'MID-SOURCE-AFTER']) {
    const count = (logs: readonly string[]) =>
      logs.filter((line) => line.startsWith(prefix)).length;

    assert.equal(count(observed.logs), count(baseline.logs));
    assert.equal(count(converted.logs), count(baseline.logs));
  }

  const xml = parse(score.musicxml);

  assert.equal(all(xml, 'image').length, 0);
  cached(score);
  reader.setOptions({
    breaks: 'encoded',
    pageWidth: 2200,
    pageHeight: 3000,
    adjustPageHeight: false,
    header: 'none',
    footer: 'none',
    xmlIdSeed: 1,
  });
  assert.equal(reader.loadData(score.musicxml), 1);
  const actual = midiTimedNotes(reader.renderToMIDI());

  if (compareSourcePlayback) {
    const sort = (notes: typeof actual) =>
      [...notes].sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
    const a = sort(actual),
      b = sort(expected);

    assert.equal(a.length, b.length);
    a.forEach((note, i) => {
      assert.equal(note.pitch, b[i]!.pitch);
      assert.equal(note.velocity, b[i]!.velocity);
      close(note.onset, b[i]!.onset, 0.001);
      close(note.duration!, b[i]!.duration!);
    });
  }

  const readerSystems = Array.from({ length: reader.getPageCount() }, (_, i) => {
    const svg = parse(reader.renderToSVG(i + 1));

    return all(svg, 'g')
      .filter((g) => g.getAttribute('class') === 'system')
      .map((system) => all(system, 'g').filter((g) => g.getAttribute('class') === 'note').length);
  }).flat();
  const mei = parse(reader.getMEI());
  // Geometry-only control: importing the same native music without print cannot alter actual SMF.
  const control = parse(score.musicxml);

  for (const print of all(control, 'print')) {
    print.parentNode!.removeChild(print);
  }

  const controlXML = builder(control).end();

  validate(controlXML);
  reader.setOptions({ xmlIdSeed: 1 });
  assert.equal(reader.loadData(controlXML), 1);
  assert.deepEqual(midiTimedNotes(reader.renderToMIDI()), actual);

  return { score, xml, svgs, readerSystems, mei, expected, actual };
}

function actualBoundary(score: ConvertedScore, main = 0.5) {
  assert.equal(score.document.pageLayoutsCaptured, true);
  const rows = score.document.events.filter(
    (e): e is MeasureRow => e.kind === 'measureLayout' && e.firstOnSystem && e.system === 2,
  );

  assert.ok(rows.length, 'actual final second System exists independently of a requested break');
  assert.ok(
    rows.every(
      (row) =>
        row.columnMoment !== null &&
        at(row.columnMoment.main) === main &&
        row.columnMoment.grace.numerator === 0,
    ),
  );
  assert.equal(score.document.pageLayouts!.length, 2);
}

function printBeforeSecondLead(measure: Element, kind: 'line' | 'page') {
  const notes = pitched(measure),
    second = notes.find(
      (n) => all(n, 'step')[0]!.textContent === 'D' || all(n, 'step')[0]!.textContent === 'A',
    )!;

  assert.ok(second);
  const content = children(measure),
    print = content[content.indexOf(second) - 1]!;

  assert.equal(print.tagName, 'print');
  assert.equal(print.getAttribute(kind === 'page' ? 'new-page' : 'new-system'), 'yes');
  assert.equal(all(print, 'system-layout').length, 1);
  assert.equal(
    measure.getAttribute('width'),
    null,
    'a partial source System width cannot become the whole unchanged metered measure width',
  );

  return print;
}

test('exact midmeasure line/page prints preserve the original measure, actual source frames and independent MIDI', async () => {
  for (const [command, kind] of [
    ['break', 'line'],
    ['pageBreak', 'page'],
  ] as const) {
    const result = await independent(source(standalone("c'2 \\" + command + " d'2"))),
      { score, xml } = result;

    actualBoundary(score);
    assert.equal(all(xml, 'part').length, 1);
    assert.equal(all(xml, 'measure').length, 1);
    assert.equal(pitched(xml).length, 2);
    const measure = all(xml, 'measure')[0]!,
      print = printBeforeSecondLead(measure, kind);
    const division = Number(all(xml, 'divisions')[0]!.textContent);

    assert.deepEqual(
      pitched(xml).map((n) => Number(all(n, 'duration')[0]!.textContent) / division / 4),
      [0.5, 0.5],
    );
    assert.equal(all(xml, 'tie').length, 0);
    assert.equal(all(xml, 'backup').length, 0);
    assert.equal(all(xml, 'forward').length, 0);
    const [first, second] = score.document.pageLayouts!;

    assert.ok(first && second);
    const f = (second.outputScale! * 10) / Number(score.document.paper!['staff-space']),
      staff = second.staves[0]!;

    if (kind === 'page') {
      assert.equal(result.svgs.length, 2);
      assert.equal(new Set(score.document.pageLayouts!.map((r) => r.page)).size, 2);
      close(Number(all(print, 'page-height')[0]!.textContent), second.height! * f, 0.000001);
      close(
        Number(all(print, 'top-system-distance')[0]!.textContent),
        (staff.baselineY! - 2 * staff.staffSpace! - second.topMargin!) * f,
        0.000001,
      );
    } else {
      assert.equal(result.svgs.length, 1);
      assert.equal(all(print, 'page-layout').length, 0);
      close(
        Number(all(print, 'system-distance')[0]!.textContent),
        (staff.baselineY! -
          2 * staff.staffSpace! -
          first.staves[0]!.baselineY! -
          2 * first.staves[0]!.staffSpace!) *
          f,
        0.000001,
      );
    }

    assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-midmeasure-reader'));
    assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-boundary'));
    assert.ok(
      result.readerSystems.includes(2),
      'pinned reader puts both original measure notes together despite native between-note print',
    );
    assert.ok(all(result.mei, 'measure').some((m) => all(m, 'note').length === 2));
    assert.ok(
      all(result.mei, 'measure').every(
        (m) => all(m, 'pb').length === 0 && all(m, 'sb').length === 0,
      ),
    );
  }
});

test('two native parts require the same exact midmeasure cursor before both source attacks', async () => {
  const text = source(
    String.raw`<< \new Staff="upper" { c'2 \pageBreak d'2 } \new Staff="lower" { g2 a2 } >>`,
  );
  const { score, xml } = await independent(text);

  actualBoundary(score);
  const parts = all(xml, 'part');

  assert.equal(parts.length, 2);
  assert.equal(all(xml, 'measure').length, 2);
  assert.equal(pitched(xml).length, 4);

  for (const part of parts) {
    assert.equal(all(part, 'measure').length, 1);
    printBeforeSecondLead(all(part, 'measure')[0]!, 'page');
  }

  assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-boundary'));
});

test('an actual source silent gap splits forwards at the exact System cursor without adding notes or changing total duration', async () => {
  const text = source(
    String.raw`\new Staff="solo" << \new Voice="played" { c'4 s2 d'4 } \new NullVoice { s2 \break s2 } >>`,
  );
  const { score, xml } = await independent(text);

  actualBoundary(score);
  assert.equal(all(xml, 'measure').length, 1);
  assert.equal(pitched(xml).length, 2);
  const notes = pitched(xml),
    voice = all(notes[0]!, 'voice')[0]!.textContent,
    division = Number(all(xml, 'divisions')[0]!.textContent);
  const forwards = all(xml, 'forward').filter((n) => all(n, 'voice')[0]?.textContent === voice);

  assert.deepEqual(
    forwards.map((n) => Number(all(n, 'duration')[0]!.textContent) / division / 4),
    [0.25, 0.25],
  );
  const measure = all(xml, 'measure')[0]!,
    content = children(measure),
    second = forwards[1]!;

  assert.equal(content[content.indexOf(second) - 1]!.tagName, 'print');
  assert.equal(content[content.indexOf(second) - 1]!.getAttribute('new-system'), 'yes');
  assert.equal(all(xml, 'tie').length, 0);
  assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-boundary'));
});

test('a sustained other part cannot donate a guessed midmeasure cursor or force source-note splitting', async () => {
  const { score, xml } = await independent(
    source(String.raw`<< \new Staff="upper" { c'2 \pageBreak d'2 } \new Staff="lower" { g1 } >>`),
  );

  actualBoundary(score);
  const disabled = toMusicXML({
    ...score.document,
    pageLayoutsCaptured: false,
    measureLayoutsCaptured: false,
  });

  validate(disabled.musicxml);
  const heldPart = all(parse(disabled.musicxml), 'part')[1]!;

  assert.equal(pitched(heldPart).length, 1);
  assert.equal(
    all(heldPart, 'attributes').length,
    1,
    'existing notation has initial attributes only',
  );
  assert.equal(all(heldPart, 'backup').length, 0);
  assert.equal(
    all(heldPart, 'forward').length,
    0,
    'no genuine existing interior cursor is available in the held part',
  );
  assert.equal(all(xml, 'part').length, 2);
  assert.equal(all(xml, 'measure').length, 2);
  assert.equal(pitched(xml).length, 3);
  assert.equal(all(xml, 'tie').length, 0);
  assert.equal(all(xml, 'backup').length, 0);
  assert.equal(all(xml, 'forward').length, 0);

  for (const part of all(xml, 'part')) {
    const sequence = children(all(part, 'measure')[0]!);
    const first = sequence.findIndex((n) => n.tagName === 'note');

    assert.ok(sequence.slice(first + 1).every((n) => n.tagName !== 'print'));
  }

  assert.ok(score.diagnostics.some((d) => d.code === 'page-layout-boundary'));
});

test('midmeasure prints precede complete chord groups rather than separating their non-advancing members', async () => {
  const { score, xml } = await independent(
    source(standalone(String.raw`<c' e'>2 \break <d' f'>2`)),
  );

  actualBoundary(score);
  assert.equal(all(xml, 'measure').length, 1);
  assert.equal(pitched(xml).length, 4);
  printBeforeSecondLead(all(xml, 'measure')[0]!, 'line');
  const content = children(all(xml, 'measure')[0]!);

  for (const note of pitched(xml).filter((n) => all(n, 'chord').length)) {
    assert.equal(content[content.indexOf(note) - 1]!.tagName, 'note');
  }

  assert.equal(all(xml, 'chord').length, 2);
  assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-boundary'));
});

test('actual negative grace System boundaries retain the exact non-advancing note cursor', async () => {
  for (const command of ['break', 'pageBreak']) {
    const text = source(
      standalone("c'2 \\grace { \\autoBeamOff d'16 \\" + command + " e'16 } f'2"),
      String.raw`\context { \Voice \remove Forbid_line_break_engraver }`,
    );
    const result = await independent(text, false),
      { score, xml } = result;
    const rows = score.document.events.filter(
      (e): e is MeasureRow => e.kind === 'measureLayout' && e.firstOnSystem && e.system === 2,
    );

    assert.ok(rows.length, 'the actual source must break inside grace');
    assert.ok(
      rows.every(
        (row) =>
          row.columnMoment !== null &&
          at(row.columnMoment.main) === 0.5 &&
          at(row.columnMoment.grace) === -1 / 16,
      ),
    );
    assert.equal(all(xml, 'measure').length, 1);
    assert.equal(pitched(xml).length, 4);
    assert.equal(all(xml, 'grace').length, 2);
    assert.equal(all(xml, 'tie').length, 0);
    const content = children(all(xml, 'measure')[0]!),
      e = pitched(xml).find((n) => all(n, 'step')[0]!.textContent === 'E')!;
    const print = content[content.indexOf(e) - 1]!;

    assert.equal(print.tagName, 'print');
    assert.equal(print.getAttribute(command === 'pageBreak' ? 'new-page' : 'new-system'), 'yes');
    assert.equal(all(content[content.indexOf(print) - 1]!, 'step')[0]!.textContent, 'D');
    assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-boundary'));
    assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-midmeasure-reader'));
    assert.ok(score.diagnostics.some((d) => d.code === 'grace-playback'));
    assert.deepEqual(
      result.actual.map((n) => n.pitch),
      result.expected.map((n) => n.pitch),
    );
    assert.deepEqual(
      result.readerSystems.filter((n) => n > 0),
      [4],
      'reader still moves the cut before the whole native measure',
    );
    const target = score.document.events.find(
      (n) => n.kind === 'note' && at(n.moment.grace) === -1 / 16,
    )!;
    const unresolved = toMusicXML({
      ...score.document,
      events: score.document.events.filter((n) => n !== target),
    });

    validate(unresolved.musicxml);
    assert.ok(unresolved.diagnostics.some((d) => d.code === 'page-layout-boundary'));
    const reduced = parse(unresolved.musicxml),
      reducedContent = children(all(reduced, 'measure')[0]!),
      first = reducedContent.findIndex((n) => n.tagName === 'note');

    assert.ok(
      reducedContent.slice(first + 1).every((n) => n.tagName !== 'print'),
      'a different grace/main sibling cannot donate the missing exact full-Moment cursor',
    );
  }

  const recovered = (await converter.convert(source(standalone("g'1")))).scores[0]!;

  validate(recovered.musicxml);
  cached(recovered);
  assert.equal(recovered.document.pageLayouts![0]!.system, 1);
  assert.equal(recovered.document.pageLayouts!.length, 1);
  assert.equal(pitched(parse(recovered.musicxml)).length, 1);
});
