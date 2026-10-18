import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { type ScoreDocument, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retimedFigureSource } from '../../support/figured-bass-fixtures.js';
import { navigationPlayback } from '../../support/navigation-playback.js';
import { validate } from '../../support/schema.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

test('retimed figured-bass columns anchor to the resolved note without changing source timing', async () => {
  const { scores } = await converter.convert(retimedFigureSource([[6, 1]]));
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    group = elements(xml, 'figured-bass')[0]!;
  let next = group.nextSibling;

  while (next && next.nodeName !== 'note') {
    next = next.nextSibling;
  }

  assert.deepEqual(texts(next, 'step'), ['D']);
  assert.deepEqual(texts(group, 'figure-number'), ['Figure6']);
  const event = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!;

  assert.equal(event.moment.main.numerator, 0);
  assert.equal(event.figures[0]!.column!.main.numerator, 1);
  assert.equal(elements(xml, 'note').length, 2);
  assert.equal(elements(xml, 'measure').length, 2);
  assert.deepEqual(
    navigationPlayback(score.musicxml).map((n) => [n[0], n[3]]),
    [
      ['C', 4],
      ['D', 4],
    ],
  );
});

test('figures from one semantic group split across their actual columns', async () => {
  const { scores } = await converter.convert(retimedFigureSource([[6, 1]], 'c1 d1', '<6+ 4>1'));
  const score = scores[0]!;

  validate(score.musicxml);
  const groups = elements(parse(score.musicxml), 'figured-bass');

  assert.deepEqual(
    groups.map((g) => texts(g, 'figure-number')),
    [['Figure4'], ['Figure6']],
  );
  assert.deepEqual(
    groups.map((g) => {
      let n = g.nextSibling;

      while (n && n.nodeName !== 'note') {
        n = n.nextSibling;
      }

      return texts(n, 'step');
    }),
    [['C'], ['D']],
  );
  assert.equal(score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures.length, 2);
});

test('coincident retimed figure groups omit advancing durations before the final simultaneous group', async () => {
  const { scores } = await converter.convert(retimedFigureSource([[6, 1]], 'c1 d1', '<6>1 <5>1'));
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    groups = elements(xml, 'figured-bass');

  assert.deepEqual(
    groups.map((g) => texts(g, 'figure-number')),
    [['Figure6'], ['Figure5']],
  );
  assert.equal(elements(groups[0], 'duration').length, 0);
  assert.equal(elements(groups[1], 'duration').length, 1);

  for (const g of groups) {
    let n = g.nextSibling;

    while (n && n.nodeName !== 'note') {
      n = n.nextSibling;
    }

    assert.deepEqual(texts(n, 'step'), ['D']);
  }

  assert.equal(elements(xml, 'note').length, 2);
});

test('backward figure columns retain the resolved onset and original semantic events', async () => {
  const { scores } = await converter.convert(retimedFigureSource([[5, 0]], 'c1 d1', '<6>1 <5>1'));
  const score = scores[0]!;

  validate(score.musicxml);
  const groups = elements(parse(score.musicxml), 'figured-bass');

  assert.deepEqual(
    groups.map((g) => texts(g, 'figure-number')),
    [['Figure6'], ['Figure5']],
  );

  for (const g of groups) {
    let n = g.nextSibling;

    while (n && n.nodeName !== 'note') {
      n = n.nextSibling;
    }

    assert.deepEqual(texts(n, 'step'), ['C']);
  }

  assert.equal(
    score.document.events.filter((e) => e.kind === 'figuredBass')[1]!.moment.main.numerator,
    1,
  );
});

