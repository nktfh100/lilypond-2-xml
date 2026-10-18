import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { type ScoreDocument, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

/** Independently project captured final source coordinates into MusicXML tenths. */
function assertResolvedSlurProjection(
  score: { document: ScoreDocument },
  mark: Element,
  type: 'start' | 'stop',
) {
  const event = score.document.events.find((e) => e.kind === 'slur');

  assert.ok(event?.resolvedGeometry, 'expected final source Bezier geometry');
  const g = event.resolvedGeometry;
  const staffSpace = score.document.paper?.['staff-space'];

  assert.ok(typeof staffSpace === 'number' && Number.isFinite(staffSpace) && staffSpace > 0);
  const factor = (g.outputScale * 10) / staffSpace;
  const endpoint = (type === 'start' ? g.points[0] : g.points[3])!;
  const control = (type === 'start' ? g.points[1] : g.points[2])!;
  const noteOrigin = type === 'start' ? g.fromNoteOrigin : g.toNoteOrigin;
  const expected = {
    'default-x': (endpoint[0] - noteOrigin[0]) * factor,
    'default-y': (endpoint[1] - g.staffTopY) * factor,
    'bezier-x': (control[0] - endpoint[0]) * factor,
    'bezier-y': (control[1] - endpoint[1]) * factor,
  };

  for (const [name, value] of Object.entries(expected)) {
    assert.ok(
      Math.abs(Number(mark.getAttribute(name)) - value) < 1e-8,
      `${name} did not match independently projected source geometry`,
    );
  }

  assert.equal(
    mark.getAttribute('relative-x'),
    null,
    'resolved absolute geometry already includes the source extra-offset',
  );
  assert.equal(
    mark.getAttribute('relative-y'),
    null,
    'resolved absolute geometry already includes the source extra-offset',
  );
}

test('numbered slurs on individual chord notes retain exact notehead ownership', async () => {
  const { scores } = await converter.convert(
    String.raw`\fixed c' { <c f\=1( g\=2( >2 <c e\=1) a\=2) >2 }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml),
    notes = elements(xml, 'note');

  assert.deepEqual(
    notes.map((n) =>
      elements(n, 'slur').map((s) => [s.getAttribute('type'), s.getAttribute('number')]),
    ),
    [[], [['start', '1']], [['start', '2']], [], [['stop', '1']], [['stop', '2']]],
  );
  assert.equal(score.document.slursCaptured, true);
  const spans = score.document.events.filter((e) => e.kind === 'slur');

  assert.equal(spans.length, 2);
  assert.ok(spans.every((s) => s.fromHead && s.toHead));
  assert.deepEqual(spans.map((s) => [s.label, s.fromNotes, s.toNotes]).sort(), [
    [1, [2], [5]],
    [2, [3], [6]],
  ]);
  const slurDiagnostics = score.diagnostics.filter((d) => d.code.startsWith('slur-'));

  assert.deepEqual(slurDiagnostics, []);
});

test('overlapping numbered normal and phrasing slurs pair their own endpoints', async () => {
  const { scores } = await converter.convert(
    String.raw`{ c'4\=1(\( d'4\=2( e'4\=1) f'4\=2) | g'4\) a'4( b'4) c''4 }`,
  );
  const score = scores[0]!;

  validate(score.musicxml);
  const notes = elements(parse(score.musicxml), 'note');
  const starts = notes.flatMap((n, i) =>
    elements(n, 'slur')
      .filter((s) => s.getAttribute('type') === 'start')
      .map((s) => [i, s.getAttribute('number')]),
  );
  const stops = notes.flatMap((n, i) =>
    elements(n, 'slur')
      .filter((s) => s.getAttribute('type') === 'stop')
      .map((s) => [i, s.getAttribute('number')]),
  );

  assert.equal(starts.length, 4);

  for (const [index, number] of starts) {
    const stop = stops.find(([i, n]) => n === number && Number(i) > Number(index));

    assert.ok(stop);
  }

  assert.equal(score.document.events.filter((e) => e.kind === 'slur' && e.phrasing).length, 1);
  assert.ok(
    !score.diagnostics.some((d) => d.code === 'slur-endpoints' || d.code === 'slur-layout'),
  );
});

test('resolved slur direction, dash styles, color and offsets use native attributes', async () => {
  const { scores } = await converter.convert(String.raw`{ \slurUp \slurDashed
    \once \override Slur.color = #red
    \once \override Slur.extra-offset = #'(1 . 2)
    c'4( d'4) \slurDown \slurDotted e'4( f'4) |
    \slurHalfDashed g'2( a'2) }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const starts = elements(parse(score.musicxml), 'slur').filter(
    (s) => s.getAttribute('type') === 'start',
  );

  assert.deepEqual(
    starts.map((s) => s.getAttribute('line-type')),
    ['dashed', 'dotted', 'dashed'],
  );
  assert.equal(starts[0]!.getAttribute('placement'), 'above');
  assert.equal(starts[0]!.getAttribute('orientation'), 'over');
  assert.equal(starts[1]!.getAttribute('placement'), 'below');
  assert.equal(starts[0]!.getAttribute('color'), '#FF0000');
  assertResolvedSlurProjection(score, starts[0]!, 'start');
  assert.equal(starts[0]!.getAttribute('dash-length'), '3');
  assert.equal(starts[0]!.getAttribute('space-length'), '4.5');
  assert.ok(score.diagnostics.some((d) => d.code === 'slur-dash-pattern'));
  assert.ok(!score.diagnostics.some((d) => d.code === 'slur-bezier-reader'));
});

test('hidden and removed slur graphics preserve visibility without recreating omitted engravers', async () => {
  const { scores } =
    await converter.convert(String.raw`\score { { \once \omit Slur c'2( d'2) \once \override Slur.transparent = ##t e'2( f'2) } }
    \score { { c'2( d'2) } \layout { \context { \Voice \remove Slur_engraver } } }`);

  validate(scores[0]!.musicxml);
  validate(scores[1]!.musicxml);
  const hidden = elements(parse(scores[0]!.musicxml), 'slur');

  assert.equal(hidden.length, 4);
  assert.ok(
    hidden.every(
      (s) =>
        s.parentElement!.getAttribute('print-object') === 'no' &&
        s.getAttribute('color') === '#00000000',
    ),
  );
  assert.equal(elements(parse(scores[1]!.musicxml), 'slur').length, 0);
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'slur-visibility-reader'));
});

test('double slurs and grace slurs retain independent identities and grace notehead endpoints', async () => {
  const { scores } =
    await converter.convert(String.raw`{ \set doubleSlurs = ##t <c' e'>2( <d' f'>2) \set doubleSlurs = ##f
    \grace { g'8( a'8 } b'1) }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const starts = elements(parse(score.musicxml), 'slur').filter(
    (s) => s.getAttribute('type') === 'start',
  );

  assert.equal(starts.length, 3);
  assert.deepEqual(
    new Set(starts.slice(0, 2).map((s) => s.getAttribute('placement'))),
    new Set(['above', 'below']),
  );
  const grace = elements(parse(score.musicxml), 'note').filter((n) => elements(n, 'grace').length);

  assert.equal(elements(grace[0], 'slur').length, 1);
  assert.equal(elements(grace[1], 'slur').length, 0);
  assert.ok(
    !score.diagnostics.some((d) => d.code === 'slur-endpoints' || d.code === 'slur-anchor'),
  );
});

test('percent-repeat slurs remap both notehead endpoints and hide copied marks', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \repeat percent 3 { c'4( d'4) e'2 } f'1 }`,
  );

  validate(scores[0]!.musicxml);
  const measures = elements(parse(scores[0]!.musicxml), 'measure');

  assert.deepEqual(
    measures.map((m) => elements(m, 'slur').length),
    [2, 2, 2, 0],
  );
  assert.ok(
    measures
      .slice(1, 3)
      .every((m) =>
        elements(m, 'slur').every((s) => s.parentElement!.getAttribute('print-object') === 'no'),
      ),
  );
  assert.ok(
    !scores[0]!.diagnostics.some((d) => d.code === 'slur-anchor' || d.code === 'slur-percent'),
  );
});

test('custom slur curves and unterminated graphics have explicit limitations', async () => {
  const { scores } =
    await converter.convert(String.raw`{ \shape #'((0 . 0) (0 . 2) (0 . 2) (0 . 0)) Slur c'2( d'2)
    \once \override Slur.stencil = #(lambda (g) (grob-interpret-markup g "custom")) e'2( f'2) g'1( }`);

  validate(scores[0]!.musicxml);
  const resolved = scores[0]!.document.events.filter((event) => event.kind === 'slur');

  assert.ok(
    resolved[0]?.kind === 'slur' && resolved[0].resolvedGeometry,
    'the standard shaped ribbon is measured from its final stencil',
  );
  assert.ok(
    resolved[1]?.kind === 'slur' && !resolved[1].resolvedGeometry,
    'the arbitrary custom stencil stays fail-closed',
  );
  assert.ok(
    !scores[0]!.diagnostics.some((d) => d.code === 'slur-layout'),
    'measured centerline geometry is not reported as unsupported',
  );
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'slur-stencil'));
  assert.ok(scores[0]!.diagnostics.some((d) => d.code === 'slur-endpoints'));
  assert.equal(elements(parse(scores[0]!.musicxml), 'slur').length, 4);
});

test('legacy event documents retain basic slurs with a missing-graphics diagnostic', async () => {
  const { scores } = await converter.convert(String.raw`{ c'2( d'2) }`);
  const document = structuredClone(scores[0]!.document);

  delete document.slursCaptured;
  document.events = document.events.filter((e) => e.kind !== 'slur');
  const score = toMusicXML(document);

  validate(score.musicxml);
  assert.equal(elements(parse(score.musicxml), 'slur').length, 2);
  assert.ok(score.diagnostics.some((d) => d.code === 'slur-history'));
});

test('small slur offsets serialize as valid MusicXML decimal attributes', async () => {
  const { scores } = await converter.convert(
    String.raw`{ \once \override Slur.extra-offset = #'(0.000000001 . -0.000000002) c'2( d'2) }`,
  );

  validate(scores[0]!.musicxml);
  const slur = elements(parse(scores[0]!.musicxml), 'slur')[0]!;

  assertResolvedSlurProjection(scores[0]!, slur, 'start');
});

test('slur numbering follows MusicXML document order and preserves more than sixteen simultaneous voices', async () => {
  const voices = Array.from({ length: 17 }, () => String.raw`\new Voice { c'2( d'2) }`).join(' ');
  const { scores } = await converter.convert(String.raw`\new Staff << ` + voices + ' >>');

  validate(scores[0]!.musicxml);
  const starts = elements(parse(scores[0]!.musicxml), 'slur').filter(
    (s) => s.getAttribute('type') === 'start',
  );

  assert.equal(starts.length, 17);
  assert.ok(starts.every((s) => s.getAttribute('number') === '1'));
  const start = Array.from({ length: 17 }, (_, i) => String.raw`\=` + i + '(').join('');
  const stop = Array.from({ length: 17 }, (_, i) => String.raw`\=` + i + ')').join('');

  await assert.rejects(
    converter.convert("{ c'2" + start + " d'2" + stop + ' }'),
    /More than 16 overlapping slurs in MusicXML document order/,
  );
});

test('cross-staff slurs within a piano part use captured note IDs on each staff', async () => {
  const { scores } = await converter.convert(String.raw`\new PianoStaff <<
    \new Staff = "upper" { c''2( \change Staff = "lower" d'2) }
    \new Staff = "lower" { s1 }
  >>`);

  validate(scores[0]!.musicxml);
  const notes = elements(parse(scores[0]!.musicxml), 'note');
  const annotated = notes.filter((n) => elements(n, 'slur').length);

  assert.equal(annotated.length, 2);
  assert.deepEqual(
    annotated.map((n) => texts(n, 'staff')),
    [['1'], ['2']],
  );
  assert.ok(!scores[0]!.diagnostics.some((d) => d.code === 'slur-anchor'));
});

test('exact Scheme rational slur offsets and colors decode into valid native dimensions', async () => {
  const { scores } =
    await converter.convert(String.raw`{ \once \override Slur.extra-offset = #'(1/3 . -2/3)
    \once \override Slur.color = #(rgb-color 1/2 0 1/4) c'2( d'2) }`);

  validate(scores[0]!.musicxml);
  const slur = elements(parse(scores[0]!.musicxml), 'slur')[0]!;

  assertResolvedSlurProjection(scores[0]!, slur, 'start');
  assert.equal(slur.getAttribute('color'), '#800040');
});
