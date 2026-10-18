import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lateFigureSource, retimedFigureSource } from '../../support/figured-bass-fixtures.js';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('late figured-bass attachment matches independent LilyPond SVG and preserves MIDI', async () => {
  for (const [parent, finalize] of [
    ['none', false],
    ['column', false],
    ['column', true],
    ['spanner', false],
  ] as const) {
    const source = lateFigureSource(parent, finalize);
    const [{ scores }, compiled] = await Promise.all([
      converter.convert(source),
      midiCompiler.compile(source, { format: ['svg', 'midi'] }),
    ]);
    const score = scores[0]!;

    validate(score.musicxml);
    const xml = parse(score.musicxml);
    const svg = new TextDecoder().decode(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
    );
    const visible = elements(xml, 'figured-bass')
      .filter((g) => g.getAttribute('print-object') !== 'no')
      .flatMap((g) => elements(g, 'figure-number'))
      .map((n) => n.textContent);

    assert.deepEqual(visible, svg.includes('LateLabel') ? ['LateLabel'] : []);
    assert.equal(svg.includes('LateLabel'), parent !== 'none');
    assert.equal(toolkit.loadData(score.musicxml), 1);
    assert.equal(toolkit.getMEI().includes('LateLabel'), parent !== 'none');
    const expected = midiTimedNotes(
        Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
      ),
      actual = midiTimedNotes(toolkit.renderToMIDI());

    assert.deepEqual(
      actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
      expected.map(({ pitch, onset, velocity }) => ({
        pitch,
        onset,
        velocity,
      })),
    );
    actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  }
});

for (const scenario of [
  {
    name: 'forward',
    moves: [[6, 1]],
    notes: 'c1 d1',
    figures: '<6+>1',
    positions: [['Figure6', '2', '1']],
  },
  {
    name: 'split',
    moves: [[6, 1]],
    notes: 'c1 d1',
    figures: '<6 4>1',
    positions: [
      ['Figure4', '1', '1'],
      ['Figure6', '2', '1'],
    ],
  },
  {
    name: 'backward',
    moves: [[5, 0]],
    notes: 'c1 d1',
    figures: '<6>1 <5>1',
    positions: [
      ['Figure6', '1', '1'],
      ['Figure5', '1', '1'],
    ],
  },
  {
    name: 'coincident',
    moves: [[6, 1]],
    notes: 'c1 d1',
    figures: '<6>1 <5>1',
    positions: [
      ['Figure6', '2', '1'],
      ['Figure5', '2', '1'],
    ],
  },
  {
    name: 'terminal',
    moves: [[6, 2]],
    notes: 'c1 d1',
    figures: '<6+>1',
    positions: [['Figure6', '2', '1']],
  },
  {
    name: 'gap',
    moves: [[6, '1/4']],
    notes: 'c4 s4 d2',
    figures: '<6>4',
    positions: [['Figure6', '1', '2']],
  },
] as const) {
  test(`retimed figured-bass ${scenario.name} columns preserve independent source labels and MIDI with verified reader positions`, async () => {
    const original = retimedFigureSource(scenario.moves, scenario.notes, scenario.figures);
    const source =
      scenario.name === 'terminal'
        ? original.replaceAll('currentMusicalColumn', 'currentCommandColumn')
        : original;
    const [{ scores }, compiled] = await Promise.all([
      converter.convert(source),
      midiCompiler.compile(source, { format: ['svg', 'midi'] }),
    ]);
    const score = scores[0]!;

    validate(score.musicxml);
    const sourceSvg = new TextDecoder().decode(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
    );
    const svg = parse(sourceSvg);
    const sourceLabels = elements(svg, 'text')
      .map((n) => n.textContent?.trim())
      .filter((s) => s?.startsWith('Figure'))
      .sort();
    const xml = parse(score.musicxml);
    const nativeLabels = elements(xml, 'figure-number')
      .map((n) => n.textContent)
      .sort();

    assert.deepEqual(nativeLabels, sourceLabels);
    assert.equal(toolkit.loadData(score.musicxml), 1);
    const mei = parse(toolkit.getMEI());
    const positions = elements(mei, 'f').map((f) => {
      let ancestor = f.parentElement,
        harm: Element | null = null,
        measure: Element | null = null;

      while (ancestor) {
        if (ancestor.tagName === 'harm') {
          harm = ancestor;
        }

        if (ancestor.tagName === 'measure') {
          measure = ancestor;
        }

        ancestor = ancestor.parentElement;
      }

      return [f.textContent?.trim(), measure?.getAttribute('n'), harm?.getAttribute('tstamp')];
    });

    assert.deepEqual(positions, scenario.positions);

    for (const label of nativeLabels) {
      assert.ok(toolkit.renderToSVG(1).includes(label!), label!);
    }

    if (scenario.name === 'terminal') {
      const figure = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!;

      assert.equal(figure.graphic, true);
      assert.equal(figure.columnUsed, true);
      assert.deepEqual(figure.column?.main, { numerator: 2, denominator: 1 });
      const groups = elements(xml, 'figured-bass');

      assert.equal(groups.length, 2);
      assert.equal(groups[0]!.getElementsByTagName('duration')[0]!.textContent, '4');
      assert.equal(groups[1]!.getElementsByTagName('duration').length, 0);
      assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-end-column'));
      assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-reader'));
      // The native blank interval reaches beat 5; this pinned reader imports the terminal label at beat 1.
      assert.equal(xml.getElementsByTagName('measure').length, 2);
      assert.equal(xml.getElementsByTagName('note').length, 2);
    }

    const expected = midiTimedNotes(
        Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
      ),
      actual = midiTimedNotes(toolkit.renderToMIDI());

    assert.deepEqual(
      actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
      expected.map(({ pitch, onset, velocity }) => ({
        pitch,
        onset,
        velocity,
      })),
    );
    actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  });
}

