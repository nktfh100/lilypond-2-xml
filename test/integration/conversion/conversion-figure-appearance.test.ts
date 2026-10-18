import { toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

test('figured-bass grob colors and uniform custom label fonts remain native', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c'1 d'1 } \figures {
    \override BassFigure.color = #red <6+ 4>1
    <\markup \with-color #blue \bold \italic \abs-fontsize #18 "Label">1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    numbers = elements(xml, 'figure-number');

  assert.deepEqual(
    numbers.map((n) => n.getAttribute('color')),
    ['#FF0000', '#FF0000', '#0000FF'],
  );
  assert.equal(elements(xml, 'prefix')[0]!.getAttribute('color'), '#FF0000');
  const label = numbers[2]!;

  assert.equal(label.textContent, 'Label');
  assert.equal(label.getAttribute('font-weight'), 'bold');
  assert.equal(label.getAttribute('font-style'), 'italic');
  assert.ok(Math.abs(Number(label.getAttribute('font-size')) - 18 * (72 / 72.27)) < 1e-9);
  assert.ok(
    !score.diagnostics.some((d) =>
      ['figured-bass-markup', 'markup-font-base', 'markup-font-reset'].includes(d.code),
    ),
  );
});

test('figured-bass relative sizes and resets use captured grob font context', async () => {
  const { scores } = await converter.convert(String.raw`#(set-global-staff-size 18)
    << \new Staff { c'1 d'1 e'1 } \figures { \override BassFigure.font-size = #3 \override BassFigure.font-series = #'bold
      <\markup \fontsize #2 "Step">1 <\markup { \abs-fontsize #18 \small "Reset" }>1 <\markup \magnify #2 "Double">1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const numbers = elements(parse(score.musicxml), 'figure-number'),
    figures = score.document.events
      .filter((e) => e.kind === 'figuredBass')
      .flatMap((e) => e.figures);
  const ref = 9.9 * (72 / 72.27);

  assert.ok(Math.abs(figures[0]!.fontContext!.reference - ref) < 1e-9);
  const expected = [ref * 2 ** (5 / 6), ref * 2 ** (-1 / 6), ref * 2];

  numbers.forEach((n, i) =>
    assert.ok(Math.abs(Number(n.getAttribute('font-size')) - expected[i]!) < 1e-9),
  );
  assert.ok(numbers.every((n) => n.getAttribute('font-weight') === 'bold'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'markup-font-reset'));
});

test('mixed figured-bass labels retain text and their common styles without inventing uniform child styles', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c'1 } \figures {
    <\markup \with-color #red \concat { \bold "Bold" \italic "Italic" }>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const n = elements(parse(score.musicxml), 'figure-number')[0]!;

  assert.equal(n.textContent, 'BoldItalic');
  assert.equal(n.getAttribute('color'), '#FF0000');
  assert.equal(n.getAttribute('font-weight'), null);
  assert.equal(n.getAttribute('font-style'), null);
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-markup'));
});

test('figured-bass decorations and composite layout are diagnosed without invalid attributes', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c'1 d'1 } \figures {
    <\markup \box \underline \bold "Boxed">1 <\markup \center-column { "Upper" "Lower" }>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const numbers = elements(parse(score.musicxml), 'figure-number');

  assert.equal(numbers[0]!.getAttribute('font-weight'), 'bold');
  assert.equal(numbers[0]!.getAttribute('enclosure'), null);
  assert.equal(numbers[0]!.getAttribute('underline'), null);
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-markup'));
  assert.ok(score.diagnostics.some((d) => d.code === 'markup-layout'));
});

test('hidden figured-bass grobs override nested colors while transparent markup retains its text', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c'1 d'1 e'1 } \figures {
    \once \override BassFigure.transparent = ##t <\markup \with-color #blue "Hidden">1
    <\markup \transparent \with-color #red "Invisible">1
    \once \override BassFigure.stencil = ##f <6+>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    numbers = elements(xml, 'figure-number');

  assert.deepEqual(
    numbers.map((n) => n.textContent),
    ['Hidden', 'Invisible', '6'],
  );
  assert.equal(numbers[0]!.getAttribute('color'), '#00000000');
  assert.equal(numbers[1]!.getAttribute('color'), '#00000000');
  assert.equal(numbers[2]!.getAttribute('color'), '#00000000');
  assert.equal(elements(xml, 'prefix')[0]!.getAttribute('color'), '#00000000');
  assert.ok(elements(xml, 'figured-bass').every((n) => n.getAttribute('print-object') === 'no'));
});

test('custom figured-bass stencils and unsupported font variants retain available native data with diagnostics', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c'1 } \figures {
    \override BassFigure.font-series = #'heavy \override BassFigure.stencil = #(lambda (grob) (ly:text-interface::print grob)) <6>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.deepEqual(texts(parse(score.musicxml), 'figure-number'), ['6']);
  assert.ok(
    score.diagnostics.some(
      (d) => d.code === 'figured-bass-font-style' && d.message.includes('heavy'),
    ),
  );
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-stencil'));
});

test('cached figures without grob context retain explicit styles and diagnose unknown relative sizes', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { c'1 } \figures { <\markup \bold \fontsize #2 "Cached">1 } >>`,
  );
  const document = {
    ...scores[0]!.document,
    events: scores[0]!.document.events.map((e) =>
      e.kind !== 'figuredBass'
        ? e
        : {
            ...e,
            figures: e.figures.map(({ fontContext: _, color: __, custom: ___, ...f }) => f),
          },
    ),
  };
  const result = toMusicXML(document);

  validate(result.musicxml);
  const n = elements(parse(result.musicxml), 'figure-number')[0]!;

  assert.equal(n.textContent, 'Cached');
  assert.equal(n.getAttribute('font-weight'), 'bold');
  assert.equal(n.getAttribute('font-size'), null);
  assert.ok(result.diagnostics.some((d) => d.code === 'markup-font-base'));
  assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-style-history'));
});

