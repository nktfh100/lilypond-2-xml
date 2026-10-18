import { type Diagnostic, convert } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { converter } from '../../support/conversion-support.js';
import { validate } from '../../support/schema.js';
import { elements, parse } from '../../support/xml-support.js';

const unsupported = (scores: { diagnostics: readonly Diagnostic[] }[]) =>
  scores.flatMap((s) => s.diagnostics).filter((d) => d.code.startsWith('unsupported-'));

test('uncovered footer glyphs are substituted with plain bars', async () => {
  const { scores } = await converter.convert(
    String.raw`\version "2.26.0"
\header { title = "T" tagline = \markup { \char ##x01C0 } }
{ c'4 }`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(
    unsupported(scores).map((d) => d.code),
    ['unsupported-glyph-substituted'],
  );
  const score = scores[0]!;
  const metadata = elements(parse(score.musicxml), 'miscellaneous-field').find(
    (field) => field.getAttribute('name') === 'lilypond-conversion-diagnostics',
  );

  assert.equal(metadata, undefined, 'diagnostics are not embedded in MusicXML');

  for (const diagnostic of score.diagnostics) {
    assert.ok(!score.musicxml.includes(diagnostic.message));
  }
});

test('uncovered literal glyphs and mangled control bytes are sanitized in includes', async () => {
  const { scores } = await convert(`{ c'4 }`, {
    files: {
      'footer.ily': `tagline = \\markup { "ǀ${String.fromCharCode(0x95)}" }`,
    },
  });

  assert.ok(scores.length);
  const codes = unsupported(scores).map((d) => d.code);

  assert.ok(codes.includes('unsupported-glyph-substituted'));
  assert.ok(codes.includes('unsupported-text-stripped'));
});

test('uncovered glyphs in linked copyright markup are substituted', async () => {
  const { scores } = await converter.convert(
    String.raw`\version "2.26.0"
\header {
  copyright = \markup {
    \sans \bold \with-url "https://www.MutopiaProject.org" {
      "Mutopia " \concat { \abs-fontsize #12 \with-color #white \char ##x01C0 "Project" }
    }
  }
}
{ c'4 }`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(
    unsupported(scores).map((d) => d.code),
    ['unsupported-glyph-substituted'],
  );
  assert.ok(unsupported(scores)[0]?.message.includes('1 occurrence(s)'));
});

test('uncoverable lyric writing is stripped with its own warning', async () => {
  const { scores } = await converter.convert(`{ c'4 ^\\markup { 吾森章 } }`);

  validate(scores[0]!.musicxml);
  assert.deepEqual(
    unsupported(scores).map((d) => d.code),
    ['unsupported-text-stripped'],
  );
});

test('characters covered by the embedded fonts are kept', async () => {
  const { scores } = await converter.convert(
    `\\version "2.26.0"
\\header { title = "Ω" tagline = \\markup { "—café © ½ αβγ ДА ♭♮♪" } }
{ c'4 }`,
  );

  validate(scores[0]!.musicxml);
  assert.deepEqual(unsupported(scores), []);
});

test('characters outside the embedded fonts are stripped from markup', async () => {
  const { scores } = await converter.convert(`{ c'4 ^\\markup { "ok 👍 ᵃ" } }`);

  validate(scores[0]!.musicxml);
  assert.deepEqual(
    unsupported(scores).map((d) => d.code),
    ['unsupported-text-stripped'],
  );
});
