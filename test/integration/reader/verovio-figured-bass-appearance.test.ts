import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('figured-bass font sizes and colors match independent source SVG while reader style losses are explicit', async () => {
  const source = String.raw`#(set-global-staff-size 18)
    \score { << \new Staff { \tempo 4 = 120 c'1 d'1 e'1 f'1 g'1 a'1 }
      \figures { \override BassFigure.color = #red \override BassFigure.font-size = #3
        <\markup \bold "Inherited">1 <\markup \with-color #blue \italic "Colored">1
        <\markup \abs-fontsize #18 "Absolute">1 <\markup \fontsize #2 "Relative">1
        <\markup \abs-fontsize #18 \small "Reset">1 <\markup \magnify #2 "Magnified">1 } >> \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const svg = parse(
    new TextDecoder().decode(Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1]),
  );
  const unitMillimeters =
    Number(svg.documentElement.getAttribute('width')!.replace('mm', '')) /
    Number(svg.documentElement.getAttribute('viewBox')!.split(/\s+/)[2]);
  const numbers = elements(xml, 'figure-number');

  for (const text of ['Inherited', 'Colored', 'Absolute', 'Relative', 'Reset', 'Magnified']) {
    const original = elements(svg, 'text').find((n) => n.textContent === text)!;
    const native = numbers.find((n) => n.textContent === text)!;

    assert.ok(original);
    assert.ok(native);
    const physical = (Number(original.getAttribute('font-size')) * unitMillimeters * 72) / 25.4;

    assert.ok(
      Math.abs(Number(native.getAttribute('font-size')) - physical) < 0.003,
      `${text}: native ${native.getAttribute('font-size')}, source ${physical}`,
    );

    for (const style of ['font-weight', 'font-style']) {
      assert.equal(
        native.getAttribute(style) ?? 'normal',
        original.getAttribute(style) ?? 'normal',
      );
    }

    let parent = original.parentElement;

    while (parent && !parent.hasAttribute('color')) {
      parent = parent.parentElement;
    }

    assert.equal(
      parent?.getAttribute('color'),
      text === 'Colored'
        ? 'rgba(0.0000%, 0.0000%, 100.0000%, 100.0000%)'
        : 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
    );
    assert.equal(native.getAttribute('color'), text === 'Colored' ? '#0000FF' : '#FF0000');
  }

  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI());
  const imported = elements(mei, 'f');

  assert.deepEqual(
    imported.map((n) => n.textContent),
    numbers.map((n) => n.textContent),
  );
  assert.ok(
    imported.every(
      (n) =>
        !n.hasAttribute('color') &&
        !n.hasAttribute('fontsize') &&
        !n.hasAttribute('fontweight') &&
        !n.hasAttribute('fontstyle'),
    ),
  );
  const rendered = toolkit.renderToSVG(1);

  assert.ok(!rendered.includes('#FF0000'));
  assert.ok(!rendered.includes('#0000FF'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-style-reader'));
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
});

test('hidden figured-bass groups stay hidden while partial-row reader losses are independently verified', async () => {
  const source = String.raw`\score { << \new Staff { \tempo 4 = 120 c'1 d'1 e'1 } \figures {
    \once \override BassFigure.transparent = ##t <\markup \with-color #blue "Hidden">1
    <\markup \transparent \with-color #red "Invisible">1
    <\markup \transparent "Secret" 4>1 } >> \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const original = new TextDecoder().decode(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
    ),
    rendered = toolkit.renderToSVG(1);

  for (const text of ['Hidden', 'Invisible', 'Secret']) {
    assert.ok(!original.includes(text));
  }

  for (const text of ['Hidden', 'Invisible']) {
    assert.ok(!rendered.includes(text));
  }

  assert.ok(rendered.includes('Secret'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-style-reader'));
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
});
