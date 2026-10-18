import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { create } from 'xmlbuilder2';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { childElements, elements as all, parse } from '../../support/xml-support.js';

const converter = createConverter(),
  compiler = createReusableCompiler();
const reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});
const score = (music: string) =>
  String.raw`\score { \new Staff = "solo" { ${music} } \layout {} \midi { \tempo 4=120 } }`;

const backwards = (xml: string) =>
  all(parse(xml), 'repeat').filter((e) => e.getAttribute('direction') === 'backward');
const independent = async (source: string) => {
  const output = await compiler.compile(source, { format: ['svg', 'midi'] });
  const midi = Object.entries(output.files).find(([name]) => name.endsWith('.midi'))![1];
  const svg = new TextDecoder().decode(
    Object.entries(output.files).find(([name]) => name.endsWith('.svg'))![1],
  );

  assert.ok(
    all(parse(svg), 'path').filter((p) => p.getAttribute('d')?.startsWith('M0 0c0 31 25 56'))
      .length >= 2,
    'independent pinned source SVG actually prints repeat dots',
  );

  return { notes: midiTimedNotes(midi), svg };
};
const render = (xml: string) => {
  validate(xml);
  reader.setOptions({ xmlIdSeed: 1 });
  assert.equal(reader.loadData(xml), 1);
  const svg = reader.renderToSVG(1),
    dom = parse(svg);
  const geometry = all(dom, '*').map((e) => [
    e.localName,
    ...['class', 'd', 'transform', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2'].map((k) =>
      e.getAttribute(k),
    ),
  ]);

  return { notes: midiTimedNotes(reader.renderToMIDI()), geometry };
};
const samePerformance = (
  actual: ReturnType<typeof midiTimedNotes>,
  expected: ReturnType<typeof midiTimedNotes>,
) => {
  assert.deepEqual(
    actual.map(({ pitch, velocity, onset }) => ({ pitch, velocity, onset })),
    expected.map(({ pitch, velocity, onset }) => ({ pitch, velocity, onset })),
  );
  actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
};
const mutate = (xml: string, action: (repeat: Element) => void) => {
  const root = create(xml);

  for (const repeat of all(root.node, 'repeat').filter(
    (e) => e.getAttribute('direction') === 'backward',
  )) {
    action(repeat);
  }

  return root.end();
};

for (const [name, music] of [
  ['metrical', String.raw`c'1 \bar ":|."`],
  ['free cadenza', String.raw`\cadenzaOn c'1 \bar ":|." \cadenzaOff`],
] as const) {
  test(`glyph-only ${name} backward bar preserves repeat dots and actual once-only playback`, async () => {
    const source = score(music),
      expected = await independent(source),
      converted = (await converter.convert(source)).scores[0]!;

    assert.equal(expected.notes.length, 1);
    const repeats = backwards(converted.musicxml);

    assert.equal(repeats.length, 1);
    assert.equal(repeats[0]!.getAttribute('times'), '1');
    assert.ok(
      !converted.document.events.some(
        (e) => 'class' in e && String(e.class).startsWith('volta-repeat'),
      ),
    );
    const actual = render(converted.musicxml);

    samePerformance(actual.notes, expected.notes);
    const defaultRepeat = render(mutate(converted.musicxml, (r) => r.removeAttribute('times')));

    assert.equal(defaultRepeat.notes.length, 2);
    assert.deepEqual(
      actual.geometry,
      defaultRepeat.geometry,
      'times1 changes performance without losing repeat-sign appearance',
    );
    const noRepeat = render(mutate(converted.musicxml, (r) => r.parentNode!.removeChild(r)));

    assert.notDeepEqual(
      actual.geometry,
      noRepeat.geometry,
      'removing the repeat child would lose the actual source dots',
    );
  });
}

