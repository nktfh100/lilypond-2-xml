import type { Document } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { createConverter, toMusicXML } from 'lilypond-2-xml';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
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

const fixture = (
  withs = '',
  music = String.raw`\makeClusters { <c' d' e'>1 <f' g' a'>1 }`,
) => String.raw`
  \score { \new Staff \new Voice \with {
    \override ClusterSpanner.output-attributes = #'((data-source-cluster . "true")) ${withs}
  } { ${music} } \layout {} \midi { \tempo 4=120 } }`;
const graphics = (score: Awaited<ReturnType<typeof converter.convert>>['scores'][number]) =>
  score.document.events.filter((e) => e.kind === 'clusterGraphic');

type ClusterNote = Extract<
  Awaited<ReturnType<typeof converter.convert>>['scores'][number]['document']['events'][number],
  { kind: 'note' }
>;
const clusterNotes = (score: Awaited<ReturnType<typeof converter.convert>>['scores'][number]) =>
  score.document.events.filter((e): e is ClusterNote => e.kind === 'note' && e.cluster === true);

async function independent(source: string) {
  const [{ scores }, plain] = await Promise.all([
    converter.convert(source),
    compiler.compile(source, { format: 'svg' }),
  ]);
  const score = scores[0]!;

  validate(score.musicxml);
  assert.equal(reader.loadData(score.musicxml), 1);
  const svg = new TextDecoder().decode(
    Object.entries(plain.files).find(([n]) => n.endsWith('.svg'))![1],
  );

  return {
    score,
    xml: parse(score.musicxml),
    svg,
    sourceSvg: parse(svg),
    mei: reader.getMEI(),
    readerSvg: reader.renderToSVG(1),
  };
}

const drawn = (svg: Document) =>
  all(svg, 'g').filter(
    (el) => el.getAttribute('data-source-cluster') === 'true' && el.childNodes.length > 0,
  );

test('actual cluster notes retain written pitches and full-size native cluster notation', async () => {
  const { score, xml, sourceSvg, mei, readerSvg } = await independent(fixture());

  assert.equal(clusterNotes(score).length, 6);
  assert.equal(graphics(score).length, 2);
  assert.deepEqual(
    graphics(score).map((g) => g.noteIds),
    [
      clusterNotes(score)
        .slice(0, 3)
        .map((n) => n.noteId),
      clusterNotes(score)
        .slice(3)
        .map((n) => n.noteId),
    ],
  );
  assert.deepEqual(
    graphics(score).map((g) => g.positions),
    [
      [-6, -4],
      [-3, -1],
    ],
  );
  assert.ok(
    graphics(score).every((g) => g.present && !g.hidden && !g.custom && g.style === 'ramp'),
  );
  assert.ok(drawn(sourceSvg).length > 0);
  assert.equal(all(xml, 'note').length, 6);
  assert.equal(all(xml, 'cue').length, 0);
  assert.ok(all(xml, 'note').every((n) => !n.hasAttribute('dynamics')));
  assert.ok(
    all(xml, 'type').every((n) => !n.hasAttribute('size') || n.getAttribute('size') === 'full'),
  );
  assert.ok(
    all(xml, 'notehead').every(
      (n) => n.textContent === 'cluster' && n.getAttribute('filled') === 'yes',
    ),
  );
  assert.ok(all(xml, 'stem').every((n) => n.textContent === 'none'));
  assert.match(mei, /cluster="white"/);
  assert.match(mei, /head.fill="solid"/);
  const head = all(parse(readerSvg), 'g').find((g) => g.getAttribute('class') === 'notehead')!;

  assert.equal(
    all(head, 'rect')[0]!.getAttribute('fill-opacity'),
    '0',
    'reader ignores filled cluster override',
  );
  assert.ok(
    all(sourceSvg, 'polygon').some((p) => p.getAttribute('fill') !== 'none'),
    'source cluster envelope is filled',
  );
  assert.ok(score.diagnostics.some((d) => d.code === 'cluster-layout'));
});

test('source removal and hidden cluster stencils preserve written notes without restoring native ink', async () => {
  for (const withs of [
    String.raw`\remove Cluster_spanner_engraver`,
    String.raw`\override ClusterSpanner.stencil = ##f`,
    String.raw`\override ClusterSpanner.transparent = ##t`,
  ]) {
    const { score, xml, sourceSvg } = await independent(fixture(withs));

    assert.equal(drawn(sourceSvg).length, 0);
    assert.ok(graphics(score).every((g) => g.hidden && g.present !== withs.includes('remove')));
    assert.ok(all(xml, 'note').every((n) => n.getAttribute('print-object') === 'no'));
    assert.ok(all(xml, 'notehead').every((n) => n.textContent === 'none'));
    assert.equal(clusterNotes(score).length, 6);
  }
});

test('cluster envelope styles and colors come from each actual owning spanner', async () => {
  for (const style of ['ramp', 'leftsided-stairs', 'rightsided-stairs', 'centered-stairs']) {
    const { score, xml, sourceSvg } = await independent(
      fixture(
        String.raw`\override ClusterSpanner.style = #'${style} \override ClusterSpanner.color = #blue`,
      ),
    );

    assert.ok(graphics(score).every((g) => g.style === style && g.present && !g.hidden));
    assert.ok(graphics(score).every((g) => JSON.stringify(g.color) === '[0,0,1]'));
    assert.ok(drawn(sourceSvg).length > 0);
    assert.ok(all(xml, 'notehead').every((n) => n.getAttribute('color') === '#0000FF'));
  }
});

