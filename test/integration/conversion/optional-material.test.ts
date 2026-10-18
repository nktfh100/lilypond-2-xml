import type { Document, Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { elements as all, parse } from '../../support/xml-support.js';

const compiler = createReusableCompiler(),
  converter = createConverter();
const reader = new VerovioToolkit(await createModule());

after(() => {
  compiler.dispose();
  converter.dispose();
  reader.destroy();
});

const delimiters = (doc: ScoreDocument) => doc.events.filter((e) => e.kind === 'optionalMaterial');
const brackets = (xml: string) => all(parse(xml), 'bracket');
const val = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const source = (music: string, config = '') =>
  String.raw`\score { \new Staff = "solo" \with { ${config} } { \override Staff.OptionalMaterialBracket.color = #red \override Staff.OptionalMaterialBracket.output-attributes = #'((data-optional . "bracket")) ${music} } \layout {} \midi { \tempo 4=120 } }`;
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const svg = (files: Record<string, Uint8Array>) =>
  parse(new TextDecoder().decode(file(files, '.svg')));

function translate(node: Element, axis: number) {
  let value = 0;

  for (
    let e: Element | null = node;
    e;
    e = e.parentNode?.nodeType === 1 ? (e.parentNode as Element) : null
  ) {
    for (const m of (e.getAttribute('transform') ?? '').matchAll(
      /translate\(([-\d.]+)[, ]+([-\d.]+)\)/g,
    )) {
      value += Number(m[axis + 1]);
    }
  }

  return value;
}

function proveRectangles(
  doc: Document,
  event: ReturnType<typeof delimiters>[number],
  index: number,
) {
  const groups = all(doc, 'g').filter((g) => g.getAttribute('data-optional') === 'bracket');
  const rects = all(groups[index]!, 'rect');

  assert.equal(rects.length, 3);
  const staff = all(doc, 'line').filter(
    (l) => Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) > 5,
  );

  assert.equal(staff.length, 5);
  const top = Math.min(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
  const bottom = Math.max(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
  const scale = 10 / ((bottom - top) / 4 / (event.staffSpace! / event.layoutStaffSpace!));
  const origin = translate(staff[0]!, 0);
  const order = (a: readonly number[], b: readonly number[]) => {
    const difference = b[3]! - b[2]! - (a[3]! - a[2]!);

    return Math.abs(difference) > 0.001 ? difference : a[2]! + a[3]! - (b[2]! + b[3]!);
  };
  const actual = rects
    .map((r) => {
      const x = translate(r, 0) + Number(r.getAttribute('x')),
        y = translate(r, 1) + Number(r.getAttribute('y'));

      return [
        (x - origin) * scale,
        (x + Number(r.getAttribute('width')) - origin) * scale,
        (top - y - Number(r.getAttribute('height'))) * scale,
        (top - y) * scale,
        2 * Number(r.getAttribute('ry')) * scale,
      ];
    })
    .sort(order);
  const captured = [...event.rectangles!].sort(order);

  actual.forEach((box, i) =>
    box.forEach((n, j) =>
      assert.ok(
        Math.abs(n - captured[i]![j]!) < 0.006,
        `independent rectangle ${i}/${j}: ${n} vs ${captured[i]![j]}`,
      ),
    ),
  );
}

test('optional-material independent delimiters preserve actual source rectangles and native segment geometry', async () => {
  const text = source(String.raw`\startOptionalMaterial c'2 d'2 \stopOptionalMaterial`);
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const items = delimiters(result.document);

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((e) => [val(e.moment.main), e.passageDirection]),
    [
      [0, -1],
      [1, 1],
    ],
  );
  assert.ok(items.every((e) => e.rectangles?.length === 3 && e.staff === e.context));
  const original = await compiler.compile(text, { format: ['svg', 'midi'] });

  items.forEach((e, i) => proveRectangles(svg(original.files), e, i));
  const native = brackets(result.musicxml);

  assert.equal(native.length, 12);
  assert.deepEqual(
    native.map((b) => b.getAttribute('type')),
    Array.from({ length: 6 }, () => ['start', 'stop']).flat(),
  );
  assert.ok(
    native.every(
      (b) => b.getAttribute('line-end') === 'none' && b.getAttribute('color') === '#FF0000',
    ),
  );
  assert.ok(native.every((b) => b.hasAttribute('default-x') && b.hasAttribute('default-y')));
  const first = native.slice(0, 2);

  assert.equal(first[0]!.getAttribute('default-x'), first[1]!.getAttribute('default-x'));
  assert.ok(
    Number(first[1]!.getAttribute('default-y')) > Number(first[0]!.getAttribute('default-y')),
  );
  assert.equal(reader.loadData(result.musicxml), 1);
  const spans = all(parse(reader.getMEI()), 'bracketSpan');

  assert.equal(spans.length, 6);
  assert.ok(spans.every((b) => !b.hasAttribute('ho') && !b.hasAttribute('vo')));
  assert.ok(!result.diagnostics.some((d) => d.code === 'optional-material-reader'));
  const expected = midiTimedNotes(file(original.files, '.midi')),
    played = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
});

test('optional-material physical source geometry follows local staff spacing, global size and offsets', async () => {
  const text =
    String.raw`#(set-global-staff-size 30)` +
    source(
      String.raw`\override Staff.StaffSymbol.staff-space = #0.7 \override Staff.OptionalMaterialBracket.extra-offset = #'(3/2 . -7/4) \override Staff.OptionalMaterialBracket.protrusion = #1.25 \override Staff.OptionalMaterialBracket.thickness = #2 \startOptionalMaterial c'1 \stopOptionalMaterial`,
    );
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const original = await compiler.compile(text, { format: 'svg' });

  assert.equal(delimiters(result.document).length, 2);
  delimiters(result.document).forEach((e, i) => proveRectangles(svg(original.files), e, i));
  assert.ok(result.diagnostics.some((d) => d.code === 'optional-material-layout'));
});

test('optional-material source visibility, removal and custom drawing do not fabricate a paired passage', async () => {
  for (const [setup, config, expected, custom] of [
    [String.raw`\override Staff.OptionalMaterialBracket.transparent = ##t`, '', 2, false],
    [String.raw`\omit Staff.OptionalMaterialBracket`, '', 2, false],
    ['', String.raw`\remove Optional_material_bracket_engraver`, 0, false],
    [
      String.raw`\override Staff.OptionalMaterialBracket.stencil = #ly:text-interface::print \override Staff.OptionalMaterialBracket.text = "optional"`,
      '',
      2,
      true,
    ],
  ] as const) {
    const text = source(`${setup} \\startOptionalMaterial c'1 \\stopOptionalMaterial`, config);
    const result = (await converter.convert(text)).scores[0]!;

    validate(result.musicxml);
    const items = delimiters(result.document);

    assert.equal(items.length, expected);
    const original = await compiler.compile(text, { format: 'svg' });
    const sourceBoxes = all(svg(original.files), 'g')
      .filter((g) => g.getAttribute('data-optional') === 'bracket')
      .flatMap((g) => all(g, 'rect'));

    assert.equal(
      sourceBoxes.length,
      0,
      'source hidden/removed/custom graphics have no standard delimiter rectangles',
    );

    if (custom) {
      assert.ok(items.every((e) => e.custom));
      assert.equal(brackets(result.musicxml).length, 0);
      assert.ok(result.diagnostics.some((d) => d.code === 'optional-material-stencil'));
    } else if (expected) {
      assert.ok(items.every((e) => e.hidden));
      assert.ok(brackets(result.musicxml).every((b) => /00$/.test(b.getAttribute('color') ?? '')));
    }
  }

  const lone = (await converter.convert(source(String.raw`\startOptionalMaterial c'1`))).scores[0]!;

  assert.equal(delimiters(lone.document).length, 1);
  assert.equal(brackets(lone.musicxml).length, 6);
});

test('optional-material final Item break visibility and own-staff identities remain distinct', async () => {
  const text = String.raw`\score { << \new Staff = "upper" { \override Staff.OptionalMaterialBracket.color = #red \startOptionalMaterial c'1 \stopOptionalMaterial \break \startOptionalMaterial d'1 \stopOptionalMaterial } \new Staff = "lower" { \startOptionalMaterial e'1 f'1 \stopOptionalMaterial } >> \layout {} }`;
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const items = delimiters(result.document);

  assert.ok(items.length >= 6);
  assert.equal(new Set(items.map((e) => e.staff)).size, 2);
  assert.equal(new Set(items.map((e) => `${e.id}:${e.piece}`)).size, items.length);
  assert.ok(items.filter((e) => !e.hidden).every((e) => e.rectangles?.length === 3));
  const original = await compiler.compile(text, { format: 'svg' });

  assert.ok(file(original.files, '.svg').length);
});

test('optional-material cache, malformed geometry, missing origin and layout failure reset safely', async () => {
  const text = source(String.raw`\startOptionalMaterial c'1 \stopOptionalMaterial`);
  const scores = (await converter.convert(text + source(String.raw`d'1`))).scores;

  assert.equal(delimiters(scores[1]!.document).length, 0);
  const cached = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;
  const attrs = (xml: string) =>
    brackets(xml).map((b) => Array.from(b.attributes).map((a) => [a.name, a.value]));

  assert.deepEqual(attrs(toMusicXML(cached).musicxml), attrs(scores[0]!.musicxml));
  const bad = toMusicXML({
    ...cached,
    events: cached.events.map((e) =>
      e.kind === 'optionalMaterial' ? { ...e, rectangles: null } : e,
    ),
  });

  assert.equal(brackets(bad.musicxml).length, 0);
  assert.ok(bad.diagnostics.some((d) => d.code === 'optional-material-geometry'));
  const missing = toMusicXML({
    ...cached,
    events: cached.events.map((e) =>
      e.kind === 'optionalMaterial' ? { ...e, xReference: null } : e,
    ),
  });

  assert.ok(brackets(missing.musicxml).every((b) => !b.hasAttribute('default-x')));
  assert.ok(missing.diagnostics.some((d) => d.code === 'optional-material-position'));
  const failure = source(
    String.raw`\override Staff.OptionalMaterialBracket.after-line-breaking = #(lambda(g)(error "optional-final")) \startOptionalMaterial c'1 \stopOptionalMaterial`,
  );
  const failed = (await converter.convert(failure + text)).scores;

  assert.ok(failed[0]!.diagnostics.some((d) => d.code === 'optional-material-capture'));
  assert.equal(delimiters(failed[0]!.document).length, 0);
  assert.equal(delimiters(failed[1]!.document).length, 2);
});

test('optional-material percent playback retains actual independent Items without imagined copies', async () => {
  const text = source(
    String.raw`\repeat percent 2 { \startOptionalMaterial c'2 d'2 \stopOptionalMaterial } e'1`,
  );
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const original = await compiler.compile(text, { format: ['svg', 'midi'] });
  const sourceGroups = all(svg(original.files), 'g').filter(
    (g) => g.getAttribute('data-optional') === 'bracket',
  );

  assert.equal(sourceGroups.length, 2);
  assert.equal(delimiters(result.document).filter((e) => !e.hidden).length, sourceGroups.length);
  assert.deepEqual(
    delimiters(result.document).map((e) => val(e.moment.main)),
    [0, 1],
  );
  assert.equal(brackets(result.musicxml).length, 12);
  assert.ok(brackets(result.musicxml).every((b) => b.getAttribute('color') === '#FF0000'));
  const unfolded = await compiler.compile(text.replaceAll('\\repeat percent', '\\repeat unfold'), {
    format: 'midi',
  });

  reader.loadData(result.musicxml);
  assert.deepEqual(
    midiTimedNotes(reader.renderToMIDI()).map((n) => [n.pitch, n.onset, n.velocity]),
    midiTimedNotes(file(unfolded.files, '.midi')).map((n) => [n.pitch, n.onset, n.velocity]),
  );
});

test('optional-material sparse or absent source grids never guess a native staff-top origin', async () => {
  for (const positions of ['(-4 0 2)', '()'] as const) {
    const result = (
      await converter.convert(
        source(
          String.raw`\override Staff.StaffSymbol.line-positions = #'${positions} \startOptionalMaterial c'1 \stopOptionalMaterial`,
        ),
      )
    ).scores[0]!;

    validate(result.musicxml);
    assert.equal(delimiters(result.document).length, 2);

    if (positions === '()') {
      assert.ok(delimiters(result.document).every((e) => e.rectangles === null));
      assert.equal(brackets(result.musicxml).length, 0);
      assert.ok(result.diagnostics.some((d) => d.code === 'optional-material-geometry'));
    } else {
      assert.equal(brackets(result.musicxml).length, 12);
      assert.ok(
        brackets(result.musicxml).every(
          (b) => b.hasAttribute('default-x') && !b.hasAttribute('default-y'),
        ),
      );
      assert.ok(result.diagnostics.some((d) => d.code === 'optional-material-position'));
      const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;

      assert.ok(brackets(toMusicXML(cached).musicxml).every((b) => !b.hasAttribute('default-y')));
    }
  }
});
