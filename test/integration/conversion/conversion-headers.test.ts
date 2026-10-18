import { toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import type { ScoreNode } from '../../support/xml-support.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

// Title-block assertions omit independent running page headers and footers.
// Their captured text is tested explicitly in the page-credit coverage.
function headerCreditWords(xml: ScoreNode) {
  return elements(xml, 'credit')
    .filter(
      (credit) => !['page header', 'page footer'].includes(texts(credit, 'credit-type')[0] ?? ''),
    )
    .flatMap((credit) => elements(credit, 'credit-words'));
}

function headerCreditTexts(xml: ScoreNode) {
  return headerCreditWords(xml).map((word) => word.textContent);
}

test('formatted headers export native first-page credits with explicit fragment style resets', async () => {
  const { scores } =
    await converter.convert(String.raw`\header { title = \markup \concat { \with-color #red \bold "Scarlet" \normal-weight " plain" }
    subtitle = \markup \abs-fontsize #9 \italic "Small" composer = \markup \sans "Composer" poet = "Poet" copyright = "Rights" } { c'1 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    credits = elements(xml, 'credit');

  assert.deepEqual(
    credits.map((c) => texts(c, 'credit-type')[0]),
    ['title', 'subtitle', 'lyricist', 'composer', 'rights', 'page footer'],
  );
  assert.deepEqual(texts(credits.at(-1)!, 'credit-words'), ['LilyPond v2.26.0']);
  const title = elements(credits[0], 'credit-words');

  assert.deepEqual(
    title.map((w) => [w.textContent, w.getAttribute('font-weight'), w.getAttribute('color')]),
    [
      ['Scarlet', 'bold', '#FF0000'],
      [' plain', 'normal', '#000000'],
    ],
  );
  assert.ok(title[0]!.hasAttribute('default-x'));
  assert.ok(!title[1]!.hasAttribute('default-x'));
  assert.equal(title[0]!.getAttribute('default-y'), title[1]!.getAttribute('default-y'));
  assert.ok(
    Math.abs(
      Number(elements(credits[1], 'credit-words')[0]!.getAttribute('font-size')) - 9 * (72 / 72.27),
    ) < 1e-9,
  );
  assert.equal(
    score.document.headerMarkup?.title && typeof score.document.headerMarkup.title,
    'object',
  );
  assert.ok(score.diagnostics.some((d) => d.code === 'header-layout'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'header-reader'));
});

test('false and empty header overrides suppress inherited book titles and keep per-score styles separate', async () => {
  const { scores } =
    await converter.convert(String.raw`\header { title = \markup \bold "Global" composer = "Composer" }
    \book { \header { title = \markup \italic "Book" } \score { \header { title = ##f } { c'1 } }
      \bookpart { \header { title = "" } \score { { d'1 } } }
      \score { \header { title = \markup \with-color #blue "Local" } { e'1 } } }`);

  for (const score of scores) {
    validate(score.musicxml);
  }

  const ordered = [...scores].sort(
    (a, b) =>
      a.document.events.find((e) => e.kind === 'note')!.pitch!.step -
      b.document.events.find((e) => e.kind === 'note')!.pitch!.step,
  );

  assert.deepEqual(
    ordered.map((s) => s.document.header.title),
    ['', '', 'Local'],
  );
  assert.deepEqual(
    ordered.map((s) => texts(parse(s.musicxml), 'work-title')),
    [[], [], ['Local']],
  );
  assert.equal(
    ordered[2]!.document.headerMarkup?.title && typeof ordered[2]!.document.headerMarkup!.title,
    'object',
  );
  assert.ok(scores.every((s) => s.document.header.composer === 'Composer'));
});

test('transparent titles retain native invisible text and explicit title-template suppression is honored', async () => {
  const { scores } =
    await converter.convert(String.raw`\book { \header { title = \markup \transparent \with-color #red "Secret" } \score { { c'1 } } }
    \book { \paper { bookTitleMarkup = ##f } \header { title = "Suppressed" composer = "Hidden composer" } \score { { d'1 } } }`);

  for (const score of scores) {
    validate(score.musicxml);
  }

  const words = elements(parse(scores[0]!.musicxml), 'credit-words');

  assert.equal(words[0]!.textContent, 'Secret');
  assert.equal(words[0]!.getAttribute('color'), '#00000000');
  const blank = headerCreditWords(parse(scores[1]!.musicxml));

  assert.equal(blank.length, 1);
  assert.equal(blank[0]!.textContent?.trim(), '');
  assert.equal(blank[0]!.getAttribute('color'), '#00000000');
  assert.equal(scores[1]!.document.pageHeaderMarkup?.bookTitleMarkup, false);
});

test('static custom title and running templates resolve header properties without inventing page conditions', async () => {
  const { scores } =
    await converter.convert(String.raw`\header { title = \markup \with-color #blue "Heading" }
    \paper { bookTitleMarkup = \markup \bold \fromproperty #'header:title
      oddHeaderMarkup = \markup \italic "Running" oddFooterMarkup = \markup \fromproperty #'page:page-number }
    { c'1 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const credits = elements(parse(score.musicxml), 'credit');

  assert.deepEqual(
    credits.map((c) => texts(c, 'credit-type')[0]),
    ['title', 'page header'],
  );
  const title = elements(credits[0], 'credit-words')[0]!;

  assert.equal(title.textContent, 'Heading');
  assert.equal(title.getAttribute('font-weight'), 'bold');
  assert.equal(title.getAttribute('color'), '#0000FF');
  assert.ok(score.document.pageHeaderMarkup?.oddFooterMarkup);
  assert.ok(score.diagnostics.some((d) => d.code === 'page-header-template'));
  assert.ok(score.diagnostics.some((d) => d.code === 'header-title-template'));
});

test('credit placement follows physical page margins and tiny point sizes remain valid decimals', async () => {
  const { scores } =
    await converter.convert(String.raw`\paper { paper-width = 180\mm paper-height = 240\mm left-margin = 20\mm right-margin = 30\mm top-margin = 12\mm bottom-margin = 15\mm }
    \header { title = \markup \abs-fontsize #0.0000001 "Tiny" composer = "Writer" copyright = "Rights" } { c'1 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    words = headerCreditWords(xml);
  const pageWidth = Number(texts(xml, 'page-width')[0]),
    pageHeight = Number(texts(xml, 'page-height')[0]);
  const left = Number(texts(xml, 'left-margin')[0]),
    right = Number(texts(xml, 'right-margin')[0]),
    top = Number(texts(xml, 'top-margin')[0]),
    bottom = Number(texts(xml, 'bottom-margin')[0]);

  assert.ok(
    Math.abs(Number(words[0]!.getAttribute('default-x')) - (left + pageWidth - right) / 2) < 1e-6,
  );
  assert.ok(Math.abs(Number(words[0]!.getAttribute('default-y')) - (pageHeight - top)) < 1e-6);
  const rights = elements(xml, 'credit').find(
    (credit) => texts(credit, 'credit-type')[0] === 'rights',
  );

  assert.ok(rights);
  assert.ok(
    Math.abs(Number(elements(rights, 'credit-words')[0]!.getAttribute('default-y')) - bottom) <
      1e-6,
  );
  const actualFooter = elements(xml, 'credit').find(
    (credit) => texts(credit, 'credit-type')[0] === 'page footer',
  );

  assert.ok(actualFooter);
  assert.ok(
    Number.isFinite(Number(elements(actualFooter, 'credit-words')[0]!.getAttribute('default-y'))),
  );
  assert.ok(!words[0]!.getAttribute('font-size')!.includes('e'));
  assert.ok(Math.abs(Number(words[0]!.getAttribute('font-size')) - 1e-7 * (72 / 72.27)) < 1e-18);
});

test('custom static page headers and footers follow the declared first-page parity', async () => {
  const { scores } =
    await converter.convert(String.raw`\paper { first-page-number = 2 oddHeaderMarkup = \markup "Odd" evenHeaderMarkup = \markup \italic "Even"
    oddFooterMarkup = \markup "Odd foot" evenFooterMarkup = \markup "Even foot" } { c'1 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(score.document.paper?.['first-page-number'], 2);
  const credits = elements(parse(score.musicxml), 'credit');

  assert.deepEqual(
    credits.map((c) => texts(c, 'credit-words').join('')),
    ['Even', 'Even foot'],
  );
  assert.deepEqual(
    credits.map((c) => texts(c, 'credit-type')[0]),
    ['page header', 'page footer'],
  );
});

test('cached headers without page geometry retain native styled text with a placement diagnostic', async () => {
  const { scores } = await converter.convert(
    String.raw`\header { title = \markup \bold "Cached" tagline = "Last page" } { c'1 }`,
  );
  const { paper: _, ...document } = scores[0]!.document;
  const result = toMusicXML(document);

  validate(result.musicxml);
  const words = elements(parse(result.musicxml), 'credit-words');

  assert.equal(words[0]!.textContent, 'Cached');
  assert.equal(words[0]!.getAttribute('font-weight'), 'bold');
  assert.ok(!words[0]!.hasAttribute('default-y'));
  assert.ok(result.diagnostics.some((d) => d.code === 'header-page'));
  assert.ok(result.diagnostics.some((d) => d.code === 'header-tagline'));
});

test('header template contexts retain actual inherited title and role weights and point sizes', async () => {
  const { scores } =
    await converter.convert(String.raw`\header { title = \markup \concat { \with-color #red "Red" " plain" }
    subtitle = "Subtitle" subsubtitle = "Third" instrument = "Solo" composer = "Composer" } { c'1 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    words = headerCreditWords(xml);

  assert.deepEqual(
    words.slice(0, 2).map((w) => w.getAttribute('font-weight')),
    ['bold', 'bold'],
  );
  const context = score.document.headerStyles!;

  assert.equal(context.title!.reference, 11 * (72 / 72.27));
  assert.equal(context.title!.attrs['font-weight'], 'bold');
  assert.ok(
    Math.abs(Number(words[0]!.getAttribute('font-size')) - 11 * (72 / 72.27) * 2 ** (4 / 6)) < 1e-9,
  );
  assert.ok(
    Math.abs(Number(words[2]!.getAttribute('font-size')) - 11 * (72 / 72.27) * 2 ** (1 / 6)) < 1e-9,
  );
  assert.ok(
    Math.abs(Number(words[3]!.getAttribute('font-size')) - 11 * (72 / 72.27) * 2 ** (-1 / 6)) <
      1e-9,
  );
  assert.equal(words.at(-1)!.getAttribute('font-weight'), 'normal');
  assert.ok(Math.abs(Number(words.at(-1)!.getAttribute('font-size')) - 11 * (72 / 72.27)) < 1e-9);
  assert.ok(!score.diagnostics.some((d) => d.code === 'header-font-context'));
});

test('header relative sizes, fixed steps, magnification and font-size overrides use the captured layout reference', async () => {
  const { scores } =
    await converter.convert(String.raw`\header { title = \markup \abs-fontsize #24 \concat {
    \normal-weight "Normal" \small "small" \fontsize #6 "relative" \magnify #2 "magnified"
    \override #'(font-size . -3) "step" \normalsize \larger "reset" } } { c'1 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const words = headerCreditWords(parse(score.musicxml));
  const expected = [24, 11 * 2 ** (-1 / 6), 48, 22, 11 * 2 ** (-3 / 6), 11 * 2 ** (1 / 6)].map(
    (v) => v * (72 / 72.27),
  );

  assert.equal(words.length, expected.length);
  words.forEach((w, i) =>
    assert.ok(Math.abs(Number(w.getAttribute('font-size')) - expected[i]!) < 1e-9),
  );
  assert.equal(words[0]!.getAttribute('font-weight'), 'normal');
  assert.equal(words[1]!.getAttribute('font-weight'), 'bold');
  assert.ok(
    !score.diagnostics.some((d) =>
      ['markup-font-base', 'markup-font-reset', 'markup-command'].includes(d.code),
    ),
  );
});

test('header context follows actual paper font defaults and staff scaling rather than a fixed title table', async () => {
  const { scores } = await converter.convert(String.raw`#(set-global-staff-size 18)
    \paper { property-defaults = #(append '((font-size . 3) (font-family . sans) (font-series . bold) (font-shape . italic))
      (ly:output-def-lookup (ly:parser-lookup '$defaultpaper) 'property-defaults)) }
    \header { title = "Title" composer = "Composer" } { c'1 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const words = headerCreditWords(parse(score.musicxml));

  assert.ok(Math.abs(score.document.headerStyleBase!.reference - 9.9 * (72 / 72.27)) < 1e-9);
  assert.ok(
    Math.abs(Number(words[0]!.getAttribute('font-size')) - 9.9 * (72 / 72.27) * 2 ** (4 / 6)) <
      1e-9,
  );
  assert.ok(
    Math.abs(Number(words[1]!.getAttribute('font-size')) - 9.9 * (72 / 72.27) * 2 ** (3 / 6)) <
      1e-9,
  );
  assert.ok(
    words.every(
      (w) =>
        w.getAttribute('font-style') === 'italic' && w.getAttribute('font-family') === 'sans-serif',
    ),
  );
});

test('old cached header data without resolved context remains usable with an explicit font-history limit', async () => {
  const { scores } = await converter.convert(
    String.raw`\header { title = \markup \bold "Cached" } { c'1 }`,
  );
  const { headerStyles: _, headerStyleBase: __, ...document } = scores[0]!.document;
  const result = toMusicXML(document);

  validate(result.musicxml);
  assert.equal(
    elements(parse(result.musicxml), 'credit-words')[0]!.getAttribute('font-weight'),
    'bold',
  );
  assert.ok(result.diagnostics.some((d) => d.code === 'header-font-context'));
});

test('unmapped inherited header font variants retain available fields and report their actual settings', async () => {
  const { scores } =
    await converter.convert(String.raw`\paper { property-defaults = #(append '((font-series . heavy) (font-shape . slanted))
      (ly:output-def-lookup (ly:parser-lookup '$defaultpaper) 'property-defaults)) }
    \header { composer = "Composer" } { c'1 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.ok(score.document.headerStyles!.composer!.unsupported.some((v) => v.includes('heavy')));
  assert.ok(
    score.diagnostics.some((d) => d.code === 'header-font-style' && d.message.includes('heavy')),
  );
});

test('native book titles keep their own scope while score metadata remains merged', async () => {
  const { scores } =
    await converter.convert(String.raw`\book { \header { title = \markup \with-color #red "BookTitle" composer = "BookComposer" copyright = "BookRights" }
    \score { \header { title = "ScoreTitle" composer = "ScoreComposer" copyright = "ScoreRights" piece = "Piece" } { c'1 } } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(score.document.header.title, 'ScoreTitle');
  assert.equal(score.document.header.composer, 'ScoreComposer');
  assert.equal(score.document.headerScopes!.book.composer, 'BookComposer');
  assert.deepEqual(headerCreditTexts(parse(score.musicxml)), [
    'BookTitle',
    'BookComposer',
    'Piece',
    'BookRights',
  ]);
  assert.ok(score.document.headerScopes!.bookStart);
  assert.equal(score.document.headerScopes!.printAllHeaders, false);
});

test('print-all-headers preserves both book and score blocks with scope-local suppression', async () => {
  const { scores } =
    await converter.convert(String.raw`\book { \paper { print-all-headers = ##t } \header { title = "BookTitle" composer = "BookComposer" }
    \score { \header { title = "ScoreTitle" composer = ##f piece = "One" } { c'1 } }
    \score { \header { title = "SecondTitle" piece = "Two" } { d'1 } } }`);

  for (const s of scores) {
    validate(s.musicxml);
  }

  assert.deepEqual(headerCreditTexts(parse(scores[0]!.musicxml)), [
    'BookTitle',
    'BookComposer',
    'ScoreTitle',
    'One',
  ]);
  assert.deepEqual(headerCreditTexts(parse(scores[1]!.musicxml)), [
    'SecondTitle',
    'BookComposer',
    'Two',
  ]);
  assert.deepEqual(
    scores.map((s) => s.document.headerScopes!.bookStart),
    [true, false],
  );
  assert.ok(scores.every((s) => s.document.headerScopes!.printAllHeaders));
});

test('bookpart scopes reset title ownership and do not repeat their book header on later scores', async () => {
  const { scores } =
    await converter.convert(String.raw`\header { title = "Global" composer = "Composer" } \book { \header { title = "Book" }
    \bookpart { \header { title = "Part" } \score { \header { piece = "One" } { c'1 } } \score { \header { piece = "Two" } { d'1 } } }
    \bookpart { \header { title = ##f composer = "" } \score { \header { piece = "Three" } { e'1 } } } }`);

  for (const s of scores) {
    validate(s.musicxml);
  }

  assert.deepEqual(
    scores.map((s) => s.document.headerScopes!.bookStart),
    [true, false, true],
  );
  assert.deepEqual(
    scores.map((s) => headerCreditTexts(parse(s.musicxml))),
    [['Part', 'Composer', 'One'], ['Two'], ['Three']],
  );
});

test('score-local false fields do not suppress a separate book title', async () => {
  const { scores } =
    await converter.convert(String.raw`\book { \header { title = "Book" composer = "Author" }
    \score { \header { title = ##f composer = "" } { c'1 } } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(score.document.header.title, '');
  assert.equal(score.document.header.composer, '');
  assert.deepEqual(headerCreditTexts(parse(score.musicxml)), ['Book', 'Author']);
});

test('static book, score and page templates resolve properties against the correct scope', async () => {
  const { scores } = await converter.convert(String.raw`\book { \paper {
      bookTitleMarkup = \markup \bold \fromproperty #'header:title
      scoreTitleMarkup = \markup \italic \fromproperty #'header:title
      oddHeaderMarkup = \markup \fromproperty #'header:composer }
    \header { title = "Book" composer = "BookAuthor" }
    \score { \header { title = "Score" composer = "ScoreAuthor" } { c'1 } } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    words = headerCreditWords(xml);

  assert.deepEqual(
    words.map((w) => w.textContent),
    ['Book', 'Score'],
  );
  assert.equal(words[0]!.getAttribute('font-weight'), 'bold');
  assert.equal(words[1]!.getAttribute('font-style'), 'italic');
  const pageHeader = elements(xml, 'credit').find(
    (credit) => texts(credit, 'credit-type')[0] === 'page header',
  );

  assert.deepEqual(texts(pageHeader!, 'credit-words'), ['BookAuthor']);
  assert.ok(
    score.document.pageCredits?.some(
      (region) =>
        region.region === 'header' && region.items.some((item) => item.text === 'BookAuthor'),
    ),
  );
});

test('the paper print-all-headers policy follows the compiler even with layout overrides', async () => {
  const { scores } =
    await converter.convert(String.raw`\book { \paper { print-all-headers = ##t bookTitleMarkup = ##f } \header { title = "Book" }
    \score { \layout { print-all-headers = ##f } \header { title = "Score" piece = "Piece" } { c'1 } } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.deepEqual(headerCreditTexts(parse(score.musicxml)), ['Score', 'Piece']);
  assert.equal(score.document.headerScopes!.printAllHeaders, true);
});

test('cached headers without scope provenance retain available output with a history diagnostic', async () => {
  const { scores } = await converter.convert(String.raw`\header { title = "Cached" } { c'1 }`);
  const { headerScopes: _, ...document } = scores[0]!.document;
  const result = toMusicXML(document);

  validate(result.musicxml);
  assert.deepEqual(headerCreditTexts(parse(result.musicxml)), ['Cached']);
  assert.ok(result.diagnostics.some((d) => d.code === 'header-scope-history'));
});

test('nested custom header properties resolve independently in book and score templates', async () => {
  const { scores } = await converter.convert(String.raw`\book { \paper { print-all-headers = ##t }
    \header { revision = "BookRev" title = \markup \concat { "Book:" \fromproperty #'header:revision } tagline = ##f }
    \score { \header { revision = "ScoreRev" title = \markup \concat { "Score:" \fromproperty #'header:revision } } { c'1 } } }`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(score.document.headerScopes!.book.revision, 'BookRev');
  assert.equal(score.document.headerMarkup!.revision, 'ScoreRev');
  assert.deepEqual(texts(parse(score.musicxml), 'credit-words'), [
    'Book:BookRev',
    'Score:ScoreRev',
  ]);
  assert.ok(!score.diagnostics.some((d) => d.code === 'markup-command'));
});
