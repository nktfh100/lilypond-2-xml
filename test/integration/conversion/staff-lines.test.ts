import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { createConverter, toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { planStaffLines, staffLineClefLine } from '../../../src/musicxml/layout/staff-lines.js';
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

const source = (withs: string, music = "c'1", prefix = '') =>
  String.raw`${prefix} \score { \new Staff \with { ${withs} } { ${music} } \layout {} \midi { \tempo 4=120 } }`;
const histories = (score: Awaited<ReturnType<typeof converter.convert>>['scores'][number]) =>
  score.document.events.filter((e) => e.kind === 'staffLines');

function lineVisibility(details: Element) {
  const n = Number(all(details, 'staff-lines')[0]!.textContent);
  const rows = all(details, 'line-detail');

  return Array.from({ length: n }, (_, i) => i + 1).filter(
    (i) =>
      rows.find((r) => Number(r.getAttribute('line')) === i)?.getAttribute('print-object') !== 'no',
  );
}

function sourceLineOffsets(svg: string) {
  const doc = parse(svg),
    translate = (el: Element) => {
      const match = (el.parentNode as Element)
        .getAttribute('transform')
        ?.match(/translate\(([-\d.]+), ([-\d.]+)\)/);

      assert.ok(match);

      return Number(match[2]);
    };
  const lines = all(doc, 'line').filter(
    (el) => Number(el.getAttribute('x2')) - Number(el.getAttribute('x1')) > 10,
  );
  const head = all(doc, 'path').find(
    (el) => (el.getAttribute('d')?.match(/M/g) ?? []).length === 2,
  );

  assert.ok(head, 'independent source whole-note head');

  return lines.map((el) => translate(head) - translate(el)).sort((a, b) => a - b);
}

async function independent(input: string) {
  const [{ scores }, plain] = await Promise.all([
    converter.convert(input),
    compiler.compile(input, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(reader.loadData(score.musicxml), 1);
  const bytes = Object.entries(plain.files).find(([n]) => n.endsWith('.midi'))![1];
  const actual = midiTimedNotes(reader.renderToMIDI()),
    expected = midiTimedNotes(bytes);

  assert.deepEqual(
    actual.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  const svg = new TextDecoder().decode(
    Object.entries(plain.files).find(([n]) => n.endsWith('.svg'))![1],
  );

  return {
    score,
    svg,
    xml: parse(score.musicxml),
    mei: reader.getMEI(),
    readerSvg: reader.renderToSVG(1),
  };
}

for (const [name, positions, n, visible, clef] of [
  ['sparse', [-4, 0, 4], 5, [1, 3, 5], 2],
  ['noncentered', [0, 2, 4], 5, [3, 4, 5], 2],
  ['extended', [-8, -4, 2, 8], 9, [1, 3, 6, 9], 4],
  ['three contiguous', [-2, 0, 2], 3, [1, 2, 3], 1],
  ['single', [0], 1, [1], 0],
] as const) {
  test(`native staff grid retains ${name} source lines and pitch reference`, async () => {
    const { score, svg, xml, mei } = await independent(
      source(String.raw`\override StaffSymbol.line-positions = #'(${positions.join(' ')})`),
    );
    const event = histories(score)[0]!;

    assert.deepEqual(
      [...event.positions!].sort((a, b) => a - b),
      [...positions].sort((a, b) => a - b),
    );
    assert.equal(event.present, true);
    const details = all(xml, 'staff-details')[0]!;

    assert.equal(all(details, 'staff-lines')[0]!.textContent, String(n));
    assert.deepEqual(lineVisibility(details), visible);
    assert.equal(all(xml, 'clef')[0]!.getElementsByTagName('line')[0]!.textContent, String(clef));
    assert.deepEqual(
      sourceLineOffsets(svg).map((x) => Math.round(x * 1000) / 1000),
      positions.map((p) => (6 + p) / 2).sort((a, b) => a - b),
    );
    assert.match(mei, new RegExp(`lines="${n}"`));
    assert.match(mei, /pname="c"/);
  });
}

test('staff spacing scales source positions without shrinking native notation', async () => {
  for (const prefix of ['', String.raw`#(set-global-staff-size 30)`]) {
    const { svg, xml, mei } = await independent(
      source(
        String.raw`\override StaffSymbol.line-positions = #'(-4 0 4) \override StaffSymbol.staff-space = #0.7`,
        "c'1",
        prefix,
      ),
    );

    assert.deepEqual(
      sourceLineOffsets(svg).map((n) => Math.round(n * 1000) / 1000),
      [0.7, 2.1, 3.5],
    );
    const size = all(xml, 'staff-size')[0]!;

    assert.equal(Number(size.textContent), 70);
    assert.equal(size.getAttribute('scaling'), '100');
    assert.match(mei, /scale="70%"/);
  }
});

test('confirmed absent, hidden, transparent and empty StaffSymbols retain notes on an invisible logical grid', async () => {
  for (const withs of [
    String.raw`\remove Staff_symbol_engraver`,
    String.raw`\override StaffSymbol.stencil = ##f`,
    String.raw`\override StaffSymbol.transparent = ##t`,
    String.raw`\override StaffSymbol.line-positions = #'()`,
    String.raw`\override StaffSymbol.line-count = #0`,
    String.raw`\override StaffSymbol.stencil = ##f \override StaffSymbol.line-positions = #'(-4 0 3/2)`,
    String.raw`\override StaffSymbol.stencil = ##f \override StaffSymbol.line-positions = #'(-3 3)`,
  ]) {
    const { score, svg, xml } = await independent(source(withs));

    assert.deepEqual(sourceLineOffsets(svg), []);
    assert.deepEqual(lineVisibility(all(xml, 'staff-details')[0]!), []);
    assert.equal(all(xml, 'staff-lines')[0]!.textContent, '5');
    assert.equal(all(xml, 'note').length, 1);
    assert.notEqual(all(xml, 'note')[0]!.getAttribute('print-object'), 'no');
    assert.equal(histories(score)[0]!.present, !withs.includes('remove'));
  }
});

test('staff line history follows created grobs instead of later override intent', async () => {
  const { score, xml } = await independent(
    source('', String.raw`c'1 \override Staff.StaffSymbol.line-count = #1 d'1`),
  );

  assert.deepEqual(
    histories(score).map((e) => e.count),
    [5],
  );
  assert.ok(all(xml, 'staff-lines').every((e) => e.textContent === '5'));
});

test('stop/start and stopped gaps preserve actual source line transitions', async () => {
  const restarted = await independent(
    source(
      '',
      String.raw`c'1 \stopStaff \override Staff.StaffSymbol.line-count = #1 \startStaff d'1`,
    ),
  );

  assert.deepEqual(
    histories(restarted.score).map((e) => [
      e.count,
      e.moment.main.numerator / e.moment.main.denominator,
    ]),
    [
      [5, 0],
      [1, 1],
    ],
  );
  assert.equal(all(restarted.xml, 'staff-lines').at(-1)!.textContent, '1');
  assert.equal(
    all(restarted.xml, 'clef').at(-1)!.getElementsByTagName('line')[0]!.textContent,
    '0',
  );
  const gap = await independent(source('', String.raw`c'1 \stopStaff d'1 \startStaff e'1`));

  assert.deepEqual(
    histories(gap.score).map((e) => [
      e.present,
      e.moment.main.numerator / e.moment.main.denominator,
    ]),
    [
      [true, 0],
      [false, 1],
      [true, 2],
    ],
  );
  assert.deepEqual(all(gap.xml, 'staff-details').map(lineVisibility).slice(-2), [
    [],
    [1, 2, 3, 4, 5],
  ]);
});

test('unrepresentable line positions are retained and diagnosed without guessed sparse native ink', async () => {
  for (const positions of ['-4 0 3', '-4 0 3/2']) {
    const { score } = await independent(
      source(String.raw`\override StaffSymbol.line-positions = #'(${positions})`),
    );

    assert.equal(histories(score)[0]!.positions!.length, 3);
    assert.ok(
      score.diagnostics.some(
        (d) => /staff-lines/.test(d.code) && /position|grid|geometry/.test(d.message),
      ),
    );
  }
});

test('staff grid geometry survives document JSON caching and per-score resets', async () => {
  const input = source(String.raw`\override StaffSymbol.line-positions = #'(-8 -4 2 8)`);
  const first = await converter.convert(input);
  const cached = toMusicXML(JSON.parse(JSON.stringify(first.scores[0]!.document)), {
    source: input,
  });

  assert.equal(cached.musicxml, first.scores[0]!.musicxml);
  const legacy = JSON.parse(JSON.stringify(first.scores[0]!.document));

  for (const event of legacy.events) {
    if (event.kind === 'staffLines') {
      for (const key of [
        'positions',
        'present',
        'staffSpace',
        'layoutStaffSpace',
        'hidden',
        'custom',
        'color',
        'lineWidth',
      ]) {
        delete event[key];
      }
    }
  }

  const old = toMusicXML(legacy);

  validate(old.musicxml);
  assert.ok(old.diagnostics.some((d) => /staff-lines.*history/.test(d.code)));
  assert.equal(all(parse(old.musicxml), 'staff-lines')[0]!.textContent, '4');
  const reset = await independent(source(''));

  assert.deepEqual(
    histories(reset.score).map((e) => e.positions),
    [[4, 2, 0, -2, -4]],
  );
  assert.ok(!reset.score.diagnostics.some((d) => /staff-lines/.test(d.code)));
});

test('legacy staff counts preserve their historical references while resolved grids support outside clef lines', () => {
  const legacy = planStaffLines({ count: 3 });

  assert.equal(legacy.legacy, true);
  assert.equal(legacy.clefLineShift, 0);
  assert.equal(
    staffLineClefLine(-2, planStaffLines({ count: 1, positions: [0], present: true })),
    0,
  );
  const even = planStaffLines({ count: 2, positions: [-3, 3], present: true });

  assert.equal(even.logicalCount, 4);
  assert.equal(even.percussionDiatonicShift, -1);
  assert.equal(staffLineClefLine(-2, even), null);
  assert.equal(staffLineClefLine(-1, even), 2);
});

test('percussion display pitches retain the source center on one-line and expanded logical grids', async () => {
  for (const [positions, step, octave] of [
    ['0', 'E', '4'],
    ['-3 3', 'A', '4'],
    ['-8 -4 2 8', 'F', '5'],
  ] as const) {
    const input = String.raw`customStyle = #'((bassdrum default #f 0))
      \score { \new DrumStaff \with { drumStyleTable = #(alist->hash-table customStyle)
      \override StaffSymbol.line-positions = #'(${positions}) } \drummode { bd1 } \layout {} \midi {} }`;
    const [{ scores }, plain] = await Promise.all([
      converter.convert(input),
      compiler.compile(input, { format: ['svg', 'midi'] }),
    ]);
    const score = scores[0]!,
      xml = parse(score.musicxml);

    validate(score.musicxml);
    assert.equal(all(xml, 'display-step')[0]!.textContent, step);
    assert.equal(all(xml, 'display-octave')[0]!.textContent, octave);
    assert.equal(all(xml, 'midi-instrument').length, 0);
    assert.equal(reader.loadData(score.musicxml), 1);
    const rendered = parse(reader.renderToSVG(1));
    const staff = all(rendered, 'g').find((el) => el.getAttribute('class') === 'staff')!;
    const nativeLines = Array.from(staff.childNodes).filter(
      (el): el is Element => el?.nodeType === 1 && (el as Element).tagName === 'path',
    );
    const lineY = nativeLines.map((el) =>
      Number(el.getAttribute('d')!.match(/^M[^ ]+ ([\d.]+)/)![1]),
    );
    const nativeHead = all(rendered, 'g').find((el) => el.getAttribute('class') === 'notehead')!;
    const headY = Number(
      all(nativeHead, 'use')[0]!
        .getAttribute('transform')!
        .match(/translate\(([-\d.]+), ([-\d.]+)\)/)![2],
    );

    assert.equal(
      headY,
      (lineY[0]! + lineY.at(-1)!) / 2,
      'reader pitch remains at source staff center',
    );
    const svg = new TextDecoder().decode(
      Object.entries(plain.files).find(([n]) => n.endsWith('.svg'))![1],
    );
    // Drum position 0 is at the source StaffSymbol center, independent of line count.
    const doc = parse(svg),
      head = all(doc, 'path').find((el) => el.getAttribute('d')?.startsWith('M347 -26'));

    assert.ok(head);
    const y = (el: Element) =>
      Number(
        (el.parentNode as Element)
          .getAttribute('transform')!
          .match(/translate\(([-\d.]+), ([-\d.]+)\)/)![2],
      );
    const lines = all(doc, 'line').filter(
      (el) => Number(el.getAttribute('x2')) - Number(el.getAttribute('x1')) > 10,
    );

    assert.deepEqual(
      lines.map((l) => Math.round((y(head) - y(l)) * 1000) / 1000).sort((a, b) => a - b),
      positions
        .split(' ')
        .map(Number)
        .map((p) => p / 2)
        .sort((a, b) => a - b),
    );
  }
});

test('independent staves retain their own sparse grids and local spacing', async () => {
  const input = String.raw`\score { \new PianoStaff <<
    \new Staff \with { \override StaffSymbol.line-positions = #'(-4 0 4) \override StaffSymbol.staff-space = #0.7 } { c'1 }
    \new Staff \with { \override StaffSymbol.line-positions = #'(-8 -4 2 8) \override StaffSymbol.staff-space = #1.3 } { \clef bass c1 }
    >> \layout {} \midi { \tempo 4=120 } }`;
  const { score, xml } = await independent(input);

  assert.deepEqual(
    histories(score)
      .map((e) => e.staffSpace)
      .sort(),
    [0.7, 1.3],
  );
  const details = all(xml, 'staff-details');

  assert.deepEqual(
    details.map((d) => d.getAttribute('number')),
    ['1', '2'],
  );
  assert.deepEqual(
    details.map((d) => Number(all(d, 'staff-lines')[0]!.textContent)),
    [5, 9],
  );
  assert.deepEqual(details.map(lineVisibility), [
    [1, 3, 5],
    [1, 3, 6, 9],
  ]);
  assert.deepEqual(
    details.map((d) => Number(all(d, 'staff-size')[0]!.textContent)),
    [70, 130],
  );
});

test('staff line color and physical thickness survive spacing changes natively', async () => {
  for (const withs of [
    String.raw`\override StaffSymbol.color = #red \override StaffSymbol.thickness = #2.5`,
    String.raw`\override StaffSymbol.color = #red \override StaffSymbol.thickness = #2.5 \override StaffSymbol.staff-space = #0.7`,
  ]) {
    const { score, svg, xml, mei } = await independent(source(withs));
    const event = histories(score)[0]!;

    assert.deepEqual(event.color, [1, 0, 0]);
    assert.ok(Math.abs(event.lineWidth! - 0.25) < 1e-10);
    const sourceLines = all(parse(svg), 'line').filter(
      (el) => Number(el.getAttribute('x2')) - Number(el.getAttribute('x1')) > 10,
    );

    assert.equal(sourceLines.length, 5);

    for (const line of sourceLines) {
      assert.equal(Number(line.getAttribute('stroke-width')), 0.25);
      assert.equal(
        ((line.parentNode as Element).parentNode as Element).getAttribute('color'),
        'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
      );
    }

    const rows = all(xml, 'line-detail');

    assert.equal(rows.length, 5);

    for (const row of rows) {
      assert.equal(row.getAttribute('color'), '#FF0000');
      assert.ok(Math.abs(Number(row.getAttribute('width')) - 2.5) < 1e-10);
    }

    assert.ok(!/<staffDef[^>]+color=/.test(mei));
  }
});
