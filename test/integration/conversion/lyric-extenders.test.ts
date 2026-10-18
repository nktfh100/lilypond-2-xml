import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { childElements, elements as all, parse } from '../../support/xml-support.js';

const converter = createConverter(),
  compiler = createReusableCompiler(),
  reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const graphics = (doc: ScoreDocument) => doc.events.filter((e) => e.kind === 'lyricExtender');
const value = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const source = (lyrics = 'ah __', music = "c'4 d'4 e'4 f'4 g'4 a'4 b'4 c''4", config = '') =>
  String.raw`\score { << \new Staff \new Voice = "melody" { \override NoteHead.output-attributes = #'((data-note . "head")) ${music} } \new Lyrics \with { \override LyricExtender.color = #red \override LyricExtender.output-attributes = #'((data-extender . "line")) ${config} } \lyricsto "melody" { ${lyrics} } >> \layout {} \midi { \tempo 4=120 } }`;
const extendsOn = (xml: string) =>
  all(parse(xml), 'note').flatMap((n, i) =>
    all(n, 'extend').map((e) => ({
      index: i,
      type: e.getAttribute('type'),
      color: e.getAttribute('color'),
    })),
  );

function nativeExtendMoments(xml: string) {
  const result: number[] = [];
  let start = 0,
    divisions = 1;

  for (const measure of all(parse(xml), 'measure')) {
    let cursor = 0,
      end = 0;

    for (const node of childElements(measure)) {
      if (node.tagName === 'attributes') {
        divisions = Number(all(node, 'divisions')[0]?.textContent ?? divisions);
      }

      const duration = Number(all(node, 'duration')[0]?.textContent ?? 0) / divisions / 4;

      if (node.tagName === 'backup') {
        cursor -= duration;
      }

      if (node.tagName === 'forward') {
        cursor += duration;
      }

      if (node.tagName === 'note' && !all(node, 'chord').length) {
        if (all(node, 'extend').length) {
          result.push(start + cursor);
        }

        cursor += duration;
        end = Math.max(end, cursor);
      }
    }

    start += end;
  }

  return result;
}

const observer = String.raw`#(define (independent-lyric-print g)
 (let ((stencil (ly:lyric-extender::print g)))
 (when (and (ly:stencil? stencil) (not (ly:stencil-empty? stencil)) (grob::is-live? g))
 (let ((heads (ly:grob-object g 'heads #f)))
  (when (ly:grob-array? heads)
   (for-each (lambda(h)(let* ((col (ly:item-get-column h)) (m (ly:grob-property col 'when)))
    (format #t "INDEPENDENT-LYRIC-HEAD ~a\n" (exact->inexact (ly:moment-main m))))) (ly:grob-array->list heads)))))
 stencil))
\layout { \context { \Lyrics \override LyricExtender.stencil = #independent-lyric-print } }
`;
const independentMoments = (logs: readonly string[]) =>
  [
    ...new Set(
      logs
        .filter((l) => l.startsWith('INDEPENDENT-LYRIC-HEAD '))
        .map((l) => Number(l.split(' ')[1])),
    ),
  ].sort((a, b) => a - b);

function supportedMoments(doc: ScoreDocument) {
  const ids = new Set(
    graphics(doc)
      .filter((g) => !g.hidden)
      .flatMap((g) => [...g.headNotes]),
  );

  return [
    ...new Set(
      doc.events
        .filter((e) => e.kind === 'note')
        .filter((n) => n.noteId !== undefined && ids.has(n.noteId))
        .map((n) => value(n.moment.main)),
    ),
  ].sort((a, b) => a - b);
}

test('early Lyrics completion retains only its actual first NoteHead, not the continuing Voice', async () => {
  const text =
    String.raw`#(define (observed-lyric-color grob) (format #t "LYRIC-COLOR-CALL\n") red)` +
    source('ah __', undefined, String.raw`\override LyricExtender.color = #observed-lyric-color`);
  const converted = await converter.convert(text),
    result = converted.scores[0]!;

  validate(result.musicxml);
  const original = await compiler.compile(observer + text, {
    format: ['svg', 'midi'],
  });
  const calls = (logs: readonly string[]) =>
    logs.filter((l) => l.startsWith('LYRIC-COLOR-CALL')).length;

  assert.ok(calls(original.logs) > 0);
  assert.equal(calls(converted.logs), calls(original.logs));
  const visible = graphics(result.document).filter((g) => !g.hidden);

  assert.equal(visible.length, 1);
  assert.deepEqual(visible[0]!.headNotes, [1]);
  assert.deepEqual(visible[0]!.toNotes, [1]);
  assert.equal(value(visible[0]!.lyricMoment!.main), 0);
  assert.equal(value(visible[0]!.endMoment!.main), 0);
  assert.deepEqual(independentMoments(original.logs), [0]);
  assert.deepEqual(extendsOn(result.musicxml), [{ index: 0, type: null, color: '#FF0000' }]);
  const svg = parse(new TextDecoder().decode(file(original.files, '.svg')));
  const group = all(svg, 'g').find((g) => g.getAttribute('data-extender') === 'line')!;
  const rect = all(group, 'rect')[0]!;

  assert.ok(Number(rect.getAttribute('width')) > 0 && Number(rect.getAttribute('width')) < 2);
  assert.ok(
    visible[0]!.rectangles?.some((b) => b[1] > b[0]),
    'same-head temporal bounds retain nonzero source ink geometry',
  );
  assert.equal(reader.loadData(result.musicxml), 1);
  assert.ok(all(parse(reader.getMEI()), 'syl').some((s) => s.getAttribute('con') === 'u'));
  assert.ok(!result.diagnostics.some((d) => d.code === 'lyric-extender-reader'));
  const played = midiTimedNotes(reader.renderToMIDI()),
    expected = midiTimedNotes(file(original.files, '.midi'));

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
});

