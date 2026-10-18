import assert from 'node:assert/strict';
import { test } from 'node:test';
import { create } from 'xmlbuilder2';
import { resolveFigureDisplay } from '../../../src/musicxml/notation/harmony/figured-bass-display.js';
import { writeFigures } from '../../../src/musicxml/notation/harmony/figured-bass.js';
import type { FigureGroup } from '../../../src/musicxml/planning/events.js';
import { add, xmlElement } from '../../../src/musicxml/primitives.js';
import { durationValue, eventTime } from '../../../src/model/time.js';
import type { TextMarkup } from '../../../src/model/document.js';

const moment = {
  main: { numerator: 0, denominator: 1 },
  grace: { numerator: 0, denominator: 1 },
};
const markup = (command: string, ...args: TextMarkup[]): TextMarkup => ({
  command,
  args,
  plain: '',
});

type Figure = FigureGroup['figures'][number];
const figure = (overrides: Partial<Figure> = {}): Figure => ({
  id: 1,
  number: 6,
  alteration: null,
  augmented: true,
  diminished: false,
  augmentedSlash: false,
  bracketStart: false,
  bracketStop: false,
  alterationBracket: false,
  noContinuation: false,
  text: null,
  markup: null,
  row: 0,
  hidden: false,
  implicit: false,
  extendTo: null,
  graphic: true,
  column: moment,
  columnUsed: true,
  fontContext: { reference: 12, attrs: { 'font-size': 12 }, unsupported: [] },
  numberFontContext: {
    reference: 10,
    attrs: { 'font-size': 10, 'font-family': 'serif' },
    unsupported: [],
    encoding: 'latin1',
  },
  display: markup('fontsize-markup', 6, markup('number-markup', '6')),
  ...overrides,
});
const resolve = (f: Figure, custom = false) => {
  const warnings: string[] = [];
  const display = resolveFigureDisplay(f, custom, (code) => warnings.push(code));

  return { display, warnings };
};
const render = (f: Figure, custom = false) => {
  const root = create().ele('measure');
  const group: FigureGroup = {
    kind: 'figuredBass',
    context: 1,
    staff: 1,
    direction: -1,
    duration: { log: 0, dots: 0, scale: { numerator: 1, denominator: 1 } },
    skip: false,
    alterationDirection: -1,
    plusDirection: 1,
    custom,
    moment,
    figures: [f],
  };

  writeFigures(root, [group], {
    at: 0,
    finish: 1,
    extensions: new Map(),
    timing: {
      time: eventTime,
      duration: durationValue,
      tick: (length) => length * 16,
    },
    output: { add, warn: () => {} },
  });

  return xmlElement(root);
};

test('rotated figures retain text and report rotation without adding an invalid native attribute', () => {
  const f = figure({ display: markup('rotate-markup', 45, 'Turn') });
  const { display, warnings } = resolve(f);

  assert.notEqual(display.mode, 'semantic-number');
  assert.ok(warnings.includes('figured-bass-markup'));
  const number = render(f).getElementsByTagName('figure-number')[0]!;

  assert.equal(number.textContent, 'Turn');
  assert.equal(number.getAttribute('rotation'), null);
});

test('numeric font resolution preserves semantic modifiers while custom numeric labels replace them', () => {
  for (const custom of [false, true]) {
    const f = figure();
    const { display } = resolve(f, custom);

    assert.equal(display.mode, custom ? 'formatted-text' : 'semantic-number');
    assert.equal(display.base['font-size'], 20);
    const xml = render(f, custom);
    const number = xml.getElementsByTagName('figure-number')[0]!;

    assert.equal(number.textContent, '6');
    assert.equal(number.getAttribute('font-size'), '20');
    assert.equal(xml.getElementsByTagName('suffix').length, custom ? 0 : 1);
    assert.equal(xml.getElementsByTagName('duration')[0]!.textContent, '16');
  }
});

test('resolved text replaces modifiers, while absent or unsupported custom displays retain event text and modifiers', () => {
  for (const [displayMarkup, expectedMode, warning] of [
    ['Label', 'formatted-text', null],
    [null, 'semantic-text', 'figured-bass-format-history'],
    [markup('musicglyph-markup', 'opaque'), 'semantic-text', 'figured-bass-format'],
    [markup('box-markup', ''), 'semantic-text', 'figured-bass-format'],
  ] as const) {
    const f = figure({ text: 'Event', display: displayMarkup });
    const { display, warnings } = resolve(f, true);

    assert.equal(display.mode, expectedMode);

    if (warning) {
      assert.ok(warnings.includes(warning));
    }

    const xml = render(f, true);

    assert.equal(
      xml.getElementsByTagName('figure-number')[0]!.textContent,
      expectedMode === 'formatted-text' ? 'Label' : 'Event',
    );
    assert.equal(
      xml.getElementsByTagName('suffix').length,
      expectedMode === 'formatted-text' ? 0 : 1,
    );
  }
});

test('mixed numeric sizes retain labels and color without guessing one point size', () => {
  const f = figure({
    color: [1, 0, 0],
    display: markup('concat-markup', [
      markup('number-markup', '6'),
      markup('fontsize-markup', 6, markup('number-markup', '4')),
    ]),
  });
  const { display, warnings } = resolve(f, true);

  assert.equal(display.mode, 'formatted-text');
  assert.ok(warnings.includes('figured-bass-number-font'));
  const number = render(f, true).getElementsByTagName('figure-number')[0]!;

  assert.equal(number.textContent, '64');
  assert.equal(number.hasAttribute('font-size'), false);
  assert.equal(number.getAttribute('color'), '#FF0000');
});

test('suppressed source graphics retain raw event text invisibly without resolving captured formatter styles', () => {
  const f = figure({ graphic: false, text: 'Event' });
  const { display, warnings } = resolve(f, true);

  assert.equal(display.mode, 'semantic-text');
  assert.equal(display.invisible, true);
  assert.deepEqual(warnings, []);
  const xml = render(f, true);

  assert.equal(xml.getElementsByTagName('figured-bass')[0]!.getAttribute('print-object'), 'no');
  const number = xml.getElementsByTagName('figure-number')[0]!;

  assert.equal(number.textContent, 'Event');
  assert.equal(number.getAttribute('color'), '#00000000');
  assert.equal(number.hasAttribute('font-size'), false);
});
