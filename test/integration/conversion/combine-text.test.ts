import type { Document, Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { readMidiAttacks } from '../../../tools/evaluation/midi.js';
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

const labels = (doc: ScoreDocument) => doc.events.filter((e) => e.kind === 'combineText');
const words = (xml: string) => all(parse(xml), 'words');
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const value = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const normal = String.raw`\partCombine { c'4 d'4 e'4 f'4 g'4 a'4 b'4 c''4 } { c'4 d'4 r4 r4 g'4 a'4 r4 r4 }`;
const source = (music = normal, config = '', layout = '') =>
  String.raw`\version "2.26.0" \score { \new Staff = "solo" \with { \override CombineTextScript.color = #red \override CombineTextScript.output-attributes = #'((data-combine . "combine")) ${config} } { ${music} } \layout { ${layout} } \midi { \tempo 4=120 } }`;

function translate(node: Element, axis: number) {
  let sum = 0;

  for (
    let e: Element | null = node;
    e;
    e = e.parentNode?.nodeType === 1 ? (e.parentNode as Element) : null
  ) {
    for (const m of (e.getAttribute('transform') ?? '').matchAll(
      /translate\(([-\d.]+)[, ]+([-\d.]+)\)/g,
    )) {
      sum += Number(m[axis + 1]);
    }
  }

  return sum;
}

const sourceGroups = (doc: Document) =>
  all(doc, 'g').filter((g) => g.getAttribute('data-combine') === 'combine');

function noGestures(data: Uint8Array) {
  const midi = readMidiAttacks(data);

  assert.ok(
    midi.tracks.every(
      (t) => t.pitchBends.every((b) => b.value === 8192) && t.controls.every((c) => c.tick === 0),
    ),
  );
}

test('part-combine words retain actual Item identities, text, creation times and source MIDI', async () => {
  const text = source(),
    result = (await converter.convert(text)).scores[0]!;
  const independent = await compiler.compile(text, { format: ['svg', 'midi'] });

  validate(result.musicxml);
  const actual = labels(result.document);

  assert.equal(actual.length, 4);
  assert.deepEqual(
    actual.map((e) => [value(e.moment.main), e.text, e.status]),
    [
      [0, 'a2', 'unisono'],
      [0.5, 'Solo', 'solo1'],
      [1, 'a2', 'unisono'],
      [1.5, 'Solo', 'solo1'],
    ],
  );
  assert.equal(new Set(actual.map((e) => e.id)).size, 4);
  assert.equal(new Set(actual.map((e) => e.context)).size, 2);
  assert.ok(
    actual.every(
      (e) => e.present && e.textObserved && !e.custom && !e.hidden && e.fontEncoding === 'latin1',
    ),
  );
  assert.deepEqual(
    words(result.musicxml).map((e) => e.textContent),
    ['a2', 'Solo', 'a2', 'Solo'],
  );
  const svg = parse(new TextDecoder().decode(file(independent.files, '.svg')));

  assert.deepEqual(
    sourceGroups(svg).map((g) => g.textContent?.trim()),
    ['a2', 'Solo', 'a2', 'Solo'],
  );
  assert.equal(reader.loadData(result.musicxml), 1);
  assert.deepEqual(
    all(parse(reader.getMEI()), 'dir').map((e) => e.textContent?.trim()),
    ['a2', 'Solo', 'a2', 'Solo'],
  );
  assert.equal(
    all(parse(reader.renderToSVG(1)), 'g').filter((g) => g.getAttribute('class') === 'dir').length,
    4,
  );
  const expected = midiTimedNotes(file(independent.files, '.midi')),
    played = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  noGestures(file(independent.files, '.midi'));
  noGestures(Buffer.from(reader.renderToMIDI(), 'base64'));
  assert.ok(!result.diagnostics.some((d) => d.code === 'combine-text-reader'));
});

test('final part-combine baselines and text-font points match independent SVG under scaling and offsets', async () => {
  for (const [setup, config] of [
    ['', ''],
    [
      '#(set-global-staff-size 30)',
      String.raw`\override StaffSymbol.staff-space = #0.7 \override CombineTextScript.extra-offset = #'(3/2 . -7/4)`,
    ],
    [String.raw`\paper { text-font-size = #20 }`, ''],
    [
      '',
      String.raw`\override CombineTextScript.font-name = #"sans-serif" \override CombineTextScript.font-size = #3 \override CombineTextScript.font-shape = #'italic`,
    ],
    [
      '',
      String.raw`\override CombineTextScript.font-name = #"sans-serif Bold Italic" \override CombineTextScript.font-size = #3`,
    ],
  ] as const) {
    const text = setup + source(normal, config),
      result = (await converter.convert(text)).scores[0]!;
    const original = await compiler.compile(text, { format: 'svg' });

    validate(result.musicxml);
    const doc = parse(new TextDecoder().decode(file(original.files, '.svg'))),
      actual = labels(result.document),
      native = words(result.musicxml);
    const staff = all(doc, 'line').filter(
      (l) => Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) > 5,
    );

    assert.equal(staff.length, 5);
    const top = Math.min(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
    const bottom = Math.max(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
    const unit =
      Number(doc.documentElement.getAttribute('width')!.replace('mm', '')) /
      Number(doc.documentElement.getAttribute('viewBox')!.split(/\s+/)[2]);
    const bars = all(doc, 'rect')
      .filter(
        (r) =>
          r.getAttribute('ry') === '0.0000' &&
          Number(r.getAttribute('height')) >= (bottom - top) * 0.9 &&
          Number(r.getAttribute('width')) < 0.3,
      )
      .sort((a, b) => translate(a, 0) - translate(b, 0));
    const ink = sourceGroups(doc)
      .map((g) => all(g, 'text')[0]!)
      .sort((a, b) => translate(a, 0) - translate(b, 0));

    assert.equal(ink.length, 4);

    for (let i = 0; i < 4; i++) {
      const e = actual[i]!,
        space = (bottom - top) / 4 / (e.staffSpace! / e.layoutStaffSpace!);
      const origin =
        i < 2
          ? translate(staff[0]!, 0)
          : translate(bars[0]!, 0) + Number(bars[0]!.getAttribute('x'));

      assert.ok(Math.abs(((translate(ink[i]!, 0) - origin) * 10) / space - e.xTenths!) < 0.004);
      assert.ok(Math.abs(((top - translate(ink[i]!, 1)) * 10) / space - e.yTenths!) < 0.004);
      assert.ok(
        Math.abs(
          (Number(ink[i]!.getAttribute('font-size')) * unit * 72) / 25.4 -
            Number(native[i]!.getAttribute('font-size')),
        ) < 0.003,
      );
      assert.ok(Math.abs(Number(native[i]!.getAttribute('default-x')) - e.xTenths!) < 0.00001);
      assert.ok(Math.abs(Number(native[i]!.getAttribute('default-y')) - e.yTenths!) < 0.00001);
      assert.equal(
        native[i]!.getAttribute('font-weight'),
        ink[i]!.getAttribute('font-weight') ?? 'normal',
      );
      assert.equal(
        native[i]!.getAttribute('font-style'),
        ink[i]!.getAttribute('font-style') ?? 'normal',
      );
    }
  }
});

test('delayed part-combine text uses the actual note-time Item and custom source labels remain markup', async () => {
  const delayed = source(
    String.raw`\set Staff.partCombineTextsOnNote = ##t \partCombine { r4 c'4 d'4 e'4 } { r4 c'4 r4 r4 }`,
  );
  const result = (await converter.convert(delayed)).scores[0]!;

  validate(result.musicxml);
  assert.deepEqual(
    labels(result.document).map((e) => [value(e.moment.main), e.text]),
    [
      [0.25, 'a2'],
      [0.5, 'Solo'],
    ],
  );
  const directions = all(parse(result.musicxml), 'direction').filter((d) => all(d, 'words').length);
  const divisions = Number(all(parse(result.musicxml), 'divisions')[0]!.textContent);

  assert.deepEqual(
    directions.map((d) => Number(all(d, 'offset')[0]!.textContent) / divisions),
    [1, 2],
  );
  const text = source(
    String.raw`\set Staff.soloText = \markup \italic "First alone" \partCombine { c'4 d'4 e'4 f'4 } { r4 r4 e'4 f'4 }`,
  );
  const marked = (await converter.convert(text)).scores[0]!;

  validate(marked.musicxml);
  const original = await compiler.compile(text, { format: 'svg' });

  assert.deepEqual(
    words(marked.musicxml).map((w) => w.textContent),
    ['First alone', 'a2'],
  );
  assert.equal(words(marked.musicxml)[0]!.getAttribute('font-style'), 'italic');
  assert.match(new TextDecoder().decode(file(original.files, '.svg')), /First alone/);
  const namedText = source(
    String.raw`\set Staff.soloText = \markup \italic "Named plain" \partCombine { c'4 d'4 e'4 f'4 } { r4 r4 e'4 f'4 }`,
    String.raw`\override CombineTextScript.font-name = #"sans-serif"`,
  );
  const named = (await converter.convert(namedText)).scores[0]!;
  const namedSource = await compiler.compile(namedText, { format: 'svg' });

  assert.equal(
    words(named.musicxml)[0]!.getAttribute('font-style'),
    'normal',
    'explicit named font also overrides nested italic markup',
  );
  const namedInk = all(
    parse(new TextDecoder().decode(file(namedSource.files, '.svg'))),
    'text',
  ).find((e) => e.textContent === 'Named plain')!;

  assert.equal(namedInk.getAttribute('font-style'), null);
  const uncertain = (
    await converter.convert(
      source(
        normal,
        String.raw`\override CombineTextScript.font-name = #"Nimbus Sans Bold Italic"`,
      ),
    )
  ).scores[0]!;

  assert.ok(
    words(uncertain.musicxml).every(
      (w) =>
        !w.hasAttribute('font-family') &&
        !w.hasAttribute('font-weight') &&
        !w.hasAttribute('font-style'),
    ),
  );
  assert.ok(uncertain.diagnostics.some((d) => d.code === 'combine-text-named-font'));
});

test('disabled, removed and empty part-combine labels do not restore labels from status events', async () => {
  for (const [music, layout] of [
    [String.raw`\set Staff.printPartCombineTexts = ##f ` + normal, ''],
    [normal, String.raw`\context { \Voice \remove Part_combine_engraver }`],
    [String.raw`\set Staff.soloText = ##f \set Staff.aDueText = ##f ` + normal, ''],
  ] as const) {
    const text = source(music, '', layout),
      result = (await converter.convert(text)).scores[0]!;
    const original = await compiler.compile(text, { format: 'svg' });

    validate(result.musicxml);
    assert.equal(labels(result.document).length, 0);
    assert.equal(words(result.musicxml).length, 0);
    assert.equal(
      sourceGroups(parse(new TextDecoder().decode(file(original.files, '.svg')))).length,
      0,
    );
  }
});

test('omitted and transparent part-combine text stays invisible without evaluating an unused formatter', async () => {
  for (const config of [
    String.raw`\override CombineTextScript.stencil = ##f`,
    String.raw`\override CombineTextScript.transparent = ##t`,
  ]) {
    const unused = config.includes('stencil')
      ? String.raw` \override CombineTextScript.before-line-breaking = #(lambda (g) (ly:grob-set-property! g 'text (lambda (actual) (display "UNUSED-COMBINE-FORMATTER\n") "Unused")))`
      : '';
    const text = source(normal, config + unused),
      conversion = await converter.convert(text),
      result = conversion.scores[0]!;

    validate(result.musicxml);
    assert.ok(!conversion.logs.some((l) => l.includes('UNUSED-COMBINE-FORMATTER')));
    assert.ok(labels(result.document).every((e) => e.hidden));
    assert.ok(words(result.musicxml).every((w) => w.getAttribute('color') === '#00000000'));
    const original = await compiler.compile(text, { format: 'svg' });

    assert.ok(!original.logs.some((l) => l.includes('UNUSED-COMBINE-FORMATTER')));
    const doc = parse(new TextDecoder().decode(file(original.files, '.svg')));

    if (config.includes('stencil')) {
      assert.equal(sourceGroups(doc).length, 0);
    }
  }
});

test('part-combine final text formatter is observed once per source Item and opaque drawings are diagnosed', async () => {
  const callback = String.raw`\override CombineTextScript.before-line-breaking = #(lambda (g) (let ((text (ly:grob-property g 'text))) (ly:grob-set-property! g 'text (lambda (actual) (display "COMBINE-TEXT-CALL\n") (string-append text "!")))))`;
  const text = source(normal, callback),
    conversion = await converter.convert(text),
    result = conversion.scores[0]!;
  const original = await compiler.compile(text, { format: ['svg', 'midi'] });

  validate(result.musicxml);

  for (const logs of [conversion.logs, original.logs]) {
    assert.equal(logs.join('\n').split('COMBINE-TEXT-CALL').length - 1, 4);
  }

  assert.deepEqual(
    labels(result.document).map((e) => e.text),
    ['a2!', 'Solo!', 'a2!', 'Solo!'],
  );
  assert.deepEqual(
    words(result.musicxml).map((e) => e.textContent),
    ['a2!', 'Solo!', 'a2!', 'Solo!'],
  );
  assert.ok(labels(result.document).every((e) => e.custom && e.textObserved));
  const opaque = (
    await converter.convert(
      source(
        normal,
        String.raw`\override CombineTextScript.stencil = #(lambda (g) (make-filled-box-stencil '(0 . 2) '(0 . 1)))`,
      ),
    )
  ).scores[0]!;

  assert.ok(labels(opaque.document).every((e) => e.custom && !e.textObserved));
  assert.equal(words(opaque.musicxml).length, 0);
  assert.ok(opaque.diagnostics.some((d) => d.code === 'combine-text-stencil'));
});

test('part-combine labels retain actual staff ownership and final systems with shared generated voice names', async () => {
  const staff = (name: string, label: string) =>
    String.raw`\new Staff = "${name}" \with { soloText = "${label} alone" aDueText = "${label} together" } { \partCombine { c'4 d'4 e'4 f'4 \break g'4 a'4 b'4 c''4 } { c'4 d'4 r4 r4 g'4 a'4 r4 r4 } }`;
  const text = String.raw`\score { \new PianoStaff << ${staff('upper', 'Upper')} ${staff('lower', 'Lower')} >> \layout {} \midi {} }`;
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const actual = labels(result.document);

  assert.equal(actual.length, 8);
  assert.equal(new Set(actual.map((e) => e.staff)).size, 2);
  assert.ok(actual.every((e) => value(e.xReference!.main) === Math.floor(value(e.moment.main))));
  const directions = all(parse(result.musicxml), 'direction').filter((d) => all(d, 'words').length);

  assert.deepEqual(
    new Set(
      directions
        .filter((d) => d.textContent?.includes('Upper'))
        .map((d) => all(d, 'staff')[0]!.textContent),
    ),
    new Set(['1']),
  );
  assert.deepEqual(
    new Set(
      directions
        .filter((d) => d.textContent?.includes('Lower'))
        .map((d) => all(d, 'staff')[0]!.textContent),
    ),
    new Set(['2']),
  );
  const independent = await compiler.compile(text, { format: 'svg' }),
    svg = new TextDecoder().decode(file(independent.files, '.svg'));

  assert.match(svg, /Upper together/);
  assert.match(svg, /Lower alone/);
});

test('part-combine JSON caching preserves source labels and guards mismatched origins and score reset', async () => {
  const result = (await converter.convert(source())).scores[0]!;
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;
  const replay = toMusicXML(cached);

  validate(replay.musicxml);
  assert.deepEqual(
    words(replay.musicxml).map((w) => w.textContent),
    words(result.musicxml).map((w) => w.textContent),
  );
  const changed = {
    ...cached,
    events: cached.events.map((e) =>
      e.kind === 'combineText'
        ? {
            ...e,
            xReference: {
              main: { numerator: 99, denominator: 1 },
              grace: { numerator: 0, denominator: 1 },
            },
          }
        : e,
    ),
  };
  const wrongOrigin = toMusicXML(changed);

  assert.ok(words(wrongOrigin.musicxml).every((w) => !w.hasAttribute('default-x')));
  assert.ok(wrongOrigin.diagnostics.some((d) => d.code === 'combine-text-position'));
  delete cached.combineTextCaptured;
  assert.ok(toMusicXML(cached).diagnostics.some((d) => d.code === 'combine-text-history'));
  const scores = (await converter.convert(source() + source())).scores;

  assert.deepEqual(
    scores.map((s) => labels(s.document).map((e) => e.id)),
    [
      [1, 2, 3, 4],
      [1, 2, 3, 4],
    ],
  );
  const next = (await converter.convert(source(String.raw`c'1`))).scores[0]!;

  assert.equal(labels(next.document).length, 0);
  assert.equal(words(next.musicxml).length, 0);
});
