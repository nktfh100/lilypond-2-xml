import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
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

const labels = ['RightHand', 'RH.', 'LeftHand', 'LH.'];
const source = (
  offset: string,
) => String.raw`\paper { line-width = 160\mm indent = 20\mm short-indent = 10\mm }
\score { \new PianoStaff \with { instrumentName = "Piano" shortInstrumentName = "Pno." } <<
 \new Staff = "upper" \with { instrumentName = "RightHand" shortInstrumentName = "RH." \override InstrumentName.color = #red \override InstrumentName.extra-offset = #'${offset} } { c'1 \break d'1 }
 \new Staff = "lower" \with { instrumentName = "LeftHand" shortInstrumentName = "LH." \override InstrumentName.color = #blue \override InstrumentName.extra-offset = #'${offset} } { c1 d1 }
 >> \layout {} \midi { \tempo 4=120 } }`;
const words = (xml: string) =>
  all(parse(xml), 'words').filter((w) => labels.includes(w.textContent || ''));
const labelPositions = (svg: string) =>
  all(parse(svg), 'text')
    .filter((t) => labels.includes(t.textContent || ''))
    .map((t) => {
      let node: Element | null = t;
      const transforms: string[] = [];

      while (node) {
        if (node.hasAttribute('transform')) {
          transforms.push(node.getAttribute('transform')!);
        }

        node = node.parentNode?.nodeType === 1 ? (node.parentNode as Element) : null;
      }

      return { text: t.textContent!, transforms };
    });

test('actual final staff label pieces become explicit staff words at their source coordinates on both systems', async () => {
  const text = source('(0 . 0)');
  const [{ scores }, independent] = await Promise.all([
    converter.convert(text),
    compiler.compile(text, { format: ['svg', 'midi'] }),
  ]);
  const converted = scores[0]!;

  validate(converted.musicxml);
  const xml = parse(converted.musicxml);

  assert.equal(all(xml, 'score-part').length, 1);
  assert.equal(all(xml, 'staves')[0]!.textContent, '2');
  const pieces = converted.document.events
    .filter((e) => e.kind === 'instrumentLabelPiece')
    .filter((e) => labels.includes(e.text));

  assert.equal(pieces.length, 4);
  const native = words(converted.musicxml);

  assert.equal(native.length, 4);
  const staffSpace = converted.document.paper!['staff-space'];

  assert.ok(typeof staffSpace === 'number' && staffSpace > 0);

  for (const piece of pieces) {
    const word = native.find((w) => w.textContent === piece.text)!;

    assert.ok(word, piece.text);
    const factor = (10 * piece.outputScale) / staffSpace;

    assert.ok(Math.abs(Number(word.getAttribute('default-x')) - factor * piece.x!) < 1e-8);
    assert.ok(Math.abs(Number(word.getAttribute('default-y')) - factor * piece.y!) < 1e-8);
    const direction = word.parentNode!.parentNode as Element;

    assert.equal(all(direction, 'staff')[0]!.textContent, piece.text.startsWith('R') ? '1' : '2');
    assert.equal(word.getAttribute('color'), piece.text.startsWith('R') ? '#FF0000' : '#0000FF');
  }

  const sourceSvgs = Object.entries(independent.files)
    .filter(([n]) => n.endsWith('.svg'))
    .map(([, b]) => new TextDecoder().decode(b));
  const sourceLabels = sourceSvgs.flatMap(labelPositions);

  assert.deepEqual(sourceLabels.map((l) => l.text).sort(), [...labels].sort());
  const staffLines = sourceSvgs
    .flatMap((svg) =>
      all(parse(svg), 'line')
        .filter(
          (l) =>
            Number(l.getAttribute('x2')) > 30 &&
            Number(l.getAttribute('y1')) === 0 &&
            Number(l.getAttribute('y2')) === 0,
        )
        .map((l) => {
          const match = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(
            (l.parentNode as Element).getAttribute('transform')!,
          )!;

          return { x: Number(match[1]), y: Number(match[2]) };
        }),
    )
    .sort((a, b) => a.y - b.y);

  assert.equal(staffLines.length, 20, 'two actual systems each contain two five-line staves');

  for (const piece of pieces) {
    const label = sourceLabels.find((l) => l.text === piece.text)!;
    const at = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(label.transforms[0]!)!;
    const top = staffLines[((piece.system - 1) * 2 + (piece.text.startsWith('R') ? 0 : 1)) * 5]!;

    assert.ok(
      Math.abs(Number(at[1]) - top.x - piece.x!) < 0.0002,
      `${piece.text} source x relative to staff start`,
    );
    assert.ok(
      Math.abs(top.y - Number(at[2]) - piece.y!) < 0.0002,
      `${piece.text} source baseline relative to its own top staff line`,
    );
  }

  assert.equal(reader.loadData(converted.musicxml), 1);
  const mei = parse(reader.getMEI());
  const imported = all(mei, 'dir').filter((d) => labels.includes(d.textContent?.trim() || ''));

  assert.equal(imported.length, 4);

  for (const dir of imported) {
    const upper = dir.textContent!.trim().startsWith('R');

    assert.equal(dir.getAttribute('staff'), upper ? '1' : '2');
    assert.equal(all(dir, 'rend')[0]!.getAttribute('color'), upper ? '#FF0000' : '#0000FF');
  }

  const actual = midiTimedNotes(reader.renderToMIDI()),
    expected = midiTimedNotes(
      Object.entries(independent.files).find(([n]) => n.endsWith('.midi'))![1],
    );

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    expected.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  const cache = toMusicXML(JSON.parse(JSON.stringify(converted.document)) as ScoreDocument);

  validate(cache.musicxml);
  assert.deepEqual(
    words(cache.musicxml).map((w) => [
      w.textContent,
      w.getAttribute('default-x'),
      w.getAttribute('default-y'),
    ]),
    native.map((w) => [w.textContent, w.getAttribute('default-x'), w.getAttribute('default-y')]),
  );
});

