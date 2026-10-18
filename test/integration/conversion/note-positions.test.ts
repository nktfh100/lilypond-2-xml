import type { Document, Element } from '@oozcitak/dom/lib/dom/interfaces.js';
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

const positions = (d: ScoreDocument) => d.events.filter((e) => e.kind === 'notePosition');
const ratio = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const tags = String.raw`#(define (note-tags voice) (lambda(g)
 (let* ((column (ly:item-get-column g)) (m (ly:grob-property column 'when))
        (event (ly:grob-property g 'cause)) (pitch (ly:event-property event 'pitch)))
  (list (cons 'data-head (format #f "~a:~a:~a:~a:~a" voice
   (exact->inexact (ly:moment-main m)) (exact->inexact (ly:moment-grace m))
   (ly:pitch-notename pitch) (ly:pitch-octave pitch)))))))`;
const source = (music: string, voice = '', setup = '', staff = '') =>
  tags +
  setup +
  String.raw`\score { \new Staff = "solo" \with { ${staff} } \new Voice = "v" \with { ${voice} } { \override NoteHead.color = #blue \override NoteHead.output-attributes = #(note-tags "v") \override Staff.BarLine.output-attributes = #'((data-bar . "line")) ${music} } \layout {} \midi { \tempo 4=120 } }`;

function translate(node: Element, axis: 0 | 1) {
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

function proveSource(doc: Document, score: ScoreDocument, localSpace = 1, broken = false) {
  const lines = all(doc, 'line').filter(
    (l) => Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) > 8,
  );
  const systems = Array.from({ length: lines.length / 5 }, (_, index) => {
    const staff = lines.slice(index * 5, index * 5 + 5);
    const top = Math.min(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
    const bottom = Math.max(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));

    return {
      top,
      middle: (top + bottom) / 2,
      space: (bottom - top) / 4 / localSpace,
      start: translate(staff[0]!, 0),
    };
  });

  for (const row of positions(score).filter(
    (r) => !r.hidden && !r.custom && r.grobName === 'NoteHead',
  )) {
    const note = score.events
      .filter((e) => e.kind === 'note')
      .find((n) => n.noteId === row.noteId)!;

    assert.ok(note?.pitch);
    const voice = score.contexts.find((c) => c.id === row.voice)!.name;
    const group = all(doc, 'g').find((g) => {
      const parts = g.getAttribute('data-head')?.split(':');

      return (
        parts &&
        parts[0] === voice &&
        Number(parts[1]) === ratio(row.moment.main) &&
        Number(parts[2]) === ratio(row.moment.grace) &&
        Number(parts[3]) === note.pitch!.step &&
        Number(parts[4]) === note.pitch!.octave
      );
    });

    assert.ok(group, `independent source glyph ${row.noteId}`);
    const path = all(group, 'path')[0]!;

    assert.ok(path);
    const x = translate(path, 0),
      y = translate(path, 1);
    const system = [...systems].sort((a, b) => Math.abs(a.middle - y) - Math.abs(b.middle - y))[0]!;
    let origin = system.start;

    if (!broken && row.xReference && ratio(row.xReference.main) > 0) {
      const bars = all(doc, 'g')
        .filter((g) => g.getAttribute('data-bar') === 'line')
        .flatMap((g) => all(g, 'rect'));

      origin = Math.min(...bars.map((b) => translate(b, 0) + Number(b.getAttribute('x'))));
    }

    assert.ok(
      Math.abs(((x - origin) * 10) / system.space - row.originXTenths!) < 0.004,
      `source X for head${row.noteId}`,
    );
    assert.ok(
      Math.abs(((system.top - y) * 10) / system.space - row.yTenths!) < 0.004,
      `source Y for head${row.noteId}`,
    );
    assert.ok(
      Math.abs(row.originXTenths! - row.glyphLeftXTenths!) < 1e-8,
      'verified ordinary glyph has zero left bearing',
    );
  }
}

