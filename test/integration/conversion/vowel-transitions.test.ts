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

const graphics = (d: ScoreDocument) => d.events.filter((e) => e.kind === 'vowelTransition');
const brackets = (xml: string) => all(parse(xml), 'bracket');
const value = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const source = (
  lyrics = String.raw`a \vowelTransition e foo bar`,
  music = "c'4 d'4 e'4 f'4",
  config = '',
  staff = '',
) =>
  String.raw`\score { << \new Staff \with { ${staff} } \new Voice = "melody" { ${music} } \new Lyrics \with { \override VowelTransition.color = #red ${config} } \lyricsto "melody" { ${lyrics} } >> \layout {} \midi { \tempo 4=120 } }`;

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

function red(e: Element) {
  for (
    let n: Element | null = e;
    n;
    n = n.parentNode?.nodeType === 1 ? (n.parentNode as Element) : null
  ) {
    if (n.getAttribute('color')?.startsWith('rgba(100.0000%, 0.0000%, 0.0000%')) {
      return true;
    }
  }

  return false;
}

function proveGeometry(doc: Document, row: ReturnType<typeof graphics>[number], staffRatio = 1) {
  const shaft = all(doc, 'line').filter(red)[0]!;

  assert.ok(shaft, 'independent ordinary source shaft');
  const tips = all(doc, 'polygon')
    .filter(red)
    .map((p) => {
      const coords = p.getAttribute('points')!.trim().split(/\s+/).map(Number);

      return [
        translate(p, 0) + coords[coords.length - 2]!,
        translate(p, 1) + coords[coords.length - 1]!,
      ] as const;
    })
    .sort((a, b) => a[0] - b[0]);

  assert.equal(tips.length, Number(row.leftArrow) + Number(row.rightArrow));
  const staff = all(doc, 'line').filter(
    (l) => !red(l) && Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) > 5,
  );

  assert.equal(staff.length, 5);
  const top = Math.min(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
  const bottom = Math.max(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
  // Lyrics line geometry uses its own staff-space. The visible StaffSymbol can
  // have an independently overridden spacing; use that explicit fixture ratio.
  const globalSpace = (bottom - top) / 4 / staffRatio;
  const origin = translate(staff[0]!, 0);
  const from = row.leftArrow
    ? tips[0]!
    : [
        translate(shaft, 0) + Number(shaft.getAttribute('x1')),
        translate(shaft, 1) + Number(shaft.getAttribute('y1')),
      ];
  const to = row.rightArrow
    ? tips.at(-1)!
    : [
        translate(shaft, 0) + Number(shaft.getAttribute('x2')),
        translate(shaft, 1) + Number(shaft.getAttribute('y2')),
      ];

  for (const [i, point] of [from, to].entries()) {
    assert.ok(
      Math.abs(((point[0]! - origin) * 10) / globalSpace - row.xTenths[i]!) < 0.004,
      `source actual endpoint x${i}`,
    );
    assert.ok(
      Math.abs(((top - point[1]!) * 10) / globalSpace - row.yTenths[i]!) < 0.004,
      `source actual endpoint y${i}`,
    );
  }
}

function nativeMIDI(xml: string, expected: ReturnType<typeof midiTimedNotes>) {
  assert.equal(reader.loadData(xml), 1);
  const played = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    played.map((n) => [n.pitch, n.onset, n.velocity]),
    expected.map((n) => [n.pitch, n.onset, n.velocity]),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
}

test('vowel transition retains actual lyric identities, native arrows and source-proven polygon-tip coordinates', async () => {
  const text = source(),
    result = (await converter.convert(text)).scores[0]!;

  validate(result.musicxml);
  const [row] = graphics(result.document);

  assert.ok(row);
  assert.equal(row.custom, false);
  assert.equal(row.hidden, false);
  assert.deepEqual([value(row.moment.main), value(row.endMoment!.main)], [0, 0.25]);
  assert.deepEqual([value(row.fromLyricMoment!.main), value(row.toLyricMoment!.main)], [0, 0.25]);
  assert.ok(row.fromLyricId! > 0 && row.toLyricId! > row.fromLyricId!);
  assert.deepEqual([row.leftKind, row.rightKind], ['LyricText', 'LyricText']);
  const original = await compiler.compile(text, { format: ['svg', 'midi'] });

  proveGeometry(parse(new TextDecoder().decode(file(original.files, '.svg'))), row);
  const native = brackets(result.musicxml);

  assert.deepEqual(
    native.map((b) => [b.getAttribute('type'), b.getAttribute('line-end')]),
    [
      ['start', 'none'],
      ['stop', 'arrow'],
    ],
  );
  native.forEach((b, i) => {
    assert.equal(b.getAttribute('color'), '#FF0000');
    assert.ok(Math.abs(Number(b.getAttribute('default-x')) - row.xTenths[i]!) < 0.00001);
    assert.ok(Math.abs(Number(b.getAttribute('default-y')) - row.yTenths[i]!) < 0.00001);
  });
  nativeMIDI(result.musicxml, midiTimedNotes(file(original.files, '.midi')));
  const imported = all(parse(reader.getMEI()), 'bracketSpan')[0]!;

  assert.ok(imported);
  assert.equal(imported.getAttribute('lendsym'), 'arrow');
  assert.equal(imported.getAttribute('tstamp2'), '0m+2');
  assert.equal(imported.getAttribute('vo'), null);
  const rendered = reader.renderToSVG(1);

  assert.ok(rendered.includes('#FF0000'));
  assert.equal(all(parse(result.musicxml), 'glissando').length, 0);
  assert.equal(all(parse(result.musicxml), 'slide').length, 0);
  assert.ok(!result.diagnostics.some((d) => d.code === 'vowel-transition-reader'));
  assert.ok(!result.diagnostics.some((d) => d.code === 'vowel-transition-position'));
});

test('vowel transition actual arrow changes, dash ink and global/local scaling agree with independent source geometry', async () => {
  for (const [setup, config, staff] of [
    ['', String.raw`\override VowelTransition.bound-details.right.arrow = ##f`, ''],
    ['', String.raw`\override VowelTransition.bound-details.left.arrow = ##t`, ''],
    [
      '',
      String.raw`\override VowelTransition.style = #'dashed-line \override VowelTransition.dash-period = #2 \override VowelTransition.dash-fraction = #0.25`,
      '',
    ],
    ['', String.raw`\override VowelTransition.style = #'dotted-line`, ''],
    [
      '#(set-global-staff-size 30)',
      String.raw`\override VowelTransition.extra-offset = #'(3/2 . -7/4)`,
      String.raw`\override StaffSymbol.staff-space = #0.7`,
    ],
  ] as const) {
    const text = setup + source(String.raw`a \vowelTransition _ _ e`, undefined, config, staff);
    const result = (await converter.convert(text)).scores[0]!;

    validate(result.musicxml);
    const [row] = graphics(result.document);

    assert.ok(row);
    assert.equal(value(row.endMoment!.main), 0.75);
    const original = await compiler.compile(text, { format: 'svg' });
    const doc = parse(new TextDecoder().decode(file(original.files, '.svg')));

    proveGeometry(doc, row, staff ? 0.7 : 1);
    assert.deepEqual(
      brackets(result.musicxml).map((b) => b.getAttribute('line-end')),
      [row.leftArrow ? 'arrow' : 'none', row.rightArrow ? 'arrow' : 'none'],
    );

    if (row.style.includes('dashed') || row.style.includes('dotted')) {
      assert.ok(
        all(doc, 'line')
          .filter(red)
          .some((l) => l.hasAttribute('stroke-dasharray')),
      );
      assert.equal(
        brackets(result.musicxml)[0]!.getAttribute('line-type'),
        row.style === 'dotted-line' ? 'dotted' : 'dashed',
      );
    }
  }
});

test('vowel transition hidden, omitted, removed, unfinished and overridden originals do not invent visible arrows', async () => {
  for (const [config, lyric, removed] of [
    [String.raw`\override VowelTransition.transparent = ##t`, undefined, false],
    [String.raw`\omit VowelTransition`, undefined, false],
    [String.raw`\remove Hyphen_engraver`, undefined, true],
    ['', String.raw`a \vowelTransition`, true],
    ['', String.raw`a \vowelTransition _ -- e`, true],
  ] as const) {
    const text = source(lyric, undefined, config),
      result = (await converter.convert(text)).scores[0]!;

    validate(result.musicxml);
    assert.ok(brackets(result.musicxml).every((b) => b.getAttribute('color') === '#00000000'));
    const original = await compiler.compile(text, { format: 'svg' }),
      doc = parse(new TextDecoder().decode(file(original.files, '.svg')));

    assert.equal(all(doc, 'polygon').filter(red).length, 0);

    if (removed) {
      assert.ok(graphics(result.document).every((g) => g.hidden));
    }

    assert.ok(!result.diagnostics.some((d) => d.code === 'vowel-transition-history'));
  }
});

test('vowel transition shaft suppression does not invent a line behind an actual standalone source arrow', async () => {
  for (const config of [
    String.raw`\override VowelTransition.style = #'none`,
    String.raw`\override VowelTransition.style = #'dashed-line \override VowelTransition.dash-period = #0`,
  ]) {
    const text = source(undefined, undefined, config),
      result = (await converter.convert(text)).scores[0]!;
    const original = await compiler.compile(text, { format: 'svg' }),
      doc = parse(new TextDecoder().decode(file(original.files, '.svg')));

    assert.equal(all(doc, 'polygon').filter(red).length, 1);
    assert.equal(all(doc, 'line').filter(red).length, 0);
    assert.equal(brackets(result.musicxml).length, 0);
    assert.ok(result.diagnostics.some((d) => d.code === 'vowel-transition-arrow-visibility'));
  }
});

test('vowel transition callbacks are not rerun and arbitrary printer/endpoint graphics stay explicitly partial', async () => {
  const setup = String.raw`#(define (vowel-color g) (format #t "VOWEL-COLOR-CALL\n") red)`;
  const text =
    setup +
    source(undefined, undefined, String.raw`\override VowelTransition.color = #vowel-color`);
  const converted = await converter.convert(text),
    original = await compiler.compile(text, { format: 'svg' });
  const count = (logs: readonly string[]) =>
    logs.filter((l) => l.startsWith('VOWEL-COLOR-CALL')).length;

  assert.ok(count(original.logs) > 0);
  assert.equal(count(converted.logs), count(original.logs));

  for (const config of [
    String.raw`\override VowelTransition.stencil = #ly:text-interface::print \override VowelTransition.text = "custom-transition"`,
    String.raw`\override VowelTransition.bound-details.right.text = \markup "end"`,
    String.raw`\override VowelTransition.after-line-breaking = #(lambda(g) #t)`,
  ]) {
    const result = (await converter.convert(source(undefined, undefined, config))).scores[0]!;

    assert.ok(graphics(result.document).some((g) => g.custom));
    assert.equal(brackets(result.musicxml).length, 0);
    assert.ok(result.diagnostics.some((d) => d.code === 'vowel-transition-stencil'));
  }
});

test('vowel transition broken pieces preserve actual bounds and distinct verse/voice identities with score reset', async () => {
  const broken = source(
    String.raw`a \vowelTransition _ _ e foo bar baz end`,
    String.raw`c'4 d'4 \break e'4 f'4 g'4 a'4 b'4 c''4`,
  );
  const multi = String.raw`\score { << \new Staff << \new Voice="upper" { c'4 d'4 e'4 f'4 } \new Voice="lower" { c4 d4 e4 f4 } >> \new Lyrics \lyricsto "upper" { a \vowelTransition e foo bar } \new Lyrics \lyricsto "lower" { a \vowelTransition e foo bar } >> \layout{} \midi{} }`;
  const result = await converter.convert(broken + multi + source('a e foo bar'));
  const first = result.scores[0]!,
    rows = graphics(first.document).filter((g) => !g.hidden);

  assert.ok(rows.length >= 2);
  assert.equal(new Set(rows.map((g) => g.id)).size, 1);
  assert.equal(value(rows[0]!.fromLyricMoment!.main), 0);
  assert.equal(value(rows[0]!.toLyricMoment!.main), 0.75);
  assert.equal(brackets(first.musicxml).length, rows.length * 2);
  validate(first.musicxml);
  const original = await compiler.compile(broken, { format: 'svg' });

  assert.ok(
    all(parse(new TextDecoder().decode(file(original.files, '.svg'))), 'polygon').filter(red)
      .length > 0,
  );
  const second = result.scores[1]!;

  validate(second.musicxml);
  assert.equal(new Set(graphics(second.document).map((g) => g.verse)).size, 2);
  assert.equal(new Set(graphics(second.document).map((g) => g.voice)).size, 2);
  assert.equal(brackets(second.musicxml).length, 4);
  assert.equal(graphics(result.scores[2]!.document).length, 0);
  assert.equal(brackets(result.scores[2]!.musicxml).length, 0);
});

test('vowel transition cache ownership, actual bounds and missing capture history fail closed', async () => {
  const result = (await converter.convert(source())).scores[0]!;
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;
  const round = toMusicXML(cached);

  validate(round.musicxml);
  assert.deepEqual(
    brackets(round.musicxml).map((b) => Array.from(b.attributes).map((a) => [a.name, a.value])),
    brackets(result.musicxml).map((b) => Array.from(b.attributes).map((a) => [a.name, a.value])),
  );
  const mutate = (
    change: (row: ReturnType<typeof graphics>[number], doc: ScoreDocument) => object,
  ) =>
    ({
      ...cached,
      events: cached.events.map((e) =>
        e.kind === 'vowelTransition' ? { ...e, ...change(e, cached) } : e,
      ),
    }) as ScoreDocument;

  for (const [doc, code] of [
    [mutate(() => ({ voice: null })), 'vowel-transition-owner'],
    [mutate(() => ({ fromLyricId: null })), 'vowel-transition-owner'],
    [mutate(() => ({ endMoment: null })), 'vowel-transition-endpoints'],
    [mutate((e) => ({ moment: e.endMoment, endMoment: e.moment })), 'vowel-transition-endpoints'],
    [
      {
        ...cached,
        events: cached.events.filter(
          (e) =>
            !(e.kind === 'lyric' && e.class === 'lyric-event' && value(e.moment.main) === 0.25),
        ),
      },
      'vowel-transition-owner',
    ],
    [{ ...cached, events: [...cached.events, graphics(cached)[0]!] }, 'vowel-transition-owner'],
  ] as const) {
    const exported = toMusicXML(doc);

    assert.equal(brackets(exported.musicxml).length, 0);
    assert.ok(
      exported.diagnostics.some((d) => d.code === code),
      code,
    );
  }

  const { vowelTransitionsCaptured: _captured, ...legacy } = cached;
  const old = toMusicXML(legacy);

  assert.equal(brackets(old.musicxml).length, 0);
  assert.ok(old.diagnostics.some((d) => d.code === 'vowel-transition-history'));
  const noRows = toMusicXML({
    ...legacy,
    events: legacy.events.filter((e) => e.kind !== 'vowelTransition'),
  });

  assert.ok(noRows.diagnostics.some((d) => d.code === 'vowel-transition-history'));
});

test('vowel transition failed final capture and unavailable staff-top references remain explicit', async () => {
  const failed = source(
    undefined,
    undefined,
    String.raw`\override VowelTransition.after-line-breaking = #(lambda(g) (error "vowel-final-failure"))`,
  );
  const results = await converter.convert(failed + source());

  assert.ok(results.scores[0]!.diagnostics.some((d) => d.code === 'vowel-transition-capture'));
  assert.equal(brackets(results.scores[0]!.musicxml).length, 0);
  assert.equal(brackets(results.scores[1]!.musicxml).length, 2);
  const sparse = (
    await converter.convert(
      source(
        undefined,
        undefined,
        '',
        String.raw`\override StaffSymbol.line-positions = #'(-4 -2 0)`,
      ),
    )
  ).scores[0]!;

  assert.ok(brackets(sparse.musicxml).every((b) => !b.hasAttribute('default-y')));
  assert.ok(sparse.diagnostics.some((d) => d.code === 'vowel-transition-position'));
});
