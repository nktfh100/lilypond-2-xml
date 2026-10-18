import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { create } from 'xmlbuilder2';
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

const tags = ['turn', 'staccato', 'up-bow', 'fermata'];
const source = (setup: string, step: number) =>
  setup +
  String.raw`\score { \new Staff { \override Script.color = #red \override Script.font-size = #${step} c'4\turn d'\staccato e'\upbow f'\fermata } \layout {} }`;
const readerShapes = (svg: string) =>
  all(parse(svg), 'use')
    .map((u) => ({
      glyph: u.getAttribute('xlink:href')?.split('-')[0],
      transform: u.getAttribute('transform'),
    }))
    .filter((u) => ['#E4A3', '#E612', '#E567', '#E4C0'].includes(u.glyph ?? ''));

test('actual music glyph SVG em sizes agree with native Script points across steps, staff and text sizes', async () => {
  const results = [];

  for (const [name, setup, step, expected] of [
    ['default', '', 0, 20],
    ['large', '', 6, 40],
    ['small', '', -6, 10],
    ['staff30', '#(set-global-staff-size 30)', 0, 30],
    ['text20', String.raw`\paper { text-font-size = #20 }`, 0, 20],
  ] as const) {
    const text = source(setup, step);
    const [{ scores }, independent] = await Promise.all([
      converter.convert(text),
      compiler.compile(text, { format: 'svg' }),
    ]);
    const converted = scores[0]!;

    validate(converted.musicxml);
    const svg = parse(
      new TextDecoder().decode(
        Object.entries(independent.files).find(([n]) => n.endsWith('.svg'))![1],
      ),
    );
    const root = svg.documentElement,
      mmPerUnit =
        Number(root.getAttribute('width')!.replace('mm', '')) /
        Number(root.getAttribute('viewBox')!.split(/\s+/)[2]);
    const red = all(svg, 'g').filter(
      (g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
    );

    assert.equal(red.length, 4, name);
    const physicalPoints = red.map((g) => {
      const path = all(g, 'path')[0]!,
        match = /scale\(([\d.]+),/.exec(path.getAttribute('transform')!)!;

      // These independently emitted Emmentaler outlines use 1000 glyph units per em.
      return (Number(match[1]) * 1000 * mmPerUnit * 72) / 25.4;
    });
    const xml = parse(converted.musicxml),
      graphics = converted.document.events.filter((e) => e.kind === 'script');

    assert.equal(graphics.length, 4);

    for (const [i, tag] of tags.entries()) {
      const points = Number(all(xml, tag)[0]!.getAttribute('font-size'));

      assert.ok(
        Math.abs(points - physicalPoints[i]!) < 0.0001,
        `${name} ${tag}: native ${points}, source ${physicalPoints[i]}`,
      );
      assert.ok(Math.abs(points - (expected * 72) / 72.27) < 1e-8);
      assert.ok(Math.abs(graphics[i]!.fontPoints! - points) < 1e-8);
    }

    assert.ok(!converted.diagnostics.some((d) => d.code === 'script-size-reader'));
    assert.equal(reader.loadData(converted.musicxml), 1);
    const mei = parse(reader.getMEI());

    for (const tag of ['artic', 'turn', 'fermata']) {
      for (const mark of all(mei, tag)) {
        assert.equal(mark.getAttribute('fontsize'), null);
      }
    }

    results.push({ name, shapes: readerShapes(reader.renderToSVG(1)) });
  }

  assert.deepEqual(results[1]!.shapes, results[0]!.shapes);
  assert.deepEqual(results[2]!.shapes, results[0]!.shapes);
});

test('physical Script font points survive JSON while missing or invalid provenance stays diagnosed', async () => {
  const { scores } = await converter.convert(source('', 6));
  const document = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;
  const cached = toMusicXML(document);

  validate(cached.musicxml);

  for (const tag of tags) {
    assert.ok(
      Math.abs(
        Number(all(parse(cached.musicxml), tag)[0]!.getAttribute('font-size')) - (40 * 72) / 72.27,
      ) < 1e-8,
    );
  }

  for (const value of [undefined, null, 0, -1, Infinity, NaN]) {
    const missing: ScoreDocument = {
      ...document,
      events: document.events.map((e) => {
        if (e.kind !== 'script') {
          return e;
        }

        const { fontPoints, ...old } = e;

        return value === undefined ? old : { ...old, fontPoints: value };
      }),
    };
    const result = toMusicXML(missing);

    validate(result.musicxml);
    assert.ok(
      result.diagnostics.some(
        (d) =>
          d.code ===
          (value === undefined || value === null ? 'script-size-history' : 'script-size-data'),
      ),
      `invalid provenance ${value}`,
    );

    for (const tag of tags) {
      assert.equal(all(parse(result.musicxml), tag)[0]!.getAttribute('font-size'), null);
    }
  }
});

test('Script sizing remains separate across staves and resets between scores', async () => {
  const { scores } = await converter.convert(
    String.raw`\score { \new PianoStaff << \new Staff { \override Script.font-size = #6 c'1\turn } \new Staff { \override Script.font-size = #-6 c1\fermata } >> } \score { { c'1\turn } }`,
  );

  assert.equal(scores.length, 2);
  scores.forEach((s) => validate(s.musicxml));
  assert.ok(
    Math.abs(
      Number(all(parse(scores[0]!.musicxml), 'turn')[0]!.getAttribute('font-size')) -
        (40 * 72) / 72.27,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(
      Number(all(parse(scores[0]!.musicxml), 'fermata')[0]!.getAttribute('font-size')) -
        (10 * 72) / 72.27,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(
      Number(all(parse(scores[1]!.musicxml), 'turn')[0]!.getAttribute('font-size')) -
        (20 * 72) / 72.27,
    ) < 1e-8,
  );
});

test('direct breath musicglyph sizes use their actual music font despite explicit text font names', async () => {
  let readerBase: ReturnType<typeof readerShapes> | undefined;

  for (const [name, paper, setup, expected] of [
    ['default', '', '', 20],
    ['named', '', String.raw`\override BreathingSign.font-name = #"serif"`, 20],
    [
      'text20',
      String.raw`\paper { text-font-size = #20 }`,
      String.raw`\override BreathingSign.font-name = #"serif"`,
      20,
    ],
    ['large', '', String.raw`\override BreathingSign.font-size = #6`, 40],
  ] as const) {
    const text =
      paper +
      String.raw`\score { { \override BreathingSign.color = #red ${setup}
      c'2 \breathe d'2 \override BreathingSign.text = \markup \musicglyph "scripts.caesura.curved" \breathe } \layout {} }`;
    const [{ scores }, independent] = await Promise.all([
      converter.convert(text),
      compiler.compile(text, { format: 'svg' }),
    ]);
    const converted = scores[0]!;

    validate(converted.musicxml);
    const svg = parse(
      new TextDecoder().decode(
        Object.entries(independent.files).find(([n]) => n.endsWith('.svg'))![1],
      ),
    );
    const root = svg.documentElement,
      unit =
        Number(root.getAttribute('width')!.replace('mm', '')) /
        Number(root.getAttribute('viewBox')!.split(/\s+/)[2]);
    const red = all(svg, 'g').filter(
      (g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
    );

    assert.equal(red.length, 2, name);
    const physical = red.map(
      (g) =>
        (Number(/scale\(([\d.]+),/.exec(all(g, 'path')[0]!.getAttribute('transform')!)![1]) *
          1000 *
          unit *
          72) /
        25.4,
    );
    const graphics = converted.document.events
      .filter((e) => e.kind === 'script')
      .filter((e) => e.breathSign);

    assert.equal(graphics.length, 2);

    for (const [i, tag] of ['breath-mark', 'caesura'].entries()) {
      const points = Number(all(parse(converted.musicxml), tag)[0]!.getAttribute('font-size'));

      assert.ok(
        Math.abs(points - physical[i]!) < 0.0001,
        `${name} ${tag}: actual source music font`,
      );
      assert.ok(Math.abs(points - (expected * 72) / 72.27) < 1e-8);
      assert.ok(Math.abs(graphics[i]!.fontPoints! - points) < 1e-8);
    }

    const cache = toMusicXML(JSON.parse(JSON.stringify(converted.document)) as ScoreDocument);

    validate(cache.musicxml);
    assert.equal(
      all(parse(cache.musicxml), 'caesura')[0]!.getAttribute('font-size'),
      all(parse(converted.musicxml), 'caesura')[0]!.getAttribute('font-size'),
    );

    if (name === 'default') {
      for (const points of [10, 20, 40]) {
        const prototype = create(converted.musicxml);

        for (const tag of ['breath-mark', 'caesura']) {
          all(prototype.node, tag)[0]!.setAttribute('font-size', String(points));
        }

        const xml = prototype.end({ prettyPrint: true });

        validate(xml);
        assert.equal(reader.loadData(xml), 1);
        const mei = parse(reader.getMEI());

        for (const tag of ['breath', 'caesura']) {
          assert.equal(all(mei, tag)[0]!.getAttribute('fontsize'), null);
        }

        const shapes = all(parse(reader.renderToSVG(1)), 'g')
          .filter((g) => ['breath', 'caesura'].includes(g.getAttribute('class') || ''))
          .flatMap((g) =>
            all(g, 'use').map((u) => ({
              glyph: u.getAttribute('xlink:href')?.split('-')[0],
              transform: u.getAttribute('transform'),
            })),
          );

        assert.equal(shapes.length, 2);

        if (readerBase) {
          assert.deepEqual(shapes, readerBase);
        } else {
          readerBase = shapes;
        }
      }
    }
  }
});

test('mixed, custom and legacy breath markup keeps native shapes without guessed physical font points', async () => {
  const { scores } = await converter.convert(String.raw`\score { { c'4
    \override BreathingSign.text = \markup \concat { \musicglyph "scripts.rcomma" \fontsize #6 \musicglyph "scripts.rcomma" } \breathe
    d'4 \override BreathingSign.text = \markup \musicglyph "scripts.rcomma"
    \override BreathingSign.stencil = #(lambda (grob) (ly:text-interface::print grob)) \breathe e'2 } \layout {} }`);
  const converted = scores[0]!;

  validate(converted.musicxml);
  const graphics = converted.document.events
    .filter((e) => e.kind === 'script')
    .filter((e) => e.breathSign);

  assert.equal(graphics.length, 2);

  for (const graphic of graphics) {
    assert.equal(graphic.fontPoints, null);
  }

  assert.ok(converted.diagnostics.some((d) => d.code === 'breath-glyph'));
  assert.ok(converted.diagnostics.some((d) => d.code === 'breath-stencil'));

  for (const mark of all(parse(converted.musicxml), 'breath-mark')) {
    assert.equal(mark.getAttribute('font-size'), null);
  }

  const plain = await converter.convert(String.raw`{c'1 \breathe}`);
  const document = JSON.parse(JSON.stringify(plain.scores[0]!.document)) as ScoreDocument;
  const legacy: ScoreDocument = {
    ...document,
    events: document.events.map((e) => {
      if (e.kind !== 'script') {
        return e;
      }

      const { fontPoints, ...old } = e;

      return old;
    }),
  };
  const cached = toMusicXML(legacy);

  validate(cached.musicxml);
  assert.equal(all(parse(cached.musicxml), 'breath-mark')[0]!.getAttribute('font-size'), null);
  assert.ok(cached.diagnostics.some((d) => d.code === 'script-size-history'));
});

test('missing glyphs from an explicit Script text font stay invisible through cache and reset for the next score', async () => {
  const text = String.raw`\score { { \override Script.color = #red \override Script.font-name = #"serif" c'4\turn d'\staccato e'\upbow f'\fermata } \layout {} }
    \score { { \override Script.color = #red c'4\turn d'\staccato e'\upbow f'\fermata } \layout {} }`;
  const [{ scores }, independent] = await Promise.all([
    converter.convert(text),
    compiler.compile(text, { format: 'svg' }),
  ]);

  assert.equal(scores.length, 2);
  scores.forEach((s) => validate(s.musicxml));
  const sourceGroups = Object.entries(independent.files)
    .filter(([n]) => n.endsWith('.svg'))
    .flatMap(([, bytes]) =>
      all(parse(new TextDecoder().decode(bytes)), 'g').filter(
        (g) => g.getAttribute('color') === 'rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)',
      ),
    );

  assert.equal(sourceGroups.length, 8);
  assert.ok(
    sourceGroups
      .slice(0, 4)
      .every((g) => all(g, 'path').length === 0 && all(g, 'text').length === 0),
    'source text-font scripts actually contain no glyph drawing',
  );
  assert.ok(
    sourceGroups.slice(4).every((g) => all(g, 'path').length > 0),
    'next source score restores actual music glyphs',
  );
  const missing = scores[0]!,
    normal = scores[1]!;
  const graphics = missing.document.events.filter((e) => e.kind === 'script');

  assert.equal(graphics.length, 4);

  for (const graphic of graphics) {
    assert.equal(graphic.glyphMissing, true);
    assert.equal(graphic.hidden, true);
    assert.equal(graphic.fontPoints, null);
  }

  assert.ok(missing.diagnostics.some((d) => d.code === 'script-font-glyph'));
  const cached = toMusicXML(JSON.parse(JSON.stringify(missing.document)) as ScoreDocument);

  validate(cached.musicxml);
  assert.ok(cached.diagnostics.some((d) => d.code === 'script-font-glyph'));

  for (const xml of [missing.musicxml, cached.musicxml]) {
    for (const tag of tags) {
      for (const mark of all(parse(xml), tag)) {
        assert.ok(
          mark.getAttribute('color') === '#00000000',
          `${tag} must not become a visible native mark when its actual source glyph is missing`,
        );
        assert.equal(mark.getAttribute('font-size'), null);
      }
    }
  }

  for (const graphic of normal.document.events.filter((e) => e.kind === 'script')) {
    assert.notEqual(graphic.glyphMissing, true);
    assert.equal(graphic.hidden, false);
    assert.ok(graphic.fontPoints! > 0);
  }

  for (const tag of tags) {
    const mark = all(parse(normal.musicxml), tag)[0]!;

    assert.ok(mark, tag);
    assert.equal(mark.getAttribute('color'), '#FF0000');
    assert.ok(Number(mark.getAttribute('font-size')) > 0);
  }
});
