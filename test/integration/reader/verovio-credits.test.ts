import assert from 'node:assert/strict';
import { test } from 'node:test';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { createReaderHarness } from '../../support/verovio-support.js';
import { elements, parse } from '../../support/xml-support.js';

const { converter, midiCompiler, toolkit } = await createReaderHarness();

test('native formatted credits retain header styles while the reader drops sizes and exact layout', async () => {
  const source = String.raw`\header { title = \markup \concat { \with-color #red \bold "Scarlet" " plain" }
    subtitle = \markup \abs-fontsize #9 \italic "Small" composer = \markup \italic "Composer" copyright = "Rights" }
    \score { { \tempo 4 = 120 c'1 } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  const mei = parse(toolkit.getMEI());
  const head = mei.getElementsByTagName('pgHead')[0]!,
    runs = elements(head, 'rend');

  assert.equal(runs.find((r) => r.textContent === 'Scarlet')!.getAttribute('color'), '#FF0000');
  assert.equal(runs.find((r) => r.textContent === 'Scarlet')!.getAttribute('fontweight'), 'bold');
  assert.equal(runs.find((r) => r.textContent === ' plain')!.getAttribute('fontweight'), 'bold');
  assert.ok(runs.every((r) => !r.hasAttribute('fontsize')));
  assert.deepEqual(
    elements(mei.getElementsByTagName('pgFoot')[0]!, 'rend').map((r) => r.textContent),
    ['Rights', 'LilyPond v2.26.0'],
  );
  const svg = toolkit.renderToSVG(1);

  assert.equal(svg.split('Scarlet').length - 1, 1);
  const original = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );

  assert.ok(original.includes('Scarlet'));
  assert.ok(original.includes('plain'));
  assert.ok(original.includes('rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)'));
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  assert.ok(Math.abs(actual[0]!.duration! - expected[0]!.duration!) < 0.01);
  assert.ok(!score.diagnostics.some((d) => d.code === 'header-reader'));
  assert.ok(score.diagnostics.some((d) => d.code === 'header-layout'));
});

test('transparent header credits stay invisible and disabled source title templates do not reveal fallback metadata', async () => {
  const source = String.raw`\header { title = \markup \transparent \with-color #blue "Secret" } { c'1 }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(toolkit.loadData(score.musicxml), 1);
  assert.ok(toolkit.renderToSVG(1).includes('fill="#00000000"'));
  const original = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );

  assert.ok(!original.includes('Secret'));
  const suppressed = await converter.convert(
    String.raw`\paper { bookTitleMarkup = ##f } \header { title = "Suppressed" composer = "Hidden composer" } { d'1 }`,
  );

  validate(suppressed.scores[0]!.musicxml);
  assert.equal(toolkit.loadData(suppressed.scores[0]!.musicxml), 1);
  const hidden = parse(toolkit.getMEI());

  assert.equal(hidden.getElementsByTagName('pgHead')[0]!.textContent?.trim(), '');
  assert.ok(!toolkit.renderToSVG(1).includes('Suppressed'));
  assert.ok(!suppressed.scores[0]!.diagnostics.some((d) => d.code === 'header-visibility-reader'));
});

