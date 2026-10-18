import type { Element, Node } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import listener from '../../../dist/lilypond/generated/listener.js';
import type { WireEvent } from '../../../src/lilypond/wire.js';
import { elements, parse } from '../../support/xml-support.js';

const compiler = createReusableCompiler();

after(() => compiler.dispose());

const output = (files: Record<string, Uint8Array>, suffix: string) => {
  const entry = Object.entries(files).find(([name]) => name.endsWith(suffix));

  assert.ok(entry, `compiler output ${suffix}`);

  return entry[1];
};
const source = (staff = '', figureMarkup = String.raw`<6>2 <4>2`) => String.raw`\version "2.26.0"
#(define (g23-source-post paper pages) (format #t "G23-SOURCE-POST ~a\n" (length pages)))
\paper { page-post-process = #g23-source-post }
\score { << \new Staff = "bass" \with { ${staff} } { \clef bass c'1 } \new FiguredBass = "figures" \figuremode { ${figureMarkup} } >> \layout {} \midi { \tempo 4=120 } }`;
const file = (files: Record<string, Uint8Array>, suffix: string) => output(files, suffix);
const compileObserved = (text: string) =>
  compiler.compile(text, {
    format: ['svg', 'midi'],
    files: { 'g23-observer.ily': listener },
    includeSettings: 'g23-observer.ily',
  });
const compileBaseline = (text: string) => compiler.compile(text, { format: ['svg', 'midi'] });

type RawEvent = Record<string, unknown>;
const document = (files: Record<string, Uint8Array>) =>
  JSON.parse(new TextDecoder().decode(file(files, '.events.json'))) as {
    paper: Record<string, number>;
    events: RawEvent[];
  };
const close = (actual: number, expected: number, message: string) =>
  assert.ok(Math.abs(actual - expected) < 0.0002, `${message}: ${actual} vs ${expected}`);