test('explicit and automatic extenders retain independently observed support endpoints before the next syllable', async () => {
  for (const lyric of ['ah __ _ _ done', 'ah _ _ done']) {
    const text = source(lyric, undefined, lyric.includes('__') ? '' : 'autoExtenders = ##t'),
      result = (await converter.convert(text)).scores[0]!;

    validate(result.musicxml);
    const original = await compiler.compile(observer + text, { format: 'svg' });

    assert.ok([0, 0.25, 0.5].every((m) => independentMoments(original.logs).includes(m)));
    assert.deepEqual(supportedMoments(result.document), independentMoments(original.logs));
    assert.deepEqual(nativeExtendMoments(result.musicxml), independentMoments(original.logs));
    assert.deepEqual(
      extendsOn(result.musicxml)
        .slice(0, 3)
        .map((e) => [e.index, e.type]),
      [
        [0, 'start'],
        [1, 'continue'],
        [2, 'stop'],
      ],
    );
    assert.ok(
      graphics(result.document).some((g) => !g.hidden && g.autoGenerated === !lyric.includes('__')),
    );
    reader.loadData(result.musicxml);
    const native = parse(reader.getMEI());

    assert.ok(all(native, 'syl').some((s) => s.textContent === 'done'));
  }
});

test('removed, hidden, omitted and custom source extenders do not invent a default visible underline', async () => {
  for (const config of [
    String.raw`\remove Extender_engraver`,
    String.raw`\override LyricExtender.transparent = ##t`,
    String.raw`\omit LyricExtender`,
    String.raw`\override LyricExtender.stencil = #(lambda(g)(ly:lyric-extender::print g))`,
  ]) {
    const text = source('ah __ _ _ done', undefined, config),
      result = (await converter.convert(text)).scores[0]!;

    validate(result.musicxml);
    assert.equal(extendsOn(result.musicxml).length, 0);
    assert.ok(all(parse(result.musicxml), 'text').some((e) => e.textContent === 'ah'));
    const original = await compiler.compile(text, { format: 'svg' });
    const svg = parse(new TextDecoder().decode(file(original.files, '.svg')));
    const ink = all(svg, 'g')
      .filter((g) => g.getAttribute('data-extender') === 'line')
      .flatMap((g) => all(g, 'rect'));

    if (config.includes('lambda')) {
      assert.ok(ink.length);
      assert.ok(result.diagnostics.some((d) => d.code === 'lyric-extender-stencil'));
    } else {
      assert.equal(ink.length, 0);
    }
  }
});

test('lyric extenders retain actual rests, ties and broken-system supports instead of interval guesses', async () => {
  for (const [music, lyric] of [
    ["c'4 r4 d'4 e'4 f'4 g'4 a'4 b'4", 'ah __'],
    ["c'4~c'4 d'4 e'4 f'4 g'4 a'4 b'4", 'ah __ _ _ done'],
    [String.raw`c'1 \break d'1 e'1 f'1`, 'ah __ _ _ done'],
  ] as const) {
    const text = source(lyric, music),
      result = (await converter.convert(text)).scores[0]!;

    validate(result.musicxml);
    const original = await compiler.compile(observer + text, { format: 'svg' });

    assert.deepEqual(supportedMoments(result.document), independentMoments(original.logs));
    assert.deepEqual(nativeExtendMoments(result.musicxml), independentMoments(original.logs));

    if (music.includes('break')) {
      assert.ok(graphics(result.document).some((g) => g.piece > 1));
    }
  }
});

