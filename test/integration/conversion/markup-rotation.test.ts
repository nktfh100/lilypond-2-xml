import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { converter, elements, parse } from '../../support/conversion-support.js';
import { validate } from '../../support/schema.js';

test('rotated markup retains the native angle and text from LilyPond source', async (t) => {
  const source = String.raw`\version "2.26.0" { c'1^\markup \rotate #45 "Turn" }`;
  const compiler = createReusableCompiler();

  t.after(() => compiler.dispose());
  const [{ scores }, compiled] = await Promise.all([
    converter.convert(source),
    compiler.compile(source, { format: ['svg'] }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const words = elements(parse(score.musicxml), 'words');

  assert.equal(words.length, 1);
  assert.equal(words[0]!.textContent, 'Turn');
  assert.equal(words[0]!.getAttribute('rotation'), '-45');
  assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code === 'markup-command'));
  const original = new TextDecoder().decode(
    Object.entries(compiled.files).find(([name]) => name.endsWith('.svg'))![1],
  );

  assert.match(original, /rotate\(-45(?:\.0+)?[, ]/);
});

test('nested and fractional rotations retain styles and wrap to schema-valid angles', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4^\markup \rotate #30 \bold \rotate #-75 \italic "Nested"
      d'4^\markup \rotate #450 "Wrapped"
      e'4^\markup \rotate #1/2 "Fraction"
      f'4^\markup \rotate #0.0000001 "Small" }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const words = elements(parse(score.musicxml), 'words');

  assert.deepEqual(
    words.map((word) => Number(word.getAttribute('rotation'))),
    [45, -90, -0.5, -0.0000001],
  );
  assert.equal(words[0]!.getAttribute('font-weight'), 'bold');
  assert.equal(words[0]!.getAttribute('font-style'), 'italic');
  assert.ok(words.every((word) => !word.getAttribute('rotation')!.includes('e')));
});

test('rotated instrument labels and lyric text use attributes supported by their native elements', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { instrumentName = \markup \rotate #-45 "Singer" }
      \new Voice { c'1 } \addlyrics { \markup \rotate #45 \bold "Turn" }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);
  const label = elements(xml, 'display-text').find((element) => element.textContent === 'Singer')!;
  const lyric = elements(xml, 'text').find((element) => element.textContent === 'Turn')!;

  assert.equal(label.getAttribute('rotation'), '45');
  assert.equal(lyric.getAttribute('rotation'), '-45');
  assert.equal(lyric.getAttribute('font-weight'), 'bold');
});