test('fully transparent figured-bass colors suppress whole groups while partially hidden rows stay independent', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c'1 d'1 } \figures {
    \once \override BassFigure.color = #'(0 1 0 0) <6+>1
    <\markup \transparent "Secret" 4>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    groups = elements(xml, 'figured-bass'),
    numbers = elements(xml, 'figure-number');

  assert.equal(groups[0]!.getAttribute('print-object'), 'no');
  assert.equal(groups[1]!.getAttribute('print-object'), null);
  assert.equal(numbers[0]!.getAttribute('color'), '#00000000');
  assert.equal(elements(xml, 'prefix')[0]!.getAttribute('color'), '#00000000');
  assert.equal(numbers[1]!.getAttribute('color'), '#00000000');
  assert.equal(numbers[2]!.textContent, '4');
});

test('figured-bass continuation colors and offsets use actual line graphics independently of figure text', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c4 d e f } \figures {
    \override BassFigure.color = #blue \override BassFigureContinuation.color = #red
    \override BassFigureContinuation.extra-offset = #'(3/2 . -1/4)
    \bassFigureExtendersOn <6 4>4 <6 3> <7 3> <7 3> } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    lines = elements(xml, 'extend');

  assert.equal(lines.length, 7);
  assert.ok(
    lines.every(
      (n) =>
        n.getAttribute('color') === '#FF0000' &&
        n.getAttribute('relative-x') === '15' &&
        n.getAttribute('relative-y') === '-2.5',
    ),
  );
  assert.ok(elements(xml, 'figure-number').every((n) => n.getAttribute('color') === '#0000FF'));
  const captured = score.document.events
    .filter((e) => e.kind === 'figuredBass')
    .flatMap((e) => e.figures)
    .filter((f) => f.continuation);

  assert.equal(captured.length, 3);
  assert.deepEqual(captured[0]!.continuation!.offset, [1.5, -0.25]);
  assert.equal(captured[0]!.continuation!.custom, false);
  assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-line-reader'));
});

test('transparent and removed figured-bass continuation stencils hide lines without hiding initial numbers', async () => {
  for (const setting of [String.raw`transparent = ##t`, String.raw`stencil = ##f`]) {
    const { scores } = await converter.convert(
      String.raw`<< \new Staff { c4 d e f } \figures {
      \override BassFigureContinuation.color = #red \override BassFigureContinuation.` +
        setting +
        String.raw`
      \bassFigureExtendersOn <6 4>4 <6 3> <7 3> <7 3> } >>`,
    );
    const score = scores[0]!;

    validate(score.musicxml);
    const xml = parse(score.musicxml);

    assert.ok(elements(xml, 'extend').every((n) => n.getAttribute('color') === '#00000000'));
    assert.deepEqual(texts(xml, 'figure-number'), ['6', '4', '3', '7']);
    assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('print-object'), null);
    assert.ok(
      score.document.events
        .filter((e) => e.kind === 'figuredBass')
        .flatMap((e) => e.figures)
        .filter((f) => f.continuation)
        .every((f) => f.continuation!.hidden && !f.continuation!.custom),
    );
  }
});

