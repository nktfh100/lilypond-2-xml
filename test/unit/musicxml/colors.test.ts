import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isTransparentColor,
  markupColor,
  musicXMLColor,
} from '../../../src/musicxml/notation/colors.js';
import { transparentText, visibleText, type TextRun } from '../../../src/musicxml/text/runs.js';

test('source RGBA components become native ARGB with canonical opaque and invisible forms', () => {
  const rows: readonly (readonly [readonly number[], string])[] = [
    [[1, 0, 0], '#FF0000'],
    [[0, 0, 1], '#0000FF'],
    [[1, 0, 0, 1], '#FF0000'],
    [[1, 0, 0, 0.5], '#80FF0000'],
    [[0, 0, 1, 0.5], '#800000FF'],
    [[1, 0, 0, 0], '#00000000'],
    [[0, 0, 1, 0], '#00000000'],
    [[0.2, 0.4, 0.6, 0.25], '#40336699'],
  ];

  for (const [rgba, native] of rows) {
    const before = [...rgba];

    assert.equal(musicXMLColor(rgba), native);
    assert.deepEqual(rgba, before);
  }
});

test('source CSS short and long RGBA hex strings are parsed before native ARGB encoding', () => {
  for (const [input, native] of [
    ['#f008', '#88FF0000'],
    ['#00f8', '#880000FF'],
    ['#ff000080', '#80FF0000'],
    ['#0000ff80', '#800000FF'],
    ['#ff0000ff', '#FF0000'],
    ['#0000ff00', '#00000000'],
    ['#aBcD', '#DDAABBCC'],
    ['#f00', '#FF0000'],
    ['dark slate blue', '#483D8B'],
  ]) {
    assert.equal(markupColor(input), native, input);
  }

  assert.equal(
    markupColor('#80FF0000'),
    '#00000000',
    'a source CSS string never masquerades as an already-native ARGB string',
  );
  assert.equal(markupColor([1, 0, 0, '1/2']), '#80FF0000');
});

test('native alpha visibility uses the first byte and rejects malformed colors', () => {
  assert.equal(isTransparentColor('#001122FF'), true);
  assert.equal(isTransparentColor('#AA112200'), false);
  assert.equal(isTransparentColor('#000000'), false);
  assert.equal(isTransparentColor('#00ff0000'), true);

  for (const value of [
    [],
    [1, 0],
    [1, 0, 0, 0, 0],
    [NaN, 0, 0],
    [Infinity, 0, 0],
    [1.1, 0, 0],
    [-0.1, 0, 0],
    new Array(3),
  ]) {
    assert.equal(musicXMLColor(value), undefined);
  }

  for (const value of ['#12', '#zzzzzz', [1, 0, 'oops'], null]) {
    assert.equal(markupColor(value), undefined);
  }
});

test('native text visibility and forced hidden text retain content/styles without mutating source runs', () => {
  const runs: TextRun[] = [
    {
      text: 'blue-transparent',
      attrs: { color: '#000000FF', 'font-weight': 'bold' },
    },
    { text: 'red-half', attrs: { color: '#80FF0000' } },
  ];

  assert.equal(visibleText([runs[0]!]), false);
  assert.equal(visibleText([runs[1]!]), true);
  const before = JSON.stringify(runs),
    hidden: TextRun[] = transparentText(runs);

  assert.equal(visibleText(hidden), false);
  assert.deepEqual(
    hidden.map((r) => r.text),
    runs.map((r) => r.text),
  );
  assert.ok(hidden.every((r) => r.attrs.color === '#00000000'));
  assert.equal(hidden[0]!.attrs['font-weight'], 'bold');
  assert.equal(JSON.stringify(runs), before);
  assert.equal(visibleText([{ text: 'opaque-black', attrs: { color: '#000000' } }]), true);
});
