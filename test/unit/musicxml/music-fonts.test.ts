import assert from 'node:assert/strict';
import { test } from 'node:test';
import { musicFontSize } from '../../../src/musicxml/text/music-fonts.js';

test('music size requires agreement among matching text contexts', () => {
  const fonts = [
    { textPoints: 12, musicPoints: 20 },
    { textPoints: 12 + 5e-8, musicPoints: 20 },
    { textPoints: 14, musicPoints: 24 },
  ] as const;

  assert.equal(musicFontSize(fonts, 12), 20);
  assert.equal(musicFontSize(fonts, 14), 24);
  assert.equal(musicFontSize([...fonts, { textPoints: 12, musicPoints: 21 }], 12), undefined);
  assert.equal(
    musicFontSize([...fonts, { textPoints: 12, musicPoints: 20 + 1e-9 }], 12),
    undefined,
    'music sizes must agree exactly even when text sizes use a tolerance',
  );
});

test('unavailable and unmatched font data have no selected music size', () => {
  for (const fonts of [undefined, null, []]) {
    assert.equal(musicFontSize(fonts, 12), undefined);
  }

  assert.equal(musicFontSize([{ textPoints: 14, musicPoints: 24 }], 12), undefined);
  const fonts = [NaN, Infinity, -Infinity].map((textPoints) => ({
    textPoints,
    musicPoints: 20,
  }));

  assert.equal(musicFontSize(fonts, 12), undefined);

  for (const textPoints of [NaN, Infinity, -Infinity]) {
    assert.equal(musicFontSize([{ textPoints: 12, musicPoints: 20 }], textPoints), undefined);
  }
});

test('text-size tolerance is strict and ignores nonmatching disagreements', () => {
  const fonts = [
    { textPoints: 5e-8, musicPoints: 20 },
    { textPoints: -5e-8, musicPoints: 20 },
    { textPoints: 1e-7, musicPoints: 21 },
    { textPoints: -1e-7, musicPoints: 22 },
  ];

  assert.equal(musicFontSize(fonts, 0), 20);
  assert.equal(musicFontSize(fonts.slice(2), 0), undefined);
});