test('a single stair beacon and unsupported source styles do not acquire invented cluster ink', async () => {
  for (const style of ['leftsided-stairs', 'rightsided-stairs', 'unknown-source-style']) {
    const { score, xml, sourceSvg } = await independent(
      fixture(
        String.raw`\override ClusterSpanner.style = #'${style}`,
        String.raw`\makeClusters { <c' d' e'>1 }`,
      ),
    );

    assert.equal(drawn(sourceSvg).length, 0);
    assert.equal(graphics(score)[0]!.present, true);
    assert.equal(graphics(score)[0]!.hidden, true);
    assert.ok(all(xml, 'note').every((n) => n.getAttribute('print-object') === 'no'));
  }
});

test('beacon transparency does not hide the source cluster envelope', async () => {
  const { score, sourceSvg, xml } = await independent(
    fixture(String.raw`\override ClusterSpannerBeacon.transparent = ##t`),
  );

  assert.ok(drawn(sourceSvg).length > 0);
  assert.ok(graphics(score).every((g) => !g.hidden));
  assert.ok(all(xml, 'notehead').every((n) => n.textContent === 'cluster'));
});

test('dotted and altered cluster durations retain written timing and absent dot ink', async () => {
  const { score, xml, sourceSvg } = await independent(
    fixture('', String.raw`\makeClusters { <cis' e' g'>2. <f' a' c''>4 }`),
  );

  assert.equal(clusterNotes(score).length, 6);
  assert.ok(drawn(sourceSvg).length > 0);
  assert.equal(all(sourceSvg, 'circle').length, 0, 'source has no dotted-note ink');
  assert.equal(
    all(sourceSvg, 'path').length,
    2,
    'only source clef and common-time glyphs; no accidental glyph',
  );
  assert.equal(all(xml, 'dot').length, 3);
  assert.ok(all(xml, 'dot').every((n) => n.getAttribute('color') === '#00000000'));
  assert.deepEqual(
    all(xml, 'duration').map((n) => n.textContent),
    ['3', '3', '3', '1', '1', '1'],
  );
  assert.equal(all(xml, 'alter')[0]!.textContent, '1');
});

test('ordinary notes next to clusters retain their independent notation', async () => {
  const { score, xml } = await independent(
    fixture('', String.raw`\makeClusters { <c' d' e'>2 <f' g' a'>2 } b'1`),
  );

  assert.equal(clusterNotes(score).length, 6);
  assert.equal(all(xml, 'note').filter((n) => !n.hasAttribute('dynamics')).length, 7);
});

test('cluster ownership remains distinct across voices and repeated source attacks', async () => {
  const input = String.raw`\score { \new Staff <<
    \new Voice = "upper" { \repeat unfold 2 { \makeClusters { <c' e'>2 <d' f'>2 } } }
    \new Voice = "lower" { \voiceTwo \makeClusters { <c g>1 <d a>1 } }
    >> \layout {} \midi {} }`;
  const { score } = await independent(input);
  const notes = clusterNotes(score);

  assert.equal(notes.length, 12);
  assert.equal(new Set(notes.map((n) => n.noteId)).size, 12);
  assert.equal(graphics(score).length, 6);
  const ids = graphics(score).flatMap((g) => g.noteIds);

  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12);
  assert.ok(!score.diagnostics.some((d) => d.code === 'cluster-ownership'));
});

test('percent-repeated clusters retain notation with source-owned copied graphics', async () => {
  const { score, xml } = await independent(
    fixture('', String.raw`\repeat percent 2 { \makeClusters { <c' e'>1 } } g'1`),
  );

  assert.equal(clusterNotes(score).length, 2);
  assert.equal(all(xml, 'cue').length, 0);
  assert.equal(all(xml, 'pitch').length, 5);
  assert.ok(
    !score.diagnostics.some((d) => d.code === 'cluster-history' || d.code === 'cluster-ownership'),
  );
});

test('cluster capture survives JSON caching and resets before the next conversion', async () => {
  const input = fixture(),
    first = (await converter.convert(input)).scores[0]!;

  assert.equal(
    toMusicXML(JSON.parse(JSON.stringify(first.document)), { source: input }).musicxml,
    first.musicxml,
  );
  const reset = await independent(fixture('', "c'1"));

  assert.equal(graphics(reset.score).length, 0);
  assert.equal(clusterNotes(reset.score).length, 0);
  assert.equal(all(reset.xml, 'cue').length, 0);
});

test('missing and conflicting cached cluster ownership is diagnosed without guessed visible heads', async () => {
  const original = (await converter.convert(fixture())).scores[0]!.document;
  const missing = structuredClone(original);

  missing.events = missing.events.filter((e) => e.kind !== 'clusterGraphic');
  const a = toMusicXML(missing);

  validate(a.musicxml);
  assert.ok(a.diagnostics.some((d) => d.code === 'cluster-history'));
  const duplicate = structuredClone(original),
    g = duplicate.events.find((e) => e.kind === 'clusterGraphic')!;

  duplicate.events = [...duplicate.events, structuredClone(g)];
  const b = toMusicXML(duplicate);

  validate(b.musicxml);
  assert.ok(b.diagnostics.some((d) => d.code === 'cluster-ownership'));
  const ids = new Set(g.noteIds);
  const notes = all(parse(b.musicxml), 'note');

  assert.ok(notes.slice(0, ids.size).every((n) => n.getAttribute('print-object') === 'no'));
});

test('custom cluster callbacks retain provenance and explicit drawing diagnostics', async () => {
  const { score } = await independent(
    fixture(String.raw`\override ClusterSpanner.after-line-breaking = #(lambda (grob) #t)`),
  );

  assert.ok(graphics(score).every((g) => g.custom));
  assert.ok(score.diagnostics.some((d) => d.code === 'cluster-stencil'));
});
