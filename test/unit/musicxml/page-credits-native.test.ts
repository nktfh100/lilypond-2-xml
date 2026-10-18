import type { Document } from '@oozcitak/dom/lib/dom/interfaces.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { create } from 'xmlbuilder2';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { writeHeaderCredits } from '../../../src/musicxml/text/headers.js';
import type { Add } from '../../../src/musicxml/types.js';
import type { Warn } from '../../../src/model/diagnostics.js';
import {
  writeResolvedPageCredits,
  type NativeCreditPage,
} from '../../../src/musicxml/layout/page-credits.js';
import type {
  PageCreditRegion,
  PageSystemLayout,
  ScoreDocument,
} from '../../../src/model/document.js';
import { validate } from '../../support/schema.js';
import { elements, parse } from '../../support/xml-support.js';

const texts = (node: Document, tag: string) =>
  elements(node, tag).map((element) => element.textContent);

const add: Add = (parent, name, text, attrs = {}) => {
  const child = parent.ele(name, attrs);

  if (text !== undefined && text !== null) {
    child.txt(String(text));
  }

  return child;
};
const stage: ScoreDocument['events'][number] = {
  kind: 'finalLayout',
  status: 'complete',
  stage: 'book',
  attempted: true,
  failure: null,
  moment: {
    main: { numerator: 0, denominator: 1 },
    grace: { numerator: 0, denominator: 1 },
  },
};
const source = (page: number, displayedPage: number): PageSystemLayout => ({
  book: 1,
  bookpart: 0,
  scope: 1,
  page,
  displayedPage,
  system: page,
  outputScale: 2,
  width: 100,
  height: 150,
  topMargin: 10,
  bottomMargin: 12,
  leftMargin: 8,
  rightMargin: 9,
  systemX: 12,
  systemY: 25,
  staves: [],
});
const region = (page: number, regionName: 'header' | 'footer', text: string): PageCreditRegion => ({
  book: 1,
  bookpart: 0,
  scope: 1,
  page,
  displayedPage: page + 16,
  region: regionName,
  resolved: true,
  outputScale: 2,
  width: 100,
  height: 150,
  items: [
    {
      piece: 1,
      text,
      fontDescription: 'DejaVu Serif, Bold Italic 10',
      x: 10,
      y: 20,
      fontScale: 1.25,
      color: [1, 0, 0, 0.5],
      unsupported: [],
    },
  ],
  primitives: [],
});
const document = (
  pageCredits: readonly PageCreditRegion[],
  extra: Partial<ScoreDocument> = {},
): ScoreDocument => ({
  version: 1,
  source: 'credits.ly',
  lilypondVersion: '2.26.0',
  header: { title: 'Title' },
  headerMarkup: {},
  pageHeaderMarkup: { oddHeaderMarkup: 'ODD RUNNING' },
  contexts: [],
  paper: { 'staff-space': 2 },
  events: [stage],
  pageCreditsCaptured: true,
  pageCredits,
  ...extra,
});
const warnings = (root: XMLBuilder, doc: ScoreDocument, pages: readonly NativeCreditPage[]) => {
  const codes: string[] = [];
  const warn: Warn = (code) => codes.push(code);
  const addHeader = add;

  writeHeaderCredits(
    root,
    doc,
    {
      indent: 0,
      shortIndent: 0,
      systemRight: 900,
      point: 10,
      page: {
        width: 1000,
        height: 1500,
        top: 100,
        bottom: 120,
        left: 80,
        right: 90,
      },
    },
    addHeader,
    warn,
    doc.pageCreditsCaptured === true,
  );
  const partList = add(root, 'part-list');

  writeResolvedPageCredits(root, partList, doc, pages, addHeader, warn);

  return { codes, partList };
};
const validScore = (doc: ScoreDocument, pages: readonly NativeCreditPage[]) => {
  const root = create().ele('score-partwise', { version: '4.0' });

  add(root, 'work').ele('work-title').txt('Title');
  const identification = add(root, 'identification');

  add(add(identification, 'encoding'), 'software', 'lilypond-2-xml');
  const result = warnings(root, doc, pages);
  const scorePart = add(result.partList, 'score-part', undefined, { id: 'P1' });

  add(scorePart, 'part-name', 'Piano');
  const part = add(root, 'part', undefined, { id: 'P1' });
  const measure = add(part, 'measure', undefined, { number: 1 });

  add(add(measure, 'attributes'), 'divisions', 1);
  const note = add(measure, 'note');

  add(note, 'rest');
  add(note, 'duration', 4);
  add(note, 'voice', 1);
  add(note, 'type', 'whole');
  const xml = root.end({ prettyPrint: true });

  validate(xml);

  return { xml, doc: parse(xml), codes: result.codes };
};
const nativePage = (page: number, displayedPage: number, nativePage: number): NativeCreditPage => ({
  source: source(page, displayedPage),
  nativePage,
});