const pitchKey = (note: Element) =>
  `${all(note, 'step')[0]?.textContent}:${all(note, 'octave')[0]?.textContent}`;
const sourceKey = (pitch: { step: number; octave: number }) =>
  `${['C', 'D', 'E', 'F', 'G', 'A', 'B'][pitch.step]}:${pitch.octave + 4}`;

test('ordinary final note positions retain source-proven chord displacement, grace columns and broken-system origins', async () => {
  const text = source(
    String.raw`c'4 d'4 <e' f'>4 <g' b'>4 \break \grace { c''16 d''16 } e''2 f''2`,
  );
  const result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  assert.equal(result.document.notePositionsCaptured, true);
  const original = await compiler.compile(text, { format: ['svg', 'midi'] });

  proveSource(
    parse(new TextDecoder().decode(file(original.files, '.svg'))),
    result.document,
    1,
    true,
  );
  const rows = positions(result.document);

  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => !r.headOnlyOffset && !r.hidden && !r.custom));
  const native = all(parse(result.musicxml), 'note');

  for (const row of rows) {
    const note = result.document.events
      .filter((e) => e.kind === 'note')
      .find((n) => n.noteId === row.noteId)!;
    const written = native.find((n) => pitchKey(n) === sourceKey(note.pitch!))!;

    assert.ok(written);
    assert.ok(Math.abs(Number(written.getAttribute('default-x')) - row.xTenths!) < 0.00001);
    assert.ok(Math.abs(Number(written.getAttribute('default-y')) - row.yTenths!) < 0.00001);
    assert.deepEqual(row.columnMoment, row.moment);
  }

  const e = rows.find((r) => r.noteId === 3)!,
    f = rows.find((r) => r.noteId === 4)!;

  assert.ok(f.xTenths! - e.xTenths! > 10, 'actual chord-second displacement retained');
  const grace = rows.filter((r) => r.moment.grace.numerator !== 0);

  assert.equal(grace.length, 2);
  assert.ok(
    grace.every(
      (r) =>
        ratio(r.xReference!.main) === 1 && r.xReference!.grace.numerator === 0 && r.xTenths! > 0,
    ),
  );
  assert.ok(
    !result.diagnostics.some(
      (d) => d.code === 'note-position-reference' || d.code === 'note-position-owner',
    ),
  );
  assert.equal(reader.loadData(result.musicxml), 1);
  const imported = all(parse(reader.getMEI()), 'note');

  assert.ok(imported.every((n) => !n.hasAttribute('ho') && !n.hasAttribute('vo')));
  assert.ok(!result.diagnostics.some((d) => d.code === 'note-position-reader'));
  const plain = toMusicXML({
    ...result.document,
    notePositionsCaptured: false,
  });
  const transforms = (svg: string) =>
    all(parse(svg), 'g')
      .filter((g) => g.getAttribute('class') === 'note')
      .map((g) => all(g, 'use')[0]?.getAttribute('transform'));
  const positionedTransforms = transforms(reader.renderToSVG(1)),
    positionedMIDI = midiTimedNotes(reader.renderToMIDI());

  assert.equal(reader.loadData(plain.musicxml), 1);
  assert.deepEqual(transforms(reader.renderToSVG(1)), positionedTransforms);
  assert.deepEqual(midiTimedNotes(reader.renderToMIDI()), positionedMIDI);
});

test('final ordinary head coordinates use global tenths across actual later measures and local/global staff scaling', async () => {
  for (const [setup, staff, spacing] of [
    ['', '', 1],
    ['#(set-global-staff-size 30)', String.raw`\override StaffSymbol.staff-space = #0.7`, 0.7],
  ] as const) {
    const text = source("c'1 d'1", '', setup, staff),
      result = (await converter.convert(text)).scores[0]!;

    validate(result.musicxml);
    const original = await compiler.compile(text, { format: 'svg' });

    proveSource(
      parse(new TextDecoder().decode(file(original.files, '.svg'))),
      result.document,
      spacing,
    );
    assert.deepEqual(
      positions(result.document).map((r) => ratio(r.xReference!.main)),
      [0, 1],
    );
    assert.ok(
      all(parse(result.musicxml), 'note').every(
        (n) => n.hasAttribute('default-x') && n.hasAttribute('default-y'),
      ),
    );
  }
});

