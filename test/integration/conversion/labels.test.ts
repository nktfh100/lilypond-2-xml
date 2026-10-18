import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { create } from 'xmlbuilder2';
import { insertLabelBookmarks, labelPlans } from '../../../dist/musicxml/layout/labels.js';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { elements as all, parse } from '../../support/xml-support.js';

const converter = createConverter(),
  compiler = createReusableCompiler(),
  reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const anchors = (d: ScoreDocument) => d.events.filter((e) => e.kind === 'label');
const bookmarks = (xml: string) => all(parse(xml), 'bookmark');
const ratio = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const moment = (main: number, denominator = 1, grace = 0) => ({
  main: { numerator: main, denominator },
  grace: { numerator: grace, denominator: 8 },
});
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const source = (
  music = String.raw`\label #'opening c'4 d'4 \label #'middle \label #'alias e'4 f'4 \label #'ending`,
  staff = '',
) =>
  String.raw`\score { \new Staff \with { ${staff} } { ${music} } \layout {} \midi { \tempo 4=120 } }`;
const nextTarget = (bookmark: Element) => {
  let n = bookmark.nextSibling;

  while (n && (n.nodeType !== 1 || ['bookmark', 'link'].includes(n.nodeName))) {
    n = n.nextSibling;
  }

  return n as Element | null;
};
const observer = String.raw`#(define (independent-label-column ctx)
 (let ((seen (make-hash-table))) (make-engraver
  ((stop-translation-timestep engraver)
   (let* ((col (ly:context-property ctx 'currentCommandColumn #f))
          (names (and (ly:grob? col) (ly:grob-property-data col 'labels))))
    (when (and (pair? names) (not (hashq-ref seen col #f)))
     (hashq-set! seen col #t)
     (format #t "INDEPENDENT-LABEL ~s\n" (list (ly:context-current-moment ctx)
      (ly:grob-property-data col 'when) names))))))))
\layout { \context { \Score \consists #independent-label-column } }
`;

function assertMIDI(xml: string, expected: ReturnType<typeof midiTimedNotes>) {
  assert.equal(reader.loadData(xml), 1);
  const played = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
}

