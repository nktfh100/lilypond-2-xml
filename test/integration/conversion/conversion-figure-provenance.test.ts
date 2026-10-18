import { type ScoreDocument, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lateFigureSource } from '../../support/figured-bass-fixtures.js';
import { validate } from '../../support/schema.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

test('removed figured-bass engravers retain native semantics invisibly with explicit absent-graphics provenance', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { c1 } \new FiguredBass \with { \remove Figured_bass_engraver } \figuremode { <\markup "Ghost" 6+>1 } >>`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    groups = elements(xml, 'figured-bass');

  assert.deepEqual(texts(xml, 'figure-number'), ['Ghost', '6']);
  assert.deepEqual(texts(xml, 'prefix'), ['sharp']);
  assert.ok(groups.every((g) => g.getAttribute('print-object') === 'no'));
  assert.ok(elements(xml, 'figure-number').every((n) => n.getAttribute('color') === '#00000000'));
  assert.equal(elements(xml, 'prefix')[0]!.getAttribute('color'), '#00000000');
  const figures = score.document.events
    .filter((e) => e.kind === 'figuredBass')
    .flatMap((e) => e.figures);

  assert.ok(figures.every((f) => f.graphic === false && f.hidden && f.display === undefined));
  assert.ok(
    !score.diagnostics.some((d) =>
      [
        'figured-bass-style-history',
        'figured-bass-format-history',
        'figured-bass-graphics-history',
      ].includes(d.code),
    ),
  );
  const document = {
    ...scores[0]!.document,
    events: scores[0]!.document.events.map((e) =>
      e.kind !== 'figuredBass'
        ? e
        : {
            ...e,
            figures: e.figures.map(({ graphic: _, ...f }) => ({
              ...f,
              hidden: false,
            })),
          },
    ),
  };
  const result = toMusicXML(document);

  validate(result.musicxml);
  const legacyXml = parse(result.musicxml);

  assert.deepEqual(texts(legacyXml, 'figure-number'), ['Ghost', '6']);
  assert.equal(elements(legacyXml, 'figured-bass')[0]!.getAttribute('print-object'), null);
  assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-graphics-history'));
  const cached = JSON.parse(
    JSON.stringify(scores[0]!.document),
  ) as import('lilypond-2-xml').ScoreDocument;
  const replay = toMusicXML({
    ...cached,
    events: cached.events.map((e) =>
      e.kind !== 'figuredBass'
        ? e
        : { ...e, figures: e.figures.map((f) => ({ ...f, hidden: false })) },
    ),
  });

  validate(replay.musicxml);
  const replayXml = parse(replay.musicxml);

  assert.equal(elements(replayXml, 'figured-bass')[0]!.getAttribute('print-object'), 'no');
  assert.equal(elements(replayXml, 'figure-number')[0]!.getAttribute('color'), '#00000000');
});

test('absent figured-bass graphics do not evaluate unused formatters or diagnose unprinted markup', async () => {
  const { scores } =
    await converter.convert(String.raw`\new Staff \with { \remove Figured_bass_engraver } << { c1 } \figuremode {
    \set figuredBassFormatter = #(lambda (figure event context) (ly:error "unused formatter ran")) <\markup \rotate #30 "Ghost" [6\+]>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.ok(
    elements(parse(score.musicxml), 'figured-bass').every(
      (n) => n.getAttribute('print-object') === 'no',
    ),
  );
  assert.ok(
    !score.diagnostics.some((d) =>
      [
        'markup-command',
        'figured-bass-format-history',
        'figured-bass-style-history',
        'figured-bass-graphics-history',
        'figured-bass-bracket',
        'figured-bass-modifier',
      ].includes(d.code),
    ),
  );
});

