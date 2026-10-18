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

const annotations = (doc: ScoreDocument) => doc.events.filter((e) => e.kind === 'footnote');
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const source = (music: string, config = '', layout = '') =>
  String.raw`\score { \new Staff = "solo" \new Voice = "voice" { ${config} ${music} } \layout { ${layout} } \midi { \tempo 4=120 } }`;
const passage = String.raw`\footnote "*" #'(0 . 2) "Editorial note" c'4 d'4 e'4 f'4`;

function noGestures(data: Uint8Array) {
  const midi = readMidiAttacks(data);

  assert.ok(
    midi.tracks.every(
      (t) => t.pitchBends.every((b) => b.value === 8192) && t.controls.every((c) => c.tick === 0),
    ),
  );
}

test('editorial footnote uses the actual sticky NoteHead owner and exact body separately from its marker', async () => {
  const text = source(passage),
    result = (await converter.convert(text)).scores[0]!;
  const original = await compiler.compile(text, { format: ['svg', 'midi'] });

  validate(result.musicxml);
  const [annotation] = annotations(result.document);

  assert.ok(annotation);
  assert.deepEqual(
    [annotation.hostKind, annotation.noteId, annotation.body, annotation.marker],
    ['NoteHead', 1, 'Editorial note', '*'],
  );
  assert.equal(annotation.automaticallyNumbered, false);
  assert.equal(annotation.custom, false);
  const native = parse(result.musicxml),
    notes = all(native, 'note');

  assert.deepEqual(
    all(native, 'footnote').map((n) => n.textContent),
    ['Editorial note'],
  );
  assert.equal(all(notes[0]!, 'footnote').length, 1);
  assert.ok(notes.slice(1).every((n) => !all(n, 'footnote').length));
  const svg = new TextDecoder().decode(file(original.files, '.svg'));

  assert.match(svg, />\*<\/tspan>/);
  assert.match(svg, />Editorial note<\/tspan>/);
  assert.equal(reader.loadData(result.musicxml), 1);
  const mei = parse(reader.getMEI()),
    pageFooters = all(mei, 'pgFoot');

  assert.ok(
    result.document.pageCredits?.some(
      (region) =>
        region.region === 'footer' && region.items.some((item) => item.text === 'Editorial note'),
    ),
    'the source-owned page footer remains separately captured',
  );
  assert.ok(
    pageFooters.some((footer) => footer.textContent?.includes('Editorial note')),
    'Verovio imports the independent source page footer',
  );
  assert.ok(
    all(mei, 'annot').every((annotation) => !annotation.textContent?.includes('Editorial note')),
    'Verovio still drops the semantic editorial footnote rather than importing it as an annotation',
  );
  assert.doesNotMatch(
    reader.renderToSVG(1),
    /Editorial note/,
    'the editorial footnote remains absent from rendered page content even though MEI retains the separate page-footer credit',
  );
  const expected = midiTimedNotes(file(original.files, '.midi')),
    played = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
  noGestures(file(original.files, '.midi'));
  noGestures(Buffer.from(reader.renderToMIDI(), 'base64'));
  assert.ok(result.diagnostics.some((d) => d.code === 'footnote-marker'));
  assert.ok(!result.diagnostics.some((d) => d.code === 'footnote-reader'));
});

test('footnote uniform markup styles remain native without borrowing marker font size', async () => {
  const text = source(String.raw`\footnote "*" #'(0 . 2) \markup \bold "Bold editorial" c'1`);
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const footnote = all(parse(result.musicxml), 'footnote')[0]!;

  assert.equal(footnote.textContent, 'Bold editorial');
  assert.equal(footnote.getAttribute('font-weight'), 'bold');
  assert.equal(footnote.getAttribute('font-size'), null);
  const original = await compiler.compile(text, { format: 'svg' });

  assert.match(new TextDecoder().decode(file(original.files, '.svg')), /Bold editorial/);
  const mixedText = source(
    String.raw`\footnote "*" #'(0 . 2) \markup \concat { \bold "Bold" \italic "Italic" } c'1`,
  );
  const mixed = (await converter.convert(mixedText)).scores[0]!;

  validate(mixed.musicxml);
  const mixedBody = all(parse(mixed.musicxml), 'footnote')[0]!;

  assert.equal(mixedBody.textContent, 'BoldItalic');
  assert.equal(mixedBody.getAttribute('font-weight'), null);
  assert.equal(mixedBody.getAttribute('font-style'), null);
  assert.ok(mixed.diagnostics.some((d) => d.code === 'footnote-format'));
});

test('hidden footnote marker does not erase its independently printed page-footer body', async () => {
  for (const config of [
    String.raw`\omit Footnote`,
    String.raw`\override Footnote.transparent = ##t`,
  ]) {
    const text = source(passage, config),
      result = (await converter.convert(text)).scores[0]!;
    const original = await compiler.compile(text, { format: 'svg' });

    validate(result.musicxml);
    const svg = new TextDecoder().decode(file(original.files, '.svg'));

    assert.match(svg, />Editorial note<\/tspan>/);
    assert.equal(annotations(result.document)[0]!.markerHidden, true);
    assert.deepEqual(
      all(parse(result.musicxml), 'footnote').map((n) => n.textContent),
      ['Editorial note'],
    );
  }
});

test('automatic footnote numbering remains explicit provenance without an invented body prefix', async () => {
  const text = source(String.raw`\footnote #'(0 . 2) "Automatic editorial" c'1`);
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  assert.equal(annotations(result.document)[0]!.automaticallyNumbered, true);
  assert.deepEqual(
    all(parse(result.musicxml), 'footnote').map((n) => n.textContent),
    ['Automatic editorial'],
  );
  assert.ok(result.diagnostics.some((d) => d.code === 'footnote-number'));
  const original = await compiler.compile(text, { format: 'svg' });

  assert.match(new TextDecoder().decode(file(original.files, '.svg')), /Automatic editorial/);
});

