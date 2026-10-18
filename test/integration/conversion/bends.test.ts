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
  compiler = createReusableCompiler();
const reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const source = (music: string, setup = '') =>
  String.raw`\score { \new TabStaff = "guitar" { \override BendSpanner.color = #red ${setup} ${music} } \layout {} \midi { \tempo 4=120 } }`;
const bends = (d: ScoreDocument) => d.events.filter((e) => e.kind === 'bendGraphic');
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const noGestures = (data: Uint8Array) => {
  const midi = readMidiAttacks(data);

  assert.ok(midi.tracks.every((t) => t.pitchBends.every((b) => b.value === 8192)));
  assert.ok(midi.tracks.every((t) => t.controls.every((c) => c.tick === 0)));
};

test('bend captures actual final owners and amount; independent SVG and MIDI prove the source gesture', async () => {
  const text = source(String.raw`c'4\3\^ d'4\3 e'4\3 f'4\3`);
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const [span] = bends(result.document);

  assert.ok(span);
  assert.deepEqual([span.fromNotes, span.toNotes, span.quarterDifference], [[1], [2], 4]);
  assert.equal(span.hidden, false);
  assert.equal(span.custom, false);
  assert.equal(span.toHeads[0]!.hidden, true);
  assert.equal(span.toHeads[0]!.stemHidden, true);
  const native = parse(result.musicxml),
    bend = all(native, 'bend')[0]!;

  assert.ok(bend);
  assert.equal(all(bend, 'bend-alter')[0]!.textContent, '2');
  const notes = all(native, 'note');

  assert.ok(all(notes[0]!, 'bend').length);
  assert.equal(all(notes[1]!, 'bend').length, 0);
  assert.equal(all(notes[1]!, 'fret')[0]!.getAttribute('color'), '#00000000');
  assert.notEqual(
    notes[1]!.getAttribute('print-object'),
    'no',
    'surviving source beams must not be hidden with the whole note',
  );
  const independent = await compiler.compile(text, { format: ['svg', 'midi'] });
  const svg = new TextDecoder().decode(file(independent.files, '.svg'));

  assert.match(svg, /rgba\(100\.0000%, 0\.0000%, 0\.0000%/);
  assert.match(svg, />1<\/tspan>/);
  assert.match(svg, />5<\/tspan>/);
  assert.doesNotMatch(svg, />7<\/tspan>/);
  assert.equal(reader.loadData(result.musicxml), 1);
  const original = midiTimedNotes(file(independent.files, '.midi')),
    played = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    played.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    original.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - original[i]!.duration!) < 0.01));
  noGestures(file(independent.files, '.midi'));
  noGestures(Buffer.from(reader.renderToMIDI(), 'base64'));
  assert.equal(all(parse(reader.getMEI()), 'bend').length, 0);
  assert.ok(!result.diagnostics.some((d) => d.code === 'bend-reader'));
});

test('bend chord amount belongs to the actual highest eligible head and all final head states survive', async () => {
  const result = (await converter.convert(source(String.raw`<c'\3 e'\2>4\^ <d'\3 fis'\2>4 r2`)))
    .scores[0]!;

  validate(result.musicxml);
  const [span] = bends(result.document);

  assert.ok(span);
  assert.deepEqual([span.fromNotes, span.toNotes], [[2], [4]]);
  assert.equal(span.fromHeads.length, 2);
  assert.equal(span.toHeads.length, 2);
  assert.ok(span.toHeads.every((h) => h.hidden));
  const notes = all(parse(result.musicxml), 'note');

  assert.equal(all(notes[0]!, 'bend').length, 0);
  assert.equal(all(notes[1]!, 'bend').length, 1);
  assert.ok(result.diagnostics.some((d) => d.code === 'bend-chord-layout'));
});

test('pre-bend and actual hold pieces retain their native phase and temporal brackets', async () => {
  for (const style of ['pre-bend', 'hold', 'pre-bend-hold']) {
    const music = style === 'hold' ? String.raw`c'4\3\^ c'4\3 r2` : String.raw`c'4\3\^ d'4\3 r2`;
    const result = (
      await converter.convert(source(music, String.raw`\override BendSpanner.style = #'${style}`))
    ).scores[0]!;

    validate(result.musicxml);
    assert.equal(bends(result.document)[0]!.style, style);
    const doc = parse(result.musicxml);

    assert.equal(all(doc, 'pre-bend').length, style === 'hold' ? 0 : 1);
    assert.equal(all(doc, 'bracket').length, style === 'pre-bend' ? 0 : 2);

    if (style !== 'pre-bend') {
      assert.deepEqual(
        all(doc, 'bracket').map((b) => b.getAttribute('type')),
        ['start', 'stop'],
      );
    }
  }
});

