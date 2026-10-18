import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import {
  type PageSystemLayout,
  type ScoreDocument,
  createConverter,
  toMusicXML,
} from 'lilypond-2-xml';

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

const close = (a: number, b: number, epsilon = 0.0001) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} versus ${b}`);
const main = (m: NonNullable<PageSystemLayout['staves'][number]['startMoment']>) =>
  m.main.numerator / m.main.denominator;
const source = (music: string, lower = 'c1', config = '', setup = '') =>
  setup +
  String.raw`
#(define (segment-source-post paper pages) (display "SEGMENT-SOURCE-POST\n"))
#(define (segment-source-after grob) (display "SEGMENT-SOURCE-AFTER\n") #t)
\paper { paper-width=100\mm line-width=80\mm ragged-right=##f page-post-process=#segment-source-post }
\score { \new PianoStaff << \new Staff="upper" \with { ${config} } { \override NoteHead.after-line-breaking=#segment-source-after ${music} } \new Staff="lower" { \clef bass ${lower} } >> \layout{} \midi{\tempo 4=120} }`;
const passage = String.raw`c'4 \stopStaff s4 \startStaff d'2`;

async function independent(text: string) {
  const baseline = await compiler.compile(text, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(text, {
    format: ['svg', 'midi'],
    files: { 'segment-observer.ily': listener },
    includeSettings: 'segment-observer.ily',
  });
  const svgs = Object.entries(baseline.files).filter(([n]) => n.endsWith('.svg'));

  assert.equal(svgs.length, 1);
  assert.deepEqual(
    observed.files[svgs[0]![0]],
    svgs[0]![1],
    'segment provenance cannot rerender source staff geometry',
  );
  const result = await converter.convert(text),
    score = result.scores[0]!;

  validate(score.musicxml);

  for (const prefix of ['SEGMENT-SOURCE-POST', 'SEGMENT-SOURCE-AFTER', 'SEGMENT-DELEGATE']) {
    const count = (logs: readonly string[]) => logs.filter((l) => l.startsWith(prefix)).length;

    assert.equal(count(observed.logs), count(baseline.logs));
    assert.equal(count(result.logs), count(baseline.logs));
  }

  const svg = parse(new TextDecoder().decode(svgs[0]![1]));
  const root = svg.documentElement,
    scale =
      Number(root.getAttribute('width')!.replace('mm', '')) /
      Number(root.getAttribute('viewBox')!.split(' ')[2]);
  const lines = all(svg, 'line')
    .filter((l) => Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) > 3)
    .map((l) => {
      const t = (l.parentNode as Element)
        .getAttribute('transform')!
        .match(/translate\(([-\d.]+), ([-\d.]+)\)/);

      assert.ok(t);

      return {
        start: Number(t[1]) + Number(l.getAttribute('x1')),
        end: Number(t[1]) + Number(l.getAttribute('x2')),
        y: Number(t[2]),
      };
    });
  const xml = parse(score.musicxml),
    mmPerTenth = Number(all(xml, 'millimeters')[0]!.textContent) / 40;

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
  const expected = midiTimedNotes(
      Object.entries(baseline.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    actual.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  actual.forEach((n, i) => close(n.duration!, expected[i]!.duration!, 0.01));

  return { score, xml, lines, scale, mmPerTenth };
}

function intervals(row: PageSystemLayout) {
  const ids = [...new Set(row.staves.map((s) => s.staff))].sort((a, b) => a - b);
  const upper = row.staves
    .filter((s) => s.staff === ids[0])
    .sort((a, b) => main(a.startMoment!) - main(b.startMoment!));

  return { upper, ids };
}

test('matching stop/start StaffSymbol segments preserve actual bounds and one known native logical frame', async () => {
  for (const [setup, config] of [
    ['', ''],
    [String.raw`#(set-global-staff-size 30)`, String.raw`\override StaffSymbol.staff-space=#0.7`],
  ] as const) {
    const { score, xml, lines, scale, mmPerTenth } = await independent(
      source(passage, 'c1', config, setup),
    );

    assert.equal(score.document.pageLayouts!.length, 1);
    const row = score.document.pageLayouts![0]!,
      { upper } = intervals(row);

    assert.equal(upper.length, 2);
    assert.deepEqual(
      upper.map((s) => [main(s.startMoment!), main(s.endMoment!)]),
      [
        [0, 0.25],
        [0.5, 1],
      ],
    );
    assert.notEqual(upper[0]!.originalId, upper[1]!.originalId);
    assert.deepEqual(
      upper.map((s) => s.piece),
      [1, 1],
    );
    close(upper[0]!.baselineY!, upper[1]!.baselineY!, 1e-9);
    assert.equal(lines.length, 15, 'two five-line upper segments and one five-line lower staff');
    const ys = [...new Set(lines.map((l) => l.y))].sort((a, b) => a - b);

    assert.equal(ys.length, 10);

    for (const y of ys.slice(0, 5)) {
      const spans = lines.filter((l) => l.y === y).sort((a, b) => a.start - b.start);

      assert.equal(spans.length, 2);
      assert.ok(spans[0]!.end < spans[1]!.start, 'independent source staff ink really has a gap');
    }

    close(
      Number(all(xml, 'staff-distance')[0]!.textContent) * mmPerTenth,
      (ys[5]! - ys[4]!) * scale,
      0.0002,
    );
    assert.equal(all(xml, 'top-system-distance').length, 1);
    assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-staves'));
    assert.equal(all(xml, 'note').filter((n) => all(n, 'pitch').length).length, 3);
  }
});

test('actual broken members retain original IDs, full column moments and native system gaps across score resets', async () => {
  const { score, xml, lines, scale, mmPerTenth } = await independent(
    source(passage + String.raw` \break e'1`, 'c1 d1'),
  );
  const [first, second] = score.document.pageLayouts!;

  assert.ok(first && second);
  const before = intervals(first).upper,
    after = intervals(second).upper;

  assert.equal(before.length, 2);
  assert.equal(after.length, 1);
  const continued = before[1]!;

  assert.equal(continued.originalId, after[0]!.originalId);
  assert.deepEqual([continued.piece, after[0]!.piece], [1, 2]);
  assert.deepEqual(
    [
      main(continued.startMoment!),
      main(continued.endMoment!),
      main(after[0]!.startMoment!),
      main(after[0]!.endMoment!),
    ],
    [0.5, 1, 1, 2],
  );

  for (const row of [first, second]) {
    for (const s of row.staves) {
      assert.deepEqual(s.startMoment!.grace, { numerator: 0, denominator: 1 });
      assert.deepEqual(s.endMoment!.grace, { numerator: 0, denominator: 1 });
    }
  }

  const ys = [...new Set(lines.map((l) => l.y))].sort((a, b) => a - b);

  assert.equal(ys.length, 20);
  close(
    Number(all(xml, 'system-distance')[0]!.textContent) * mmPerTenth,
    (ys[10]! - ys[9]!) * scale,
    0.0002,
  );
  const next = (await converter.convert(source(passage))).scores[0]!;

  assert.deepEqual(
    next.document.pageLayouts![0]!.staves.map((s) => s.originalId).sort(),
    [1, 2, 3],
  );
  assert.ok(next.document.pageLayouts![0]!.staves.every((s) => s.piece === 1));
});

test('real segment grid conflicts retain evidence instead of selecting the first or last staff frame', async () => {
  for (const change of [
    String.raw`\override Staff.StaffSymbol.staff-space=#0.7`,
    String.raw`\override Staff.StaffSymbol.line-positions=#'(-2 0 2)`,
  ]) {
    const text = source(String.raw`c'4 \stopStaff s4 ${change} \startStaff d'2`);
    const { score, xml, lines } = await independent(text),
      row = score.document.pageLayouts![0]!,
      { upper } = intervals(row);

    assert.equal(upper.length, 2);
    assert.notEqual(upper[0]!.originalId, upper[1]!.originalId);
    const segments = new Map<string, number[]>();

    for (const line of lines) {
      const key = `${line.start}:${line.end}`,
        ys = segments.get(key) ?? [];

      ys.push(line.y);
      segments.set(key, ys);
    }

    const finalSegment = [...segments.entries()]
      .sort(([a], [b]) => Number(a.split(':')[0]) - Number(b.split(':')[0]))
      .at(-1)![1]
      .sort((a, b) => a - b);

    assert.equal(
      finalSegment.length,
      change.includes('staff-space') ? 5 : 3,
      'independent source restart really changes the grid',
    );
    close(finalSegment[1]! - finalSegment[0]!, change.includes('staff-space') ? 0.7 : 1);
    assert.ok(score.diagnostics.some((d) => d.code === 'page-layout-staves'));
    assert.equal(all(xml, 'top-system-distance').length, 0);
    assert.equal(all(xml, 'staff-distance').length, 0);
    assert.equal(all(xml, 'note').filter((n) => all(n, 'pitch').length).length, 3);
  }

  for (const change of [
    String.raw`\override Staff.StaffSymbol.transparent=##t`,
    String.raw`\override Staff.StaffSymbol.stencil=#segment-staff-delegate`,
  ]) {
    const setup = String.raw`#(define (segment-staff-delegate grob) (display "SEGMENT-DELEGATE\n") (ly:staff-symbol::print grob))`;
    const { score, xml } = await independent(
      source(String.raw`c'4 \stopStaff s4 ${change} \startStaff d'2`, 'c1', '', setup),
    );
    const { upper } = intervals(score.document.pageLayouts![0]!);

    assert.equal(upper.length, 2);
    assert.ok(upper[1]!.hidden || upper[1]!.custom);
    assert.equal(
      all(xml, 'staff-distance').length,
      1,
      'different source ink does not erase a known common logical frame',
    );
    assert.ok(!score.diagnostics.some((d) => d.code === 'page-layout-staves'));
  }
});

test('cached segment provenance rejects aliases and missing bounds while keeping source identities intact', async () => {
  const text = source(passage),
    score = (await converter.convert(text)).scores[0]!,
    document = JSON.parse(JSON.stringify(score.document)) as ScoreDocument;

  assert.equal(toMusicXML(document, { source: text }).musicxml, score.musicxml);
  const row = document.pageLayouts![0]!,
    { upper, ids } = intervals(row),
    target = upper[1]!;
  const invalid = [
    { ...target, originalId: upper[0]!.originalId!, piece: upper[0]!.piece! },
    { ...target, startMoment: null },
    {
      ...target,
      endMoment: {
        main: { numerator: 0, denominator: 1 },
        grace: { numerator: 0, denominator: 1 },
      },
    },
    {
      ...target,
      originalId: row.staves.find((s) => s.staff === ids[1])!.originalId!,
    },
    (({ originalId: _id, piece: _piece, ...legacy }) => legacy)(target),
  ];

  for (const replacement of invalid) {
    const replay = toMusicXML({
      ...document,
      pageLayouts: [
        {
          ...row,
          staves: row.staves.map((s) => (s === target ? replacement : s)),
        },
      ],
    });

    validate(replay.musicxml);
    assert.ok(
      replay.diagnostics.some((d) => /^page-layout-(staves|segments|ownership)$/.test(d.code)),
    );
    assert.equal(all(parse(replay.musicxml), 'staff-distance').length, 0);
  }

  const ordinary = (await converter.convert(source("c'1"))).scores[0]!;
  const legacyRows = ordinary.document.pageLayouts!.map((r) => ({
    ...r,
    staves: r.staves.map(
      ({ originalId: _id, piece: _piece, startMoment: _start, endMoment: _end, ...s }) => s,
    ),
  }));
  const legacy = toMusicXML({ ...ordinary.document, pageLayouts: legacyRows });

  validate(legacy.musicxml);
  assert.equal(
    all(parse(legacy.musicxml), 'staff-distance').length,
    1,
    'a single legacy staff row needs no guessed multi-segment association',
  );
});