test('terminal figured-bass columns use a blank interval under the final note without extending playback', async () => {
  const { scores } = await converter.convert(
    retimedFigureSource([[6, 2]]).replaceAll('currentMusicalColumn', 'currentCommandColumn'),
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    groups = elements(xml, 'figured-bass'),
    divisions = Number(texts(xml, 'divisions')[0]);

  assert.deepEqual(
    groups.map((g) => texts(g, 'figure-number')),
    [[], ['Figure6']],
  );
  assert.equal(Number(texts(groups[0], 'duration')[0]) / divisions, 4);
  assert.equal(elements(groups[1], 'duration').length, 0);
  assert.equal(elements(xml, 'note').length, 2);
  assert.equal(elements(xml, 'measure').length, 2);
  assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-end-column'));
});

test('fractional cached figure columns set exact divisions and retain held-note playback', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c1 } \figures { <6>1 } >>`),
    document = scores[0]!.document;
  const cached = {
    ...document,
    events: document.events.map((e) =>
      e.kind !== 'figuredBass'
        ? e
        : {
            ...e,
            figures: e.figures.map((f) => ({
              ...f,
              column: {
                main: { numerator: 1, denominator: 3 },
                grace: { numerator: 0, denominator: 1 },
              },
            })),
          },
    ),
  };
  const result = toMusicXML(cached);

  validate(result.musicxml);
  const xml = parse(result.musicxml),
    groups = elements(xml, 'figured-bass'),
    divisions = Number(texts(xml, 'divisions')[0]);

  assert.deepEqual(
    groups.map((g) => texts(g, 'figure-number')),
    [[], ['6']],
  );
  assert.equal(Number(texts(groups[0], 'duration')[0]) / divisions, 4 / 3);
  assert.equal(Number(texts(groups[1], 'duration')[0]) / divisions, 8 / 3);
  assert.equal(elements(xml, 'note').length, 1);
  assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-column-timing'));
  assert.deepEqual(
    navigationPlayback(result.musicxml).map((n) => [n[0], n[3]]),
    [['C', 4]],
  );
  assert.equal(
    document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!.column!.main.numerator,
    0,
  );
});

test('overlapping figure durations stop at the next resolved column beneath a held note', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { c1 } \figures { <6>2 <5>2 } >>`,
  );
  const document = {
    ...scores[0]!.document,
    events: scores[0]!.document.events.map((e) =>
      e.kind !== 'figuredBass'
        ? e
        : {
            ...e,
            figures: e.figures.map((f) => ({
              ...f,
              column: {
                main: { numerator: f.number === 6 ? 2 : 3, denominator: 8 },
                grace: { numerator: 0, denominator: 1 },
              },
            })),
          },
    ),
  };
  const result = toMusicXML(document);

  validate(result.musicxml);
  const xml = parse(result.musicxml),
    groups = elements(xml, 'figured-bass'),
    divisions = Number(texts(xml, 'divisions')[0]);

  assert.deepEqual(
    groups.map((g) => texts(g, 'figure-number')),
    [[], ['6'], ['5']],
  );
  assert.deepEqual(
    groups.map((g) => Number(texts(g, 'duration')[0]) / divisions),
    [1, 0.5, 2],
  );
  assert.equal(elements(xml, 'note').length, 1);
  assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-column-timing'));
});

test('figure columns inside source skips receive bounded silent anchors', async () => {
  const { scores } = await converter.convert(retimedFigureSource([[6, '1/4']], 'c4 s4 d2', '<6>4')),
    score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    group = elements(xml, 'figured-bass')[0]!;
  let anchor = group.nextSibling;

  while (anchor && anchor.nodeName !== 'note') {
    anchor = anchor.nextSibling;
  }

  assert.equal(elements(anchor, 'rest').length, 1);
  assert.equal((anchor as Element).getAttribute('print-object'), 'no');
  assert.equal(elements(xml, 'measure').length, 1);
  assert.deepEqual(
    navigationPlayback(score.musicxml).map((n) => [n[0], n[3]]),
    [
      ['C', 1],
      ['D', 2],
    ],
  );
});