test('omitted bend does not infer hidden target ink, and an unterminated bend does not guess a target', async () => {
  const omitted = (
    await converter.convert(source(String.raw`c'4\3\^ d'4\3 r2`, String.raw`\omit BendSpanner`))
  ).scores[0]!;
  const [span] = bends(omitted.document);

  assert.ok(span);
  assert.equal(span.hidden, true);
  assert.equal(span.toHeads[0]!.hidden, false);
  const target = all(parse(omitted.musicxml), 'fret')[1]!;

  assert.notEqual(target.getAttribute('color'), '#00000000');
  const unfinished = (await converter.convert(source(String.raw`c'1\3\^`))).scores[0]!;

  validate(unfinished.musicxml);
  assert.deepEqual(bends(unfinished.document)[0]!.toNotes, []);
  assert.equal(all(parse(unfinished.musicxml), 'bend').length, 0);
});

test('visible parenthesized target and dotted full notation retain actual component visibility', async () => {
  const visible = (
    await converter.convert(
      source(
        String.raw`c'4\3\^ d'4\3 r2`,
        String.raw`\override BendSpanner.details.target-visibility = ##t`,
      ),
    )
  ).scores[0]!;

  assert.equal(bends(visible.document)[0]!.toHeads[0]!.hidden, false);
  assert.equal(bends(visible.document)[0]!.toHeads[0]!.parenthesized, true);
  assert.ok(visible.diagnostics.some((d) => d.code === 'bend-target-parentheses'));
  const text = source(String.raw`c'8.\3\^ d'8.\3 e'4\3`, String.raw`\tabFullNotation`);
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const target = bends(result.document)[0]!.toHeads[0]!;

  assert.equal(target.hidden, true);
  assert.equal(target.dotsHidden, true);
  assert.notEqual(target.beamHidden, true);
  const note = all(parse(result.musicxml), 'note')[1]!;

  assert.equal(all(note, 'dot')[0]!.getAttribute('color'), '#00000000');
  assert.ok(all(note, 'beam').every((b) => b.getAttribute('color') !== '#00000000'));
  const independent = await compiler.compile(text, { format: ['svg', 'midi'] });

  assert.match(new TextDecoder().decode(file(independent.files, '.svg')), /<polygon/);
  noGestures(file(independent.files, '.midi'));
});

test('bend JSON roundtrip preserves native ownership and contradictory cached amount is diagnosed', async () => {
  const text = source(String.raw`c'4\3\^ d'4\3 e'4\3 f'4\3`);
  const result = (await converter.convert(text)).scores[0]!;
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;
  const replay = toMusicXML(cached);

  assert.deepEqual(
    all(parse(replay.musicxml), 'bend').map((b) => b.textContent),
    all(parse(result.musicxml), 'bend').map((b) => b.textContent),
  );
  const invalid = {
    ...cached,
    events: cached.events.map((e) =>
      e.kind === 'bendGraphic' ? { ...e, quarterDifference: 6 } : e,
    ),
  };
  const rejected = toMusicXML(invalid);

  assert.equal(all(parse(rejected.musicxml), 'bend').length, 0);
  assert.ok(rejected.diagnostics.some((d) => d.code === 'bend-data'));
  const next = (await converter.convert(source(String.raw`c'1\3`))).scores[0]!;

  assert.equal(bends(next.document).length, 0);
  assert.equal(all(parse(next.musicxml), 'bend').length, 0);
});

