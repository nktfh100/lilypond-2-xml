import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeInput, sanitizeUnsupportedText } from '../../../src/lilypond/sanitize.js';

const stripped = (source: string, expected: string, count = 1) => {
  const sanitized = sanitizeUnsupportedText(source);

  assert.equal(sanitized.text, expected);
  assert.equal(sanitized.diagnostics.length, 1);
  assert.equal(sanitized.diagnostics[0]?.code, 'unsupported-text-stripped');
  assert.ok(sanitized.diagnostics[0]?.message.includes(`${count} occurrence(s)`));
};

const preserved = (source: string) => {
  assert.deepEqual(sanitizeUnsupportedText(source), {
    text: source,
    diagnostics: [],
  });
};

test('a closing parenthesis in a Scheme string does not expose executable text', () => {
  preserved('#(define s ")漢")');
});

test('Scheme delimiters in LilyPond comments do not hide a rendered title', () => {
  stripped('% #( comment\n\\header { title = "漢" }', '% #( comment\n\\header { title = "" }');
});

test('Unicode LilyPond definitions and references are source identifiers', () => {
  preserved('樂 = { c4 }\n\\樂');
  preserved('樂_漢 = { c4 }\n\\樂_漢');
  preserved('ǀ = { c4 }\n\\ǀ');
});

test('LilyPond line and nested block comments are preserved', () => {
  const comment = '% 漢 " #(\n%{ 漢 %{ #( %} ) %}';

  stripped(`${comment}\n\\markup { 漢 }`, `${comment}\n\\markup {  }`);
});

test('Scheme strings, escaped quotes, line comments and nested block comments are preserved', () => {
  const scheme = String.raw`#(list ")漢" "\"(漢" ; ) 漢
    #| ) 漢 #| ( 漢 |# |# "漢")`;

  stripped(`${scheme}\n\\header { title = "漢" }`, `${scheme}\n\\header { title = "" }`);
});

test('Scheme quoted data, character literals and reader comments preserve boundaries', () => {
  for (const scheme of [
    String.raw`#'(漢 ")漢")`,
    String.raw`#(list #\) #\" #\space "漢")`,
    String.raw`#(list #;(ignored ")漢") "漢")`,
    String.raw`#"漢"`,
    String.raw`##("漢" 漢)`,
    String.raw`##vu8(1 2 3)`,
    String.raw`$'(漢 ")漢")`,
    String.raw`#'漢`,
  ]) {
    stripped(`${scheme}\n\\markup { 漢 }`, `${scheme}\n\\markup {  }`);
  }
});

test('unfinished Scheme forms, strings and comments are preserved conservatively', () => {
  for (const source of [
    '#(list "漢"',
    '#(list "漢',
    '#(list #| 漢',
    '%{ 漢 "',
    '"漢',
    String.raw`"漢\"`,
  ]) {
    preserved(source);
  }
});

test('text blocks sanitize bare words, strings, nested markup and lyric syllables', () => {
  stripped(
    String.raw`樂 = { c4 } \markup { 漢 \bold { "字" } } \樂 \lyricmode { 吾 -- 森 }`,
    String.raw`樂 = { c4 } \markup {  \bold { "" } } \樂 \lyricmode {  --  }`,
    4,
  );
  stripped(String.raw`\markup 漢 \樂`, String.raw`\markup  \樂`);
  stripped(String.raw`\lyricsto "樂" { 漢 }`, String.raw`\lyricsto "樂" {  }`);
});

test('escaped LilyPond quotes do not end rendered strings', () => {
  stripped(String.raw`\markup "a\"漢 b"`, String.raw`\markup "a\" b"`);
});

test('file names and context identifiers are preserved', () => {
  preserved(String.raw`\include "樂.ily" \new Staff = "樂" { c4 }`);
  stripped(
    String.raw`\new Staff { instrumentName = "漢" }`,
    String.raw`\new Staff { instrumentName = "" }`,
  );
});

