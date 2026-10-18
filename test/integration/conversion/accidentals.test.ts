import { createReusableCompiler } from '@sightread/lilypond-wasm';
import {
  type AccidentalGraphicEvent,
  type ScoreDocument,
  createConverter,
  toMusicXML,
} from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { readMidiAttacks } from '../../../tools/evaluation/midi.js';
import { accidentalPlans } from '../../../src/musicxml/notation/notes/accidentals.js';
import listener from '../../../src/lilypond/generated/listener.js';
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

const source = (music: string, layout = '', prefix = '') =>
  prefix +
  String.raw`\header{tagline=##f}\score{\new Staff="solo"{${music}}\layout{${layout}}\midi{\tempo 4=120}}`;
const decode = (files: Record<string, Uint8Array>) =>
  Object.entries(files)
    .filter(([n]) => n.endsWith('.svg'))
    .map(([, d]) => new TextDecoder().decode(d));
const midi = (files: Record<string, Uint8Array>) =>
  readMidiAttacks(Object.entries(files).find(([n]) => n.endsWith('.midi'))![1]);
const attacks = (m: ReturnType<typeof readMidiAttacks>) =>
  m.tracks
    .flatMap((t) => t.attacks)
    .map((a) => [
      a.pitch,
      a.channel,
      a.tick / m.division,
      a.velocity,
      a.endTick === null ? null : a.endTick / m.division,
    ]);
const compareReader = (
  actual: ReturnType<typeof readMidiAttacks>,
  expected: ReturnType<typeof readMidiAttacks>,
) => {
  const a = attacks(actual),
    b = attacks(expected);

  assert.equal(a.length, b.length);

  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(a[i]!.slice(0, 4), b[i]!.slice(0, 4));
    assert.ok(
      a[i]![4] !== null && b[i]![4] !== null && Math.abs(a[i]![4]! - b[i]![4]!) < 0.01,
      'reader noteoff quantization',
    );
  }
};