test('BendSpanner stencil observation delegates once and preserves source MIDI while diagnosing custom drawing', async () => {
  const text =
    String.raw`#(define (observed-bend g) (display "XML-BEND-STENCIL-CALL\n") (bend-spanner::print g)) ` +
    source(
      String.raw`c'4\3\^ d'4\3 e'4\3 f'4\3`,
      String.raw`\override BendSpanner.stencil = #observed-bend`,
    );
  const conversion = await converter.convert(text),
    result = conversion.scores[0]!;
  const independent = await compiler.compile(text, { format: ['svg', 'midi'] });

  for (const logs of [conversion.logs, independent.logs]) {
    assert.equal(logs.join('\n').split('XML-BEND-STENCIL-CALL').length - 1, 1);
  }

  assert.equal(bends(result.document)[0]!.custom, true);
  assert.equal(
    bends(result.document)[0]!.toHeads[0]!.hidden,
    true,
    'actual delegated printer mutates the target before capture',
  );
  assert.equal(all(parse(result.musicxml), 'bend').length, 0);
  assert.ok(result.diagnostics.some((d) => d.code === 'bend-stencil'));
  assert.match(
    new TextDecoder().decode(file(independent.files, '.svg')),
    /rgba\(100\.0000%, 0\.0000%, 0\.0000%/,
  );
  reader.loadData(result.musicxml);
  assert.deepEqual(
    midiTimedNotes(reader.renderToMIDI()).map((n) => [n.pitch, n.onset, n.velocity]),
    midiTimedNotes(file(independent.files, '.midi')).map((n) => [n.pitch, n.onset, n.velocity]),
  );
  noGestures(file(independent.files, '.midi'));
  noGestures(Buffer.from(reader.renderToMIDI(), 'base64'));
});

test('TAB reader losses are explicit: target fret alpha is dropped and last string note rings through rests', async () => {
  const text = source(String.raw`c'4\3\^ d'4\3 r2`),
    result = (await converter.convert(text)).scores[0]!;
  const independent = await compiler.compile(text, { format: ['svg', 'midi'] });
  const original = midiTimedNotes(file(independent.files, '.midi'));

  reader.loadData(result.musicxml);
  const played = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    original.map((n) => [n.pitch, n.onset, n.duration]),
    [
      [60, 0, 0.5],
      [62, 0.5, 0.5],
    ],
  );
  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset]),
    [
      [60, 0],
      [62, 0.5],
    ],
  );
  assert.ok(
    played[1]!.duration! > original[1]!.duration! + 0.9,
    'reader TAB string damping ignores following rest',
  );
  const mei = parse(reader.getMEI()),
    target = all(mei, 'note').find((n) => n.getAttribute('tab.fret') === '7');

  assert.ok(target);
  assert.equal(target.getAttribute('color'), null, 'native fret color alpha is ignored');
  assert.match(reader.renderToSVG(1), />7<\/tspan>/);
  assert.equal(all(parse(result.musicxml), 'fret')[1]!.getAttribute('color'), '#00000000');
  noGestures(file(independent.files, '.midi'));
  noGestures(Buffer.from(reader.renderToMIDI(), 'base64'));
  assert.ok(!result.diagnostics.some((d) => d.code === 'bend-reader'));
  assert.ok(!result.diagnostics.some((d) => d.code === 'tab-release-reader'));
  const plainText = source(String.raw`c'4\3 d'4\3 r2`);
  const plain = (await converter.convert(plainText)).scores[0]!;
  const plainSource = await compiler.compile(plainText, { format: 'midi' });

  assert.deepEqual(
    midiTimedNotes(file(plainSource.files, '.midi')),
    original,
    'source bend adds no MIDI gesture or duration change',
  );
  reader.loadData(plain.musicxml);
  assert.deepEqual(
    midiTimedNotes(reader.renderToMIDI()),
    played,
    'the reader release loss also occurs without a bend',
  );
  assert.ok(!plain.diagnostics.some((d) => d.code === 'tab-release-reader'));
});

test('actual six-quarter and downward source pitch differences retain exact semitone amounts', async () => {
  for (const [music, quarterDifference, amount, release] of [
    [String.raw`c'4\3\^ ees'4\3 e'4\3 f'4\3`, 6, 3, false],
    [String.raw`d'4\3\^ c'4\3 e'4\3 f'4\3`, -4, -2, true],
  ] as const) {
    const result = (await converter.convert(source(music))).scores[0]!;

    validate(result.musicxml);
    assert.equal(bends(result.document)[0]!.quarterDifference, quarterDifference);
    const bend = all(parse(result.musicxml), 'bend')[0]!;

    assert.equal(Number(all(bend, 'bend-alter')[0]!.textContent), amount);
    assert.equal(all(bend, 'release').length, release ? 1 : 0);
  }
});

test('cached multiple highest owners and conflicting head histories are diagnosed without arbitrary bend selection', async () => {
  const result = (await converter.convert(source(String.raw`<c'\3 e'\2>4\^ <d'\3 fis'\2>4 r2`)))
    .scores[0]!;
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;
  const ambiguous = {
    ...cached,
    events: cached.events.map((e) => (e.kind === 'bendGraphic' ? { ...e, fromNotes: [1, 2] } : e)),
  };
  const rejected = toMusicXML(ambiguous);

  assert.equal(all(parse(rejected.musicxml), 'bend').length, 0);
  assert.ok(rejected.diagnostics.some((d) => d.code === 'bend-ownership'));
  const span = bends(cached)[0]!;
  const reordered = {
    ...cached,
    events: [
      ...cached.events,
      {
        ...span,
        piece: span.piece + 1,
        fromHeads: span.fromHeads.map((h) => ({
          ...(Object.fromEntries(Object.entries(h).reverse()) as typeof h),
          audit: 'extra cached metadata',
        })),
        toHeads: span.toHeads.map(
          (h) => Object.fromEntries(Object.entries(h).reverse()) as typeof h,
        ),
      },
    ],
  };
  const equivalent = toMusicXML(reordered);

  assert.equal(all(parse(equivalent.musicxml), 'bend').length, 1);
  assert.ok(
    !equivalent.diagnostics.some((d) => d.code === 'bend-history'),
    'head key insertion order and unknown metadata do not create conflicts',
  );
  const conflict = {
    ...cached,
    events: [
      ...cached.events,
      {
        ...span,
        id: span.id + 100,
        fromHeads: span.fromHeads.map((h) => ({ ...h, hidden: !h.hidden })),
      },
    ],
  };
  const conflicting = toMusicXML(conflict);

  assert.equal(all(parse(conflicting.musicxml), 'bend').length, 0);
  assert.ok(conflicting.diagnostics.some((d) => d.code === 'bend-history'));
});
