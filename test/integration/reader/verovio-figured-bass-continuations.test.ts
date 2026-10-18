import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('native figured-bass continuation appearance matches source graphics and preserves independent MIDI', async () => {
  let baseline: number[][] = [];

  for (const { hidden, offset } of [
    { hidden: false, offset: false },
    { hidden: false, offset: true },
    { hidden: true, offset: true },
  ]) {
    const source =
      String.raw`\score { << \new Staff { \clef bass \tempo 4 = 120 c4 d e f } \figures {
      \override BassFigureContinuation.color = #red \override BassFigureContinuation.extra-offset = ` +
      (offset ? "#'(2 . 1)" : "#'(0 . 0)") +
      String.raw`
      \override BassFigureContinuation.transparent = ` +
      (hidden ? '##t' : '##f') +
      String.raw`
      \bassFigureExtendersOn <6 4>4 <6 3> <7 3> <7 3> } >> \layout {} \midi {} }`;
    const [{ scores }, compiled] = await Promise.all([
      converter.convert(source),
      midiCompiler.compile(source, { format: ['svg', 'midi'] }),
    ]);
    const score = scores[0]!;

    validate(score.musicxml);
    const xml = parse(score.musicxml);
    const lines = elements(xml, 'extend');

    assert.equal(lines.length, 7);

    for (const line of lines) {
      assert.equal(line.getAttribute('color'), hidden ? '#00000000' : '#FF0000');
      assert.equal(line.getAttribute('relative-x'), offset ? '20' : null);
      assert.equal(line.getAttribute('relative-y'), offset ? '10' : null);
    }

    const svg = parse(
      new TextDecoder().decode(
        Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
      ),
    );
    const colored = elements(svg, 'g').filter(
      (n) =>
        n.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)' &&
        n.getElementsByTagName('line').length,
    );

    assert.equal(colored.length, hidden ? 0 : 3);

    if (!hidden) {
      const positions = colored.map((n) =>
        n
          .getElementsByTagName('g')[0]!
          .getAttribute('transform')!
          .match(/translate\(([^)]+)\)/)![1]!
          .split(',')
          .map(Number),
      );

      if (!offset) {
        baseline = positions;
      } else {
        positions.forEach((pos, i) => {
          assert.ok(Math.abs(pos[0]! - baseline[i]![0]! - 2) < 1e-6);
          assert.ok(Math.abs(pos[1]! - baseline[i]![1]! + 1) < 1e-6);
        });
      }
    }

    assert.equal(toolkit.loadData(score.musicxml), 1);
    const mei = parse(toolkit.getMEI());
    const flags = elements(mei, 'f').filter((n) => n.getAttribute('extender') === 'true');

    assert.equal(flags.length, 3);
    assert.ok(
      flags.every(
        (n) => !n.hasAttribute('color') && !n.hasAttribute('ho') && !n.hasAttribute('vo'),
      ),
    );
    const rendered = parse(toolkit.renderToSVG(1));
    const figureGroups = elements(rendered, 'g').filter((n) => n.getAttribute('class') === 'fb');

    assert.ok(figureGroups.length);
    assert.ok(
      figureGroups.every((n) =>
        ['path', 'line', 'polyline', 'rect'].every(
          (tag) => n.getElementsByTagName(tag).length === 0,
        ),
      ),
    );
    assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-line-reader'));
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