test('title credits reset rotation for text following a rotated run', () => {
  const { doc: parsed } = validScore(
    document([], {
      headerMarkup: {
        title: {
          command: 'concat-markup',
          args: [[{ command: 'rotate-markup', args: [45, 'Turn'], plain: 'Turn' }, 'Straight']],
          plain: 'TurnStraight',
        },
      },
    }),
    [],
  );
  const words = elements(parsed, 'credit-words').filter((word) =>
    ['Turn', 'Straight'].includes(word.textContent ?? ''),
  );

  assert.deepEqual(
    words.map((word) => [word.textContent, word.getAttribute('rotation')]),
    [
      ['Turn', '-45'],
      ['Straight', '0'],
    ],
  );
});

test('resolved running credits use standalone native page ordinals and source physical coordinates', () => {
  const doc = document([
    region(1, 'header', 'ODD 17'),
    region(1, 'footer', 'FOOT 17'),
    region(2, 'header', '18 EVEN'),
    region(2, 'footer', 'LAST'),
  ]);
  const { xml, doc: parsed, codes } = validScore(doc, [nativePage(1, 17, 1), nativePage(2, 18, 2)]);
  const credits = elements(parsed, 'credit');

  assert.deepEqual(
    credits.map((credit) => credit.getAttribute('page')),
    ['1', '1', '1', '2', '2'],
  );
  assert.deepEqual(texts(parsed, 'credit-words'), [
    'Title',
    'ODD 17',
    'FOOT 17',
    '18 EVEN',
    'LAST',
  ]);
  assert.equal(
    elements(parsed, 'credit-type').some((type) => type.textContent === 'page header'),
    true,
  );
  const words = elements(parsed, 'credit-words');
  const secondPage = words.find((word) => word.textContent === '18 EVEN')!;

  assert.equal(secondPage.getAttribute('default-x'), '100');
  assert.equal(secondPage.getAttribute('default-y'), '1300');
  assert.equal(secondPage.getAttribute('font-family'), 'DejaVu Serif');
  assert.equal(secondPage.getAttribute('font-weight'), 'bold');
  assert.equal(secondPage.getAttribute('font-style'), 'italic');
  assert.ok(
    Math.abs(Number(secondPage.getAttribute('font-size')) - ((10 * 72) / 25.4) * 1.25) < 1e-8,
  );
  assert.equal(secondPage.getAttribute('color'), '#80FF0000');
  assert.ok(!codes.includes('page-credit-reader'));
  assert.ok(!xml.includes('page="18"'));
});

test('native page credits are not moved onto a page when source ownership is absent or ambiguous', () => {
  const rows = [
    region(1, 'header', 'H'),
    region(1, 'footer', 'F'),
    region(2, 'header', 'H2'),
    region(2, 'footer', 'F2'),
  ];
  const absent = validScore(document(rows), []);

  assert.deepEqual(texts(absent.doc, 'credit-words'), ['Title']);
  const conflicting = validScore(document(rows), [nativePage(1, 17, 1), nativePage(1, 17, 2)]);

  assert.deepEqual(texts(conflicting.doc, 'credit-words'), ['Title']);
  assert.ok(conflicting.codes.includes('page-credit-ownership'));
  const mismatched = validScore(document(rows), [nativePage(1, 99, 1)]);

  assert.deepEqual(texts(mismatched.doc, 'credit-words'), ['Title']);
  assert.ok(mismatched.codes.includes('page-credit-ownership'));
});

test('incomplete region capture keeps independently resolved text and omits unknown coordinates', () => {
  const rows = [
    region(1, 'header', 'H'),
    { ...region(1, 'footer', 'F'), resolved: false, items: [] },
  ];
  const { doc: parsed, codes } = validScore(document(rows), [nativePage(1, 17, 1)]);

  assert.deepEqual(texts(parsed, 'credit-words'), ['Title', 'H']);
  assert.ok(codes.includes('page-credit-capture'));
  const unsupported = {
    ...region(1, 'header', 'known text'),
    items: [
      {
        ...region(1, 'header', 'known text').items[0]!,
        x: null,
        y: null,
        unsupported: ['rotated stencil'],
      },
    ],
  };
  const partial = validScore(document([unsupported, region(1, 'footer', 'F')]), [
    nativePage(1, 17, 1),
  ]);
  const words = elements(partial.doc, 'credit-words').find(
    (word) => word.textContent === 'known text',
  )!;

  assert.equal(words.hasAttribute('default-x'), false);
  assert.equal(words.hasAttribute('default-y'), false);
  assert.ok(partial.codes.includes('page-credit-transform'));
});

test('captured running templates and rights do not duplicate resolved page credits while title credits remain', () => {
  const doc = document([
    region(1, 'header', 'Actual page header'),
    region(1, 'footer', 'Actual page footer'),
  ]);
  const { doc: parsed } = validScore(doc, [nativePage(1, 17, 1)]);

  assert.deepEqual(texts(parsed, 'credit-words'), [
    'Title',
    'Actual page header',
    'Actual page footer',
  ]);
  assert.ok(!texts(parsed, 'credit-words').includes('ODD RUNNING'));
});