test('out-of-range and malformed cached figure columns diagnose fallback without extending the score', async () => {
  const { scores } = await converter.convert(retimedFigureSource([[6, 1]]));

  for (const main of [
    { numerator: 3, denominator: 1 },
    { numerator: -1, denominator: 1 },
    { numerator: 1, denominator: 0 },
    { numerator: 7000000000, denominator: 2000000000 },
  ]) {
    const document = {
      ...scores[0]!.document,
      events: scores[0]!.document.events.map((e) =>
        e.kind !== 'figuredBass'
          ? e
          : {
              ...e,
              figures: e.figures.map((f) => ({
                ...f,
                column: { main, grace: { numerator: 0, denominator: 1 } },
              })),
            },
      ),
    };
    const result = toMusicXML(document);

    validate(result.musicxml);
    const xml = parse(result.musicxml),
      group = elements(xml, 'figured-bass')[0]!;
    let anchor = group.nextSibling;

    while (anchor && anchor.nodeName !== 'note') {
      anchor = anchor.nextSibling;
    }

    assert.deepEqual(texts(anchor, 'step'), ['C']);
    assert.equal(elements(xml, 'note').length, 2);
    assert.equal(elements(xml, 'measure').length, 2);
    assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-column-range'));
  }
});

test('grace figure columns keep the regular main onset with an explicit native anchor limitation', async () => {
  const { scores } = await converter.convert(retimedFigureSource([[6, 1]]));
  const document = {
    ...scores[0]!.document,
    events: scores[0]!.document.events.map((e) =>
      e.kind !== 'figuredBass'
        ? e
        : {
            ...e,
            figures: e.figures.map((f) => ({
              ...f,
              column: {
                main: { numerator: 1, denominator: 1 },
                grace: { numerator: -1, denominator: 8 },
              },
            })),
          },
    ),
  };
  const result = toMusicXML(document);

  validate(result.musicxml);
  const xml = parse(result.musicxml),
    group = elements(xml, 'figured-bass')[0]!;
  let anchor = group.nextSibling;

  while (anchor && anchor.nodeName !== 'note') {
    anchor = anchor.nextSibling;
  }

  assert.deepEqual(texts(anchor, 'step'), ['D']);
  assert.equal(elements(xml, 'note').length, 2);
  assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-grace'));
});

test('unused final musical columns preserve source absence and cannot be exposed by cached hidden overrides', async () => {
  const { scores } = await converter.convert(retimedFigureSource([[6, 2]]));
  const score = scores[0]!;

  validate(score.musicxml);
  const event = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!,
    figure = event.figures[0]!;

  assert.equal(figure.graphic, true);
  assert.equal(figure.column!.main.numerator, 2);
  assert.equal(figure.columnUsed, false);
  assert.equal(figure.hidden, true);
  const xml = parse(score.musicxml);

  assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('print-object'), 'no');
  assert.deepEqual(texts(xml, 'figure-number'), ['6']);
  assert.equal(elements(xml, 'note').length, 2);
  assert.equal(elements(xml, 'measure').length, 2);
  const cached = JSON.parse(JSON.stringify(score.document)) as ScoreDocument;
  const result = toMusicXML({
    ...cached,
    events: cached.events.map((e) =>
      e.kind !== 'figuredBass'
        ? e
        : { ...e, figures: e.figures.map((f) => ({ ...f, hidden: false })) },
    ),
  });

  validate(result.musicxml);
  assert.equal(
    elements(parse(result.musicxml), 'figured-bass')[0]!.getAttribute('print-object'),
    'no',
  );
});

test('cached final figure columns without usage provenance remain explicit diagnosed fallbacks', async () => {
  const { scores } = await converter.convert(retimedFigureSource([[6, 2]]));
  const document = {
    ...scores[0]!.document,
    events: scores[0]!.document.events.map((e) =>
      e.kind !== 'figuredBass'
        ? e
        : {
            ...e,
            figures: e.figures.map(({ columnUsed: _, ...f }) => ({
              ...f,
              hidden: false,
            })),
          },
    ),
  };
  const result = toMusicXML(document);

  validate(result.musicxml);
  const xml = parse(result.musicxml);

  assert.deepEqual(texts(xml, 'figure-number'), ['Figure6']);
  assert.ok(elements(xml, 'figured-bass').every((g) => g.getAttribute('print-object') !== 'no'));
  assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-column-history'));
});
