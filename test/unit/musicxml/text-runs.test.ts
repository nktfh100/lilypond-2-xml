import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TextMarkup } from '../../../src/model/document.js';
import { textRuns } from '../../../src/musicxml/text/runs.js';

const markup = (command: string, ...args: TextMarkup[]): TextMarkup => ({
  command,
  args,
  plain: '',
});

test('equivalent nested styles retain bold and italic formatting inside one enclosure', () => {
  const warnings: string[] = [];
  const runs = textRuns(
    markup(
      'box-markup',
      markup('concat-markup', [
        markup('bold-markup', markup('italic-markup', 'a')),
        markup('italic-markup', markup('bold-markup', 'b')),
      ]),
    ),
    {},
    (code) => warnings.push(code),
  );

  assert.deepEqual(runs, [
    {
      text: 'ab',
      attrs: {
        enclosure: 'rectangle',
        'font-weight': 'bold',
        'font-style': 'italic',
      },
    },
  ]);
  assert.deepEqual(warnings, []);
});

test('equivalent adjacent styles merge independently of property order', () => {
  const runs = textRuns(
    markup('concat-markup', [
      markup('bold-markup', markup('italic-markup', 'a')),
      markup('italic-markup', markup('bold-markup', 'b')),
    ]),
    {},
    () => assert.fail('Equivalent styles must not warn'),
  );

  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.text, 'ab');
  assert.equal(runs[0]!.attrs['font-weight'], 'bold');
  assert.equal(runs[0]!.attrs['font-style'], 'italic');
});

test('different enclosed styles still report the native uniform-formatting limit', () => {
  const warnings: string[] = [];
  const runs = textRuns(
    markup(
      'box-markup',
      markup('concat-markup', [markup('bold-markup', 'a'), markup('italic-markup', 'b')]),
    ),
    {},
    (code) => warnings.push(code),
  );

  assert.deepEqual(runs, [{ text: 'ab', attrs: { enclosure: 'rectangle' } }]);
  assert.deepEqual(warnings, ['markup-enclosure']);
});

test('rotation reverses LilyPond angles and preserves nested text styles', () => {
  const runs = textRuns(
    markup('rotate-markup', 45, markup('bold-markup', markup('italic-markup', 'Turn'))),
    {},
    () => assert.fail('A supported rotation must not warn'),
  );

  assert.deepEqual(runs, [
    { text: 'Turn', attrs: { rotation: -45, 'font-weight': 'bold', 'font-style': 'italic' } },
  ]);
});

test('nested rotations add angles and leave adjacent unrotated text unchanged', () => {
  const runs = textRuns(
    markup('concat-markup', [
      markup('rotate-markup', 30, markup('rotate-markup', -75, 'Turn')),
      'Straight',
    ]),
    {},
    () => assert.fail('Supported rotations must not warn'),
  );

  assert.deepEqual(runs, [
    { text: 'Turn', attrs: { rotation: 45 } },
    { text: 'Straight', attrs: {} },
  ]);
});

test('rotations wrap whole turns into the MusicXML range without rounding fractional angles', () => {
  for (const [angle, expected] of [
    [0, 0],
    [360, 0],
    [180, -180],
    [-180, 180],
    [270, 90],
    [-450, 90],
    ['1/2', -0.5],
    [1e-12, -1e-12],
  ] as const) {
    const runs = textRuns(markup('rotate-markup', angle, 'Turn'), {}, () => {});

    assert.equal(runs[0]!.attrs.rotation, expected);
  }
});

test('unresolved rotation angles preserve child styles and diagnose the missing angle', () => {
  for (const angle of [null, 'unresolved', Infinity, NaN]) {
    const warnings: string[] = [];
    const runs = textRuns(
      markup('rotate-markup', angle, markup('bold-markup', 'Turn')),
      {},
      (code) => warnings.push(code),
    );

    assert.deepEqual(runs, [{ text: 'Turn', attrs: { 'font-weight': 'bold' } }]);
    assert.deepEqual(warnings, ['markup-rotation']);
  }
});

test('rotated mixed styles retain their angles and diagnose composite layout only for nonzero turns', () => {
  for (const angle of [45, 360]) {
    const warnings: string[] = [];
    const runs = textRuns(
      markup('rotate-markup', angle, [markup('bold-markup', 'First'), 'Second']),
      {},
      (code) => warnings.push(code),
    );

    assert.equal(runs.length, 2);
    assert.equal(runs[0]!.attrs['font-weight'], 'bold');
    assert.ok(runs.every((run) => run.attrs.rotation === (angle === 45 ? -45 : 0)));
    assert.deepEqual(warnings, angle === 45 ? ['markup-rotation-layout'] : []);
  }
});
