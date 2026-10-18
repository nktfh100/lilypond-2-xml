import { expect, test } from '@playwright/test';
import { toMusicXML, type ScoreDocument } from 'lilypond-2-xml';
import { elements, parse } from '../support/xml-support.js';

test('browser normal books exclude MIDI-only page geometry and restore score ownership after callback failures', async ({
  page,
}) => {
  await page.goto('/test/browser/browser.html');
  await page.waitForFunction(() => window.lilypond);
  const result = await page.evaluate(async () => {
    const converter = window.lilypond.createConverter();

    try {
      const converted = await converter.convert(String.raw`
#(define (normal-browser-post paper pages) (format #t "NORMAL-BROWSER-PAGES ~a\n" (length pages)))
#(define (normal-browser-after grob) (format #t "NORMAL-BROWSER-AFTER\n") #t)
\paper { paper-width=180\mm paper-height=280\mm page-post-process=#normal-browser-post }
\layout { \context { \Voice \override NoteHead.after-line-breaking=#normal-browser-after } }
\book { \header { title="Browser normal book" tagline=##f }
 \score { \header { piece="MidiOnly" } \new Staff="same" { c'1\p } \midi { \tempo 4=80 } }
 \score { \header { piece="First printed" } \new Staff="same" { d'1\f } \layout{} \midi { \tempo 4=120 } }
 \score { \header { piece="Second printed" } \new Staff="same" { e'1\mp } \layout{} \midi { \tempo 4=90 } }
}`);
      const summarize = (score: (typeof converted.scores)[number]) => {
        const xml = new DOMParser().parseFromString(score.musicxml, 'application/xml');

        return {
          layoutRequested: score.document.layoutRequested,
          stage: score.document.events.find((event) => event.kind === 'finalLayout'),
          piece: score.document.header.piece,
          bookStart: score.document.headerScopes?.bookStart,
          notes: score.document.events
            .filter((event) => event.kind === 'note')
            .map((event) => ({ id: event.noteId, staff: event.staff })),
          heads: score.document.events.filter((event) => event.kind === 'notePosition'),
          diagnostics: score.diagnostics.map((diagnostic) => diagnostic.code),
          native: {
            parts: xml.querySelectorAll('part').length,
            measures: xml.querySelectorAll('measure').length,
            images: xml.querySelectorAll('image').length,
            errors: xml.querySelectorAll('parsererror').length,
            notes: [...xml.querySelectorAll('note')].map((note) => ({
              step: note.querySelector('step')?.textContent ?? null,
              octave: note.querySelector('octave')?.textContent ?? null,
              x: note.getAttribute('default-x'),
              y: note.getAttribute('default-y'),
              dynamics: note.getAttribute('dynamics'),
            })),
          },
          json: JSON.stringify(score.document),
        };
      };
      let failure: { message: string; calls: number } | null = null;

      try {
        await converter.convert(String.raw`
#(define (normal-browser-fail paper pages) (format #t "NORMAL-BROWSER-FAIL\n") (error "normal-browser-page-failed"))
\paper { page-post-process=#normal-browser-fail }
\score { { f'1 } \layout{} \midi{} }`);
      } catch (error) {
        const source = error as Error & { logs?: string[] };

        failure = {
          message: source.message,
          calls: source.logs?.filter((line) => line.startsWith('NORMAL-BROWSER-FAIL')).length ?? 0,
        };
      }

      const recovered = (
        await converter.convert(String.raw`\score { \new Staff="same" { g'1 } \layout{} \midi{} }`)
      ).scores[0]!;

      return {
        scores: converted.scores.map(summarize),
        pageCalls: converted.logs.filter((line) => line.startsWith('NORMAL-BROWSER-PAGES')),
        afterCalls: converted.logs.filter((line) => line.startsWith('NORMAL-BROWSER-AFTER')).length,
        failure,
        recovered: summarize(recovered),
      };
    } finally {
      converter.dispose();
    }
  });

  expect(result.pageCalls).toEqual(['NORMAL-BROWSER-PAGES 1']);
  expect(result.afterCalls).toBe(2);
  expect(result.scores.map((score) => score.layoutRequested)).toEqual([true, true]);
  expect(result.scores.map((score) => score.stage?.status)).toEqual(['complete', 'complete']);
  expect(result.scores.map((score) => score.piece)).toEqual(['First printed', 'Second printed']);
  expect(result.scores[0]!.bookStart).toBe(true);
  expect(result.scores[1]!.bookStart).toBe(false);

  for (const score of result.scores) {
    expect(score.heads).toHaveLength(1);
    expect(score.heads[0]!.custom).toBe(true);
    expect(score.heads[0]!.xTenths).not.toBeNull();
    expect(score.heads[0]!.yTenths).not.toBeNull();
    expect(score.native.notes[0]!.x).toBeNull();
    expect(score.native.notes[0]!.y).toBeNull();
    expect(score.diagnostics).toContain('note-position-stencil');
  }

  for (const score of [...result.scores, result.recovered]) {
    expect(score.notes.map((note) => note.id)).toEqual([1]);
    expect(score.native).toMatchObject({
      parts: 1,
      measures: 1,
      images: 0,
      errors: 0,
    });
    const cached = toMusicXML(JSON.parse(score.json) as ScoreDocument);
    const xml = parse(cached.musicxml);

    expect(
      elements(xml, 'note').map((note) => ({
        step: note.getElementsByTagName('step')[0]?.textContent ?? null,
        octave: note.getElementsByTagName('octave')[0]?.textContent ?? null,
        x: note.getAttribute('default-x'),
        y: note.getAttribute('default-y'),
        dynamics: note.getAttribute('dynamics'),
      })),
    ).toEqual(score.native.notes);
    expect(xml.getElementsByTagName('image')).toHaveLength(0);
  }

  expect(result.failure?.message).toContain('normal-browser-page-failed');
  expect(result.failure?.calls).toBe(1);
  expect(result.recovered).toMatchObject({
    layoutRequested: true,
    stage: { status: 'complete' },
  });
  expect(result.recovered.native.notes[0]).toMatchObject({
    step: 'G',
    octave: '4',
  });
  expect(result.recovered.heads[0]!.custom).toBe(false);
  expect(result.recovered.native.notes[0]!.x).not.toBeNull();
  expect(result.recovered.native.notes[0]!.y).not.toBeNull();
});