test('hidden figured-bass text does not suppress separately visible continuation lines', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c4 d e f } \figures {
    \override BassFigure.transparent = ##t \override BassFigureContinuation.color = #blue
    \bassFigureExtendersOn <6 4>4 <6 3> <7 3> <7 3> } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.equal(elements(xml, 'extend').length, 7);
  assert.ok(elements(xml, 'extend').every((n) => n.getAttribute('color') === '#0000FF'));
  assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('print-object'), null);
  assert.ok(!texts(xml, 'figure-number').includes('6'));
});

test('figured-bass continuation rows keep their own resolved callback colors', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c4 d e f } \figures {
    \override BassFigureContinuation.color = #(lambda (grob)
      (if (eqv? (ly:event-property (ly:grob-property (ly:spanner-bound grob LEFT) 'cause) 'figure) 6) red blue))
    \bassFigureExtendersOn <6 4>4 <6 3> <7 3> <7 3> } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.deepEqual(
    elements(xml, 'extend').map((n) => n.getAttribute('color')),
    ['#FF0000', '#FF0000', '#0000FF', '#0000FF', '#0000FF', '#0000FF', '#0000FF'],
  );
});

test('custom figured-bass continuation stencils and geometry retain available attributes with diagnostics', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c4 d e f } \figures {
    \override BassFigureContinuation.stencil = #(lambda (grob) (figured-bass-continuation::print grob))
    \override BassFigureContinuation.thickness = #3 \override BassFigureContinuation.style = #'dashed-line
    \bassFigureExtendersOn <6 4>4 <6 3> <7 3> <7 3> } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(elements(parse(score.musicxml), 'extend').length, 7);
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-line-stencil'));
  assert.ok(
    score.diagnostics.some(
      (d) =>
        d.code === 'figured-bass-line-layout' &&
        d.message.includes('3') &&
        d.message.includes('dashed-line'),
    ),
  );
});

test('cached figured-bass continuations retain their endpoints and diagnose missing appearance', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { c4 d e f } \figures { \override BassFigureContinuation.color = #red \bassFigureExtendersOn <6 4>4 <6 3> <7 3> <7 3> } >>`,
  );
  const document = {
    ...scores[0]!.document,
    events: scores[0]!.document.events.map((e) =>
      e.kind !== 'figuredBass'
        ? e
        : { ...e, figures: e.figures.map(({ continuation: _, ...f }) => f) },
    ),
  };
  const result = toMusicXML(document);

  validate(result.musicxml);
  const lines = elements(parse(result.musicxml), 'extend');

  assert.equal(lines.length, 7);
  assert.ok(lines.every((n) => n.getAttribute('color') === null));
  assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-line-history'));
});

test('figured-bass continuation appearance and identifiers reset between scores', async () => {
  const { scores } =
    await converter.convert(String.raw`\score { << \new Staff { c2 d } \figures { \override BassFigureContinuation.color = #red \bassFigureExtendersOn <6>2 <6> } >> }
    \score { << \new Staff { e2 f } \figures { \override BassFigureContinuation.color = #blue \bassFigureExtendersOn <6>2 <6> } >> }`);

  for (const [i, s] of scores.entries()) {
    validate(s.musicxml);
    assert.ok(
      elements(parse(s.musicxml), 'extend').every(
        (n) => n.getAttribute('color') === (i ? '#0000FF' : '#FF0000'),
      ),
    );
    assert.equal(s.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!.id, 1);
  }
});

test('adjacent cached figured-bass line spans share one continuation field and report appearance changes', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { c4 d e f } \figures { \override BassFigureContinuation.color = #blue \bassFigureExtendersOn <6>4 <6\!> <6> <6> } >>`,
  );
  const first = scores[0]!,
    groups = first.document.events.filter((e) => e.kind === 'figuredBass'),
    next = groups[1]!.figures[0]!;

  for (const changed of [false, true]) {
    const document = {
      ...first.document,
      events: first.document.events.map((e) =>
        e !== groups[0]
          ? e
          : {
              ...groups[0]!,
              figures: [
                {
                  ...groups[0]!.figures[0]!,
                  extendTo: next.id,
                  continuation: {
                    ...next.continuation!,
                    color: changed ? [1, 0, 0] : [0, 0, 1],
                  },
                },
              ],
            },
      ),
    };
    const result = toMusicXML(document);

    validate(result.musicxml);
    const lines = elements(parse(result.musicxml), 'extend');

    assert.deepEqual(
      lines.map((n) => n.getAttribute('type')),
      ['start', 'continue', 'continue', 'stop'],
    );
    assert.equal(lines[1]!.getAttribute('color'), '#0000FF');
    assert.equal(
      result.diagnostics.some((d) => d.code === 'figured-bass-line-junction'),
      changed,
    );
  }
});