test('semantic three-pass volta plus a manual glyph emits one authoritative backward count in metrical and free music', async () => {
  for (const music of [
    String.raw`\repeat volta 3 { c'1 \bar ":|." } d'1`,
    String.raw`\cadenzaOn \repeat volta 3 { c'4 d'4 \bar ":|." } \cadenzaOff e'1`,
  ]) {
    const source = score(music),
      folded = await independent(source),
      converted = (await converter.convert(source)).scores[0]!;
    const repeats = backwards(converted.musicxml);

    assert.equal(repeats.length, 1);
    assert.equal(repeats[0]!.getAttribute('times'), '3');
    const firstMeasure = all(parse(converted.musicxml), 'measure')[0]!;
    const children = childElements(firstMeasure);
    const left = children.findIndex(
      (n) => n.tagName === 'barline' && n.getAttribute('location') === 'left',
    );

    assert.ok(left >= 0);

    for (const kind of ['attributes', 'note']) {
      assert.ok(
        left < children.findIndex((n) => n.tagName === kind),
        'left barline precedes measure content as specified',
      );
    }

    assert.ok(
      converted.document.events.some((e) => 'class' in e && e.class === 'volta-repeat-end-event'),
    );
    // Folded LilyPond MIDI plays its body once. Compare semantic traversal to an
    // explicit independent unfolded source; do not relabel folded MIDI as three passes.
    assert.equal(folded.notes.length, music.includes('cadenza') ? 3 : 2);
    const unfolded = await independent(score(String.raw`\unfoldRepeats { ${music} }`));
    const actual = render(converted.musicxml);

    samePerformance(actual.notes, unfolded.notes);
    assert.equal(actual.notes.length, music.includes('cadenza') ? 7 : 4);

    if (!music.includes('cadenza')) {
      const cached = JSON.parse(JSON.stringify(converted.document)) as ScoreDocument;
      const end = cached.events.find((e) => 'class' in e && e.class === 'volta-repeat-end-event')!;

      cached.events = [...cached.events, { ...end, repeatCount: 2 }];
      const ambiguous = toMusicXML(cached);

      validate(ambiguous.musicxml);
      assert.deepEqual(
        backwards(ambiguous.musicxml)
          .map((r) => Number(r.getAttribute('times')))
          .sort(),
        [1, 2, 3],
        'ambiguous semantic ends remain distinct while the glyph alone plays once',
      );
      assert.ok(ambiguous.diagnostics.some((d) => d.code === 'barline-repeat-ownership'));
    }
  }
});

test('terminal label uses actual repeat-glyph fallback with times1 and retains cache/reset behavior', async () => {
  const text = score(String.raw`\override Staff.BarLine.glyph-name = ":|." c'1 \label #'finish`);
  const expected = await independent(text),
    converted = (await converter.convert(text)).scores[0]!;

  assert.ok(converted.document.events.some((e) => e.kind === 'barline' && e.glyph === ':|.'));
  assert.ok(
    !converted.document.events.some((e) => 'class' in e && e.class === 'bar-event'),
    'actual graphical override has no bare bar command to manufacture a sibling',
  );
  const repeats = backwards(converted.musicxml);

  assert.equal(repeats.length, 1);
  assert.equal(repeats[0]!.getAttribute('times'), '1');
  const bookmark = all(parse(converted.musicxml), 'bookmark').find(
    (b) => b.getAttribute('name') === 'finish',
  )!;

  assert.ok(bookmark);
  let next = bookmark.nextSibling;

  while (next && (next.nodeType !== 1 || ['bookmark', 'link'].includes(next.nodeName))) {
    next = next.nextSibling;
  }

  assert.equal(next?.nodeName, 'barline');
  assert.equal(all(next as Element, 'repeat')[0]!.getAttribute('times'), '1');
  const actual = render(converted.musicxml);

  samePerformance(actual.notes, expected.notes);
  assert.deepEqual(
    actual.geometry,
    render(mutate(converted.musicxml, (r) => r.removeAttribute('times'))).geometry,
  );
  const cached = toMusicXML(JSON.parse(JSON.stringify(converted.document)) as ScoreDocument);

  validate(cached.musicxml);
  assert.equal(backwards(cached.musicxml)[0]!.getAttribute('times'), '1');
  samePerformance(render(cached.musicxml).notes, expected.notes);
  const reset = (await converter.convert(score("d'1"))).scores[0]!;

  validate(reset.musicxml);
  assert.equal(backwards(reset.musicxml).length, 0);
  assert.equal(all(parse(reset.musicxml), 'bookmark').length, 0);
});
