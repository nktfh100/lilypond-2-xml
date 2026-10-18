import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { musicXmlWrittenNotes } from '../../../tools/evaluation/written.js';
import { toMusicXML } from '../../../src/musicxml/convert.js';
import { converter, elements, parse } from '../../support/conversion-support.js';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';

const reader = new VerovioToolkit(await createModule());

after(() => reader.destroy());

const attacks = (xml: string) => {
  assert.equal(reader.loadData(xml), 1);

  return midiTimedNotes(reader.renderToMIDI()).map((note) => [note.pitch, note.onset]);
};

const piano = (music: string) =>
  String.raw`\score { \new PianoStaff << \new Staff { ${music} } \new Staff { ${music} } >> \layout {} }`;

test('parallel staff repeats share one repeat and ending on each native barline', async () => {
  const music = String.raw`\repeat volta 2 { c'1 } \alternative { { d'1 } { e'1 } } f'1`;
  const { scores } = await converter.convert(piano(music));
  const xml = scores[0]!.musicxml;

  validate(xml);
  const native = parse(xml);

  assert.equal(elements(native, 'repeat').length, 2);
  assert.equal(elements(native, 'ending').length, 4);
  const backward = elements(native, 'repeat').find(
    (e) => e.getAttribute('direction') === 'backward',
  )!;

  assert.equal(backward.getAttribute('times'), '2');
  assert.equal(elements(backward.parentElement!, 'ending')[0]!.getAttribute('type'), 'stop');
  const unfolded = await converter.convert(piano(String.raw`\unfoldRepeats { ${music} }`));

  assert.deepEqual(attacks(xml), attacks(unfolded.scores[0]!.musicxml));
});

test('metered repeats ending inside a bar use an exact implicit measure boundary', async () => {
  const music = String.raw`\time 6/8 \partial 8 \repeat volta 2 { c'8 d'4. e'4 } f'8 g'2.`;
  const { scores } = await converter.convert(piano(music));
  const xml = scores[0]!.musicxml;

  validate(xml);
  const native = parse(xml);
  const repeats = elements(native, 'repeat');

  assert.equal(repeats.length, 2);
  const backward = repeats.find((e) => e.getAttribute('direction') === 'backward')!;

  assert.equal(backward.getAttribute('times'), '2');
  assert.equal(backward.parentElement!.getAttribute('location'), 'right');
  const measure = backward.parentElement!.parentElement!;

  assert.equal(measure.getAttribute('implicit'), 'yes');
  const divisions = Number(elements(native, 'divisions')[0]!.textContent);
  const duration = elements(measure, 'note')
    .filter((n) => !elements(n, 'chord').length && elements(n, 'voice')[0]?.textContent === '1')
    .reduce((sum, n) => sum + Number(elements(n, 'duration')[0]?.textContent ?? 0), 0);

  assert.equal(duration / divisions, 2.5);
  const unfolded = await converter.convert(piano(String.raw`\unfoldRepeats { ${music} }`));

  assert.deepEqual(attacks(xml), attacks(unfolded.scores[0]!.musicxml));
});

test('annotated repeat glyphs preserve their actual heavy-light bar style', async () => {
  const { scores } = await converter.convert(String.raw`{ c'1 \bar ".|:-||" d'1 }`);
  const xml = scores[0]!.musicxml;

  validate(xml);
  const native = parse(xml);
  const forward = elements(native, 'repeat').find(
    (e) => e.getAttribute('direction') === 'forward',
  )!;

  assert.equal(elements(forward.parentElement!, 'bar-style')[0]!.textContent, 'heavy-light');
});

test('an original voice-local repeat retains its owner and reports the unchanged playback limitation', async () => {
  const source = String.raw`\score {
    \new PianoStaff <<
      \new Staff << \time 1/4
        \new Voice = "melody" { \voiceOne \repeat volta 2 { c''4 d''4 } g''4 }
        \new Voice = "companion" { \voiceTwo e'4 f'4 a'4 b'4 }
      >>
      \new Staff { \time 1/4 c4 d4 e4 f4 }
    >> \layout {} \midi {}
  }`;
  const score = (await converter.convert(source)).scores[0]!;
  const controls = score.document.events.filter(
    (event) =>
      event.kind === 'score' &&
      ['volta-repeat-start-event', 'volta-repeat-end-event'].includes(event.class),
  );
  const melody = score.document.contexts.find((context) => context.name === 'melody')!;

  assert.ok(controls.length > 0);
  assert.ok(
    controls.every((event) => 'repeatContext' in event && event.repeatContext === melody.id),
  );
  assert.ok(
    score.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'repeat-playback-scope' &&
        diagnostic.message.includes('different repeats or endings'),
    ),
  );
  validate(score.musicxml);
  const written = musicXmlWrittenNotes(score.musicxml)
    .map(({ pitch, start, grace, duration }) => [pitch, start, grace, duration])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const expected = [
    ['C:0:5', 0, 0, 1],
    ['D:0:5', 1, 0, 1],
    ['G:0:5', 2, 0, 1],
    ['E:0:4', 0, 0, 1],
    ['F:0:4', 1, 0, 1],
    ['A:0:4', 2, 0, 1],
    ['B:0:4', 3, 0, 1],
    ['C:0:3', 0, 0, 1],
    ['D:0:3', 1, 0, 1],
    ['E:0:3', 2, 0, 1],
    ['F:0:3', 3, 0, 1],
  ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  assert.deepEqual(written, expected);
  const native = [
    [48, 0],
    [64, 0],
    [72, 0],
    [50, 1],
    [65, 1],
    [74, 1],
    [52, 2],
    [69, 2],
    [72, 2],
    [53, 3],
    [71, 3],
    [74, 3],
    [79, 4],
  ];
  const actual = attacks(score.musicxml);

  assert.equal(actual.length, 17);
  assert.notDeepEqual(actual, native);
});

