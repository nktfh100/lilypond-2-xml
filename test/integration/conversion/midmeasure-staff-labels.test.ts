import type { Document, Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { createConverter, toMusicXML } from '../../../dist/index.js';
import listener from '../../../dist/lilypond/generated/listener.js';
import type { ScoreDocument } from '../../../src/model/document.js';
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

const words = (xml: string) =>
  all(parse(xml), 'words').filter((w) =>
    ['RightHand', 'LeftHand', 'P1.', 'P2.'].includes(w.textContent ?? ''),
  );
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];

type Matrix = [number, number, number, number, number, number];
const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const elementMatrix = (value: string | null): Matrix => {
  let out: Matrix = [1, 0, 0, 1, 0, 0];

  for (const entry of (value ?? '').matchAll(
    /(matrix|translate|scale|rotate|skewX|skewY)\(([^)]*)\)/g,
  )) {
    const n = (entry[2] ?? '').trim().split(/[ ,]+/).map(Number),
      name = entry[1];
    let next: Matrix;

    if (name === 'matrix' && n.length === 6) {
      next = n as Matrix;
    } else if (name === 'translate') {
      next = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    } else if (name === 'scale') {
      next = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    } else if (name === 'rotate') {
      const angle = ((n[0] ?? 0) * Math.PI) / 180,
        c = Math.cos(angle),
        s = Math.sin(angle),
        cx = n[1] ?? 0,
        cy = n[2] ?? 0;

      next = mul(mul([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (name === 'skewX') {
      next = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    } else if (name === 'skewY') {
      next = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    } else {
      continue;
    }

    out = mul(out, next);
  }

  return out;
};
const svgPoint = (
  node: Element,
  x = Number(node.getAttribute('x') ?? 0),
  y = Number(node.getAttribute('y') ?? 0),
) => {
  const chain: Element[] = [];

  for (
    let parent: Element | null = node;
    parent;
    parent = parent.parentNode?.nodeType === 1 ? (parent.parentNode as Element) : null
  ) {
    chain.push(parent);
  }

  let matrix: Matrix = [1, 0, 0, 1, 0, 0];

  for (const parent of chain.reverse()) {
    matrix = mul(matrix, elementMatrix(parent.getAttribute('transform')));
  }

  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
};
const systemOrigins = (svg: Document) => {
  const points = all(svg, '*')
    .filter((el) => el.getAttribute('data-system-left') === 'yes')
    .flatMap((owner) =>
      all(owner, 'path').flatMap((path) => {
        const m = (path.getAttribute('d') ?? '').match(
          /^M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)$/,
        );

        if (!m) {
          return [];
        }

        const x1 = Number(m[1]),
          y1 = Number(m[2]),
          x2 = Number(m[3]),
          y2 = Number(m[4]);

        return Math.abs(x2 - x1) < 1e-7 && Math.abs(Math.abs(y2 - y1) - 0.1) < 1e-6
          ? [svgPoint(path, x1, y1)]
          : [];
      }),
    );
  const unique = points.filter(
    (point, i) =>
      points.findIndex(
        (other) => Math.abs(other.x - point.x) < 0.0001 && Math.abs(other.y - point.y) < 0.0001,
      ) === i,
  );

  return unique.sort((a, b) => a.y - b.y);
};
const source = (
  upper = String.raw`c'2 \break d'2 e'2 \break f'2`,
  lower = 'c2 d2 e2 f2',
) => String.raw`\version "2.26.0"
#(define (mid-label-after g)
 (let ((when (ly:grob-property-data (ly:spanner-bound g LEFT) 'when)))
  (format #t "MID-LABEL-AFTER ~s\n" when)
  (ly:grob-set-property! g 'output-attributes '((data-instrument-label . "yes")))
  (ly:grob-set-property! g 'text (if (moment<=? when (ly:make-moment 1)) "P1." "P2."))
  (ly:grob-set-property! g 'stencil system-start-text::print)))
#(define (mid-label-post paper pages) (format #t "MID-LABEL-POST ~a\n" (length pages)))
#(define (mid-label-system-left g)
 (let* ((system (ly:grob-system g)) (left (and (ly:grob? system) (ly:spanner-bound system LEFT))))
  (if (and (ly:grob? left) (eq? g left))
   '((data-system-left . "yes"))
   '())))
#(define (mid-label-system-left-stencil g)
 (ly:stencil-add (ly:paper-column::print g)
  (ly:make-stencil '(path 0.05 (moveto 0 0 lineto 0 0.1) round round #t)
   '(0 . 0.05) '(0 . 0.1))))
\paper { ragged-right=##t indent=20\mm short-indent=10\mm page-post-process=#mid-label-post }
\header { tagline=##f }
\score { \new PianoStaff \with { instrumentName="Piano" shortInstrumentName="Pno."
 \override InstrumentName.after-line-breaking=#mid-label-after } <<
 \new Staff="upper" \with { instrumentName="RightHand" shortInstrumentName="RH." \override InstrumentName.color=#red } { ${upper} }
 \new Staff="lower" \with { instrumentName="LeftHand" shortInstrumentName="LH." \override InstrumentName.color=#blue } { ${lower} }
 >> \layout { \context { \Voice \remove Forbid_line_break_engraver }
 \context { \Score \override PaperColumn.stencil = #mid-label-system-left-stencil
 \override NonMusicalPaperColumn.stencil = #mid-label-system-left-stencil
 \override PaperColumn.output-attributes = #mid-label-system-left
 \override NonMusicalPaperColumn.output-attributes = #mid-label-system-left } } \midi { \tempo 4=120 } }
`;

function musical(xml: string) {
  return all(parse(xml), 'note').map((n) => ({
    step: all(n, 'step')[0]?.textContent,
    duration: all(n, 'duration')[0]?.textContent,
    grace: all(n, 'grace').length,
    type: all(n, 'type')[0]?.textContent,
  }));
}

test('actual independent and main labels survive proven midmeasure System cursors without guessed horizontal references', async () => {
  const original = source(),
    plain = await compiler.compile(original, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(original, {
    format: ['svg', 'midi'],
    files: { 'mid-label.ily': listener },
    includeSettings: 'mid-label.ily',
  });

  assert.deepEqual(file(observed.files, '.svg'), file(plain.files, '.svg'));
  assert.ok(
    Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );

  for (const prefix of ['MID-LABEL-AFTER', 'MID-LABEL-POST']) {
    assert.deepEqual(
      observed.logs.filter((l) => l.startsWith(prefix)),
      plain.logs.filter((l) => l.startsWith(prefix)),
    );
  }

  const svg = parse(new TextDecoder().decode(file(plain.files, '.svg')));

  assert.equal(all(svg, 'text').filter((e) => e.textContent === 'P1.').length, 3);
  assert.equal(all(svg, 'text').filter((e) => e.textContent === 'P2.').length, 3);
  const result = (await converter.convert(original)).scores[0]!;

  validate(result.musicxml);
  const xml = parse(result.musicxml),
    native = words(result.musicxml),
    sourceSvg = parse(new TextDecoder().decode(file(plain.files, '.svg')));
  const space = result.document.paper?.['staff-space'];

  assert.ok(typeof space === 'number' && space > 0);
  assert.deepEqual(
    native.map((w) => w.textContent),
    ['RightHand', 'LeftHand', 'P1.', 'P1.', 'P2.', 'P2.'],
  );

  for (const [index, word] of native.entries()) {
    const direction = word.parentNode!.parentNode as Element,
      staff = Number(all(direction, 'staff')[0]!.textContent);

    assert.equal(staff, (index % 2) + 1);
    assert.equal(word.getAttribute('color'), staff === 1 ? '#FF0000' : '#0000FF');
    const piece = result.document.events
      .filter((e) => e.kind === 'instrumentLabelPiece')
      .find((p) => p.context === (staff === 1 ? 2 : 3) && p.system === Math.floor(index / 2) + 1)!;

    assert.ok(
      Math.abs(
        Number(word.getAttribute('default-y')) - (piece.y! * 10 * piece.outputScale) / space,
      ) < 1e-8,
    );
    assert.ok(
      Math.abs(
        Number(word.getAttribute('default-x')) - (piece.x! * 10 * piece.outputScale) / space,
      ) < 1e-8,
    );
    assert.equal(word.getAttribute('font-size'), String(piece.fontContext!.attrs['font-size']));
    assert.ok(word.hasAttribute('default-x'));
    const lineOrigins = all(sourceSvg, 'line')
      .filter(
        (line) =>
          Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')) > 10 &&
          Number(line.getAttribute('y1')) === 0 &&
          Number(line.getAttribute('y2')) === 0,
      )
      .map((line) => {
        return svgPoint(line, Number(line.getAttribute('x1')), Number(line.getAttribute('y1')));
      })
      .sort((a, b) => a.y - b.y);

    assert.equal(lineOrigins.length, 30, 'three actual Systems each contain two five-line staves');
    const staffIndex = staff === 1 ? 0 : 1,
      top = lineOrigins[((piece.system - 1) * 2 + staffIndex) * 5]!;
    const leftColumns = systemOrigins(sourceSvg);

    assert.equal(
      leftColumns.length,
      3,
      'the actual PaperColumn LEFT origin is independently measured once per source System',
    );
    const sourceCandidates = all(sourceSvg, '*')
      .filter((el) => el.getAttribute('data-instrument-label') === 'yes')
      .flatMap((el) => (el.localName === 'text' ? [el] : all(el, 'text')))
      .filter((text) => text.textContent === piece.text)
      .map((el) => ({ el, ...svgPoint(el) }))
      .filter((text) => Math.abs(top.y - text.y - piece.y!) < 0.0002);

    assert.equal(
      sourceCandidates.length,
      1,
      `unique independent SVG label for ${piece.text} on staff ${staff}`,
    );
    assert.ok(
      Math.abs(sourceCandidates[0]!.x - leftColumns[piece.system - 1]!.x - piece.x!) < 0.0002,
      `${piece.text} SVG text anchor relative to the independently printed PaperColumn-origin line`,
    );
  }

  const mainUpdates = all(xml, 'print')
    .flatMap((p) => all(p, 'part-abbreviation-display'))
    .flatMap((p) => all(p, 'display-text').map((e) => e.textContent));

  assert.ok(
    mainUpdates.includes('P2.'),
    'actual later main display is attached at its proven System print',
  );
  assert.ok(!result.diagnostics.some((d) => d.code === 'instrument-label-reference'));
  assert.ok(!result.diagnostics.some((d) => d.code === 'instrument-label-system'));
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;

  assert.equal(toMusicXML(cached, { source: original }).musicxml, result.musicxml);

  const rejectBoundary = (document: ScoreDocument) => {
    const rejected = toMusicXML(document, { source: original });

    validate(rejected.musicxml);
    const p1 = words(rejected.musicxml).filter((w) => w.textContent === 'P1.');

    assert.equal(
      p1.length,
      0,
      'ambiguous source boundary is fail-closed in native output rather than assigned a guessed System X',
    );
    assert.equal(
      document.events.filter(
        (e) =>
          e.kind === 'instrumentLabelPiece' &&
          e.system === 2 &&
          e.text === 'P1.' &&
          [2, 3].includes(e.context),
      ).length,
      2,
      'the source label pieces remain available in cached metadata',
    );
    assert.deepEqual(musical(rejected.musicxml), musical(result.musicxml));
    const provenanceDiagnostics = rejected.diagnostics.filter(
      (d) => d.code.includes('boundary') || d.code.startsWith('instrument-label-'),
    );

    assert.ok(
      provenanceDiagnostics.length > 0,
      `the omission is reported with a boundary/label diagnostic: ${JSON.stringify(rejected.diagnostics)}`,
    );
  };
  const systemTwoRows = cached.events.filter(
    (e) => e.kind === 'measureLayout' && e.system === 2 && e.firstOnSystem,
  );

  assert.equal(systemTwoRows.length, 2, 'both source staves own the actual System boundary');
  const mismatchedBoundary = {
    ...cached,
    events: cached.events.map((e) =>
      e.kind === 'measureLayout' && e === systemTwoRows[1]!
        ? {
            ...e,
            moment: {
              ...e.moment,
              main: {
                ...e.moment.main,
                numerator: e.moment.main.numerator + 1,
              },
            },
          }
        : e,
    ),
  };

  rejectBoundary(mismatchedBoundary);
  const maxId = cached.events.reduce(
    (max, e) => ('id' in e && typeof e.id === 'number' ? Math.max(max, e.id) : max),
    0,
  );
  const duplicateBoundary = {
    ...cached,
    events: [...cached.events, { ...systemTwoRows[0]!, id: maxId + 1 }],
  };

  rejectBoundary(duplicateBoundary);
  const unlabelled = toMusicXML(
    {
      ...cached,
      events: cached.events.filter((e) => e.kind !== 'instrumentLabelPiece'),
    },
    { source: original },
  ).musicxml;

  assert.deepEqual(musical(result.musicxml), musical(unlabelled));
  assert.equal(reader.loadData(result.musicxml), 1);
  const withLabels = midiTimedNotes(reader.renderToMIDI());

  assert.equal(reader.loadData(unlabelled), 1);
  assert.deepEqual(midiTimedNotes(reader.renderToMIDI()), withLabels);
  const expected = midiTimedNotes(file(plain.files, '.midi'));

  assert.deepEqual(
    withLabels.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  withLabels.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  assert.equal(all(xml, 'image').length, 0);
  const pieces = cached.events.filter((e) => e.kind === 'instrumentLabelPiece'),
    middle = pieces.find((p) => p.context === 2 && p.system === 2)!;
  const duplicate = toMusicXML(
    { ...cached, events: [...cached.events, { ...middle }] },
    { source: original },
  );

  assert.ok(duplicate.diagnostics.some((d) => d.code === 'instrument-label-piece'));
  assert.equal(words(duplicate.musicxml).filter((w) => w.textContent === 'P1.').length, 1);
  const wrongMoment = toMusicXML(
    {
      ...cached,
      events: cached.events.map((e) =>
        e === middle
          ? {
              ...middle,
              moment: {
                main: { numerator: 3, denominator: 4 },
                grace: { numerator: 0, denominator: 1 },
              },
            }
          : e,
      ),
    },
    { source: original },
  );

  assert.ok(wrongMoment.diagnostics.some((d) => d.code === 'instrument-label-piece'));
  assert.equal(words(wrongMoment.musicxml).filter((w) => w.textContent === 'P1.').length, 1);
  const main = pieces.find((p) => p.context === 1 && p.system === 3)!;
  const duplicatedMain = toMusicXML(
    { ...cached, events: [...cached.events, { ...main }] },
    { source: original },
  );

  validate(duplicatedMain.musicxml);
  assert.ok(duplicatedMain.diagnostics.some((d) => d.code === 'instrument-name-piece'));
  assert.ok(
    !all(parse(duplicatedMain.musicxml), 'print')
      .flatMap((p) => all(p, 'display-text'))
      .some((p) => p.textContent === 'P2.'),
  );
  const shiftedMain = toMusicXML(
    {
      ...cached,
      events: cached.events.map((e) =>
        e === main
          ? {
              ...main,
              moment: {
                main: { numerator: 7, denominator: 4 },
                grace: { numerator: 0, denominator: 1 },
              },
            }
          : e,
      ),
    },
    { source: original },
  );

  validate(shiftedMain.musicxml);
  assert.ok(shiftedMain.diagnostics.some((d) => d.code === 'instrument-name-piece'));
  assert.ok(
    !all(parse(shiftedMain.musicxml), 'print')
      .flatMap((p) => all(p, 'display-text'))
      .some((p) => p.textContent === 'P2.'),
  );
});

test("same-main negative grace Systems retain each Staff's label at its exact printed occurrence", async () => {
  const upper = String.raw`c'1 \grace { \autoBeamOff d'16 \break e'16 \break f'16 } g'1`;
  const lower = String.raw`c1 \grace { \autoBeamOff d16 \break e16 \break f16 } g1`;
  const original = source(upper, lower),
    plain = await compiler.compile(original, { format: ['svg', 'midi'] });
  const result = (await converter.convert(original)).scores[0]!;

  validate(result.musicxml);
  assert.deepEqual(
    words(result.musicxml).map((w) => w.textContent),
    ['RightHand', 'LeftHand', 'P1.', 'P1.', 'P1.', 'P1.'],
  );
  assert.equal(
    all(parse(result.musicxml), 'print').filter((p) => p.getAttribute('new-system') === 'yes')
      .length,
    2,
  );
  assert.equal(
    all(parse(new TextDecoder().decode(file(plain.files, '.svg'))), 'text').filter(
      (e) => e.textContent === 'P1.',
    ).length,
    6,
  );
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;
  const without = toMusicXML(
    {
      ...cached,
      events: cached.events.filter((e) => e.kind !== 'instrumentLabelPiece'),
    },
    { source: original },
  ).musicxml;

  assert.deepEqual(musical(result.musicxml), musical(without));
  const wrongSystem = toMusicXML(
    {
      ...cached,
      events: cached.events.map((e) =>
        e.kind === 'instrumentLabelPiece' && e.context === 2 && e.system === 2
          ? { ...e, system: 3 }
          : e,
      ),
    },
    { source: original },
  );

  assert.ok(wrongSystem.diagnostics.some((d) => d.code === 'instrument-label-piece'));
  assert.equal(words(wrongSystem.musicxml).filter((w) => w.textContent === 'P1.').length, 2);
});

test('nongrace labels after a grace group use the actual following-note cursor rather than the measure prefix', async () => {
  const upper = String.raw`c'1 \grace { \autoBeamOff d'16 e'16 } \break f'1`;
  const lower = String.raw`c1 \grace { \autoBeamOff d16 e16 } \break f1`;
  const original = source(upper, lower),
    plain = await compiler.compile(original, { format: ['svg', 'midi'] });
  const result = (await converter.convert(original)).scores[0]!;

  validate(result.musicxml);
  const xml = parse(result.musicxml),
    native = words(result.musicxml);

  assert.deepEqual(
    native.map((w) => w.textContent),
    ['RightHand', 'LeftHand', 'P1.', 'P1.'],
  );
  const pieces = result.document.events
    .filter((e) => e.kind === 'instrumentLabelPiece')
    .filter((p) => p.system === 2);

  assert.equal(pieces.length, 3);
  assert.ok(pieces.every((p) => p.moment.main.numerator === 1 && p.moment.grace.numerator === 0));
  const prints = all(xml, 'print').filter((p) => p.getAttribute('new-system') === 'yes');

  assert.equal(prints.length, 1);
  let previous = prints[0]!.previousSibling;

  while (previous && previous.nodeType !== 1) {
    previous = previous.previousSibling;
  }

  assert.equal(previous?.nodeName, 'note');
  assert.equal(all(previous as Element, 'grace').length, 1);
  assert.equal(all(previous as Element, 'step')[0]!.textContent, 'E');
  let next = prints[0]!.nextSibling;
  const directions: Element[] = [];

  while (next) {
    if (next.nodeType === 1) {
      if (next.nodeName === 'note') {
        break;
      }

      directions.push(next as Element);
    }

    next = next.nextSibling;
  }

  assert.equal(all(next as Element, 'step')[0]!.textContent, 'F');
  assert.equal(all(next as Element, 'grace').length, 0);
  assert.deepEqual(
    directions.flatMap((d) => all(d, 'words').map((w) => w.textContent)),
    ['P1.', 'P1.'],
  );
  const sourceSVG = parse(new TextDecoder().decode(file(plain.files, '.svg')));

  assert.equal(all(sourceSVG, 'text').filter((e) => e.textContent === 'P1.').length, 3);
  const space = result.document.paper?.['staff-space'];

  assert.ok(typeof space === 'number' && space > 0);
  const systemLefts = systemOrigins(sourceSVG);
  const labelGroups = all(sourceSVG, '*')
    .filter((el) => el.getAttribute('data-instrument-label') === 'yes')
    .flatMap((el) => (el.localName === 'text' ? [el] : all(el, 'text')))
    .filter((t) => t.textContent === 'P1.')
    .map((el) => ({ el, ...svgPoint(el) }));

  assert.equal(
    systemLefts.length,
    2,
    'each source System has one independently measured PaperColumn LEFT origin',
  );
  assert.equal(
    labelGroups.length,
    3,
    'two independent Staff labels and the PianoStaff label have SVG text anchors',
  );
  const lines = all(sourceSVG, 'line')
    .filter(
      (line) =>
        Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')) > 10 &&
        Number(line.getAttribute('y1')) === 0 &&
        Number(line.getAttribute('y2')) === 0,
    )
    .map((line) => svgPoint(line, Number(line.getAttribute('x1')), 0))
    .sort((a, b) => a.y - b.y);

  assert.equal(lines.length, 20, 'two source Systems each contain two five-line staves');

  for (const staff of [1, 2]) {
    const piece = pieces.find((p) => p.context === (staff === 1 ? 2 : 3))!;
    const top = lines[((piece.system - 1) * 2 + (staff - 1)) * 5]!;
    const sourceCandidates = labelGroups.filter(
      (text) => Math.abs(top.y - text.y - piece.y!) < 0.0002,
    );

    assert.equal(
      sourceCandidates.length,
      1,
      `one actual SVG label anchor belongs to staff ${staff}`,
    );
    const sourcePoint = sourceCandidates[0]!;

    assert.ok(
      Math.abs(sourcePoint.x - systemLefts[1]!.x - piece.x!) < 0.0002,
      'post-grace label matches its independently printed PaperColumn-origin frame',
    );
    const word = native.slice(2)[staff - 1]!;

    assert.ok(
      word.hasAttribute('default-x'),
      'exact System boundary at the following regular-note cursor supports X',
    );
    assert.ok(
      Math.abs(
        Number(word.getAttribute('default-x')) - (piece.x! * 10 * piece.outputScale) / space,
      ) < 1e-8,
    );
  }

  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;

  assert.equal(toMusicXML(cached, { source: original }).musicxml, result.musicxml);
  const without = toMusicXML(
    {
      ...cached,
      events: cached.events.filter((e) => e.kind !== 'instrumentLabelPiece'),
    },
    { source: original },
  ).musicxml;

  assert.deepEqual(musical(result.musicxml), musical(without));
  assert.equal(reader.loadData(result.musicxml), 1);
  const actual = midiTimedNotes(reader.renderToMIDI());

  assert.equal(reader.loadData(without), 1);
  assert.deepEqual(midiTimedNotes(reader.renderToMIDI()), actual);
  assert.deepEqual(
    actual.map((n) => n.pitch).sort((a, b) => a - b),
    midiTimedNotes(file(plain.files, '.midi'))
      .map((n) => n.pitch)
      .sort((a, b) => a - b),
  );
});
