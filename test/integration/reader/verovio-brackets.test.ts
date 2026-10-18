import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('native analysis brackets retain placement while Verovio refits them and match independent LilyPond MIDI', async () => {
  const source = String.raw`\layout { \context { \Voice \consists Horizontal_bracket_engraver } }
    \score { { \tempo 4 = 120
      c'4-\tweak HorizontalBracketText.text "analysis" \startGroup d'4\stopGroup e'2 }
      \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = toolkit.getMEI();

  assert.match(mei, /<bracketSpan [^>]*tstamp="1"[^>]*tstamp2="0m\+2"/);
  assert.match(mei, /lendsym="angleup" lstartsym="angleup"/);
  assert.doesNotMatch(mei, /<bracketSpan [^>]*place=/);
  assert.equal((toolkit.renderToSVG(1).match(/class="bracketSpan"/g) || []).length, 1);
  assert.ok(toolkit.renderToSVG(1).includes('analysis'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'bracket-reader'));
  const originalSvg = Object.entries(compiled.files).find(([name]) => name.endsWith('.svg'))!;

  assert.ok(new TextDecoder().decode(originalSvg[1]).includes('analysis'));
  const originalMidi = Object.entries(compiled.files).find(([name]) => name.endsWith('.midi'))!;
  const expected = midiNotes(originalMidi[1]),
    actual = midiNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset }) => ({ pitch, onset })),
    expected.map(({ pitch, onset }) => ({ pitch, onset })),
  );

  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i]!.duration! - expected[i]!.duration!) < 0.02);
  }
});

test('native bracket numbers remain distinct when Verovio mispairs nested endpoints', async () => {
  const { scores } =
    await converter.convert(String.raw`\layout { \context { \Voice \consists Horizontal_bracket_engraver } }
    { c'4\startGroup\startGroup d'4\stopGroup e'4 f'4\stopGroup }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const xml = parse(score.musicxml);
  const native = elements(xml, 'bracket');

  assert.deepEqual(
    native.map((b) => [b.getAttribute('type'), b.getAttribute('number')]),
    [
      ['start', '1'],
      ['start', '2'],
      ['stop', '2'],
      ['stop', '1'],
    ],
  );
  const mei = toolkit.getMEI();
  const imported = parse(mei);

  assert.deepEqual(
    elements(imported, 'bracketSpan').map((b) => b.getAttribute('tstamp2')),
    ['0m+2', '0m+4'],
  );
  assert.equal((toolkit.renderToSVG(1).match(/class="bracketSpan"/g) || []).length, 2);
  assert.ok(!score.diagnostics.some((d) => d.code === 'bracket-nesting-reader'));
});

test('Verovio retains bracket color and transparency while losing piano-staff association', async () => {
  const { scores } =
    await converter.convert(String.raw`\layout { \context { \Voice \consists Horizontal_bracket_engraver } }
    \new PianoStaff << \new Staff {
      \once \override HorizontalBracket.color = #red c''2\startGroup d''2\stopGroup
    } \new Staff {
      \once \override HorizontalBracket.transparent = ##t c'2\startGroup d'2\stopGroup
    } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = toolkit.getMEI();
  const imported = parse(mei);
  const brackets = elements(imported, 'bracketSpan');

  assert.deepEqual(
    brackets.map((b) => b.getAttribute('color')),
    ['#FF0000', '#00000000'],
  );
  assert.ok(brackets.every((b) => !b.hasAttribute('staff')));
  const svg = toolkit.renderToSVG(1);

  assert.ok(svg.includes('#FF0000'));
  assert.ok(svg.includes('#00000000'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'bracket-staff-reader'));
});

test('measure-spanning brackets retain their barline interval and independent LilyPond playback', async () => {
  const source = String.raw`\layout { \context { \Staff \consists Measure_spanner_engraver } }
    \score { { \tempo 4 = 120 \tweak text "two measures" \startMeasureSpanner c'1 d'1 \stopMeasureSpanner }
      \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);

  validate(scores[0]!.musicxml);
  assert.equal(toolkit.loadData(scores[0]!.musicxml), 1);
  assert.match(toolkit.getMEI(), /<bracketSpan [^>]*tstamp="1"[^>]*tstamp2="1m\+5"/);
  assert.match(toolkit.getMEI(), /lendsym="angledown" lstartsym="angledown"/);
  const svg = toolkit.renderToSVG(1);

  assert.equal((svg.match(/class="bracketSpan"/g) || []).length, 1);
  assert.ok(svg.includes('two measures'));
  const originalSvg = Object.entries(compiled.files).find(([name]) => name.endsWith('.svg'))!;

  assert.ok(new TextDecoder().decode(originalSvg[1]).includes('two measures'));
  const originalMidi = Object.entries(compiled.files).find(([name]) => name.endsWith('.midi'))!;
  const expected = midiNotes(originalMidi[1]),
    actual = midiNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset }) => ({ pitch, onset })),
    expected.map(({ pitch, onset }) => ({ pitch, onset })),
  );

  for (let i = 0; i < actual.length; i++) {
    assert.ok(Math.abs(actual[i]!.duration! - expected[i]!.duration!) < 0.02);
  }
});
