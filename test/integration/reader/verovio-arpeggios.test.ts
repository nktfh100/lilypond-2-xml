import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiNotes, midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit, playback } = await createReaderHarness();

for (const connected of [false, true]) {
  test(`Verovio renders ${connected ? 'one connected' : 'two independent'} piano arpeggio groups`, async () => {
    const { scores } = await converter.convert(
      String.raw`\new PianoStaff \with { connectArpeggios = ${connected ? '##t' : '##f'} } << \new Staff { <c' e' g'>1\arpeggio } \new Staff { \clef bass <c e g>1\arpeggio } >>`,
    );
    const score = scores[0]!;

    validate(score.musicxml);
    assert.equal(toolkit.loadData(score.musicxml), 1);
    const groups = toolkit.getMEI().match(/<arpeg\b[^>]*>/g) || [];

    assert.equal(groups.length, connected ? 1 : 2);

    if (connected) {
      assert.match(groups[0]!, /plist="#[^" ]+ #[^" ]+"/);
    }

    assert.equal((toolkit.renderToSVG(1).match(/class="arpeg"/g) || []).length, connected ? 1 : 2);
    assert.ok(toolkit.renderToSVG(1).includes('#EAA9-'));
    assert.deepEqual(
      playback()
        .map((note) => note.pitch)
        .sort((a, b) => a - b),
      [48, 52, 55, 60, 64, 67],
    );
  });
}

test('native non-arpeggiato brackets remain present when Verovio changes chord playback', async () => {
  const source = String.raw`\score { { \tempo 4 = 120 <c' e' g'>1\nonArpeggiato } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: 'midi' }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  assert.match(toolkit.getMEI(), /<arpeg\b[^>]*order="nonarp"/);
  const svg = toolkit.renderToSVG(1);

  assert.ok(svg.includes('class="arpeg"'));
  assert.ok(!svg.includes('#EAA9-'));
  const original = midiNotes(
    Object.entries(compiled.files).find(([name]) => name.endsWith('.midi'))![1],
  );
  const actual = midiNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    original.map((note) => note.onset),
    [0, 0, 0],
  );
  assert.deepEqual(
    actual.map((note) => note.pitch),
    original.map((note) => note.pitch),
  );
  assert.ok(actual.some((note) => note.onset > 0));
  assert.ok(
    !score.diagnostics.some((diagnostic) => diagnostic.code === 'arpeggio-playback-reader'),
  );
});

test('Verovio omits hidden arpeggios and preserves simultaneous chord playback', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \omit Arpeggio <c' e' g'>1\arpeggio }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  assert.ok(!/<arpeg\b/.test(toolkit.getMEI()));
  assert.ok(!toolkit.renderToSVG(1).includes('#EAA9-'));
  assert.deepEqual(
    playback().map((note) => note.time),
    [0, 0, 0],
  );
  assert.ok(
    !score.diagnostics.some((diagnostic) => diagnostic.code === 'arpeggio-playback-reader'),
  );
});

test('Verovio keeps consecutive grace arpeggios separate from the main chord', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \grace { <c' e'>16\arpeggio <d' f'>16\arpeggio } <e' g'>1\arpeggio }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const groups = toolkit.getMEI().match(/<arpeg\b[^>]*>/g) || [];

  assert.equal(groups.length, 3);
  assert.ok(groups.every((group) => /plist="#[^" ]+"/.test(group)));
  assert.equal((toolkit.renderToSVG(1).match(/class="arpeg"/g) || []).length, 3);
});

test('Verovio retains arpeggio colors while ignoring native offsets and nominal endpoint positions', async () => {
  const source = String.raw`\score { { \tempo 4 = 120
    \once \override Arpeggio.color = #red \once \override Arpeggio.extra-offset = #'(1 . 2)
    \once \override Arpeggio.positions = #'(-4 . 2) <c' e' g'>2\arpeggio
    \once \override ChordBracket.color = #blue <d' f' a'>2\nonArpeggiato } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI()),
    arpeggios = elements(mei, 'arpeg');

  assert.deepEqual(
    arpeggios.map((a) => a.getAttribute('color')),
    ['#FF0000', '#0000FF'],
  );
  assert.ok(arpeggios.every((a) => !a.hasAttribute('ho') && !a.hasAttribute('vo')));
  const svg = toolkit.renderToSVG(1);

  assert.ok(svg.includes('class="arpeg" color="#FF0000"'));
  assert.ok(svg.includes('class="arpeg" color="#0000FF"'));
  const original = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );
  const originalXml = parse(original);

  for (const color of [
    'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
    'rgba(0.0000%, 0.0000%, 100.0000%, 100.0000%)',
  ]) {
    const group = elements(originalXml, 'g').find((g) => g.getAttribute('color') === color)!;

    assert.ok(group);
    assert.ok(group.childElementCount > 0);
  }

  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map((n) => n.pitch),
    expected.map((n) => n.pitch),
  );
  assert.deepEqual(
    expected.map((n) => n.onset),
    [0, 0, 0, 1, 1, 1],
  );
  assert.ok(actual[1]!.onset > expected[1]!.onset);
  assert.ok(actual[4]!.onset > expected[4]!.onset);
  assert.ok(!score.diagnostics.some((d) => d.code === 'arpeggio-position-reader'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'arpeggio-playback-reader'));
});

test('native reversed tablature brackets retain physical endpoints while Verovio cannot draw tab-group arpeggios', async () => {
  const source = String.raw`\score { \new TabStaff \with { stringOneTopmost = ##f } { \once \override ChordBracket.color = #blue <e'\1 b\2 g\3>1\nonArpeggiato } \layout {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: 'svg' }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const xml = parse(score.musicxml),
    notes = elements(xml, 'note');

  assert.equal(notes[0]!.getElementsByTagName('non-arpeggiate')[0]!.getAttribute('type'), 'bottom');
  assert.equal(notes[2]!.getElementsByTagName('non-arpeggiate')[0]!.getAttribute('type'), 'top');
  const mei = parse(toolkit.getMEI()),
    arpeg = mei.getElementsByTagName('arpeg')[0]!;
  const svg = parse(toolkit.renderToSVG(1));
  const group = elements(svg, 'g').find(
    (g) => g.getAttribute('id') === arpeg.getAttribute('xml:id'),
  )!;

  assert.equal(group?.childElementCount ?? 0, 0);
  const original = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );
  const originalXml = parse(original);
  const blue = elements(originalXml, 'g').find(
    (g) => g.getAttribute('color') === 'rgba(0.0000%, 0.0000%, 100.0000%, 100.0000%)',
  )!;

  assert.ok(blue);
  assert.ok(blue.childElementCount > 0);
  assert.ok(!score.diagnostics.some((d) => d.code === 'arpeggio-tab-reader'));
});
