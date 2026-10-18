import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { createConverter } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { elements, parse } from '../../support/xml-support.js';

const converter = createConverter();
const compiler = createReusableCompiler();
const toolkit = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  toolkit.destroy();
});

const variants = [
  { name: 'default', header: '', override: '', encoding: 'fetaText' },
  {
    name: 'text20',
    header: String.raw`\paper { text-font-size = #20 }`,
    override: '',
    encoding: 'fetaText',
  },
  {
    name: 'size3',
    header: '',
    override: String.raw`\override BassFigure.font-size = #3`,
    encoding: 'fetaText',
  },
  {
    name: 'staff30',
    header: '#(set-global-staff-size 30)',
    override: '',
    encoding: 'fetaText',
  },
  {
    name: 'named',
    header: '',
    override: String.raw`\override BassFigure.font-name = #"serif"`,
    encoding: 'latin1',
  },
  {
    name: 'named-text20',
    header: String.raw`\paper { text-font-size = #20 }`,
    override: String.raw`\override BassFigure.font-name = #"serif"`,
    encoding: 'latin1',
  },
  {
    name: 'bolditalic',
    header: '',
    override: String.raw`\override BassFigure.font-series = #'bold \override BassFigure.font-shape = #'italic`,
    encoding: 'fetaText',
  },
] as const;
const auditStencil = String.raw`#(define (audit-figure-font grob)
  (let ((stencil (ly:text-interface::print grob)))
    (format #t "FIGURE-FONT ~s\n" (ly:stencil-expr stencil))
    stencil))`;

// The SVG backend divides glyph-string size by the physical length of one SVG unit.
// Its scalar therefore has millimeter units; SVG text supplies an independent unit calibration.
test('numeric figured-bass physical sizes match independent stencil and SVG font evidence while playback stays intact', async () => {
  const results = new Map<
    string,
    { native: number; physical: number; glyph: string; paths: string[] }
  >();

  for (const variant of variants) {
    const source =
      variant.header +
      String.raw`\score { <<
      \new Staff { \tempo 4 = 120 c'1^\markup \abs-fontsize #18 "Reference" }
      \figures { ${variant.override} <6>1 } >> \layout {} \midi {} }`;
    const independent =
      auditStencil +
      source.replace('<6>1', String.raw`\override BassFigure.stencil = #audit-figure-font <6>1`);
    const [{ scores }, compiled] = await Promise.all([
      converter.convert(source),
      compiler.compile(independent, { format: ['svg', 'midi'] }),
    ]);
    const score = scores[0]!;

    validate(score.musicxml);
    const xml = parse(score.musicxml);
    const native = xml.getElementsByTagName('figure-number')[0]!;

    assert.equal(native.textContent, '6', variant.name);
    const svgSource = new TextDecoder().decode(
      Object.entries(compiled.files).find(([name]) => name.endsWith('.svg'))![1],
    );
    const svg = parse(svgSource);
    const unitMillimeters =
      Number(svg.documentElement.getAttribute('width')!.replace('mm', '')) /
      Number(svg.documentElement.getAttribute('viewBox')!.split(/\s+/)[2]);
    const reference = elements(svg, 'text').find((n) => n.textContent === 'Reference')!;

    assert.ok(reference, variant.name);
    const referencePoints =
      (Number(reference.getAttribute('font-size')) * unitMillimeters * 72) / 25.4;

    assert.ok(
      Math.abs(referencePoints - (18 * 72) / 72.27) < 0.003,
      `${variant.name} SVG calibration: ${referencePoints}`,
    );
    const expression = compiled.logs.find((line) => line.startsWith('FIGURE-FONT '))!;

    assert.ok(expression, variant.name);
    const glyph = expression.match(/\(glyph-string [\s\S]*?"([^"]+)" ([\d.]+)/)!;

    assert.ok(glyph, expression);
    const physical = (Number(glyph[2]) * 72) / 25.4;
    const pointSize = Number(native.getAttribute('font-size'));

    assert.ok(
      Math.abs(pointSize - physical) < 0.003,
      `${variant.name}: native ${pointSize}, source ${physical}`,
    );
    const figure = score.document.events.filter((e) => e.kind === 'figuredBass')[0]!.figures[0]!;

    assert.equal(figure.numberFontContext?.encoding, variant.encoding, variant.name);
    assert.ok(figure.numberFontContext!.reference > 0);

    if (variant.encoding === 'fetaText') {
      assert.equal(native.getAttribute('font-weight') ?? 'normal', 'normal');
      assert.equal(native.getAttribute('font-style') ?? 'normal', 'normal');
      assert.match(glyph[1]!, /^Emmentaler-/);
    } else {
      assert.match(glyph[1]!, /^TeXGyreSchola-/);
    }

    assert.ok(!score.diagnostics.some((d) => d.code === 'figured-bass-style-reader'));
    assert.equal(toolkit.loadData(score.musicxml), 1);
    const mei = parse(toolkit.getMEI());
    const imported = mei.getElementsByTagName('f')[0]!;

    assert.equal(imported.textContent, '6');
    assert.ok(
      ['fontsize', 'fontweight', 'fontstyle', 'fontfam'].every((a) => !imported.hasAttribute(a)),
    );
    assert.match(toolkit.renderToSVG(1), /class="fb"/);
    const expected = midiTimedNotes(
      Object.entries(compiled.files).find(([name]) => name.endsWith('.midi'))![1],
    );
    const actual = midiTimedNotes(toolkit.renderToMIDI());

    assert.deepEqual(
      actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
      expected.map(({ pitch, onset, velocity }) => ({
        pitch,
        onset,
        velocity,
      })),
    );
    actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
    results.set(variant.name, {
      native: pointSize,
      physical,
      glyph: glyph[1]!,
      paths: elements(svg, 'path').map(
        (n) => `${n.getAttribute('transform')}:${n.getAttribute('d')}`,
      ),
    });
  }

  const base = results.get('default')!;

  assert.equal(results.get('text20')!.native, base.native);
  assert.equal(results.get('text20')!.physical, base.physical);
  assert.deepEqual(results.get('text20')!.paths, base.paths);
  assert.equal(results.get('bolditalic')!.native, base.native);
  assert.equal(results.get('bolditalic')!.physical, base.physical);
  assert.deepEqual(results.get('bolditalic')!.paths, base.paths);
  assert.ok(Math.abs(results.get('size3')!.native / base.native - Math.SQRT2) < 1e-10);
  assert.ok(Math.abs(results.get('staff30')!.native / base.native - 1.5) < 1e-10);
  assert.ok(
    Math.abs(results.get('named-text20')!.native / results.get('named')!.native - 20 / 11) < 1e-10,
  );
});