test('restoring the standard figured-bass engraver preserves visible labels and positive graphics provenance', async () => {
  const { scores } = await converter.convert(
    String.raw`\new Staff \with { \remove Figured_bass_engraver \consists Figured_bass_engraver } << { c1 } \figuremode { <\markup "Visible" 6+>1 } >>`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.deepEqual(texts(xml, 'figure-number'), ['Visible', '6']);
  assert.ok(elements(xml, 'figured-bass').every((n) => n.getAttribute('print-object') === null));
  assert.ok(
    score.document.events
      .filter((e) => e.kind === 'figuredBass')
      .flatMap((e) => e.figures)
      .every((f) => f.graphic === true && !f.hidden),
  );
});

test('custom replacement figured-bass engravers preserve actual textual grobs even without row ownership', async () => {
  const { scores } =
    await converter.convert(String.raw`\new Staff \with { \remove Figured_bass_engraver
    \consists #(lambda (ctx) (make-engraver (listeners ((bass-figure-event engraver event)
      (let ((grob (ly:engraver-make-grob engraver 'BassFigure event)))
        (ly:grob-set-property! grob 'text (markup #:with-color blue #:bold "Replacement"))))))) }
    << { c1 } \figuremode { <6+>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    number = elements(xml, 'figure-number')[0]!;

  assert.equal(number.textContent, 'Replacement');
  assert.equal(number.getAttribute('font-weight'), 'bold');
  assert.equal(number.getAttribute('color'), '#0000FF');
  assert.equal(elements(xml, 'prefix').length, 0);
  const f = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!;

  assert.equal(f.graphic, true);
  assert.equal(f.row, null);
  assert.equal(f.number, 6);
  assert.ok(f.display);
});

test('unowned replacement figured-bass graphics retain an explicit unknown state instead of false absence', async () => {
  const { scores } =
    await converter.convert(String.raw`\new Staff \with { \remove Figured_bass_engraver
    \consists #(lambda (ctx) (make-engraver (listeners ((bass-figure-event engraver event)
      (let ((grob (ly:engraver-make-grob engraver 'BassFigure '())))
        (ly:grob-set-property! grob 'text "Unowned")))))) }
    << { c1 } \figuremode { <6+>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.equal(
    score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!.graphic,
    undefined,
  );
  assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('print-object'), null);
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-graphics-history'));
});

test('omitted figured-bass text still has positive provenance and preserves independently visible continuations', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { c4 d e f } \figures { \omit BassFigure \bassFigureExtendersOn <6 4>4 <6 3> <7 3> <7 3> } >>`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.ok(
    score.document.events
      .filter((e) => e.kind === 'figuredBass')
      .flatMap((e) => e.figures)
      .every((f) => f.graphic === true && f.hidden),
  );
  assert.equal(elements(xml, 'extend').length, 7);
  assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('print-object'), null);
});

test('figured-bass graphics presence does not leak between separate scores', async () => {
  const { scores } =
    await converter.convert(String.raw`\score { << \new Staff { c1 } \new FiguredBass \with { \remove Figured_bass_engraver } \figuremode { <6+>1 } >> }
    \score { << \new Staff { d1 } \figures { <5->1 } >> }`);

  for (const s of scores) {
    validate(s.musicxml);
  }

  assert.deepEqual(
    scores.map(
      (s) => s.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!.graphic,
    ),
    [false, true],
  );
  assert.equal(
    elements(parse(scores[0]!.musicxml), 'figured-bass')[0]!.getAttribute('print-object'),
    'no',
  );
  assert.equal(
    elements(parse(scores[1]!.musicxml), 'figured-bass')[0]!.getAttribute('print-object'),
    null,
  );
});

test('late figured-bass graphics retain object provenance but suppress unattached source text', async () => {
  for (const extraNotes of [false, true]) {
    const { scores } = await converter.convert(lateFigureSource('none', false, extraNotes));
    const score = scores[0]!;

    validate(score.musicxml);
    const figure = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!;

    assert.equal(figure.graphic, true);
    assert.equal(figure.column, null);
    assert.equal(figure.hidden, true);
    assert.equal(figure.display, 'LateLabel');
    const xml = parse(score.musicxml);

    assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('print-object'), 'no');
    assert.deepEqual(texts(xml, 'figure-number'), ['6']);
    assert.equal(elements(xml, 'prefix')[0]!.getAttribute('color'), '#00000000');
    assert.ok(
      !score.diagnostics.some((d) =>
        ['figured-bass-column-history', 'figured-bass-row', 'figured-bass-style-history'].includes(
          d.code,
        ),
      ),
    );
    const cached = JSON.parse(JSON.stringify(score.document)) as ScoreDocument;
    const replay = toMusicXML({
      ...cached,
      events: cached.events.map((e) =>
        e.kind !== 'figuredBass'
          ? e
          : { ...e, figures: e.figures.map((f) => ({ ...f, hidden: false })) },
      ),
    });

    validate(replay.musicxml);
    assert.equal(
      elements(parse(replay.musicxml), 'figured-bass')[0]!.getAttribute('print-object'),
      'no',
    );
  }
});

test('late figured-bass column links made at stop or finalize remain visible', async () => {
  for (const finalize of [false, true]) {
    const { scores } = await converter.convert(lateFigureSource('column', finalize));
    const score = scores[0]!;

    validate(score.musicxml);
    const group = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!;

    assert.deepEqual(group.figures[0]!.column, group.moment);
    assert.equal(group.figures[0]!.hidden, false);
    const xml = parse(score.musicxml);

    assert.deepEqual(texts(xml, 'figure-number'), ['LateLabel']);
    assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('print-object'), null);
    assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-column-history'));
    const document = {
      ...scores[0]!.document,
      events: scores[0]!.document.events.map((e) =>
        e.kind !== 'figuredBass' ? e : { ...e, figures: e.figures.map(({ column: _, ...f }) => f) },
      ),
    };
    const result = toMusicXML(document);

    validate(result.musicxml);
    assert.deepEqual(texts(parse(result.musicxml), 'figure-number'), ['LateLabel']);
    assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-column-history'));
  }
});

test('figured-bass spanner ancestry remains unresolved rather than falsely absent', async () => {
  const { scores } = await converter.convert(lateFigureSource('spanner'));
  const score = scores[0]!;

  validate(score.musicxml);
  const figure = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!;

  assert.equal(figure.graphic, true);
  assert.equal(figure.column, undefined);
  assert.equal(figure.hidden, false);
  assert.deepEqual(texts(parse(score.musicxml), 'figure-number'), ['LateLabel']);
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-column-history'));
});

test('figured-bass final column inspection resets between scores', async () => {
  const { scores } = await converter.convert(lateFigureSource('none') + lateFigureSource('column'));

  assert.equal(scores.length, 2);

  for (const score of scores) {
    validate(score.musicxml);
  }

  assert.equal(
    scores[0]!.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!.column,
    null,
  );
  assert.deepEqual(
    scores[1]!.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!.column,
    {
      main: { numerator: 0, denominator: 1 },
      grace: { numerator: 0, denominator: 1 },
    },
  );
});

test('mixed figured-bass attachments keep per-object column provenance and suppression', async () => {
  const source = lateFigureSource('column')
    .replace('<6+>', '<6+ 4>')
    .replace(
      '(ly:grob-set-parent! grob X column)',
      "(when (= (ly:event-property event 'figure) 6) (ly:grob-set-parent! grob X column))",
    );
  const { scores } = await converter.convert(source),
    score = scores[0]!;

  validate(score.musicxml);
  const figures = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures;

  assert.ok(figures[0]!.column);
  assert.equal(figures[1]!.column, null);
  const xml = parse(score.musicxml);

  assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('print-object'), null);
  assert.deepEqual(texts(xml, 'figure-number'), ['LateLabel', '4']);
  assert.equal(elements(xml, 'figure-number')[1]!.getAttribute('color'), '#00000000');
});
