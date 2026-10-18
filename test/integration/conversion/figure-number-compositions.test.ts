import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, type TextMarkup, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { validate } from '../../support/schema.js';
import { serialize, elements, parse } from '../../support/xml-support.js';

const converter = createConverter(),
  compiler = createReusableCompiler();

after(() => {
  converter.dispose();
  compiler.dispose();
});

const source = (figures: string) => String.raw`\score { << \new Staff { c1 d2 }
  \figures { ${figures} } >> \layout {} }`;
const audit = String.raw`#(define (audit-number-composition grob)
  (let ((stencil (ly:text-interface::print grob)))
    (format #t "NUMBER-COMPOSITION ~s\n" (ly:stencil-expr stencil)) stencil))
`;
const withDisplay = (document: ScoreDocument, display: TextMarkup): ScoreDocument => ({
  ...document,
  events: document.events.map((e) =>
    e.kind !== 'figuredBass' ? e : { ...e, figures: e.figures.map((f) => ({ ...f, display })) },
  ),
});
const custom = source(String.raw`\set figuredBassFormatter = #(lambda (figure event context)
  (make-with-color-markup red (make-fontsize-markup -2 (make-number-markup "12")))) <6+>1`);

test('custom uniform number markup retains actual digits, point size and color without stale semantic modifiers', async () => {
  const [{ scores }, independent] = await Promise.all([
    converter.convert(custom),
    compiler.compile(
      audit +
        custom.replace(
          '<6+>1',
          String.raw`\override BassFigure.stencil = #audit-number-composition <6+>1`,
        ),
      { format: ['svg'] },
    ),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    number = elements(xml, 'figure-number')[0]!;

  assert.equal(number.textContent, '12');
  assert.equal(number.getAttribute('color'), '#FF0000');
  assert.equal(elements(xml, 'prefix').length + elements(xml, 'suffix').length, 0);
  const figure = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!;

  assert.equal(figure.number, 6);
  assert.ok(figure.alteration);
  const expression = independent.logs.find((l) => l.startsWith('NUMBER-COMPOSITION '))!;

  assert.match(expression, /"12"/);
  assert.ok(!expression.includes('"6"'));
  const size =
    (Number(expression.match(/\(glyph-string [\s\S]*?"[^"]+" ([\d.]+)/)![1]) * 72) / 25.4;

  assert.ok(Math.abs(Number(number.getAttribute('font-size')) - size) < 0.003);
  assert.ok(
    !score.diagnostics.some((d) =>
      ['markup-command', 'figured-bass-format', 'figured-bass-number-font'].includes(d.code),
    ),
  );
});

test('default modifiers, solitary plus, multi-digit alignment, accidental brackets and drawn slashes retain verified numeric sizes', async () => {
  const original = source(String.raw`<6+>4 <_\+>4 <12>4 <6[+]>4 <5/>4 <5\\>4`);
  const [{ scores }, independent] = await Promise.all([
    converter.convert(original),
    compiler.compile(
      audit +
        original.replace(
          '<6+>4',
          String.raw`\override BassFigure.stencil = #audit-number-composition <6+>4`,
        ),
      { format: ['svg'] },
    ),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  const groups = elements(parse(score.musicxml), 'figured-bass');
  const expressions = independent.logs.filter((l) => l.startsWith('NUMBER-COMPOSITION '));

  assert.equal(groups.length, 6);
  assert.equal(expressions.length, 6);

  for (const [i, group] of groups.entries()) {
    const sourceSizes = [
      ...expressions[i]!.matchAll(/\(glyph-string [\s\S]*?"[^"]+" ([\d.]+)/g),
    ].map((m) => (Number(m[1]) * 72) / 25.4);

    assert.ok(sourceSizes.length);
    const nodes = [
      ...elements(group, 'figure-number'),
      ...elements(group, 'prefix'),
      ...elements(group, 'suffix'),
    ];

    assert.ok(nodes.length);

    for (const node of nodes) {
      for (const size of sourceSizes) {
        assert.ok(
          Math.abs(Number(node.getAttribute('font-size')) - size) < 0.003,
          `${i}: ${serialize(node)}, source ${size}`,
        );
      }
    }
  }

  assert.equal(elements(groups[1]!, 'figure-number').length, 0);
  assert.equal(elements(groups[1]!, 'prefix')[0]!.textContent, 'plus');
  assert.equal(elements(groups[2]!, 'figure-number')[0]!.textContent, '12');
  assert.equal(elements(groups[4]!, 'suffix')[0]!.textContent, 'slash');
  assert.equal(elements(groups[5]!, 'suffix')[0]!.textContent, 'back-slash');
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-bracket'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-number-font'));
});

test('uniform concatenated numeric formatter labels retain supported color styling', async () => {
  const { scores } = await converter.convert(
    source(String.raw`\set figuredBassFormatter = #(lambda (figure event context)
    (make-with-color-markup blue (make-fontsize-markup -3
      (make-concat-markup (list (make-number-markup "1") (make-number-markup "2")))))) <6+>1`),
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const number = elements(parse(score.musicxml), 'figure-number')[0]!;

  assert.equal(number.textContent, '12');
  assert.equal(number.getAttribute('color'), '#0000FF');
  assert.ok(Number(number.getAttribute('font-size')) > 0);
  assert.ok(
    !score.diagnostics.some((d) =>
      ['markup-command', 'figured-bass-format', 'figured-bass-number-font'].includes(d.code),
    ),
  );
});

test('JSON-cached numeric formatter labels without numeric provenance retain text with an explicit history diagnostic', async () => {
  const { scores } = await converter.convert(custom);
  const document = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;

  document.events = document.events.map((e) =>
    e.kind !== 'figuredBass'
      ? e
      : { ...e, figures: e.figures.map(({ numberFontContext: _, ...f }) => f) },
  );
  const result = toMusicXML(document);

  validate(result.musicxml);
  const number = elements(parse(result.musicxml), 'figure-number')[0]!;

  assert.equal(number.textContent, '12');
  assert.equal(number.getAttribute('color'), '#FF0000');
  assert.ok(!number.hasAttribute('font-size'));
  assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-number-font-history'));
});

test('numeric-only caches use number provenance while ordinary text caches still require their text context', async () => {
  for (const [figures, numeric] of [
    [String.raw`<6>1`, true],
    [
      String.raw`\set figuredBassFormatter = #(lambda (figure event context) (make-number-markup "12")) <6>1`,
      true,
    ],
    [
      String.raw`\set figuredBassFormatter = #(lambda (figure event context) (make-bold-markup "Roman")) <6>1`,
      false,
    ],
  ] as const) {
    const { scores } = await converter.convert(source(figures));
    const document = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;

    document.events = document.events.map((e) =>
      e.kind !== 'figuredBass'
        ? e
        : { ...e, figures: e.figures.map(({ fontContext: _, ...f }) => f) },
    );
    const result = toMusicXML(document);

    validate(result.musicxml);
    assert.equal(
      result.diagnostics.some((d) => d.code === 'figured-bass-style-history'),
      !numeric,
    );

    if (numeric) {
      assert.ok(
        Number(elements(parse(result.musicxml), 'figure-number')[0]!.getAttribute('font-size')) > 0,
      );
    }
  }
});

test('mixed numeric formatter sizes retain resolved text and diagnose the missing native size', async () => {
  const { scores } = await converter.convert(
    source(String.raw`\set figuredBassFormatter = #(lambda (figure event context)
    (make-concat-markup (list (make-fontsize-markup -2 (make-number-markup "12"))
      (make-fontsize-markup -5 (make-number-markup "3"))))) <6+>1`),
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const number = elements(parse(score.musicxml), 'figure-number')[0]!;

  assert.equal(number.textContent, '123');
  assert.ok(!number.hasAttribute('font-size'));
  assert.equal(elements(parse(score.musicxml), 'prefix').length, 0);
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-number-font'));
});

test('opaque glyphs and uncaptured font-reference changes keep diagnosed native fallback semantics', async () => {
  const { scores } = await converter.convert(
    source(String.raw`\set figuredBassFormatter = #(lambda (figure event context)
    (make-musicglyph-markup "figbass.twoplus")) <6+>1`),
  );
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(elements(parse(score.musicxml), 'figure-number')[0]!.textContent, '6');
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-number-font'));
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-format'));
  const result = toMusicXML(
    withDisplay(score.document, {
      command: 'override-markup',
      args: [['font-name', 'serif'], { command: 'number-markup', args: ['12'], plain: '12' }],
      plain: '12',
    }),
  );

  validate(result.musicxml);
  assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-number-font'));
});

test('numeric point sizes that underflow or overflow are omitted with diagnostics', async () => {
  const { scores } = await converter.convert(source('<6>1'));

  for (const step of [-1e9, 1e9]) {
    const result = toMusicXML(
      withDisplay(scores[0]!.document, {
        command: 'fontsize-markup',
        args: [step, { command: 'number-markup', args: ['6'], plain: '6' }],
        plain: '6',
      }),
    );

    validate(result.musicxml);
    assert.ok(!elements(parse(result.musicxml), 'figure-number')[0]!.hasAttribute('font-size'));
    assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-number-font'));
  }
});

test('ordinary text formatter labels retain their text font reference and bold style', async () => {
  const { scores } = await converter.convert(
    source(String.raw`\set figuredBassFormatter = #(lambda (figure event context)
    (make-fontsize-markup 2 (make-bold-markup "Roman"))) <6+>1`),
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const number = elements(parse(score.musicxml), 'figure-number')[0]!;
  const figure = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!;

  assert.equal(number.textContent, 'Roman');
  assert.equal(number.getAttribute('font-weight'), 'bold');
  assert.ok(
    Math.abs(
      Number(number.getAttribute('font-size')) - figure.fontContext!.reference * 2 ** (2 / 6),
    ) < 1e-10,
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-number-font'));
});
