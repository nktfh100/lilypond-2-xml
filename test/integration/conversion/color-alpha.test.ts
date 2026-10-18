import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import listener from '../../../src/lilypond/generated/listener.js';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { serialize, elements as all, parse } from '../../support/xml-support.js';
const compiler = createReusableCompiler(),
  converter = createConverter(),
  reader = new VerovioToolkit(await createModule());

after(() => {
  compiler.dispose();
  converter.dispose();
  reader.destroy();
});

const SVGs = (files: Record<string, Uint8Array>) =>
  Object.entries(files)
    .filter(([n]) => n.endsWith('.svg'))
    .map(([, b]) => new TextDecoder().decode(b));
const MIDI = (files: Record<string, Uint8Array>) =>
  Object.entries(files).find(([n]) => n.endsWith('.midi'))![1];
const partTree = (xml: string) => all(parse(xml), 'part').map((n) => serialize(n));

async function independent(source: string) {
  const plain = await compiler.compile(source, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(source, {
    format: ['svg', 'midi'],
    includeSettings: 'color.ily',
    files: { 'color.ily': listener },
  });

  assert.deepEqual(SVGs(observed.files), SVGs(plain.files));
  assert.ok(
    Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  const result = (await converter.convert(source)).scores[0]!;

  validate(result.musicxml);
  assert.equal(all(parse(result.musicxml), 'image').length, 0);
  const cached = toMusicXML(JSON.parse(JSON.stringify(result.document)) as ScoreDocument);

  validate(cached.musicxml);
  assert.deepEqual(partTree(cached.musicxml), partTree(result.musicxml));

  return {
    result,
    sourceSVG: SVGs(plain.files).join('\n'),
    midi: midiTimedNotes(MIDI(plain.files)),
  };
}

const colors = [
  [1, 0, 0, 0],
  [1, 0, 0, 0.5],
  [1, 0, 0, 1],
  [0, 0, 1, 0],
  [0, 0, 1, 0.5],
  [0, 0, 1, 1],
] as const;
const native = ['#00000000', '#80FF0000', '#FF0000', '#00000000', '#800000FF', '#0000FF'];

test('actual source red and blue RGBA0/half/1 retain native ARGB and playback with explicit reader CSS alpha loss', async () => {
  const music = colors
    .map(
      (color, i) =>
        String.raw`\once\override Script.color=#'(${color.join(' ')}) ${["c'", "d'", "e'", "f'", "g'", "a'"][i]}1\upbow^\markup\with-color #'(${color.join(' ')}) "Color${i}"`,
    )
    .join(' ');
  const source = String.raw`\header{tagline=##f}\score{\new Staff="solo"{${music}}\layout{}\midi{\tempo 4=120}}`;
  const { result, sourceSVG, midi } = await independent(source),
    xml = parse(result.musicxml);

  assert.deepEqual(
    all(xml, 'words').map((n) => n.getAttribute('color')),
    native,
  );
  assert.deepEqual(
    all(xml, 'up-bow').map((n) => n.getAttribute('color')),
    native,
  );
  assert.deepEqual(
    result.document.events.filter((e) => e.kind === 'script').map((e) => e.color),
    colors,
  );
  assert.match(sourceSVG, /rgba\(100(?:\.0000)?%, 0(?:\.0000)?%, 0(?:\.0000)?%, 50\.0000%\)/);
  assert.match(sourceSVG, /rgba\(0(?:\.0000)?%, 0(?:\.0000)?%, 100(?:\.0000)?%, 50\.0000%\)/);
  assert.equal(result.diagnostics.filter((d) => d.code === 'color-alpha-reader').length, 0);
  reader.setOptions({ xmlIdSeed: 1 });
  assert.equal(reader.loadData(result.musicxml), 1);
  const mei = parse(reader.getMEI()),
    rendered = reader.renderToSVG(1);
  const rends = all(mei, 'rend').filter((n) => n.textContent?.startsWith('Color'));

  assert.deepEqual(
    rends.map((n) => n.getAttribute('color')),
    native,
  );
  assert.ok(
    rendered.includes('fill="#80FF0000"'),
    'the reader passes ARGB directly into CSS rather than converting alpha',
  );
  assert.ok(rendered.includes('fill="#800000FF"'));
  assert.ok(rendered.includes('fill="#00000000"'));
  const actual = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    actual.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    midi.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  actual.forEach((n, i) => assert.ok(Math.abs(n.duration! - midi[i]!.duration!) < 0.02));
  const unused = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;
  const unowned = unused.events.find((e) => e.kind === 'script')!;

  unused.events = unused.events
    .filter((e) => e.kind !== 'script' && !(e.kind === 'voice' && e.class === 'text-script-event'))
    .map((e) => (e.kind === 'note' ? { ...e, attachments: [] } : e));
  unused.events = [
    ...unused.events,
    { ...unowned, id: 999, color: [1, 0, 0, 0.5] } as typeof unowned,
  ];
  const clean = toMusicXML(unused);

  validate(clean.musicxml);
  assert.ok(
    !clean.diagnostics.some((d) => d.code === 'color-alpha-reader'),
    'unused source color metadata must not claim a reader loss',
  );
  const recovered = (await converter.convert(String.raw`{c'1^\markup\with-color #red "Opaque"}`))
    .scores[0]!;

  assert.equal(all(parse(recovered.musicxml), 'words')[0]!.getAttribute('color'), '#FF0000');
  assert.ok(!recovered.diagnostics.some((d) => d.code === 'color-alpha-reader'));
});

test('actual figured-bass continuation zero alpha stays hidden while half-red remains independently visible', async () => {
  for (const [color, expected] of [
    ['0 0 1 0', '#00000000'],
    ['1 0 0 0.5', '#80FF0000'],
    ['1 0 0 1', '#FF0000'],
  ]) {
    const source = String.raw`\header{tagline=##f}\score{<<\new Staff{c4 d e f}\figures{\override BassFigureContinuation.color=#'(${color})\bassFigureExtendersOn <6 4>4 <6 3> <7 3> <7 3>}>>\layout{}\midi{\tempo 4=120}}`;
    const { result } = await independent(source),
      xml = parse(result.musicxml),
      lines = all(xml, 'extend');

    assert.equal(lines.length, 7);
    assert.ok(lines.every((n) => n.getAttribute('color') === expected));
    assert.notEqual(
      all(xml, 'figured-bass')[0]!.getAttribute('print-object'),
      'no',
      'visible initial figure text stays independent of hidden continuation ink',
    );
    assert.equal(
      result.diagnostics.some((d) => d.code === 'color-alpha-reader'),
      false,
    );
  }
});
