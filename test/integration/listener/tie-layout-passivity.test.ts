import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createConverter, toMusicXML } from '../../../dist/index.js';
import type { ScoreDocument } from '../../../src/model/document.js';
import { compileObserver } from '../../support/source-observation-support.js';
import { validate } from '../../support/schema.js';
import { elements as all, parse } from '../../support/xml-support.js';
const compiler = createReusableCompiler(),
  converter = createConverter();

after(() => {
  compiler.dispose();
  converter.dispose();
});
const score = (music: string) =>
  String.raw`\score { \new Staff="solo" { ${music} } \layout{} \midi{\tempo 4=120} }`;
const header = String.raw`\header { tagline=##f }`;

async function passive(source: string) {
  const { baseline: plain, observed } = await compileObserver(compiler, source, [
    'TIE-SOURCE-STENCIL',
    'TIE-SOURCE-AFTER',
  ]);
  const result = await converter.convert(source);

  for (const s of result.scores) {
    validate(s.musicxml);
    const stages = s.document.events.filter((e) => e.kind === 'finalLayout');

    assert.equal(stages.length, 1);
    assert.equal(stages[0]!.status, 'complete');
    assert.equal(stages[0]!.stage, 'book');
  }

  return { result, plain, observed };
}

test('actual accidental tie source stays byte-identical and final native direction is recovered without early positioning', async () => {
  const source =
    header +
    score(
      String.raw`fis'?1 \override AccidentalCautionary.parenthesized=##f gis'?1 \break ais'1~ ais'1`,
    );
  const { result } = await passive(source);

  assert.equal(result.scores.length, 1);
  const s = result.scores[0]!,
    ties = s.document.events.filter((e) => e.kind === 'tieGraphic');

  assert.equal(ties.length, 1);
  assert.equal(ties[0]!.direction, -1);
  const marks = all(parse(s.musicxml), 'tied');

  assert.equal(marks.length, 2);
  assert.ok(
    marks.every(
      (m) => m.getAttribute('placement') === 'below' && m.getAttribute('orientation') === 'under',
    ),
  );
  assert.ok(!s.diagnostics.some((d) => d.code === 'tie-direction'));
  const cached = JSON.parse(JSON.stringify(s.document)) as ScoreDocument;

  assert.equal(toMusicXML(cached, { source }).musicxml, s.musicxml);
  const unknown = toMusicXML(
    {
      ...cached,
      events: cached.events.map((e) => (e.kind === 'tieGraphic' ? { ...e, direction: 0 } : e)),
    },
    { source },
  );

  assert.ok(unknown.diagnostics.some((d) => d.code === 'tie-direction'));
  assert.ok(all(parse(unknown.musicxml), 'tied').every((t) => !t.hasAttribute('orientation')));
});

test('normal and custom delegated tie printers preserve source callbacks and final explicit direction', async () => {
  for (const custom of [false, true]) {
    const callbacks = custom
      ? String.raw`#(define (tie-source-stencil g) (format #t "TIE-SOURCE-STENCIL\n") (ly:tie::print g))
#(define (tie-source-after g) (format #t "TIE-SOURCE-AFTER\n") #t)
`
      : '';
    const override = custom
      ? String.raw`\override Tie.stencil=#tie-source-stencil \override Tie.after-line-breaking=#tie-source-after`
      : '';
    const { result, plain } = await passive(
      callbacks + header + score(String.raw`${override} \tieUp c'1~ c'1`),
    );
    const s = result.scores[0]!,
      ties = s.document.events.filter((e) => e.kind === 'tieGraphic');

    assert.equal(ties.length, 1);
    assert.equal(ties[0]!.direction, 1);
    assert.ok(
      all(parse(s.musicxml), 'tied').every((m) => m.getAttribute('orientation') === 'over'),
    );

    if (custom) {
      assert.equal(plain.logs.filter((l) => l.startsWith('TIE-SOURCE-STENCIL')).length, 1);
      assert.equal(plain.logs.filter((l) => l.startsWith('TIE-SOURCE-AFTER')).length, 1);
    }
  }
});

test('broken normal and semi ties keep actual printed direction and score-local retained ownership', async () => {
  const source =
    header +
    score(String.raw`c'1~ \break c'1 d'1\repeatTie e'1\laissezVibrer`) +
    score(String.raw`\tieUp g'1~ g'1`);
  const { result } = await passive(source);

  assert.equal(result.scores.length, 2);
  const first = result.scores[0]!,
    second = result.scores[1]!;
  const a = first.document.events.filter((e) => e.kind === 'tieGraphic'),
    b = second.document.events.filter((e) => e.kind === 'tieGraphic');

  assert.deepEqual(
    a.map((e) => e.tieType),
    ['normal', 'repeat', 'laissez-vibrer'],
  );
  assert.deepEqual(
    a.map((e) => e.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    b.map((e) => e.id),
    [1],
  );
  assert.ok(a.every((e) => e.direction === 1 || e.direction === -1));
  assert.equal(b[0]!.direction, 1);

  for (const s of result.scores) {
    assert.ok(!s.diagnostics.some((d) => d.code === 'tie-direction'));
    assert.equal(all(parse(s.musicxml), 'image').length, 0);
  }
});
