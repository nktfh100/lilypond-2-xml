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
  compiler = createReusableCompiler();
const reader = new VerovioToolkit(await createModule());

after(() => {
  converter.dispose();
  compiler.dispose();
  reader.destroy();
});

const source = (music: string, config = '') =>
  String.raw`\score { \new Staff = "solo" \new Voice = "voice" \with { \consists Episema_engraver ${config} } { \override Episema.color = #red ${music} } \layout {} \midi { \tempo 4=120 } }`;
const lines = (d: ScoreDocument) => d.events.filter((e) => e.kind === 'episema');
const brackets = (xml: string) => all(parse(xml), 'bracket');
const value = (r: { numerator: number; denominator: number }) => r.numerator / r.denominator;
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];
const svg = (files: Record<string, Uint8Array>) =>
  parse(new TextDecoder().decode(file(files, '.svg')));
const translate = (node: Element, axis: 0 | 1) => {
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
};
const redLines = (doc: Document) =>
  all(doc, 'line').filter((line) => {
    for (
      let e: Element | null = line;
      e;
      e = e.parentNode?.nodeType === 1 ? (e.parentNode as Element) : null
    ) {
      if (e.getAttribute('color')?.startsWith('rgba(100.0000%, 0.0000%, 0.0000%')) {
        return true;
      }
    }

    return false;
  });