test('actual removed engraving and unsupported sticky hosts do not attach editorial text to a guessed note', async () => {
  const removedText = source(
    passage,
    '',
    String.raw`\context { \Score \remove Footnote_engraver }`,
  );
  const removed = (await converter.convert(removedText)).scores[0]!;
  const original = await compiler.compile(removedText, { format: 'svg' });

  assert.equal(annotations(removed.document).length, 0);
  assert.equal(all(parse(removed.musicxml), 'footnote').length, 0);
  assert.doesNotMatch(new TextDecoder().decode(file(original.files, '.svg')), /Editorial note/);

  for (const config of [
    String.raw`\override Footnote.break-visibility = #all-invisible`,
    String.raw`\override Footnote.after-line-breaking = #ly:grob-suicide!`,
  ]) {
    const absentText = source(passage, config),
      absent = (await converter.convert(absentText)).scores[0]!;
    const absentSource = await compiler.compile(absentText, { format: 'svg' });

    assert.doesNotMatch(
      new TextDecoder().decode(file(absentSource.files, '.svg')),
      /Editorial note/,
    );
    assert.equal(annotations(absent.document)[0]!.body, null);
    assert.equal(all(parse(absent.musicxml), 'footnote').length, 0);
  }

  const unsupportedText = source(
    String.raw`\footnote "*" #'(0 . 2) "Stem editorial" Stem c'4 d'4 e'4 f'4`,
  );
  const unsupported = (await converter.convert(unsupportedText)).scores[0]!;

  assert.equal(annotations(unsupported.document)[0]!.hostKind, 'Stem');
  assert.equal(annotations(unsupported.document)[0]!.noteId, null);
  assert.equal(all(parse(unsupported.musicxml), 'footnote').length, 0);
  assert.ok(unsupported.diagnostics.some((d) => d.code === 'footnote-owner'));
});

test('custom footnote callbacks retain available body without replaying source callbacks', async () => {
  for (const [property, callback] of [
    ['stencil', 'ly:balloon-interface::print'],
    ['after-line-breaking', 'ly:balloon-interface::remove-irrelevant-spanner'],
  ] as const) {
    const text =
      `#(define (count-footnote g) (display "XML-FOOTNOTE-CALLBACK\\n") (${callback} g)) ` +
      source(passage, `\\override Footnote.${property} = #count-footnote`);
    const converted = await converter.convert(text),
      result = converted.scores[0]!;
    const original = await compiler.compile(text, { format: ['svg', 'midi'] });

    validate(result.musicxml);

    for (const logs of [converted.logs, original.logs]) {
      assert.equal(logs.join('\n').split('XML-FOOTNOTE-CALLBACK').length - 1, 1);
    }

    assert.equal(annotations(result.document)[0]!.custom, true);
    assert.deepEqual(
      all(parse(result.musicxml), 'footnote').map((n) => n.textContent),
      ['Editorial note'],
    );
    assert.ok(result.diagnostics.some((d) => d.code === 'footnote-stencil'));
    assert.equal(reader.loadData(result.musicxml), 1);
    const played = midiTimedNotes(reader.renderToMIDI()),
      expected = midiTimedNotes(file(original.files, '.midi'));

    assert.deepEqual(
      played.map((n) => [n.pitch, n.onset, n.velocity]),
      expected.map((n) => [n.pitch, n.onset, n.velocity]),
    );
    noGestures(file(original.files, '.midi'));
  }
});

test('footnote JSON roundtrip preserves exact ownership and stale IDs never select the next note', async () => {
  const result = (await converter.convert(source(passage))).scores[0]!;
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;
  const replay = toMusicXML(cached);

  validate(replay.musicxml);
  assert.deepEqual(
    all(parse(replay.musicxml), 'footnote').map((n) => n.textContent),
    ['Editorial note'],
  );
  const invalid = {
    ...cached,
    events: cached.events.map((e) => (e.kind === 'footnote' ? { ...e, noteId: 999 } : e)),
  };
  const rejected = toMusicXML(invalid);

  assert.equal(all(parse(rejected.musicxml), 'footnote').length, 0);
  assert.ok(rejected.diagnostics.some((d) => d.code === 'footnote-owner'));
  const annotation = annotations(cached)[0]!;
  const styled = {
    ...annotation,
    markup: {
      command: 'bold-markup',
      args: ['Editorial note'],
      plain: 'Editorial note',
    },
  };
  const reordered = {
    ...annotation,
    piece: annotation.piece + 1,
    markup: {
      plain: 'Editorial note',
      args: ['Editorial note'],
      command: 'bold-markup',
    },
  };
  const equivalent = toMusicXML({
    ...cached,
    events: [...cached.events.filter((e) => e.kind !== 'footnote'), styled, reordered],
  });

  assert.equal(all(parse(equivalent.musicxml), 'footnote').length, 1);
  assert.ok(!equivalent.diagnostics.some((d) => d.code === 'footnote-history'));
  const conflict = toMusicXML({
    ...cached,
    events: [
      ...cached.events,
      {
        ...annotation,
        piece: annotation.piece + 1,
        body: 'Contradictory body',
      },
    ],
  });

  assert.equal(all(parse(conflict.musicxml), 'footnote').length, 0);
  assert.ok(conflict.diagnostics.some((d) => d.code === 'footnote-history'));
  const next = (await converter.convert(source(String.raw`c'1`))).scores[0]!;

  assert.equal(annotations(next.document).length, 0);
  assert.equal(all(parse(next.musicxml), 'footnote').length, 0);
});