for (const [name, source, owner] of [
  [
    'score',
    String.raw`\score { \repeat volta 2 << \new Staff { c'1 } \new Staff { e'1 } >> \layout {} }`,
    'Score',
  ],
  [
    'piano staff',
    String.raw`\score { \repeat volta 2 \new PianoStaff << \new Staff { c'1 } \new Staff { e'1 } >> \layout {} }`,
    'PianoStaff',
  ],
  [
    'staff',
    String.raw`\score { \new Staff \repeat volta 2 << \new Voice { c'1 } \new Voice { e'1 } >> \layout {} }`,
    'Staff',
  ],
  [
    'single active voice',
    String.raw`\score { \new Staff << \new Voice { \repeat volta 2 { c'1 } } \new Voice { s1 } >> \layout {} }`,
    'Voice',
  ],
  [
    'matching voice repeats',
    String.raw`\score { \new Staff << \new Voice { \repeat volta 2 { c'1 } } \new Voice { \repeat volta 2 { e'1 } } >> \layout {} }`,
    'Voice',
  ],
] as const) {
  test(`repeat ownership is exact for ${name} without a false scope warning`, async () => {
    const score = (await converter.convert(source)).scores[0]!;
    const controls = score.document.events.filter(
      (event) =>
        event.kind === 'score' &&
        ['volta-repeat-start-event', 'volta-repeat-end-event'].includes(event.class),
    );

    assert.ok(controls.length > 0);
    assert.ok(
      controls.every(
        (event) =>
          'repeatContext' in event &&
          score.document.contexts.find((context) => context.id === event.repeatContext)?.type ===
            owner,
      ),
    );
    assert.ok(
      !score.diagnostics.some((diagnostic) =>
        ['repeat-playback-scope', 'repeat-playback-ownership'].includes(diagnostic.code),
      ),
    );
  });
}

test('repeat ownership stays separate across score documents in one book', async () => {
  const result = await converter.convert(String.raw`shared = \repeat volta 2 <<
    \new Staff { c'1 } \new Staff { e'1 }
  >>
  \book {
    \score { \shared \layout {} }
    \score { \new PianoStaff \shared \layout {} }
  }`);

  assert.equal(result.scores.length, 2);

  for (const [index, type] of [
    [0, 'Score'],
    [1, 'PianoStaff'],
  ] as const) {
    const score = result.scores[index]!;
    const repeat = score.document.events.find(
      (event) => event.kind === 'score' && event.class === 'volta-repeat-start-event',
    )!;

    assert.ok('repeatContext' in repeat);
    assert.equal(
      score.document.contexts.find((context) => context.id === repeat.repeatContext)?.type,
      type,
    );
    assert.ok(
      !score.diagnostics.some((diagnostic) => diagnostic.code === 'repeat-playback-ownership'),
    );
  }
});

test('legacy repeat documents retain identical music and report unknown ownership', async () => {
  const score = (await converter.convert(piano(String.raw`\repeat volta 2 { c'1 } d'1`)))
    .scores[0]!;
  const legacy = {
    ...structuredClone(score.document),
    events: score.document.events.map((event) => {
      if (!('repeatContext' in event)) {
        return event;
      }

      const { repeatContext, ...legacyEvent } = event;

      return legacyEvent;
    }),
  };
  const replay = toMusicXML(legacy);

  validate(replay.musicxml);
  assert.ok(
    replay.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'repeat-playback-ownership' &&
        diagnostic.message.includes('was not captured'),
    ),
  );
  assert.ok(!replay.diagnostics.some((diagnostic) => diagnostic.code === 'repeat-playback-scope'));
  const music = (xml: string) => xml.replace(/<identification>[\s\S]*?<\/identification>/g, '');

  assert.equal(music(replay.musicxml), music(score.musicxml));
});
