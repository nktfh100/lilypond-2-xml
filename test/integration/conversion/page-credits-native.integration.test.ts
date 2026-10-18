import type { Document, Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createConverter, toMusicXML, type ScoreDocument } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { validate } from '../../support/schema.js';
import { elements as all, parse } from '../../support/xml-support.js';

const converter = createConverter();
const toolkit = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  toolkit.destroy();
});

const texts = (node: Document | Element, tag: string) =>
  all(node, tag).map((element) => element.textContent?.trim() ?? '');
const credits = (xml: string) =>
  all(parse(xml), 'credit').map((credit) => ({
    page: credit.getAttribute('page'),
    type: texts(credit, 'credit-type').join(' '),
    words: texts(credit, 'credit-words').join(''),
    x: all(credit, 'credit-words').map((word) => word.getAttribute('default-x')),
    y: all(credit, 'credit-words').map((word) => word.getAttribute('default-y')),
  }));
const source = String.raw`\version "2.26.0"
\header { title="Native page credit integration" tagline=##f }
\paper {
 paper-width=90\mm paper-height=70\mm top-margin=6\mm bottom-margin=6\mm
 left-margin=5\mm right-margin=5\mm first-page-number=17 print-first-page-number=##t
 ragged-last-bottom=##f
 oddHeaderMarkup=\markup \fill-line { "ODD header" \fromproperty #'page:page-number-string }
 evenHeaderMarkup=\markup \fill-line { \fromproperty #'page:page-number-string "EVEN header" }
 oddFooterMarkup=\markup \fill-line { \if \on-last-page "LAST footer" }
 evenFooterMarkup=\markup \fill-line { \if \on-last-page "LAST footer" }
}
\score { \new Staff { c'1 \break d'1 \break e'1 \break f'1 } \layout{} \midi{\tempo 4=120} }
`;

test('actual resolved running credits project to native pages and retain cache/schema data', async () => {
  const result = await converter.convert(source);

  assert.equal(result.scores.length, 1);
  const score = result.scores[0]!;
  const rows = score.document.pageCredits!;

  assert.equal(score.document.pageCreditsCaptured, true);
  assert.ok(
    rows.some((row) => row.page === 1 && row.displayedPage === 17 && row.region === 'header'),
  );
  assert.ok(
    rows.some((row) => row.page === 2 && row.displayedPage === 18 && row.region === 'header'),
  );
  assert.ok(
    rows.some(
      (row) =>
        row.page === 2 &&
        row.region === 'footer' &&
        row.items.some((item) => item.text === 'LAST footer'),
    ),
  );

  validate(score.musicxml);
  const native = credits(score.musicxml);

  assert.ok(
    native.some(
      (credit) =>
        credit.page === '1' && credit.type === 'page header' && credit.words.includes('ODD header'),
    ),
  );
  assert.ok(native.some((credit) => credit.page === '1' && credit.words.includes('17')));
  assert.ok(
    native.some(
      (credit) =>
        credit.page === '2' &&
        credit.type === 'page header' &&
        credit.words.includes('EVEN header'),
    ),
  );
  assert.ok(native.some((credit) => credit.page === '2' && credit.words.includes('18')));
  assert.ok(
    native.some(
      (credit) =>
        credit.page === '2' &&
        credit.type === 'page footer' &&
        credit.words.includes('LAST footer'),
    ),
  );
  assert.ok(!native.some((credit) => credit.page === '17' || credit.page === '18'));
  assert.ok(
    native.every((credit) => credit.words !== 'ODD header' || credit.x.some((x) => x !== null)),
  );
  assert.ok(!score.diagnostics.some((diagnostic) => diagnostic.code === 'page-credit-reader'));

  const cached = JSON.parse(JSON.stringify(score.document)) as ScoreDocument;
  const replay = toMusicXML(cached).musicxml;

  validate(replay);
  assert.deepEqual(
    credits(replay).filter((credit) => credit.type.startsWith('page ')),
    native.filter((credit) => credit.type.startsWith('page ')),
  );

  toolkit.setOptions({
    breaks: 'encoded',
    pageWidth: 2200,
    pageHeight: 3000,
    adjustPageHeight: false,
    xmlIdSeed: 1,
  });
  assert.equal(toolkit.loadData(score.musicxml), 1);
  assert.ok(
    toolkit.getPageCount() >= 2,
    JSON.stringify({
      pageCount: toolkit.getPageCount(),
      prints: all(parse(score.musicxml), 'print').map((print) => ({
        page: print.getAttribute('new-page'),
        number: print.getAttribute('page-number'),
      })),
      pageRows: score.document.pageLayouts?.map((row) => ({
        page: row.page,
        system: row.system,
      })),
      diagnostics: score.diagnostics.map((d) => d.code),
    }),
  );
  const pageOne = toolkit.renderToSVG(1),
    pageTwo = toolkit.renderToSVG(2);

  assert.ok(pageOne.includes('ODD header'));
  assert.ok(!pageTwo.includes('EVEN header'));
  assert.ok(!pageTwo.includes('LAST footer'));
  const actualMidi = Buffer.from(toolkit.renderToMIDI());
  const { pageCredits: _pageCredits, ...withoutPageCredits } = cached;
  const noPageRows = { ...withoutPageCredits, pageCreditsCaptured: false };
  const noCreditMusic = toMusicXML(noPageRows).musicxml;

  assert.equal(toolkit.loadData(noCreditMusic), 1);
  assert.deepEqual(
    Buffer.from(toolkit.renderToMIDI()),
    actualMidi,
    'native page-credit projection does not change reader playback',
  );
});

test('shared-page credits project once in each standalone score that owns systems on that page', async () => {
  const shared = String.raw`\version "2.26.0"
\header { title="Shared page credit" tagline=##f }
\paper { paper-width=160\mm paper-height=120\mm top-margin=8\mm bottom-margin=8\mm
 left-margin=8\mm right-margin=8\mm oddHeaderMarkup=\markup \fill-line { "SHARED header" \fromproperty #'page:page-number-string }
 oddFooterMarkup=\markup { "SHARED footer" } }
\book { \bookpart { \header { title="Shared part" tagline=##f }
 \score { \header { piece="Shared first" } \new Staff { c'1 } \layout{} }
 \score { \header { piece="Shared second" } \new Staff { d'1 } \layout{} } } }`;
  const result = await converter.convert(shared);

  assert.equal(result.scores.length, 2);
  const owners = result.scores.map((score) => {
    assert.equal(score.document.pageCreditsCaptured, true);
    const rows = score.document.pageCredits!;

    assert.equal(
      new Set(rows.map((row) => `${row.book}:${row.bookpart}:${row.scope}:${row.page}`)).size,
      1,
    );

    return [
      ...new Set(rows.map((row) => `${row.book}:${row.bookpart}:${row.scope}:${row.page}`)),
    ][0];
  });

  assert.equal(owners[0], owners[1], 'both score roots own the same physical source page');

  for (const score of result.scores) {
    validate(score.musicxml);
    const native = credits(score.musicxml);

    assert.equal(
      native.filter((credit) => credit.page === '1' && credit.words.includes('SHARED header'))
        .length,
      1,
    );
    assert.equal(
      native.filter((credit) => credit.page === '1' && credit.words.includes('SHARED footer'))
        .length,
      1,
    );
    assert.ok(
      !native.some((credit) => credit.page !== '1' && credit.words.includes('SHARED header')),
    );
  }
});