for (const forcedUsed of [false, true]) {
  test(`retimed figured-bass ${forcedUsed ? 'explicitly used' : 'unused'} terminal musical column matches source absence and preserves MIDI`, async () => {
    const original = retimedFigureSource([[6, 2]]);
    const source = forcedUsed
      ? original.replace(
          '(when column (ly:grob-set-parent! grob X column))',
          "(when column (ly:grob-set-property! column 'used #t) (ly:grob-set-parent! grob X column))",
        )
      : original;
    const [{ scores }, compiled] = await Promise.all([
      converter.convert(source),
      midiCompiler.compile(source, { format: ['svg', 'midi'] }),
    ]);
    const score = scores[0]!;

    validate(score.musicxml);
    const svg = new TextDecoder().decode(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
    );

    assert.ok(!svg.includes('Figure6'));
    const figure = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!;

    assert.equal(figure.graphic, true);
    assert.equal(figure.columnUsed, false);
    assert.deepEqual(figure.column?.main, { numerator: 2, denominator: 1 });
    const xml = parse(score.musicxml);
    const visible = elements(xml, 'figured-bass')
      .filter((g) => g.getAttribute('print-object') !== 'no')
      .flatMap((g) => elements(g, 'figure-number'))
      .map((n) => n.textContent);

    assert.deepEqual(visible, []);
    assert.equal(toolkit.loadData(score.musicxml), 1);
    assert.ok(!toolkit.getMEI().includes('Figure6'));
    const expected = midiTimedNotes(
        Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
      ),
      actual = midiTimedNotes(toolkit.renderToMIDI());

    assert.deepEqual(
      actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
      expected.map(({ pitch, onset, velocity }) => ({
        pitch,
        onset,
        velocity,
      })),
    );
    actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  });
}

test('retimed figured-bass split has independently verified source SVG horizontal movement', async () => {
  const positions = [];

  for (const moves of [[], [[6, 1]]] as const) {
    const compiled = await midiCompiler.compile(retimedFigureSource(moves, 'c1 d1', '<6 4>1'), {
      format: 'svg',
    });
    const sourceSvg = new TextDecoder().decode(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
    );
    const svg = parse(sourceSvg);

    positions.push(
      ['Figure6', 'Figure4'].map((label) => {
        const text = elements(svg, 'text').find((n) => n.textContent?.trim() === label)!;

        return Number(
          text.parentElement!.getAttribute('transform')!.match(/translate\(([^,]+)/)![1],
        );
      }),
    );
  }

  assert.equal(positions[0]![0], positions[0]![1]);
  assert.ok(positions[1]![0]! > positions[1]![1]!);
  assert.ok(positions[1]![0]! > positions[0]![0]!);
});