const translate = (element: Element) => {
  const match = (element.getAttribute('transform') ?? '').match(
    /^translate\(\s*([-\d.e+]+)[, ]+([-\d.e+]+)\s*\)$/,
  );

  return match ? ([Number(match[1]), Number(match[2])] as const) : undefined;
};
const sumTranslate = (element: Element): readonly [number, number] => {
  let x = 0;
  let y = 0;

  for (let current: Node | null = element; current?.nodeType === 1; current = current.parentNode) {
    const point = translate(current as Element);

    if (point) {
      x += point[0];
      y += point[1];
    }
  }

  return [x, y];
};
const staffLineYs = (svg: string) => {
  const doc = parse(svg);
  const ys = elements(doc, 'line')
    .filter(
      (line) => Math.abs(Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'))) > 5,
    )
    .map((line) => {
      let y = Number(line.getAttribute('y1'));

      for (
        let parent: Node | null = line.parentNode;
        parent?.nodeType === 1;
        parent = parent.parentNode
      ) {
        const t = translate(parent as Element);

        if (t) {
          y += t[1];
        }
      }

      return Number(y.toFixed(4));
    });

  return [...new Set(ys)].sort((a, b) => a - b);
};
const figureGlyphOrigins = (svg: string) => {
  const doc = parse(svg);

  return elements(doc, 'g').flatMap((group) => {
    const point = translate(group);

    return point && group.getElementsByTagName('path').length > 0 ? [point] : [];
  });
};

test('actual figured-bass grob positions match source SVG while capture preserves playback and callbacks', async () => {
  const variants = [
    ['', String.raw`<6 4>2 <5>2`, 1],
    [String.raw`\override StaffSymbol.staff-space = #0.7`, String.raw`<6 4>2 <5>2`, 0.7],
    ['', String.raw`\once \override BassFigure.extra-offset = #'(1/3 . -2/3) <6 4>2 <5>2`, 1],
  ] as const;

  for (const [staff, figures, staffScale] of variants) {
    const text = source(staff, figures);
    const [plain, captured] = await Promise.all([compileBaseline(text), compileObserved(text)]);
    const svgNames = Object.keys(plain.files)
      .filter((name) => name.endsWith('.svg'))
      .sort();

    assert.ok(svgNames.length > 0);

    for (const name of svgNames) {
      assert.deepEqual(
        captured.files[name],
        plain.files[name],
        'listener keeps source SVG bytes identical',
      );
    }

    assert.ok(
      Object.keys(captured.files).every((name) => !name.endsWith('.midi')),
      'notation observer emits no MIDI',
    );
    const callbacks = (logs: readonly string[]) =>
      logs.filter((line) => line.startsWith('G23-SOURCE-POST '));

    assert.deepEqual(
      callbacks(captured.logs),
      callbacks(plain.logs),
      'listener preserves callback count and order',
    );

    const capturedDocument = document(captured.files);
    const rows = capturedDocument.events;
    const graphics = rows.filter(
      (event): event is Extract<WireEvent, { k: 'figuregraphic' }> => event.k === 'figuregraphic',
    );

    assert.equal(graphics.length, 3);
    const positioned = graphics.map((event) => {
      assert.ok(event.position);

      return event.position;
    });

    assert.ok(positioned.every((position) => position && position['stencil-live'] === true));
    assert.ok(
      positioned.every((position) => position['system'] === 1 && position['staff-context'] > 0),
    );
    assert.ok(positioned.every((position) => position['column-used'] === true));
    assert.equal(
      positioned[0]!['system-x-tenths'],
      positioned[1]!['system-x-tenths'],
      'stacked 6/4 share one source column',
    );
    assert.notEqual(
      positioned[0]!['y-tenths'],
      positioned[1]!['y-tenths'],
      'stacked rows have independent vertical placement',
    );
    assert.notEqual(
      positioned[0]!['system-x-tenths'],
      positioned[2]!['system-x-tenths'],
      'the later 5 occupies a distinct source column',
    );
    const measurements = rows.filter(
      (event): event is Extract<WireEvent, { k: 'measure-layout' }> => event.k === 'measure-layout',
    );
    const globalStaffSpace = capturedDocument.paper['staff-space'];

    assert.ok(
      globalStaffSpace !== undefined && Number.isFinite(globalStaffSpace) && globalStaffSpace > 0,
      'actual document global staff-space is captured',
    );
    const svg = new TextDecoder().decode(file(captured.files, '.svg'));
    const ys = staffLineYs(svg);

    assert.ok(ys.length >= 5, `independent SVG staff lines: ${ys}`);
    const staffTopY = ys[0]!;
    const glyphOrigins = figureGlyphOrigins(svg);

    assert.ok(glyphOrigins.length >= 3);

    for (const position of positioned) {
      const measure = measurements.find(
        (event) => event.system === position.system && event.s === position['staff-context'],
      );

      assert.ok(measure, 'position joins to measure layout in exact source system/staff frame');
      const expectedX =
        (Number(measure['system-left-x-tenths']) + position['system-x-tenths']) / 10;
      const expectedY = staffTopY - position['y-tenths'] / 10;

      assert.ok(
        glyphOrigins.some(
          ([x, y]) => Math.abs(x - expectedX) < 0.0002 && Math.abs(y - expectedY) < 0.0002,
        ),
        `SVG figure origin matches captured source position (${expectedX}, ${expectedY})`,
      );
      const numberOffset = position.tokens?.number;

      assert.ok(
        numberOffset,
        'recognized default formatter exposes its uniquely mapped number glyph origin',
      );
      const expectedNumber: readonly [number, number] = [
        expectedX + Number(numberOffset[0]) / 10,
        expectedY - Number(numberOffset[1]) / 10,
      ];

      assert.ok(
        glyphOrigins.some(
          ([x, y]) =>
            Math.abs(x - expectedNumber[0]) < 0.0002 && Math.abs(y - expectedNumber[1]) < 0.0002,
        ),
        `number token offset independently matches rendered SVG glyph (${expectedNumber})`,
      );
      const xExtent = position['stencil-x-tenths'] as number[];
      const yExtent = position['stencil-y-tenths'] as number[];

      assert.equal(xExtent.length, 2);
      assert.equal(yExtent.length, 2);
      assert.ok(xExtent.every(Number.isFinite) && yExtent.every(Number.isFinite));
      close(
        Number(position['output-scale']) * position['layout-staff-space'],
        globalStaffSpace,
        'raw source-layout tenths normalize to the actual document global staff-space',
      );
    }

    const scaledGaps = ys.slice(1).map((y, index) => y - ys[index]!);
    const avgGap = scaledGaps.reduce((sum, value) => sum + value, 0) / scaledGaps.length;

    close(avgGap, staffScale, 'actual SVG staff-space reflects the requested staff scale');

    if (staffScale === 0.7) {
      assert.ok(
        positioned.every((position) => Math.abs(position['local-staff-space'] - 0.7) < 0.0001),
        'captured local staff-space retains the observed resized staff scale',
      );
      close(
        avgGap * Number(positioned[0]!['output-scale']),
        globalStaffSpace * 0.7,
        'independent SVG resized gap converts through output scale to local physical staff-space',
      );
    }
  }
});

test('standard figured-bass modifier roles map to tagged source SVG leaves and custom renderers fail closed', async () => {
  const text = String.raw`\version "2.26.0"
#(define g23-custom-stencil-count 0)
#(define (g23-custom-stencil grob) (set! g23-custom-stencil-count (+ g23-custom-stencil-count 1)) (ly:text-interface::print grob))
#(define (g23-custom-formatter figure event context) (format-bass-figure figure event context))
#(define (g23-source-post paper pages) (format #t "G23-SOURCE-POST ~a ~a\n" (length pages) g23-custom-stencil-count))
\paper { page-post-process = #g23-source-post }
\score { << \new Staff = "bass" { \clef bass c'1 c'1 c'1 c'1 c'1 }
  \new FiguredBass = "figures" \figuremode {
    \once \override BassFigure.output-attributes = #'((data-figure . "plus-left")) <6+>1
    \set figuredBassPlusDirection = #RIGHT
    \once \override BassFigure.output-attributes = #'((data-figure . "plus-right")) <6\+>1
    \set figuredBassAlterationDirection = #RIGHT
    \once \override BassFigure.output-attributes = #'((data-figure . "sharp-right")) <6->1
    \set figuredBassFormatter = #g23-custom-formatter
    \once \override BassFigure.output-attributes = #'((data-figure . "custom-formatter")) <6>1
    \set figuredBassFormatter = #format-bass-figure
    \once \override BassFigure.stencil = #g23-custom-stencil
    \once \override BassFigure.output-attributes = #'((data-figure . "custom-stencil")) <6>1
  } >> \layout {} \midi { \tempo 4=120 } }`;
  const [plain, captured] = await Promise.all([compileBaseline(text), compileObserved(text)]);
  const svgNames = Object.keys(plain.files)
    .filter((name) => name.endsWith('.svg'))
    .sort();

  assert.ok(svgNames.length > 0);

  for (const name of svgNames) {
    assert.deepEqual(captured.files[name], plain.files[name], 'source SVG remains byte-identical');
  }

  assert.ok(
    Object.keys(captured.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  const callbacks = (logs: readonly string[]) =>
    logs.filter((line) => line.startsWith('G23-SOURCE-POST '));

  assert.deepEqual(
    callbacks(captured.logs),
    callbacks(plain.logs),
    'formatter/stencil and page callback sequences remain identical',
  );
  const graphics = document(captured.files).events.filter(
    (event): event is Extract<WireEvent, { k: 'figuregraphic' }> => event.k === 'figuregraphic',
  );

  assert.equal(graphics.length, 5);

  for (const graphic of graphics) {
    assert.ok(graphic.position && graphic.position['stencil-live']);
  }

  const events = document(captured.files).events;
  const svg = parse(new TextDecoder().decode(file(captured.files, '.svg')));
  const tagged = elements(svg, 'g').filter((group) => group.hasAttribute('data-figure'));

  assert.deepEqual(tagged.map((group) => group.getAttribute('data-figure')).sort(), [
    'custom-formatter',
    'custom-stencil',
    'plus-left',
    'plus-right',
    'sharp-right',
  ]);
  const measureLayouts = events.filter(
    (event): event is Extract<WireEvent, { k: 'measure-layout' }> => event.k === 'measure-layout',
  );
  const staffTops = staffLineYs(new TextDecoder().decode(file(captured.files, '.svg')));
  const records = [
    ['plus-left', ['number', 'prefix']],
    ['plus-right', ['number', 'suffix']],
    ['sharp-right', ['number', 'suffix']],
  ] as const;

  for (const [index, tag, roles] of records.map((record, index) => [index, ...record] as const)) {
    const graphic = graphics[index];
    const position = graphic?.position;

    assert.ok(position, `${tag}: exact source figure position exists`);
    const measure = measureLayouts.find(
      (event) =>
        event.system === position.system &&
        event.s === position['staff-context'] &&
        event.m === position['column-m'] &&
        event.g === position['column-g'],
    );

    assert.ok(measure, `${tag}: source measure frame exists`);
    const itemOrigin = [
      (Number(measure['system-left-x-tenths']) + position['system-x-tenths']) / 10,
      staffTops[0]! - position['y-tenths'] / 10,
    ];
    const taggedGroup = tagged.find((group) => group.getAttribute('data-figure') === tag);

    assert.ok(taggedGroup, `${tag}: tagged source SVG grob exists`);
    const tokens = position.tokens as Record<string, number[]> | undefined;

    assert.ok(tokens, `${tag}: known standard formatter exposes token origins`);
    assert.deepEqual(
      Object.keys(tokens).sort(),
      [...roles].sort(),
      `${tag}: event semantics map exact roles`,
    );

    for (const role of roles) {
      const delta = tokens[role]!;
      const expected = [itemOrigin[0]! + delta[0]! / 10, itemOrigin[1]! - delta[1]! / 10];
      const matches: Element[] = elements(taggedGroup, 'g').filter((group) => {
        const point = sumTranslate(group);

        return (
          group.getElementsByTagName('path').length > 0 &&
          Math.abs(point[0] - expected[0]!) < 0.0002 &&
          Math.abs(point[1] - expected[1]!) < 0.0002
        );
      });

      assert.equal(
        matches.length,
        1,
        `${tag}.${role}: token coordinate uniquely matches its rendered SVG glyph`,
      );
    }
  }

  assert.equal(
    graphics[3]?.position && graphics[3].position.tokens,
    undefined,
    'custom formatter is not treated as a default AST',
  );
  assert.equal(
    graphics[4]?.position && graphics[4].position.tokens,
    undefined,
    'custom stencil callback is not treated as a default glyph tree',
  );
});

test('suffix token coordinates retain source units under resized staff and rational item offset', async () => {
  const text = String.raw`\version "2.26.0"
#(define (g23-source-post paper pages) (format #t "G23-SOURCE-POST ~a\\n" (length pages)))
\paper { page-post-process = #g23-source-post }
\score { << \new Staff = "bass" \with { \override StaffSymbol.staff-space = #0.7 } { \clef bass c'1 }
  \new FiguredBass = "figures" \figuremode {
    \set figuredBassPlusDirection = #RIGHT
    \override BassFigure.extra-offset = #'(1/3 . -2/3)
    \once \override BassFigure.output-attributes = #'((data-figure . "scaled-suffix")) <6\+>1
  } >> \layout {} \midi { \tempo 4=120 } }`;
  const [plain, captured] = await Promise.all([compileBaseline(text), compileObserved(text)]);
  const svg = new TextDecoder().decode(file(captured.files, '.svg'));

  assert.deepEqual(
    file(captured.files, '.svg'),
    file(plain.files, '.svg'),
    'source SVG bytes are unchanged',
  );
  assert.ok(
    Object.keys(captured.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  const callbacks = (logs: readonly string[]) =>
    logs.filter((line) => line.startsWith('G23-SOURCE-POST '));

  assert.deepEqual(
    callbacks(captured.logs),
    callbacks(plain.logs),
    'page callback sequence is unchanged',
  );
  const rows = document(captured.files).events;
  const graphic = rows.find(
    (event): event is Extract<WireEvent, { k: 'figuregraphic' }> => event.k === 'figuregraphic',
  );

  assert.ok(graphic?.position);
  assert.ok(graphic.position.tokens?.number && graphic.position.tokens.suffix);
  assert.equal(graphic.position.tokens.prefix, undefined);
  const position = graphic.position;
  const tokens = position.tokens;

  assert.ok(tokens);
  const measure = rows.find(
    (event): event is Extract<WireEvent, { k: 'measure-layout' }> =>
      event.k === 'measure-layout' &&
      event.system === position.system &&
      event.s === position['staff-context'] &&
      event.m === position['column-m'] &&
      event.g === position['column-g'],
  );

  assert.ok(measure);
  const doc = parse(svg);
  const tagged = elements(doc, 'g').find(
    (group) => group.getAttribute('data-figure') === 'scaled-suffix',
  );

  assert.ok(tagged);
  const expectedItem: readonly [number, number] = [
    (Number(measure['system-left-x-tenths']) + position['system-x-tenths']) / 10,
    staffLineYs(svg)[0]! - position['y-tenths'] / 10,
  ];

  for (const role of ['number', 'suffix'] as const) {
    const delta = tokens[role]!;
    const expected: readonly [number, number] = [
      expectedItem[0] + Number(delta[0]) / 10,
      expectedItem[1] - Number(delta[1]) / 10,
    ];
    const matches: Element[] = elements(tagged, 'g').filter((group) => {
      const point = sumTranslate(group);

      return (
        group.getElementsByTagName('path').length > 0 &&
        Math.abs(point[0] - expected[0]) < 0.0002 &&
        Math.abs(point[1] - expected[1]) < 0.0002
      );
    });

    assert.equal(
      matches.length,
      1,
      `${role} token follows actual SVG placement through local scaling and item offset`,
    );
  }

  const globalStaffSpace = document(captured.files).paper['staff-space']!;

  close(
    Number(position['output-scale']) * position['layout-staff-space'],
    globalStaffSpace,
    'captured source layout scale converts to document-global staff-space',
  );
  assert.ok(
    Math.abs(position['local-staff-space'] - 0.7) < 0.0001,
    'local staff symbol retains its 0.7 scale',
  );
});