test('head-only rendering/X/Y overrides remain actual metadata without moving native descendant origins', async () => {
  for (const config of [
    String.raw`\override NoteHead.extra-offset = #'(1.5 . 0.75)`,
    String.raw`\override NoteHead.X-offset = #1`,
    String.raw`\override NoteHead.Y-offset = #1`,
  ]) {
    const text = source(`${config} c'4 d'4 e'4 f'4`),
      result = (await converter.convert(text)).scores[0]!;

    assert.ok(positions(result.document).every((r) => r.headOnlyOffset));
    const original = await compiler.compile(text, { format: 'svg' });

    proveSource(parse(new TextDecoder().decode(file(original.files, '.svg'))), result.document);
    assert.ok(
      all(parse(result.musicxml), 'note').every(
        (n) => !n.hasAttribute('default-x') && !n.hasAttribute('default-y'),
      ),
    );
    assert.ok(result.diagnostics.some((d) => d.code === 'note-position-head-offset'));
  }
});

test('actual hidden, removed, custom and nonordinary source heads never acquire guessed native coordinates', async () => {
  for (const [music, voice, diagnostic] of [
    [String.raw`\omit NoteHead c'1`, '', 'note-position-hidden'],
    [String.raw`\override NoteHead.transparent = ##t c'1`, '', 'note-position-hidden'],
    ["c'1", String.raw`\remove Note_heads_engraver`, 'note-position-owner'],
    [
      String.raw`\override NoteHead.stencil = #ly:text-interface::print \override NoteHead.text = "custom" c'1`,
      '',
      'note-position-stencil',
    ],
    [
      String.raw`\override NoteHead.after-line-breaking = #(lambda(g) #t) c'1`,
      '',
      'note-position-stencil',
    ],
    [String.raw`\override NoteHead.style = #'cross c'1`, '', 'note-position-stencil'],
  ] as const) {
    const result = (await converter.convert(source(music, voice))).scores[0]!;

    validate(result.musicxml);
    assert.ok(
      all(parse(result.musicxml), 'note').every(
        (n) => !n.hasAttribute('default-x') && !n.hasAttribute('default-y'),
      ),
    );
    assert.ok(
      result.diagnostics.some((d) => d.code === diagnostic),
      diagnostic,
    );
  }
});

test('source positions are not copied to generated split fragments or hidden percent copies', async () => {
  const split = (await converter.convert(source(String.raw`\time 3/4 c'1 d'2`))).scores[0]!;

  validate(split.musicxml);
  const notes = all(parse(split.musicxml), 'note').filter((n) => pitchKey(n) === 'C:4');

  assert.equal(notes.length, 2);
  assert.ok(notes[0]!.hasAttribute('default-x'));
  assert.ok(!notes[1]!.hasAttribute('default-x'));
  assert.ok(split.diagnostics.some((d) => d.code === 'note-position-split'));
  const percentText = source(String.raw`\repeat percent 2 { c'1 } d'1`),
    percent = (await converter.convert(percentText)).scores[0]!;

  validate(percent.musicxml);
  const copied = all(parse(percent.musicxml), 'note').filter(
    (n) => n.getAttribute('print-object') === 'no',
  );

  assert.ok(copied.length > 0);
  assert.ok(copied.every((n) => !n.hasAttribute('default-x') && !n.hasAttribute('default-y')));
  const original = await compiler.compile(
    percentText.replaceAll('\\repeat percent', '\\repeat unfold'),
    { format: 'midi' },
  );

  assert.equal(reader.loadData(percent.musicxml), 1);
  const played = midiTimedNotes(reader.renderToMIDI()),
    expected = midiTimedNotes(file(original.files, '.midi'));

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
});