test('native header and word point sizes match independently compiled SVG physical dimensions', async () => {
  const source = String.raw`\header { title = \markup \concat { "Default" \normal-weight " normal" }
    subtitle = \markup \abs-fontsize #9 "Absolute" composer = "Base"
    subsubtitle = \markup \abs-fontsize #24 \magnify #2 "Magnified" instrument = \markup \abs-fontsize #24 \small "Reset"
    poet = \markup \override #'(font-size . -3) "Step" }
    \score { { \tempo 4 = 120 c'1^\markup \abs-fontsize #14 "Body" } \layout {} \midi {} }`;
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    midiCompiler.compile(source, { format: ['svg', 'midi'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const original = new TextDecoder().decode(
    Object.entries(compiled.files).find(([n]) => n.endsWith('.svg'))![1],
  );
  const svg = parse(original),
    root = svg.documentElement;
  const unitMillimeters =
    Number(root.getAttribute('width')!.replace('mm', '')) /
    Number(root.getAttribute('viewBox')!.split(/\s+/)[2]);
  const xml = parse(score.musicxml);
  const native = [...elements(xml, 'credit-words'), ...elements(xml, 'words')];

  for (const text of [
    'Default',
    'normal',
    'Absolute',
    'Base',
    'Body',
    'Magnified',
    'Reset',
    'Step',
  ]) {
    const sourceText = elements(svg, 'text').find((n) => n.textContent?.trim() === text)!;
    const written = native.find((n) => n.textContent?.trim() === text)!;
    const physicalSize =
      (Number(sourceText.getAttribute('font-size')) * unitMillimeters * 72) / 25.4;

    assert.ok(
      Math.abs(Number(written.getAttribute('font-size')) - physicalSize) < 0.003,
      `${text}: native ${written.getAttribute('font-size')}, source SVG ${physicalSize}`,
    );
    assert.equal(
      written.getAttribute('font-weight') ?? 'normal',
      sourceText.getAttribute('font-weight') ?? 'normal',
    );
  }

  assert.equal(toolkit.loadData(score.musicxml), 1);
  const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([n]) => n.endsWith('.midi'))![1],
    ),
    actual = midiTimedNotes(toolkit.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  assert.ok(Math.abs(actual[0]!.duration! - expected[0]!.duration!) < 0.01);
});

test('book and score header scopes match independent LilyPond text and preserve MIDI playback', async () => {
  for (const all of [false, true]) {
    const source =
      String.raw`\book { \paper { print-all-headers = ` +
      (all ? '##t' : '##f') +
      String.raw` }
      \header { title = \markup \with-color #red "BookTitle" composer = "BookComposer" copyright = "BookRights" tagline = ##f }
      \score { \header { title = \markup \with-color #blue "ScoreTitle" composer = "ScoreComposer" copyright = "ScoreRights" piece = "One" }
        { \tempo 4 = 120 c'1 } \layout {} \midi {} }
      \score { \header { title = "SecondTitle" composer = ##f piece = "Two" } { \tempo 4 = 120 d'1 } \layout {} \midi {} } }`;
    const [{ scores }, compiled] = await Promise.all([
      converter.convert(source),
      midiCompiler.compile(source, { format: ['svg', 'midi'] }),
    ]);
    const native = scores.flatMap((s) => {
      validate(s.musicxml);
      const xml = parse(s.musicxml);

      return elements(xml, 'credit')
        .filter((c) => elements(c, 'credit-type').some((n) => n.textContent !== 'page footer'))
        .flatMap((c) =>
          elements(c, 'credit-words')
            .map((n) => n.textContent?.trim())
            .filter(Boolean),
        );
    });
    const labels = new Set([
      'BookTitle',
      'BookComposer',
      'BookRights',
      'ScoreTitle',
      'ScoreComposer',
      'ScoreRights',
      'SecondTitle',
      'One',
      'Two',
    ]);
    const original = Object.entries(compiled.files)
      .filter(([name]) => name.endsWith('.svg'))
      .flatMap(([, bytes]) => {
        const svg = parse(new TextDecoder().decode(bytes));

        return elements(svg, 'text')
          .map((n) => n.textContent?.trim())
          .filter((value) => labels.has(value ?? ''));
      });

    assert.deepEqual([...native].sort(), [...original].sort());
    const midiFiles = Object.entries(compiled.files)
      .filter(([name]) => name.endsWith('.midi'))
      .sort(([a], [b]) => {
        const order = (name: string) => Number(name.match(/-(\d+)\.midi$/)?.[1] ?? 0);

        return order(a) - order(b);
      });

    assert.equal(midiFiles.length, scores.length);

    for (const [i, score] of scores.entries()) {
      assert.equal(toolkit.loadData(score.musicxml), 1);
      const actual = midiTimedNotes(toolkit.renderToMIDI()),
        expected = midiTimedNotes(midiFiles[i]![1]);

      assert.deepEqual(
        actual.map(({ pitch, onset, velocity }) => ({
          pitch,
          onset,
          velocity,
        })),
        expected.map(({ pitch, onset, velocity }) => ({
          pitch,
          onset,
          velocity,
        })),
      );
      assert.ok(Math.abs(actual[0]!.duration! - expected[0]!.duration!) < 0.01);
      const mei = parse(toolkit.getMEI()),
        head = mei.getElementsByTagName('pgHead')[0]!;

      assert.ok(!head.textContent!.includes('ScoreRights'));

      if (i === 0) {
        assert.ok(head.textContent!.includes('BookTitle'));
      } else {
        assert.ok(!head.textContent!.includes('BookTitle'));
      }
    }
  }
});

test('an ignored score-local title cannot reappear through Verovio metadata fallback', async () => {
  const { scores } =
    await converter.convert(String.raw`\book { \header { title = "Book" tagline = ##f }
    \score { \header { title = "LocalOne" } { c'1 } } \score { \header { title = "LocalTwo" } { d'1 } } }`);

  for (const s of scores) {
    validate(s.musicxml);
  }

  assert.equal(toolkit.loadData(scores[1]!.musicxml), 1);
  const mei = parse(toolkit.getMEI());

  assert.equal(mei.getElementsByTagName('pgHead')[0]!.textContent?.trim(), '');
  const rendered = parse(toolkit.renderToSVG(1));

  assert.ok(!elements(rendered, 'text').some((n) => n.textContent?.includes('LocalTwo')));
  assert.ok(!scores[1]!.diagnostics.some((d) => d.code === 'header-visibility-reader'));
});
