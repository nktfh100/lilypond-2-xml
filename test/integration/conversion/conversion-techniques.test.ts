import { toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validate } from '../../support/schema.js';
import { converter, elements, parse, texts } from '../../support/conversion-support.js';

test('right-hand plucking uses resolved labels and individual chord-note ownership', async () => {
  const { scores } = await converter.convert(String.raw`
    \layout { \context { \Voice strokeFingerOrientations = #'(up) } }
    { <c'^\rightHandFinger #1 e'_\rightHandFinger #2 >4
      \once \override StrokeFinger.digit-names = ##("T" "I" "M" "A" "X")
      <d'-\rightHandFinger #1 >4 <e'-\rightHandFinger #"custom" >4
      f'4\rightHandFinger #3 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.deepEqual(texts(xml, 'pluck'), ['p', 'i', 'T', 'custom']);
  assert.deepEqual(
    elements(xml, 'pluck')
      .slice(0, 2)
      .map((p) => p.getAttribute('placement')),
    ['above', 'below'],
  );
  assert.deepEqual(
    elements(xml, 'note').map((n) => texts(n, 'pluck')),
    [['p'], ['i'], ['T'], ['custom'], []],
  );
  assert.equal(elements(xml, 'fingering').length, 0);
  assert.ok(
    !score.diagnostics.some((d) =>
      ['unmapped-event', 'unmapped-attachment', 'technique-stencil'].includes(d.code),
    ),
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'technique-reader'));
});

test('hidden, removed and horizontally placed plucking marks preserve compiler visibility', async () => {
  const { scores } = await converter.convert(String.raw`{
    <c'-\rightHandFinger #1 >4
    \once \omit StrokeFinger <d'-\rightHandFinger #2 >4
    \once \override StrokeFinger.transparent = ##t <e'-\rightHandFinger #3 >4
    \once \override StrokeFinger.font-shape = #'upright <f'^\rightHandFinger #4 >4 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.deepEqual(texts(xml, 'pluck'), ['p', 'i', 'm', 'a']);
  assert.ok(
    elements(xml, 'pluck')
      .slice(1, 3)
      .every((p) => p.parentElement!.parentElement!.getAttribute('print-object') === 'no'),
  );
  assert.equal(elements(xml, 'pluck')[3]!.getAttribute('font-style'), 'normal');
  assert.ok(score.diagnostics.some((d) => d.code === 'pluck-placement'));
});

test('bendAfter exports native falls and doits using actual graphics rather than guitar semitones', async () => {
  const { scores } = await converter.convert(String.raw`{
    c'4\bendAfter #-4 d'4\bendAfter #4
    \once \override BendAfter.delta-position = #5 e'4\bendAfter #-4
    <f' a'>4\bendAfter #-3
    \once \omit BendAfter g'4\bendAfter #2
    \once \override BendAfter.transparent = ##t a'4\bendAfter #-2
    b'4\bendAfter #0 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.equal(elements(xml, 'falloff').length, 4);
  assert.equal(elements(xml, 'doit').length, 2);
  assert.equal(elements(xml, 'bend').length, 0);
  assert.equal(elements(xml, 'falloff')[0]!.getAttribute('line-shape'), 'curved');
  assert.equal(
    elements(xml, 'doit')[1]!.parentElement!.parentElement!.getAttribute('print-object'),
    'no',
  );
  assert.equal(
    elements(xml, 'falloff')[3]!.parentElement!.parentElement!.getAttribute('print-object'),
    'no',
  );
  assert.ok(score.diagnostics.some((d) => d.code === 'bend-after-zero'));
  assert.ok(score.diagnostics.some((d) => d.code === 'bend-after-layout'));
  assert.ok(
    !score.diagnostics.some((d) => d.code.startsWith('unmapped') || d.code === 'technique-stencil'),
  );
});

test('custom plucking markup and drawings retain native text with explicit formatting limits', async () => {
  const { scores } = await converter.convert(String.raw`{
    <c'^\rightHandFinger \markup \bold "thumb" >4
    <d'^\rightHandFinger \markup \box "index" >4
    \once \override StrokeFinger.stencil = #(lambda (g) (grob-interpret-markup g "custom drawing"))
    <e'^\rightHandFinger #3 >4 f'4 }`);
  const score = scores[0]!;

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.deepEqual(texts(xml, 'pluck'), ['thumb', 'index', 'm']);
  assert.equal(elements(xml, 'pluck')[0]!.getAttribute('font-weight'), 'bold');
  assert.ok(score.diagnostics.some((d) => d.code === 'pluck-format'));
  assert.ok(score.diagnostics.some((d) => d.code === 'technique-stencil'));
});

test('old event documents infer native techniques with an explicit missing-graphics diagnostic', async () => {
  const { scores } = await converter.convert(
    String.raw`{ <c'^\rightHandFinger #1 >2 d'2\bendAfter #-4 }`,
  );
  const document = structuredClone(scores[0]!.document);

  delete document.scriptsCaptured;
  document.events = document.events.filter((e) => e.kind !== 'script');
  const score = toMusicXML(document);

  validate(score.musicxml);
  const xml = parse(score.musicxml);

  assert.deepEqual(texts(xml, 'pluck'), ['p']);
  assert.equal(elements(xml, 'falloff').length, 1);
  assert.ok(score.diagnostics.some((d) => d.code === 'technique-history'));
});