test('position caches, exact source ownership and uncertain staff origins fail explicitly', async () => {
  const result = (await converter.convert(source("c'1"))).scores[0]!,
    cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;
  const round = toMusicXML(cached);

  validate(round.musicxml);
  assert.deepEqual(
    all(parse(round.musicxml), 'note').map((n) => [
      n.getAttribute('default-x'),
      n.getAttribute('default-y'),
    ]),
    all(parse(result.musicxml), 'note').map((n) => [
      n.getAttribute('default-x'),
      n.getAttribute('default-y'),
    ]),
  );
  const changed = (data: object) =>
    ({
      ...cached,
      events: cached.events.map((e) => (e.kind === 'notePosition' ? { ...e, ...data } : e)),
    }) as ScoreDocument;

  for (const [document, code] of [
    [changed({ staff: null }), 'note-position-owner'],
    [changed({ voice: null }), 'note-position-owner'],
    [changed({ columnMoment: null }), 'note-position-owner'],
    [changed({ xReference: null }), 'note-position-reference'],
    [changed({ xTenths: NaN }), 'note-position-reference'],
    [changed({ noteId: 999 }), 'note-position-owner'],
    [{ ...cached, events: [...cached.events, positions(cached)[0]!] }, 'note-position-owner'],
    [
      {
        ...cached,
        events: [...cached.events, ...cached.events.filter((e) => e.kind === 'notehead')],
      },
      'note-position-owner',
    ],
  ] as const) {
    const exported = toMusicXML(document);

    assert.ok(all(parse(exported.musicxml), 'note').every((n) => !n.hasAttribute('default-x')));
    assert.ok(
      exported.diagnostics.some((d) => d.code === code),
      code,
    );
  }

  const { notePositionsCaptured: _captured, ...legacy } = cached;

  assert.ok(toMusicXML(legacy).diagnostics.some((d) => d.code === 'note-position-history'));
  const sparse = (
    await converter.convert(
      source("c'1", '', '', String.raw`\override StaffSymbol.line-positions = #'(-4 -2 0)`),
    )
  ).scores[0]!;

  assert.ok(
    all(parse(sparse.musicxml), 'note').every(
      (n) => n.hasAttribute('default-x') && !n.hasAttribute('default-y'),
    ),
  );
  assert.ok(sparse.diagnostics.some((d) => d.code === 'note-position-reference'));
});

test('final position capture keeps source callback counts and recovers after failed formatting without score leaks', async () => {
  const text =
    String.raw`#(define (head-blue g) (format #t "HEAD-BLUE-CALL\n") blue)` +
    source(String.raw`\override NoteHead.color = #head-blue c'4 d'4 e'4 f'4`);
  const converted = await converter.convert(text),
    original = await compiler.compile(text, { format: ['svg', 'midi'] });
  const count = (logs: readonly string[]) =>
    logs.filter((l) => l.startsWith('HEAD-BLUE-CALL')).length;

  assert.ok(count(original.logs) > 0);
  assert.equal(count(converted.logs), count(original.logs));
  const failed = source(
    String.raw`\override NoteHead.after-line-breaking = #(lambda(g) (error "position-failed")) c'1`,
  );
  const reset = await converter.convert(failed + source("d'1"));

  assert.ok(reset.scores[0]!.diagnostics.some((d) => d.code === 'note-position-capture'));
  assert.ok(
    all(parse(reset.scores[0]!.musicxml), 'note').every((n) => !n.hasAttribute('default-x')),
  );
  assert.equal(positions(reset.scores[1]!.document)[0]!.id, 1);
  assert.ok(
    all(parse(reset.scores[1]!.musicxml), 'note').every((n) => n.hasAttribute('default-x')),
  );
});