const readerLabelPositions = (svg: string) =>
  all(parse(svg), 'text')
    .filter((t) => labels.includes(t.textContent?.trim() || ''))
    .map((t) => ({
      text: t.textContent!.trim(),
      x: t.getAttribute('x'),
      y: t.getAttribute('y'),
    }));

test('source label offsets survive native coordinates while reader uses its own text placement', async () => {
  const results = [];

  for (const offset of ['(0 . 0)', '(2 . -1)']) {
    const text = source(offset);
    const [{ scores }, independent] = await Promise.all([
      converter.convert(text),
      compiler.compile(text, { format: 'svg' }),
    ]);
    const converted = scores[0]!;

    validate(converted.musicxml);
    reader.setOptions({ breaks: 'encoded' });
    assert.equal(reader.loadData(converted.musicxml), 1);
    const positions = Object.entries(independent.files)
      .filter(([n]) => n.endsWith('.svg'))
      .flatMap(([, b]) => labelPositions(new TextDecoder().decode(b)));

    results.push({
      pieces: converted.document.events
        .filter((e) => e.kind === 'instrumentLabelPiece')
        .filter((e) => labels.includes(e.text)),
      native: words(converted.musicxml),
      positions,
      reader: Array.from({ length: reader.getPageCount() }, (_, i) =>
        readerLabelPositions(reader.renderToSVG(i + 1)),
      ).flat(),
    });
    assert.ok(!converted.diagnostics.some((d) => d.code === 'instrument-label-reader'));
  }

  const [base, moved] = results;

  for (const name of labels) {
    const first = base!.pieces.find((p) => p.text === name)!,
      second = moved!.pieces.find((p) => p.text === name)!;

    assert.ok(Math.abs(second.x! - first.x! - 2) < 1e-8, `${name} captured horizontal translation`);
    assert.ok(Math.abs(second.y! - first.y! + 1) < 1e-8, `${name} captured vertical translation`);
    const before = base!.native.find((w) => w.textContent === name)!,
      after = moved!.native.find((w) => w.textContent === name)!;

    assert.ok(
      Math.abs(
        Number(after.getAttribute('default-x')) - Number(before.getAttribute('default-x')) - 20,
      ) < 1e-8,
    );
    assert.ok(
      Math.abs(
        Number(after.getAttribute('default-y')) - Number(before.getAttribute('default-y')) + 10,
      ) < 1e-8,
    );
    const a = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(
      base!.positions.find((p) => p.text === name)!.transforms[0]!,
    )!;
    const b = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(
      moved!.positions.find((p) => p.text === name)!.transforms[0]!,
    )!;

    assert.ok(Math.abs(Number(b[1]) - Number(a[1]) - 2) < 0.0002);
    assert.ok(Math.abs(Number(b[2]) - Number(a[2]) - 1) < 0.0002);
  }

  assert.deepEqual(moved!.reader, base!.reader);
});

test('native staff label font points agree with independently rendered physical source text', async () => {
  for (const setup of ['', '#(set-global-staff-size 30)']) {
    const text = setup + source('(0 . 0)');
    const [{ scores }, independent] = await Promise.all([
      converter.convert(text),
      compiler.compile(text, { format: 'svg' }),
    ]);
    const converted = scores[0]!;

    validate(converted.musicxml);
    const native = words(converted.musicxml);
    const rendered = Object.entries(independent.files)
      .filter(([n]) => n.endsWith('.svg'))
      .flatMap(([, b]) => {
        const svg = parse(new TextDecoder().decode(b)),
          root = svg.documentElement;
        const unit =
          Number(root.getAttribute('width')!.replace('mm', '')) /
          Number(root.getAttribute('viewBox')!.split(/\s+/)[2]);

        return all(svg, 'text')
          .filter((t) => labels.includes(t.textContent || ''))
          .map((t) => ({
            text: t.textContent!,
            points: (Number(t.getAttribute('font-size')) * unit * 72) / 25.4,
          }));
      });

    assert.equal(rendered.length, 4);

    for (const label of rendered) {
      const word = native.find((w) => w.textContent === label.text)!;

      assert.ok(word);
      assert.ok(
        Math.abs(Number(word.getAttribute('font-size')) - label.points) < 0.0005,
        `${setup || 'default'} ${label.text}: source ${label.points}, native ${word.getAttribute('font-size')}`,
      );
    }
  }
});
