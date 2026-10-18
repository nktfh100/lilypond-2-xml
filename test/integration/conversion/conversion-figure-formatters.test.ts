import { toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

test('custom figured-bass formatter text replaces native display without stale accidentals', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c1 } \figures {
    \set figuredBassFormatter = #(lambda (figure event context) (markup #:with-color blue #:bold "RomanSix")) <6+>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    number = elements(xml, 'figure-number')[0]!;

  assert.equal(number.textContent, 'RomanSix');
  assert.equal(number.getAttribute('color'), '#0000FF');
  assert.equal(number.getAttribute('font-weight'), 'bold');
  assert.equal(elements(xml, 'prefix').length, 0);
  assert.equal(elements(xml, 'suffix').length, 0);
  const f = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!;

  assert.equal(f.number, 6);
  assert.deepEqual(f.alteration, { numerator: 1, denominator: 2 });
  assert.ok(f.display);
  assert.equal(f.text, null);
  assert.ok(
    !score.diagnostics.some((d) =>
      ['figured-bass-format', 'figured-bass-format-history'].includes(d.code),
    ),
  );
});

test('empty and null figured-bass formatter results suppress native labels without exposing semantic numbers', async () => {
  for (const result of [String.raw`""`, String.raw`(make-null-markup)`]) {
    const { scores } = await converter.convert(
      String.raw`<< \new Staff { c1 } \figures { \set figuredBassFormatter = #(lambda (figure event context) ` +
        result +
        String.raw`) <6+>1 } >>`,
    );
    const score = scores[0]!;

    validate(score.musicxml);
    const xml = parse(score.musicxml);

    assert.deepEqual(texts(xml, 'figure-number'), ['']);
    assert.equal(elements(xml, 'prefix').length, 0);
    assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('print-object'), 'no');
    assert.ok(
      !score.diagnostics.some((d) =>
        ['figured-bass-format', 'figured-bass-format-history', 'markup-command'].includes(d.code),
      ),
    );
  }
});

test('transparent figured-bass formatter text keeps its native content and suppresses whole groups', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c1 } \figures {
    \set figuredBassFormatter = #(lambda (figure event context) (markup #:transparent #:with-color blue "Secret")) <6+>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    number = elements(xml, 'figure-number')[0]!;

  assert.equal(number.textContent, 'Secret');
  assert.equal(number.getAttribute('color'), '#00000000');
  assert.equal(elements(xml, 'figured-bass')[0]!.getAttribute('print-object'), 'no');
  assert.equal(elements(xml, 'prefix').length, 0);
});

test('mixed figured-bass formatter runs keep common styles with a native single-style diagnostic', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c1 } \figures {
    \set figuredBassFormatter = #(lambda (figure event context) (markup #:with-color red #:concat (#:bold "Bold" #:italic "Italic"))) <6+>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const number = elements(parse(score.musicxml), 'figure-number')[0]!;

  assert.equal(number.textContent, 'BoldItalic');
  assert.equal(number.getAttribute('color'), '#FF0000');
  assert.equal(number.getAttribute('font-weight'), null);
  assert.equal(number.getAttribute('font-style'), null);
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-markup'));
});

test('graphical figured-bass formatter results retain native semantics with explicit unsupported diagnostics', async () => {
  for (const output of [
    String.raw`(markup #:draw-circle 1 0.1 #f)`,
    String.raw`(markup #:box #:null)`,
  ]) {
    const { scores } = await converter.convert(
      String.raw`<< \new Staff { c1 } \figures { \set figuredBassFormatter = #(lambda (figure event context) ` +
        output +
        String.raw`) <6+>1 } >>`,
    );
    const score = scores[0]!;

    validate(score.musicxml);
    const xml = parse(score.musicxml);

    assert.deepEqual(texts(xml, 'figure-number'), ['6']);
    assert.deepEqual(texts(xml, 'prefix'), ['sharp']);
    assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-format'));
  }
});

test('a custom figured-bass formatter delegating to music-font markup retains native number and modifier semantics', async () => {
  const { scores } = await converter.convert(String.raw`<< \new Staff { c1 } \figures {
    \set figuredBassFormatter = #(lambda (figure event context) (format-bass-figure figure event context)) <6+>1 } >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.deepEqual(texts(xml, 'figure-number'), ['6']);
  assert.deepEqual(texts(xml, 'prefix'), ['sharp']);
  assert.ok(score.diagnostics.some((d) => d.code === 'figured-bass-format'));
});

test('cached figured-bass custom formatters without captured display retain available data with a history diagnostic', async () => {
  const { scores } = await converter.convert(
    String.raw`<< \new Staff { c1 } \figures { \set figuredBassFormatter = #(lambda (figure event context) "Label") <6+>1 } >>`,
  );
  const document = {
    ...scores[0]!.document,
    events: scores[0]!.document.events.map((e) =>
      e.kind !== 'figuredBass' ? e : { ...e, figures: e.figures.map(({ display: _, ...f }) => f) },
    ),
  };
  const result = toMusicXML(document);

  validate(result.musicxml);
  assert.deepEqual(texts(parse(result.musicxml), 'figure-number'), ['6']);
  assert.deepEqual(texts(parse(result.musicxml), 'prefix'), ['sharp']);
  assert.ok(result.diagnostics.some((d) => d.code === 'figured-bass-format-history'));
});

test('custom figured-bass formatter changes and later scores keep their own resolved display', async () => {
  const { scores } = await converter.convert(String.raw`\score { << \new Staff { c2 d } \figures {
    \set figuredBassFormatter = #(lambda (figure event context) "First") <6+>2
    \set figuredBassFormatter = #(lambda (figure event context) "Second") <5->2 } >> }
    \score { << \new Staff { e1 } \figures { <4+>1 } >> }`);

  for (const s of scores) {
    validate(s.musicxml);
  }

  assert.deepEqual(texts(parse(scores[0]!.musicxml), 'figure-number'), ['First', 'Second']);
  assert.equal(elements(parse(scores[0]!.musicxml), 'prefix').length, 0);
  assert.deepEqual(texts(parse(scores[1]!.musicxml), 'figure-number'), ['4']);
  assert.deepEqual(texts(parse(scores[1]!.musicxml), 'prefix'), ['sharp']);
});

test('stacked custom figured-bass formatters within piano staves keep their own labels and note anchors', async () => {
  const { scores } = await converter.convert(String.raw`\new PianoStaff <<
    \new Staff = "upper" << { c'2 d' } \figures { \set figuredBassFormatter = #(lambda (figure event context) "Upper") <6+ 4>2 <5- 3> } >>
    \new Staff = "lower" << { c2 d } \figures { \set figuredBassFormatter = #(lambda (figure event context) "Lower") <6+>2 <5-> } >> >>`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    groups = elements(xml, 'figured-bass');

  assert.equal(elements(xml, 'part').length, 1);
  assert.deepEqual(
    groups.map((g) => texts(g, 'figure-number')),
    [['Upper', 'Upper'], ['Upper', 'Upper'], ['Lower'], ['Lower']],
  );

  for (const g of groups) {
    let next = g.nextSibling;

    while (next && next.nodeName !== 'note') {
      next = next.nextSibling;
    }

    assert.ok(next);
    assert.equal(texts(next, 'staff')[0], texts(g, 'figure-number')[0] === 'Upper' ? '1' : '2');
  }

  assert.equal(elements(xml, 'prefix').length, 0);
});
