import { expect, test } from '@playwright/test';

test('published browser assets compile without a backend', async ({ page }) => {
  const errors: string[] = [];

  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/test/browser/browser.html');
  await page.waitForFunction(() => window.lilypond);
  const result = await page.evaluate(async () => {
    const source = String.raw`\version "2.26.0" \include "melody.ily" \score { \relative c' { \melody } }`;
    const result = await window.lilypond.convert(source, {
      files: { 'melody.ily': 'melody = { c4 d e f }' },
    });
    const xml = new DOMParser().parseFromString(result.scores[0]!.musicxml, 'application/xml');

    return {
      pitches: [...xml.querySelectorAll('pitch > step')].map((e) => e.textContent),
      parseErrors: xml.querySelectorAll('parsererror').length,
    };
  });

  expect(result).toEqual({ pitches: ['C', 'D', 'E', 'F'], parseErrors: 0 });
  expect(errors).toEqual([]);
});
