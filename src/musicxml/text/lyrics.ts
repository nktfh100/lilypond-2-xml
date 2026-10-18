import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add, Attributes } from '../types.js';
import type { Warn } from '../../model/diagnostics.js';
import { textRuns, visibleText } from './runs.js';

export type WrittenLyric = {
  verse: number;
  text?: string | undefined;
  markup?: import('../../model/document.js').TextMarkup;
  syllabic?: string | undefined;
  extend?: string | undefined;
  extendAttrs?: Attributes | undefined;
};

export function lyricHasText(text: string | undefined, markup: WrittenLyric['markup']) {
  return textRuns(markup ?? text ?? '', {}, () => {}).some((run) => run.text.trim());
}

const supported = new Set([
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'color',
  'underline',
  'overline',
  'line-through',
  'rotation',
  'letter-spacing',
  'xml:lang',
  'dir',
]);

export function writeLyric(note: XMLBuilder, lyric: WrittenLyric, add: Add, warn: Warn) {
  const runs = lyric.text !== undefined ? textRuns(lyric.markup ?? lyric.text, {}, warn) : [];
  const isolated = lyric.syllabic === 'single' && !lyric.extend;
  const color =
    isolated && runs.length && runs.every((r) => r.attrs.color === runs[0]!.attrs.color)
      ? runs[0]!.attrs.color
      : undefined;
  const l = add(note, 'lyric', undefined, {
    number: lyric.verse,
    color,
    ...(isolated && runs.length && !visibleText(runs) ? { 'print-object': 'no' } : {}),
  });

  if (lyric.text !== undefined) {
    add(l, 'syllabic', lyric.syllabic);

    for (const run of runs.length ? runs : [{ text: lyric.text, attrs: {} }]) {
      const attrs = Object.fromEntries(
        Object.entries(run.attrs).filter(([key]) => supported.has(key)),
      );

      if (Object.keys(run.attrs).some((key) => !supported.has(key))) {
        warn(
          'lyric-markup-layout',
          'Lyric enclosures and markup alignment have no per-fragment native field; text and supported font/color styles remain native.',
        );
      }

      add(l, 'text', run.text, attrs);
    }
  }

  if (lyric.extend) {
    add(l, 'extend', undefined, {
      ...lyric.extendAttrs,
      ...(lyric.extend === 'single' ? {} : { type: lyric.extend }),
    });
  }
}