test('glyph substitutions apply to rendered text and preserve executable content', () => {
  const executable = String.raw`#(list "ǀ" "\\char ##x01C0") % ǀ \char ##x01C0`;
  const source = `${executable}\n${String.raw`\markup { ǀ \char ##x01C0 }`}`;
  const sanitized = sanitizeUnsupportedText(source);

  assert.equal(sanitized.text, `${executable}\n${String.raw`\markup { | "|" }`}`);
  assert.equal(sanitized.diagnostics.length, 2);
  assert.ok(
    sanitized.diagnostics.every(
      (diagnostic) => diagnostic.code === 'unsupported-glyph-substituted',
    ),
  );
});

test('a carriage return ends a LilyPond line comment', () => {
  stripped('% #( 漢\r\\markup { 漢 }', '% #( 漢\r\\markup {  }');
});

test('embedded LilyPond strings and comments do not end a Scheme datum', () => {
  const scheme = String.raw`#(define music #{ c4 ^"#}漢" %{ #} %} d4 #})`;

  stripped(`${scheme}\n\\markup { 漢 }`, `${scheme}\n\\markup {  }`);
});

test('context definitions and all context identity arguments are executable strings', () => {
  preserved(String.raw`\layout { \context { \Voice \name "漢" } } \new "漢" { c4 }`);

  for (const command of [
    'name',
    'alias',
    'accepts',
    'denies',
    'defaultchild',
    'consists',
    'remove',
  ]) {
    preserved(`\\layout { \\context { \\Voice \\${command} "漢" } }`);
  }

  preserved(String.raw`\new "漢" = "字" { c4 }`);
  preserved(String.raw`\new Staff = "漢" { c4 } \change Staff = "漢"`);
  preserved(String.raw`\context "漢" = "字" { c4 }`);
  stripped(String.raw`\lyricsto "漢" { "字" }`, String.raw`\lyricsto "漢" { "" }`);
});

test('unknown command arguments and unclassified assignments preserve their strings', () => {
  preserved(String.raw`\customMusicFunction "漢" "字" { c4 }`);
  preserved(String.raw`value = "漢" \set Staff.midiInstrument = "漢"`);
  preserved(String.raw`\header { title = \customTitleFunction "漢" "字" }`);
  preserved(String.raw`\markup { \customMarkupFunction "漢" "字" }`);
  preserved(String.raw`\markup { \musicglyph "漢" }`);
});

test('explicit display strings still sanitize header fields, text properties and music labels', () => {
  stripped(
    String.raw`\header { title = "漢" composer = "漢" } \set Staff.instrumentName = "漢" c4^"漢" d4-"漢" \tempo "漢" \mark "漢"`,
    String.raw`\header { title = "" composer = "" } \set Staff.instrumentName = "" c4^"" d4-"" \tempo "" \mark ""`,
    7,
  );
});

test('include markup substitutes uncovered glyphs and strips control bytes', () => {
  const input = `tagline = \\markup { "ǀ${String.fromCharCode(0x95)}" }`;
  const sanitized = sanitizeInput("{ c'4 }", { 'footer.ily': input });

  assert.equal(sanitized.files['footer.ily'], String.raw`tagline = \markup { "|" }`);
  assert.deepEqual(
    sanitized.diagnostics.map((d) => d.code),
    ['unsupported-glyph-substituted', 'unsupported-text-stripped'],
  );
});

test('successive sanitizer rules preserve rendered siblings and are idempotent', () => {
  const source =
    String.raw`\markup { \char ##x01C0 "ǀ` +
    String.fromCharCode(0x95) +
    String.raw`漢" \char ##x01C0 }`;
  const sanitized = sanitizeUnsupportedText(source);
  const expected = String.raw`\markup { "|" "|" "|" }`;

  assert.equal(sanitized.text, expected);
  assert.deepEqual(
    sanitized.diagnostics.map((d) => d.code),
    ['unsupported-glyph-substituted', 'unsupported-glyph-substituted', 'unsupported-text-stripped'],
  );
  assert.ok(sanitized.diagnostics[0]?.message.includes('2 occurrence(s)'));
  assert.ok(sanitized.diagnostics[2]?.message.includes('2 occurrence(s)'));
  preserved(expected);
});

test('a covered char command does not suppress the following rendered string', () => {
  stripped(String.raw`\markup { \char ##x0041 "漢" }`, String.raw`\markup { \char ##x0041 "" }`);
});

test('linked markup sanitizes its displayed content while preserving its URL', () => {
  for (const target of [
    String.raw`"https://example.com/漢ǀ"`,
    String.raw`#(string-append "漢" "ǀ")`,
    String.raw`\target`,
  ]) {
    for (const [body, expected] of [
      [
        String.raw`{ \abs-fontsize #12 \with-color #white \char ##x01C0 }`,
        String.raw`{ \abs-fontsize #12 \with-color #white "|" }`,
      ],
      [String.raw`"ǀ"`, String.raw`"|"`],
      [String.raw`\bold { "ǀ" }`, String.raw`\bold { "|" }`],
    ]) {
      const source = `\\markup { \\with-url ${target} ${body} }`;
      const sanitized = sanitizeUnsupportedText(source);

      assert.equal(sanitized.text, `\\markup { \\with-url ${target} ${expected} }`);
      assert.equal(sanitized.diagnostics[0]?.code, 'unsupported-glyph-substituted');
      preserved(sanitized.text);
    }
  }
});

test('linked markup preserves comments and sanitizes nested link labels and siblings', () => {
  stripped(
    String.raw`\markup { \with-url %{ 漢 %} "https://example.com/漢" { \with-url "漢" "漢" } "漢" }`,
    String.raw`\markup { \with-url %{ 漢 %} "https://example.com/漢" { \with-url "漢" "" } "" }`,
    2,
  );
});