async function independent(text: string) {
  const plain = await compiler.compile(text, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(text, {
    format: ['svg', 'midi'],
    files: { 'observe.ily': listener },
    includeSettings: 'observe.ily',
  });

  assert.deepEqual(
    decode(observed.files),
    decode(plain.files),
    'observer must preserve actual source SVG bytes',
  );
  assert.ok(
    Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );
  assert.deepEqual(
    observed.logs.filter((s) => s.startsWith('ACC-CALL ')),
    plain.logs.filter((s) => s.startsWith('ACC-CALL ')),
  );
  const score = (await converter.convert(text)).scores[0]!;

  validate(score.musicxml);
  assert.equal(score.document.accidentalsCaptured, true);
  const cache = toMusicXML(JSON.parse(JSON.stringify(score.document)) as ScoreDocument);

  validate(cache.musicxml);
  assert.deepEqual(
    all(parse(cache.musicxml), 'accidental').map((n) => serialize(n)),
    all(parse(score.musicxml), 'accidental').map((n) => serialize(n)),
  );
  assert.equal(all(parse(score.musicxml), 'image').length, 0);

  return {
    score,
    svg: decode(plain.files).join('\n'),
    sourceMidi: midi(plain.files),
  };
}

const graphics = (d: ScoreDocument) =>
  d.events.filter((e): e is AccidentalGraphicEvent => e.kind === 'accidentalGraphic');
const basicText = source(
  String.raw`\override Accidental.output-attributes=#'((data-acc . "source")) fis'1 \omit Accidental gis'1 \undo \omit Accidental \override Accidental.color=#red \override Accidental.font-size=#3 ais'1`,
);
let basic: Awaited<ReturnType<typeof independent>> | undefined;
const getBasic = async () => (basic ??= await independent(basicText));

test('actual accidental ink retains omission, source color and resolved physical font size without changing pitch or playback', async () => {
  const { score, svg, sourceMidi } = await getBasic(),
    g = graphics(score.document),
    native = all(parse(score.musicxml), 'accidental');

  assert.equal((svg.match(/data-acc="source"/g) ?? []).length, 2);
  assert.ok(svg.includes('color="rgba(100.0000%, 0.0000%, 0.0000%, 100.0000%)"'));
  assert.equal(g.length, 3);
  assert.deepEqual(
    g.map((e) => e.noteId),
    [1, 2, 3],
  );
  assert.equal(
    g[1]!.pieces.every((p) => p.hidden),
    true,
  );
  assert.equal(native[1]!.getAttribute('color'), '#00000000');
  assert.equal(native[2]!.getAttribute('color'), '#FF0000');
  const sizes = native.map((n) => Number(n.getAttribute('font-size')));

  assert.ok(Math.abs(sizes[2]! / sizes[0]! - Math.SQRT2) < 1e-8);
  const scales = Array.from(
    svg.matchAll(/data-acc="source"[\s\S]*?<path transform="scale\(([\d.]+)/g),
  ).map((m) => Number(m[1]));

  assert.ok(
    Math.abs(scales[1]! / scales[0]! - sizes[2]! / sizes[0]!) < 0.02,
    'independent source path scaling agrees',
  );
  reader.setOptions({ xmlIdSeed: 1 });
  assert.equal(reader.loadData(score.musicxml), 1);
  const mei = reader.getMEI(),
    rendered = reader.renderToSVG(1);

  assert.match(mei, /accid="s" color="#00000000"/);
  assert.match(rendered, /class="accid" color="#00000000" fill="#00000000"/);
  assert.match(mei, /accid="s" color="#FF0000"/);
  assert.ok(!/fontsize|font-size/.test(mei.match(/<accid[^>]*color="#FF0000"[^>]*>/)![0]));
  compareReader(readMidiAttacks(Buffer.from(reader.renderToMIDI(), 'base64')), sourceMidi);
  assert.ok(!score.diagnostics.some((d) => d.code === 'accidental-size-reader'));
  const changed = await independent(
    source(
      String.raw`\override Accidental.glyph-name="accidentals.flat" fis'1 \revert Accidental.glyph-name \override Accidental.restore-first=##t gis'1`,
    ),
  );

  assert.deepEqual(
    all(parse(changed.score.musicxml), 'accidental').map((n) => n.textContent),
    ['flat', 'natural-sharp'],
  );
  assert.deepEqual(
    all(parse(changed.score.musicxml), 'alter').map((n) => n.textContent),
    ['1', '1'],
  );
  reader.loadData(changed.score.musicxml);
  assert.deepEqual(
    changed.sourceMidi.tracks.flatMap((t) => t.attacks).map((n) => n.pitch),
    [66, 68],
  );
  assert.deepEqual(
    readMidiAttacks(Buffer.from(reader.renderToMIDI(), 'base64'))
      .tracks.flatMap((t) => t.attacks)
      .map((n) => n.pitch),
    [64, 68],
  );
  assert.ok(!changed.score.diagnostics.some((d) => d.code === 'accidental-pitch-reader'));
});

test('removed accidental engraving creates no native accidental while altered sounding pitches remain', async () => {
  const text = source("fis'1 gis'1", String.raw`\context{\Staff\remove Accidental_engraver}`);
  const { score, svg, sourceMidi } = await independent(text);

  assert.equal(graphics(score.document).length, 0);
  assert.equal(all(parse(score.musicxml), 'accidental').length, 0);
  assert.ok(!svg.includes('M0 119c0 8'));
  reader.loadData(score.musicxml);
  assert.equal((reader.getMEI().match(/<accid\s/g) ?? []).length, 0);
  assert.match(reader.getMEI(), /accid.ges="s"/);
  compareReader(readMidiAttacks(Buffer.from(reader.renderToMIDI(), 'base64')), sourceMidi);
});

test('cautionary accidental parentheses follow actual final grobs and tied source removal does not regain ink', async () => {
  const { score } = await independent(
    source(String.raw`fis'?1 \override AccidentalCautionary.parenthesized=##f gis'?1 \break ais'1`),
  );
  const gs = graphics(score.document),
    native = all(parse(score.musicxml), 'accidental');

  assert.equal(native[0]!.getAttribute('parentheses'), 'yes');
  assert.equal(native[1]!.getAttribute('parentheses'), null);
  assert.equal(native[1]!.getAttribute('cautionary'), 'yes');
  assert.equal(gs[0]!.pieces[0]!.parenthesized, true);
  assert.equal(gs[1]!.pieces[0]!.parenthesized, false);
  // The separately fixed early Tie.direction read must also stay passive with accidental capture.
  const tied = (
    await independent(
      source(
        String.raw`fis'?1 \override AccidentalCautionary.parenthesized=##f gis'?1 \break ais'1~ ais'1`,
      ),
    )
  ).score;
  const tail = tied.document.events.filter((e) => e.kind === 'note').at(-1)!;

  assert.ok(
    !graphics(tied.document).some(
      (g) => g.noteId === tail.noteId && g.pieces.some((p) => !p.hidden),
    ),
  );
  assert.ok(!score.diagnostics.some((d) => d.code === 'accidental-owner'));
});

test('delegated source accidental callbacks run once and actual empty/suicided ink stays suppressed', async () => {
  const prefix = String.raw`#(define(acc-stencil g)(format #t "ACC-CALL stencil\n")(ly:accidental-interface::print g))
 #(define(acc-after g)(format #t "ACC-CALL after\n")(ly:accidental-interface::remove-tied g))`;
  const { score } = await independent(
    source(
      String.raw`\override Accidental.stencil=#acc-stencil \override Accidental.after-line-breaking=#acc-after fis'1 \override Accidental.stencil=#(lambda(g)empty-stencil) gis'1 \revert Accidental.stencil \override Accidental.after-line-breaking=#ly:grob-suicide! ais'1`,
      '',
      prefix,
    ),
  );
  const g = graphics(score.document),
    native = all(parse(score.musicxml), 'accidental');

  assert.ok(g[0]!.pieces[0]!.custom);
  assert.equal(native[1]!.getAttribute('color'), '#00000000');
  assert.equal(native[2]!.getAttribute('color'), '#00000000');
  assert.ok(score.diagnostics.some((d) => d.code === 'accidental-stencil'));
  const recovered = (await converter.convert(source("fis'1"))).scores[0]!;

  assert.equal(graphics(recovered.document)[0]!.id, 1);
  assert.equal(graphics(recovered.document)[0]!.pieces[0]!.custom, false);
  assert.notEqual(
    all(parse(recovered.musicxml), 'accidental')[0]!.getAttribute('color'),
    '#00000000',
  );
});

test('accidental cache ownership and malformed final histories never choose an arbitrary graphic', async () => {
  const original = (await getBasic()).score.document;
  const run = (mutate: (d: ScoreDocument) => void) => {
    const d = JSON.parse(JSON.stringify(original)) as ScoreDocument;

    mutate(d);
    const codes: string[] = [];
    const p = accidentalPlans(d, d.events as Parameters<typeof accidentalPlans>[1], (code) =>
      codes.push(code),
    );

    return { p, codes };
  };

  assert.ok(
    run((d) => {
      const row = graphics(d)[0]!;

      d.events = [...d.events, { ...row, id: 999 }];
    }).codes.includes('accidental-ownership'),
  );
  assert.ok(
    run((d) => {
      graphics(d)[0]!.staff = 999;
    }).codes.includes('accidental-owner'),
  );
  assert.ok(
    run((d) => {
      graphics(d)[0]!.pieces = [{ ...graphics(d)[0]!.pieces[0]!, fontPoints: Infinity }];
    }).codes.includes('accidental-appearance'),
  );
  assert.ok(
    run((d) => {
      d.events = d.events.filter((e) => e.kind !== 'finalLayout');
    }).codes.includes('accidental-capture'),
  );
  assert.ok(
    run((d) => {
      d.events = d.events.map((e) => (e.kind === 'finalLayout' ? { ...e, attempted: false } : e));
    }).codes.includes('accidental-capture'),
  );
  assert.ok(
    run((d) => {
      d.events = d.events.map((e) => (e.kind === 'finalLayout' ? { ...e, stage: 'score' } : e));
    }).codes.includes('accidental-capture'),
  );
  assert.ok(
    run((d) => {
      delete d.accidentalsCaptured;
    }).codes.includes('accidental-history'),
  );
  const missing = run((d) => {
    d.events = d.events.filter((e) => e.kind !== 'accidentalGraphic' || e.noteId !== 1);
  });

  assert.ok(missing.codes.includes('accidental-capture'));
  assert.equal(missing.p.get(1)?.attrs.color, '#00000000');
  const duplicate = run((d) => {
    const row = graphics(d)[0]!;

    row.pieces = [row.pieces[0]!, { ...row.pieces[0]!, system: 2 }];
  });

  assert.ok(duplicate.codes.includes('accidental-appearance'));
  const quarantine = run((d) => {
    const row = graphics(d)[0]!;

    d.events = [{ ...row, id: 999, staff: 999 }, ...d.events];
  });

  assert.equal(quarantine.p.get(1)?.attrs.color, '#00000000');
  assert.ok(quarantine.codes.includes('accidental-owner'));
  const micro = run((d) => {
    const row = graphics(d)[0]!;

    row.pieces = [{ ...row.pieces[0]!, glyph: 'accidentals.sharp.slashslash.stem' }];
  });

  assert.equal(micro.p.get(1)?.value, 'quarter-sharp');
  assert.equal(micro.p.get(1)?.attrs.smufl, 'accidentalQuarterToneSharpStein');
});

test('accidental physical font scales with global staff size while local line spacing retains selected glyph size', async () => {
  const points: number[] = [],
    pathScales: number[] = [];

  for (const [prefix, override] of [
    ['', ''],
    ['#(set-global-staff-size 30)', ''],
    ['', String.raw`\override StaffSymbol.staff-space=#0.7`],
  ]) {
    const { score, svg } = await independent(
      source(
        String.raw`${override} \override Accidental.output-attributes=#'((data-acc . "scale")) fis'1`,
        '',
        prefix,
      ),
    );

    points.push(Number(all(parse(score.musicxml), 'accidental')[0]!.getAttribute('font-size')));
    const rendered = parse(svg),
      unit =
        Number(rendered.documentElement.getAttribute('width')!.replace('mm', '')) /
        Number(rendered.documentElement.getAttribute('viewBox')!.split(/\s+/)[2]);

    pathScales.push(
      Number(svg.match(/data-acc="scale"[\s\S]*?<path transform="scale\(([\d.]+)/)![1]) * unit,
    );
  }

  assert.ok(Math.abs(points[1]! / points[0]! - 1.5) < 1e-8);
  assert.ok(Math.abs(points[2]! / points[0]! - 1) < 1e-8);
  assert.ok(Math.abs(pathScales[1]! / pathScales[0]! - 1.5) < 0.025);
  assert.ok(Math.abs(pathScales[2]! / pathScales[0]! - 1) < 0.025);
});