test('simultaneous Lyrics verses and source voices keep their actual owners and score reset', async () => {
  const text = String.raw`\score { << \new Staff << \new Voice = "upper" { \voiceOne c'4 d'4 e'4 f'4 } \new Voice = "lower" { \voiceTwo c4 d4 e4 f4 } >> \new Lyrics \lyricsto "upper" { ah __ } \new Lyrics \lyricsto "lower" { low __ _ _ end } >> \layout{} }`;
  const scores = (await converter.convert(text + source('plain', "c'1"))).scores;

  validate(scores[0]!.musicxml);
  const visible = graphics(scores[0]!.document).filter((g) => !g.hidden);

  assert.equal(new Set(visible.map((g) => g.voice)).size, 2);
  assert.equal(new Set(visible.map((g) => g.verse)).size, 2);
  assert.equal(extendsOn(scores[0]!.musicxml).length, 4);
  assert.equal(extendsOn(scores[1]!.musicxml).length, 0);
  const tabText = String.raw`\score { << \new TabStaff \new TabVoice = "tabvoice" { c'4 d'4 e'4 f'4 } \new Lyrics \lyricsto "tabvoice" { tab __ _ _ end } >> \layout {} }`;
  const tab = (await converter.convert(tabText)).scores[0]!;

  validate(tab.musicxml);
  const original = await compiler.compile(observer + tabText, {
    format: 'svg',
  });

  assert.deepEqual(independentMoments(original.logs), [0, 0.25, 0.5]);
  assert.ok(graphics(tab.document).some((g) => !g.hidden && g.rightKind === 'TabNoteHead'));
  assert.deepEqual(nativeExtendMoments(tab.musicxml), independentMoments(original.logs));
});

test('lyric-extender caches, missing owners, filtered notes and legacy history fail explicitly', async () => {
  const result = (await converter.convert(source('ah __ _ _ done'))).scores[0]!;
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;

  assert.deepEqual(extendsOn(toMusicXML(cached).musicxml), extendsOn(result.musicxml));

  for (const change of [
    'null-head',
    'unknown-voice',
    'null-syllable',
    'missing-lyric',
    'filtered-note',
    'grace',
    'outside-piece',
    'wrong-terminal-moment',
    'missing-terminal',
    'null-terminal',
    'null-bound',
  ] as const) {
    const doc: ScoreDocument = {
      ...cached,
      events: cached.events.flatMap<ScoreDocument['events'][number]>((e) => {
        if (change === 'filtered-note' && e.kind === 'note' && e.noteId === 2) {
          return [];
        }

        if (change === 'grace' && e.kind === 'note' && e.noteId === 2) {
          return [
            {
              ...e,
              moment: {
                ...e.moment,
                grace: { numerator: -1, denominator: 16 },
              },
            },
          ];
        }

        if (change === 'null-syllable' && e.kind === 'lyric') {
          return [{ ...e, voice: null }];
        }

        if (e.kind !== 'lyricExtender') {
          return [e];
        }

        return [
          {
            ...e,
            ...(change === 'null-head' ? { headNotes: [...e.headNotes, null] } : {}),
            ...(change === 'outside-piece' ? { headNotes: [...e.headNotes, 4] } : {}),
            ...(change === 'wrong-terminal-moment'
              ? {
                  endMoment: {
                    main: { numerator: 3, denominator: 4 },
                    grace: { numerator: 0, denominator: 1 },
                  },
                }
              : {}),
            ...(change === 'missing-terminal' ? { toNotes: [] } : {}),
            ...(change === 'null-terminal' ? { toNotes: [null] } : {}),
            ...(change === 'null-bound' ? { rightKind: null } : {}),
            ...(change === 'unknown-voice' ? { voice: null } : {}),
            ...(change === 'missing-lyric' ? { lyricMoment: null } : {}),
          },
        ];
      }),
    };
    const invalid = toMusicXML(doc);

    assert.equal(extendsOn(invalid.musicxml).length, 0, change);
    assert.ok(
      invalid.diagnostics.some((d) => d.code.startsWith('lyric-extender-')),
      change,
    );
  }

  const { lyricExtendersCaptured, ...legacy } = cached;
  const fallback = toMusicXML({
    ...legacy,
    events: legacy.events.filter((e) => e.kind !== 'lyricExtender'),
  });

  assert.ok(fallback.diagnostics.some((d) => d.code === 'lyric-extender-history'));
  const auto = (await converter.convert(source('ah _ _ done', undefined, 'autoExtenders = ##t')))
    .scores[0]!.document;

  assert.ok(!auto.events.some((e) => e.kind === 'lyric' && e.class === 'extender-event'));
  const { lyricExtendersCaptured: captured, ...autoLegacy } = auto;

  assert.ok(toMusicXML(autoLegacy).diagnostics.some((d) => d.code === 'lyric-extender-history'));
});

test('failed final extender capture does not fabricate score-end completion and later scores recover', async () => {
  const text = source(
    'ah __',
    undefined,
    String.raw`\override LyricExtender.after-line-breaking = #(lambda(g)(error "lyric-final"))`,
  );
  const scores = (await converter.convert(text + source())).scores;

  assert.equal(graphics(scores[0]!.document).length, 0);
  assert.equal(extendsOn(scores[0]!.musicxml).length, 0);
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'lyric-extender-capture'));
  assert.equal(extendsOn(scores[1]!.musicxml).length, 1);
});