test('labels retain passive actual command columns, exact ordered aliases and native sibling targets without ink or playback', async () => {
  const text = source(),
    result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  assert.equal(result.document.labelsCaptured, true);
  const rows = anchors(result.document);

  assert.deepEqual(
    rows.map((r) => [ratio(r.moment.main), ratio(r.columnMoment!.main), r.names]),
    [
      [0, 0, ['opening']],
      [0.5, 0.5, ['alias', 'middle']],
      [1, 1, ['ending']],
    ],
  );
  assert.equal(new Set(rows.map((r) => r.id)).size, 3);
  assert.ok(
    rows.every((r) =>
      result.document.contexts.some((c) => c.id === r.context && c.type === 'Score'),
    ),
  );
  const original = await compiler.compile(text, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(observer + text, {
    format: ['svg', 'midi'],
  });

  assert.deepEqual(file(observed.files, '.svg'), file(original.files, '.svg'));
  assert.deepEqual(
    midiTimedNotes(file(observed.files, '.midi')),
    midiTimedNotes(file(original.files, '.midi')),
  );
  const logs = observed.logs.filter((l) => l.startsWith('INDEPENDENT-LABEL '));

  assert.equal(logs.length, 3);
  assert.ok(logs.some((l) => l.includes('(alias middle)')));
  const native = bookmarks(result.musicxml);

  assert.deepEqual(
    native.map((b) => b.getAttribute('name')),
    ['opening', 'alias', 'middle', 'ending'],
  );
  assert.equal(new Set(native.map((b) => b.getAttribute('id'))).size, 4);
  assert.ok(native.every((b) => /^lp-label-/.test(b.getAttribute('id')!)));
  assert.equal(nextTarget(native[1]!)!.tagName, 'note');
  assert.equal(all(nextTarget(native[1]!)!, 'step')[0]!.textContent, 'E');
  assert.equal(nextTarget(native[2]!), nextTarget(native[1]!));
  assert.equal(nextTarget(native[3]!)!.tagName, 'barline');
  assert.equal(all(parse(result.musicxml), 'link').length, 0);
  assertMIDI(result.musicxml, midiTimedNotes(file(original.files, '.midi')));
  assert.equal(all(parse(reader.getMEI()), 'bookmark').length, 0);
  assert.ok(!reader.renderToSVG(1).includes('lp-label-'));
  assert.ok(!result.diagnostics.some((d) => d.code === 'label-reader'));
  assert.ok(result.diagnostics.some((d) => d.code === 'label-page'));
});

test('labels use exact later-part, grace and figured-bass siblings at their actual full column Moments', async () => {
  const text = String.raw`\score { << \new Staff { c'1 } \new Staff { c'4 \label #'quarter d'4 e'4 f'4 } >> \layout{} \midi{} }`;
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  assert.equal(ratio(anchors(result.document)[0]!.moment.main), 0.25);
  const parts = all(parse(result.musicxml), 'part');

  assert.equal(all(parts[0]!, 'bookmark').length, 0);
  assert.equal(all(parts[1]!, 'bookmark').length, 1);
  assert.equal(all(nextTarget(all(parts[1]!, 'bookmark')[0]!)!, 'step')[0]!.textContent, 'D');
  assert.ok(!result.diagnostics.some((d) => d.code === 'label-anchor'));
  const gapSource = (await converter.convert(source(String.raw`c'4 d'4 \label #'gap e'4 f'4`)))
    .scores[0]!;

  assert.equal(
    ratio(anchors(gapSource.document)[0]!.moment.main),
    0.5,
    'independent actual source column before cache filtering',
  );
  const gapDocument = {
    ...gapSource.document,
    events: gapSource.document.events.filter(
      (e) => !(e.kind === 'note' && [0.25, 0.5].includes(ratio(e.moment.main))),
    ),
  };
  const gap = toMusicXML(gapDocument);

  validate(gap.musicxml);
  const gapBookmark = bookmarks(gap.musicxml)[0]!;

  assert.ok(gapBookmark);
  assert.equal(nextTarget(gapBookmark)!.tagName, 'forward');
  const divisions = Number(all(parse(gap.musicxml), 'divisions')[0]!.textContent);

  assert.deepEqual(
    all(parse(gap.musicxml), 'forward').map(
      (f) => Number(all(f, 'duration')[0]!.textContent) / divisions / 4,
    ),
    [0.25, 0.25],
  );
  assert.equal(all(parse(gap.musicxml), 'note').length, 2);

  for (const [text, name, main, grace, tag, content, independentMoment] of [
    [
      source(String.raw`\grace { c'16 \label #'inner d'16 } e'1`),
      'inner',
      0,
      -1 / 16,
      'note',
      'D',
      '0G-1/16',
    ],
    [
      String.raw`\score { << \new Staff { c'1 } \new FiguredBass \figuremode { <6>4 \label #'figure-point <5>4 <4>4 <3>4 } >> \layout {} \midi { \tempo 4=120 } }`,
      'figure-point',
      0.25,
      0,
      'figured-bass',
      '5',
      '1/4',
    ],
  ] as const) {
    const converted = (await converter.convert(text)).scores[0]!;

    validate(converted.musicxml);
    const row = anchors(converted.document).find((r) => r.names.includes(name))!;

    assert.ok(row);
    assert.deepEqual([ratio(row.moment.main), ratio(row.moment.grace)], [main, grace]);
    assert.deepEqual(row.columnMoment, row.moment);
    assert.deepEqual(row.observedMoment, row.moment);
    const independent = await compiler.compile(observer + text, {
      format: ['svg', 'midi'],
    });

    assert.ok(
      independent.logs.some(
        (l) =>
          l.startsWith('INDEPENDENT-LABEL ') && l.includes(independentMoment) && l.includes(name),
      ),
    );
    const bookmark = bookmarks(converted.musicxml).find((b) => b.getAttribute('name') === name)!;

    assert.ok(bookmark);
    const target = nextTarget(bookmark)!;

    assert.equal(target.tagName, tag);
    assert.equal(all(target, tag === 'note' ? 'step' : 'figure-number')[0]!.textContent, content);

    if (tag === 'note') {
      assert.equal(all(target, 'grace').length, 1);
    }

    const noLabels = toMusicXML({
      ...converted.document,
      events: converted.document.events.filter((e) => e.kind !== 'label'),
    });

    assert.equal(
      all(parse(converted.musicxml), 'note').length,
      all(parse(noLabels.musicxml), 'note').length,
      'bookmarks add no notes, including grace and figure anchor notes',
    );
    assert.equal(
      all(parse(converted.musicxml), 'words').length,
      all(parse(noLabels.musicxml), 'words').length,
    );
    assert.equal(reader.loadData(noLabels.musicxml), 1);
    const baselineMIDI = midiTimedNotes(reader.renderToMIDI());

    assert.equal(reader.loadData(converted.musicxml), 1);
    assert.deepEqual(midiTimedNotes(reader.renderToMIDI()), baselineMIDI);
    assert.ok(!converted.diagnostics.some((d) => d.code === 'label-anchor'));
    assert.ok(midiTimedNotes(file(independent.files, '.midi')).length > 0);
  }
});

test('labels preserve separate duplicate occurrences and unchanged token names without inventing href or page resolution', async () => {
  const text = source(
    String.raw`\label #'same \label #(string->symbol "two  spaces") \label #'日本語 c'2 \label #'same d'2`,
  );
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const native = bookmarks(result.musicxml);

  assert.equal(native.length, 4);
  assert.equal(new Set(native.map((b) => b.getAttribute('id'))).size, 4);
  assert.equal(native.filter((b) => b.getAttribute('name') === 'same').length, 2);
  assert.ok(native.some((b) => b.getAttribute('name') === '日本語'));
  assert.equal(native.filter((b) => !b.hasAttribute('name')).length, 1);
  assert.ok(anchors(result.document).some((r) => r.names.includes('two  spaces')));
  assert.ok(result.diagnostics.some((d) => d.code === 'label-duplicate'));
  assert.ok(result.diagnostics.some((d) => d.code === 'label-name'));
  assert.equal(all(parse(result.musicxml), 'link').length, 0);
});

test('label source reset, skipped typesetting, actual terminal barlines and absent endpoints do not invent anchors', async () => {
  const text =
    source(String.raw`\label #'start c'1 \bar "||" \label #'finish`) +
    source("d'1") +
    source(String.raw`\label #'again e'1`);
  const results = await converter.convert(text);

  assert.equal(anchors(results.scores[0]!.document)[0]!.id, 1);
  assert.equal(anchors(results.scores[2]!.document)[0]!.id, 1);
  assert.equal(anchors(results.scores[1]!.document).length, 0);
  assert.equal(bookmarks(results.scores[1]!.musicxml).length, 0);
  const terminal = bookmarks(results.scores[0]!.musicxml).find(
    (b) => b.getAttribute('name') === 'finish',
  )!;

  assert.ok(terminal);
  assert.equal(nextTarget(terminal)!.tagName, 'barline');
  assert.equal(all(nextTarget(terminal)!, 'bar-style')[0]!.textContent, 'light-light');
  const removed = (
    await converter.convert(
      source(String.raw`c'1 \label #'unanchored`, String.raw`\remove Bar_engraver`),
    )
  ).scores[0]!;

  assert.ok(anchors(removed.document).some((r) => r.names.includes('unanchored')));
  assert.equal(bookmarks(removed.musicxml).length, 0);
  assert.ok(removed.diagnostics.some((d) => d.code === 'label-anchor'));
  const skipped = source(
    String.raw`\label #'start c'4 \set Score.skipTypesetting = ##t \label #'inside d'4 \label #'later e'4 \set Score.skipTypesetting = ##f \label #'resume f'4 \label #'end`,
  );
  const skipResult = (await converter.convert(skipped)).scores[0]!;

  validate(skipResult.musicxml);
  const merged = anchors(skipResult.document).find((r) => r.names.includes('inside'))!;

  assert.ok(merged);
  assert.deepEqual(merged.names, ['resume', 'later', 'inside']);
  assert.equal(ratio(merged.moment.main), 0.75);
  assert.equal(ratio(merged.columnMoment!.main), 0.75);
  assert.equal(ratio(merged.observedMoment.main), 0.75);
  const inside = bookmarks(skipResult.musicxml).find((b) => b.getAttribute('name') === 'inside')!;

  assert.equal(all(nextTarget(inside)!, 'step')[0]!.textContent, 'F');
  const skipBaseline = await compiler.compile(skipped, {
    format: ['svg', 'midi'],
  });
  const skipObserved = await compiler.compile(observer + skipped, {
    format: ['svg', 'midi'],
  });

  assert.deepEqual(file(skipBaseline.files, '.svg'), file(skipObserved.files, '.svg'));
  assert.deepEqual(
    midiTimedNotes(file(skipBaseline.files, '.midi')),
    midiTimedNotes(file(skipObserved.files, '.midi')),
  );
});

test('label cached missing provenance, context, contradictory column and exact grace moments fail explicitly', async () => {
  const result = (await converter.convert(source(String.raw`\label #'one c'4 d'4 e'4 f'4`)))
    .scores[0]!;
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;
  const round = toMusicXML(cached);

  validate(round.musicxml);
  assert.deepEqual(
    bookmarks(round.musicxml).map((b) => Array.from(b.attributes).map((a) => [a.name, a.value])),
    bookmarks(result.musicxml).map((b) => Array.from(b.attributes).map((a) => [a.name, a.value])),
  );
  const mutate = (data: object) =>
    ({
      ...cached,
      events: cached.events.map((e) => (e.kind === 'label' ? { ...e, ...data } : e)),
    }) as ScoreDocument;
  const nbsp = toMusicXML(mutate({ names: ['\u00a0name\u00a0'] }));

  validate(nbsp.musicxml);
  assert.equal(bookmarks(nbsp.musicxml)[0]!.getAttribute('name'), '\u00a0name\u00a0');
  assert.ok(!nbsp.diagnostics.some((d) => d.code === 'label-name'));
  const shiftedObservation = toMusicXML(mutate({ observedMoment: moment(1, 4) }));

  assert.equal(bookmarks(shiftedObservation.musicxml).length, 1);
  assert.ok(shiftedObservation.diagnostics.some((d) => d.code === 'label-timing'));

  for (const [document, code] of [
    [mutate({ columnMoment: null }), 'label-column'],
    [mutate({ observedMoment: null }), 'label-column'],
    [mutate({ columnMoment: moment(1, 4) }), 'label-column'],
    [mutate({ context: -1 }), 'label-context'],
    [{ ...cached, events: [...cached.events, anchors(cached)[0]!] }, 'label-data'],
    [mutate({ moment: moment(1, 8), columnMoment: moment(1, 8) }), 'label-anchor'],
    [mutate({ moment: moment(0, 1, -1), columnMoment: moment(0, 1, -1) }), 'label-anchor'],
  ] as const) {
    const exported = toMusicXML(document);

    assert.equal(bookmarks(exported.musicxml).length, 0);
    assert.ok(
      exported.diagnostics.some((d) => d.code === code),
      code,
    );
  }

  const { labelsCaptured: _captured, ...legacy } = cached;
  const old = toMusicXML(legacy);

  assert.equal(bookmarks(old.musicxml).length, 0);
  assert.ok(old.diagnostics.some((d) => d.code === 'label-history'));
});

test('label insertion follows exact full moments and actual sibling order, rejects fake terminal nodes and avoids ID collisions', async () => {
  const result = (await converter.convert(source(String.raw`\label #'one c'1`))).scores[0]!;
  const codes: string[] = [],
    warn = (code: string) => {
      codes.push(code);
    };
  const [plan] = labelPlans(result.document, warn);

  assert.ok(plan);
  const tree = create().ele('score-partwise'),
    part = tree.ele('part'),
    measure = part.ele('measure');
  const first = measure.ele('note', { id: plan.id }),
    later = measure.ele('direction');

  insertLabelBookmarks(
    [plan],
    [
      { node: later, moment: moment(0, 1, -1) },
      { node: first, moment: moment(0) },
    ],
    warn,
  );
  const native = bookmarks(tree.end());

  assert.equal(native.length, 1);
  assert.equal(native[0]!.getAttribute('id'), `${plan.id}-2`);
  assert.equal(nextTarget(native[0]!)!.getAttribute('id'), plan.id);
  const terminalTree = create().ele('score-partwise').ele('part').ele('measure'),
    note = terminalTree.ele('note');

  insertLabelBookmarks([plan], [{ node: note, moment: moment(0), terminal: true }], warn);
  assert.equal(bookmarks(terminalTree.doc().end()).length, 0);
  assert.ok(codes.includes('label-anchor'));
});