function proveGeometry(doc: Document, line: ReturnType<typeof lines>[number], later = false) {
  const ink = redLines(doc)[0]!;

  assert.ok(ink, 'independent source episema ink');
  const staff = all(doc, 'line').filter(
    (l) =>
      Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) > 5 && !redLines(doc).includes(l),
  );

  assert.equal(staff.length, 5);
  const top = Math.min(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
  const bottom = Math.max(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
  const globalSpace = (bottom - top) / 4 / (line.staffSpace! / line.layoutStaffSpace!);
  const bars = all(doc, 'rect').filter(
    (r) => Number(r.getAttribute('height')) >= 4 && Number(r.getAttribute('width')) < 0.3,
  );
  const origin = later
    ? Math.min(...bars.map((r) => translate(r, 0) + Number(r.getAttribute('x'))))
    : translate(staff[0]!, 0);

  assert.ok(Number.isFinite(origin));

  for (const i of [0, 1] as const) {
    const x = translate(ink, 0) + Number(ink.getAttribute(i === 0 ? 'x1' : 'x2'));
    const y = translate(ink, 1) + Number(ink.getAttribute(i === 0 ? 'y1' : 'y2'));

    assert.ok(
      Math.abs(((x - origin) * 10) / globalSpace - line.xTenths[i]!) < 0.004,
      `source x${i}`,
    );
    assert.ok(Math.abs(((top - y) * 10) / globalSpace - line.yTenths[i]!) < 0.004, `source y${i}`);
  }
}

test('episema retains actual two-note and single-neume fitted native width without tenuto semantics', async () => {
  for (const [music, end] of [
    [String.raw`c'2\episemInitium d'2\episemFinis`, 0.5],
    [String.raw`c'1\episemInitium\episemFinis d'1`, 0],
  ] as const) {
    const text = source(music),
      { scores } = await converter.convert(text),
      result = scores[0]!;

    validate(result.musicxml);
    const [line] = lines(result.document);

    assert.ok(line);
    assert.deepEqual([value(line.moment.main), value(line.endMoment!.main)], [0, end]);
    assert.deepEqual(line.fromNotes, [1]);
    assert.deepEqual(line.toNotes, [end ? 2 : 1]);
    const original = await compiler.compile(text, { format: ['svg', 'midi'] });

    proveGeometry(svg(original.files), line);
    const native = brackets(result.musicxml);

    assert.deepEqual(
      native.map((b) => b.getAttribute('type')),
      ['start', 'stop'],
    );
    assert.ok(native.every((b) => b.getAttribute('line-end') === 'none'));

    for (const i of [0, 1] as const) {
      assert.ok(
        Math.abs(Number(native[i]!.getAttribute('default-x')) - line.xTenths[i]!) < 0.00001,
      );
      assert.ok(
        Math.abs(Number(native[i]!.getAttribute('default-y')) - line.yTenths[i]!) < 0.00001,
      );
    }

    assert.ok(
      line.xTenths[1]! > line.xTenths[0]!,
      'actual source width survives even coincident temporal endpoints',
    );
    assert.equal(all(parse(result.musicxml), 'tenuto').length, 0);
    assert.ok(
      !result.diagnostics.some((d) => /width.*not (mapped|reconstructed)/i.test(d.message)),
    );
    assert.equal(reader.loadData(result.musicxml), 1);
    const imported = all(parse(reader.getMEI()), 'bracketSpan')[0]!;

    assert.ok(imported);
    assert.equal(imported.getAttribute('tstamp2'), end ? '0m+3' : '0m+1');

    for (const attribute of ['ho', 'vo', 'startho', 'endho']) {
      assert.equal(imported.getAttribute(attribute), null);
    }

    const played = midiTimedNotes(reader.renderToMIDI()),
      expected = midiTimedNotes(file(original.files, '.midi'));

    assert.deepEqual(
      played.map((n) => [n.pitch, n.onset, n.velocity]),
      expected.map((n) => [n.pitch, n.onset, n.velocity]),
    );
    played.forEach((n, i) => assert.ok(Math.abs(n.duration! - expected[i]!.duration!) < 0.01));
    assert.ok(!result.diagnostics.some((d) => d.code === 'episema-reader'));
  }
});

test('episema actual measure origin and scaled physical source endpoints remain native', async () => {
  for (const [setup, music, later] of [
    ['', String.raw`e'1 c'2\episemInitium d'2\episemFinis`, true],
    [
      '#(set-global-staff-size 30)',
      String.raw`\override Staff.StaffSymbol.staff-space = #0.7 \override Episema.extra-offset = #'(3/2 . -7/4) c'2\episemInitium d'2\episemFinis`,
      false,
    ],
    [
      '',
      String.raw`\override Episema.style = #'dashed-line \override Episema.dash-period = #2 \override Episema.dash-fraction = #0.25 c'2\episemInitium d'2\episemFinis`,
      false,
    ],
    [
      '',
      String.raw`\override Episema.style = #'dotted-line c'2\episemInitium d'2\episemFinis`,
      false,
    ],
  ] as const) {
    const text = setup + source(music),
      { scores } = await converter.convert(text),
      result = scores[0]!;

    validate(result.musicxml);
    const [line] = lines(result.document);

    assert.ok(line);
    assert.deepEqual(
      line.xReference.map((m) => m && value(m.main)),
      later ? [1, 1] : [0, 0],
    );
    const original = await compiler.compile(text, { format: 'svg' });

    proveGeometry(svg(original.files), line, later);
    assert.ok(
      brackets(result.musicxml).every(
        (b) => b.hasAttribute('default-x') && b.hasAttribute('default-y'),
      ),
    );

    if (line.style === 'dashed-line' || line.style === 'dotted-line') {
      assert.ok(
        redLines(svg(original.files)).some((l) => l.hasAttribute('stroke-dasharray')),
        'independent source dash ink',
      );
      assert.ok(
        brackets(result.musicxml).every(
          (b) =>
            b.getAttribute('line-type') === (line.style === 'dashed-line' ? 'dashed' : 'dotted'),
        ),
      );
      assert.ok(line.xTenths[1]! > line.xTenths[0]!);
      assert.ok(!result.diagnostics.some((d) => d.code === 'episema-position'));
    }
  }
});

test('episema visibility, source absence, suicide and replacement endpoints do not invent plain lines', async () => {
  for (const [name, setup, music, config, hidden, custom] of [
    [
      'transparent',
      String.raw`\override Episema.transparent = ##t`,
      String.raw`c'2\episemInitium d'2\episemFinis`,
      '',
      true,
      false,
    ],
    [
      'omit',
      String.raw`\omit Episema`,
      String.raw`c'2\episemInitium d'2\episemFinis`,
      '',
      true,
      false,
    ],
    [
      'none',
      String.raw`\override Episema.style = #'none`,
      String.raw`c'2\episemInitium d'2\episemFinis`,
      '',
      true,
      false,
    ],
    [
      'removed',
      '',
      String.raw`c'2\episemInitium d'2\episemFinis`,
      String.raw`\remove Episema_engraver`,
      true,
      false,
    ],
    ['unterminated', '', String.raw`c'2\episemInitium d'2`, '', true, false],
    [
      'custom',
      String.raw`\override Episema.stencil = #ly:text-interface::print \override Episema.text = "episema-label"`,
      String.raw`c'2\episemInitium d'2\episemFinis`,
      '',
      false,
      true,
    ],
    [
      'endpoint',
      String.raw`\override Episema.bound-details.left.text = \markup "start"`,
      String.raw`c'2\episemInitium d'2\episemFinis`,
      '',
      false,
      true,
    ],
  ] as const) {
    const text = source(`${setup} ${music}`, config),
      { scores } = await converter.convert(text),
      result = scores[0]!;

    validate(result.musicxml);
    const original = await compiler.compile(text, { format: 'svg' });

    if (name === 'removed') {
      assert.equal(lines(result.document).length, 0);
      assert.equal(brackets(result.musicxml).length, 0);
      continue;
    }

    assert.equal(lines(result.document)[0]!.hidden, hidden, name);
    assert.equal(lines(result.document)[0]!.custom, custom, name);

    if (custom) {
      assert.equal(brackets(result.musicxml).length, 0);
      assert.ok(result.diagnostics.some((d) => d.code === 'episema-stencil'));
    } else {
      assert.ok(
        brackets(result.musicxml).every((b) =>
          /^#00[0-9A-F]{6}$/.test(b.getAttribute('color') ?? ''),
        ),
        name,
      );
    }

    if (hidden) {
      assert.equal(redLines(svg(original.files)).length, 0, name);
    }
  }
});

test('episema actual chord and final broken bounds retain distinct piece identities', async () => {
  const chord = (
    await converter.convert(source(String.raw`<c' e'>2\episemInitium <d' f'>2\episemFinis`))
  ).scores[0]!;

  validate(chord.musicxml);
  const [line] = lines(chord.document);

  assert.ok(line);
  assert.ok(line.fromNotes.every((id) => [1, 2].includes(id)));
  assert.ok(line.toNotes.every((id) => [3, 4].includes(id)));
  assert.deepEqual([value(line.moment.main), value(line.endMoment!.main)], [0, 0.5]);
  const broken = (
    await converter.convert(source(String.raw`c'1\episemInitium \break d'1\episemFinis e'1`))
  ).scores[0]!;

  validate(broken.musicxml);
  assert.deepEqual(
    lines(broken.document).map((l) => [l.id, l.piece]),
    [
      [1, 1],
      [1, 2],
    ],
  );
  assert.equal(brackets(broken.musicxml).length, 4);
});

test('coincident episema and ligature pairs start before stopping and reuse the shared duration number', async () => {
  const result = (
    await converter.convert(
      source(
        String.raw`\[ c'1\-\episemInitium\episemFinis \] d'1`,
        String.raw`\consists Duration_line_engraver`,
      ),
    )
  ).scores[0]!;

  validate(result.musicxml);
  assert.deepEqual(
    lines(result.document).map((l) => [value(l.moment.main), value(l.endMoment!.main)]),
    [[0, 0]],
  );
  const endpoints = brackets(result.musicxml);

  assert.deepEqual(
    endpoints.map((b) => b.getAttribute('type')),
    ['start', 'stop', 'start', 'stop', 'start', 'stop'],
  );
  assert.ok(endpoints.every((b) => b.getAttribute('number') === '1'));
});

test('episema cache, missing references, layout failure and score resets preserve only proven coordinates', async () => {
  const { scores } = await converter.convert(
    source(String.raw`c'2\episemInitium d'2\episemFinis`) + source(String.raw`e'2 f'2`),
  );

  assert.equal(lines(scores[1]!.document).length, 0);
  const cached = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;
  const attrs = (xml: string) =>
    brackets(xml).map((b) => Array.from(b.attributes).map((a) => [a.name, a.value]));

  assert.deepEqual(attrs(toMusicXML(cached).musicxml), attrs(scores[0]!.musicxml));
  const missing = toMusicXML({
    ...cached,
    events: cached.events.map((e) =>
      e.kind === 'episema' ? { ...e, xReference: [null, null] as const } : e,
    ),
  });

  validate(missing.musicxml);
  assert.ok(brackets(missing.musicxml).every((b) => !b.hasAttribute('default-x')));
  assert.ok(missing.diagnostics.some((d) => d.code === 'episema-position'));
  const invalid = toMusicXML({
    ...cached,
    events: cached.events.map((e) => (e.kind === 'episema' ? { ...e, endMoment: null } : e)),
  });

  assert.equal(brackets(invalid.musicxml).length, 0);
  assert.ok(invalid.diagnostics.some((d) => d.code === 'episema-endpoints'));
  const failed = (
    await converter.convert(
      source(
        String.raw`\override Episema.after-line-breaking = #(lambda(g)(error "episema-final")) c'2\episemInitium d'2\episemFinis`,
      ) + source(String.raw`c'2\episemInitium d'2\episemFinis`),
    )
  ).scores;

  assert.ok(failed[0]!.diagnostics.some((d) => d.code === 'episema-capture'));
  assert.equal(lines(failed[0]!.document).length, 0);
  assert.equal(lines(failed[1]!.document).length, 1);
});

test('episema percent copies preserve hidden spans and actual source playback', async () => {
  const text = source(String.raw`\repeat percent 2 { c'2\episemInitium d'2\episemFinis } e'1`);
  const { scores } = await converter.convert(text),
    result = scores[0]!;

  validate(result.musicxml);
  assert.equal(brackets(result.musicxml).length, 4);
  assert.equal(
    brackets(result.musicxml).filter((b) => /^#00[0-9A-F]{6}$/.test(b.getAttribute('color') ?? ''))
      .length,
    2,
  );
  const original = await compiler.compile(text.replaceAll('\\repeat percent', '\\repeat unfold'), {
    format: 'midi',
  });

  reader.loadData(result.musicxml);
  assert.deepEqual(
    midiTimedNotes(reader.renderToMIDI()).map((n) => [n.pitch, n.onset]),
    midiTimedNotes(file(original.files, '.midi')).map((n) => [n.pitch, n.onset]),
  );
});

test('VaticanaStaff remains an explicit context boundary rather than claimed ordinary-staff episema coverage', async () => {
  const text = String.raw`\score { \new VaticanaStaff \new VaticanaVoice { a\episemInitium\episemFinis } \layout {} }`;
  const original = await compiler.compile(text, { format: 'svg' });

  assert.ok(Object.keys(original.files).some((n) => n.endsWith('.svg')));
  await assert.rejects(converter.convert(text), /no supported staves/);
});
