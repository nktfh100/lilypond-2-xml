import type { Document, Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import { type ScoreDocument, createConverter, toMusicXML } from 'lilypond-2-xml';

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { readMidiAttacks } from '../../../tools/evaluation/midi.js';
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
  String.raw`\score { \new Staff = "solo" \new Voice = "voice" \with { ${config} } { \override FingerGlideSpanner.color = #red ${music} } \layout {} \midi { \tempo 4=120 } }`;
const glides = (d: ScoreDocument) => d.events.filter((e) => e.kind === 'fingerGlide');
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
const coloredLines = (doc: Document) =>
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

function proveGeometry(doc: Document, line: ReturnType<typeof glides>[number]) {
  const ink = coloredLines(doc)[0]!;

  assert.ok(ink, 'independent source connector');
  const staff = all(doc, 'line').filter(
    (l) =>
      Math.abs(Number(l.getAttribute('x2')) - Number(l.getAttribute('x1'))) > 5 &&
      !coloredLines(doc).includes(l),
  );

  assert.equal(staff.length, 5);
  const top = Math.min(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
  const bottom = Math.max(...staff.map((l) => translate(l, 1) + Number(l.getAttribute('y1'))));
  const localSpace = (bottom - top) / 4;
  const globalSpace = localSpace / (line.staffSpace! / line.layoutStaffSpace!);
  const origin = translate(staff[0]!, 0); // Actual System LEFT / source staff start, not padded ink x1.

  for (const i of [0, 1] as const) {
    const x = translate(ink, 0) + Number(ink.getAttribute(i === 0 ? 'x1' : 'x2'));
    const y = translate(ink, 1) + Number(ink.getAttribute(i === 0 ? 'y1' : 'y2'));

    assert.ok(Math.abs(((x - origin) * 10) / globalSpace - line.xTenths[i]!) < 0.004, `x${i}`);
    assert.ok(Math.abs(((top - y) * 10) / globalSpace - line.yTenths[i]!) < 0.004, `y${i}`);
  }
}

test('finger glide retains actual label endpoints and source SVG geometry without changing notes or MIDI controls', async () => {
  const text = source(String.raw`c'4\glide-1 d'4-1`);
  const { scores } = await converter.convert(text);
  const result = scores[0]!;

  validate(result.musicxml);
  const independent = await compiler.compile(text, { format: ['svg', 'midi'] });
  const [line] = glides(result.document);

  assert.ok(line);
  assert.equal(line.hidden, false);
  assert.equal(line.custom, false);
  assert.deepEqual([line.leftKind, line.rightKind], ['Fingering', 'Fingering']);
  assert.deepEqual([line.fromNotes, line.toNotes], [[1], [2]]);
  assert.deepEqual(
    [line.fromLabel?.kind, line.fromLabel?.text, line.toLabel?.text],
    ['Fingering', '1', '1'],
  );
  assert.notEqual(line.fromLabel?.id, line.toLabel?.id);
  assert.deepEqual([value(line.moment.main), value(line.endMoment!.main)], [0, 0.25]);
  assert.deepEqual(
    line.xReference.map((m) => m && value(m.main)),
    [0, 0],
  );
  proveGeometry(svg(independent.files), line);
  assert.equal(
    line.yTenths[0],
    line.yTenths[1],
    'ascending pitches retain horizontal finger-label connector',
  );
  const native = brackets(result.musicxml);

  assert.deepEqual(
    native.map((b) => b.getAttribute('type')),
    ['start', 'stop'],
  );
  native.forEach((b, i) => {
    assert.equal(b.getAttribute('line-end'), 'none');
    assert.equal(b.getAttribute('color'), '#FF0000');
    assert.ok(Math.abs(Number(b.getAttribute('default-x')) - line.xTenths[i]!) < 0.00001);
    assert.ok(Math.abs(Number(b.getAttribute('default-y')) - line.yTenths[i]!) < 0.00001);
  });
  assert.equal(all(parse(result.musicxml), 'slide').length, 0);
  assert.equal(all(parse(result.musicxml), 'bend').length, 0);
  assert.equal(reader.loadData(result.musicxml), 1);
  const span = all(parse(reader.getMEI()), 'bracketSpan')[0]!;

  assert.ok(span);
  assert.equal(span.getAttribute('tstamp'), '1');
  assert.equal(span.getAttribute('tstamp2'), '0m+2');
  assert.ok(
    all(parse(reader.renderToSVG(1)), 'g').some((g) => g.getAttribute('class') === 'bracketSpan'),
  );
  const original = midiTimedNotes(file(independent.files, '.midi')),
    played = midiTimedNotes(reader.renderToMIDI());

  assert.deepEqual(
    played.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    original.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - original[i]!.duration!) < 0.01));
  const sourceMidi = readMidiAttacks(file(independent.files, '.midi'));
  const readerMidi = readMidiAttacks(Buffer.from(reader.renderToMIDI(), 'base64'));

  for (const [name, midi] of [
    ['source', sourceMidi],
    ['reader', readerMidi],
  ] as const) {
    assert.ok(
      midi.tracks.every((t) => t.pitchBends.every((b) => b.value === 8192)),
      `${name}: no nonneutral pitch wheels`,
    );
    assert.ok(
      midi.tracks.every((t) => t.controls.every((c) => c.tick === 0)),
      `${name}: no time-changing controller events`,
    );
  }

  assert.ok(!result.diagnostics.some((d) => d.code === 'finger-glide-reader'));
  assert.ok(
    !result.diagnostics.some(
      (d) => d.code === 'attachment' && d.message.includes('finger-glide-event'),
    ),
  );
});

test('finger glide later-measure X uses the actual source bar origin', async () => {
  const text = source(String.raw`e'1 c'4\glide-1 d'4-1`);
  const { scores } = await converter.convert(text);
  const result = scores[0]!;

  validate(result.musicxml);
  const [line] = glides(result.document);

  assert.ok(line);
  assert.deepEqual(
    line.xReference.map((m) => m && value(m.main)),
    [1, 1],
  );
  const independent = await compiler.compile(text, { format: 'svg' }),
    doc = svg(independent.files);
  const ink = coloredLines(doc)[0]!;
  const bars = all(doc, 'rect').filter(
    (r) => Number(r.getAttribute('height')) >= 4 && Number(r.getAttribute('width')) < 0.3,
  );

  assert.ok(bars.length >= 1);
  const origin = Math.min(...bars.map((r) => translate(r, 0) + Number(r.getAttribute('x'))));

  for (const i of [0, 1] as const) {
    const x = translate(ink, 0) + Number(ink.getAttribute(i === 0 ? 'x1' : 'x2'));

    assert.ok(Math.abs((x - origin) * 10 - line.xTenths[i]!) < 0.004, `later x${i}`);
  }

  assert.ok(
    brackets(result.musicxml).every(
      (b, i) => Math.abs(Number(b.getAttribute('default-x')) - line.xTenths[i]!) < 0.00001,
    ),
  );
});

test('finger glide explicit IDs connect actual different labels across intervening notes', async () => {
  const { scores } = await converter.convert(
    source(String.raw`\fixed c' { c4\glide \= #'foo -1 e4-1 r4 d4\= #'foo -2 }`),
  );
  const result = scores[0]!;

  validate(result.musicxml);
  const [line] = glides(result.document);

  assert.ok(line);
  assert.deepEqual([line.fromNotes, line.toNotes], [[1], [3]]);
  assert.deepEqual([line.fromLabel?.text, line.toLabel?.text], ['1', '2']);
  assert.deepEqual([value(line.moment.main), value(line.endMoment!.main)], [0, 0.75]);
});

test('finger glides retain string-number and stroke-finger bound identities', async () => {
  for (const [music, kind] of [
    [String.raw`<c'\glide _\3>4 <d'_\3>4`, 'StringNumber'],
    [String.raw`<c'\glide \rightHandFinger #1 >4 <d'\rightHandFinger #1 >4`, 'StrokeFinger'],
  ]) {
    const { scores } = await converter.convert(source(music!));
    const result = scores[0]!;

    validate(result.musicxml);
    const [line] = glides(result.document);

    assert.ok(line, kind);
    assert.equal(line.fromLabel?.kind, kind);
    assert.equal(line.toLabel?.kind, kind);
    assert.deepEqual([line.fromNotes, line.toNotes], [[1], [2]], kind);
    assert.equal(brackets(result.musicxml).length, 2, kind);
  }
});

test('finger glide chord ownership follows actual NoteHead supports and separate explicit IDs', async () => {
  const { scores } = await converter.convert(
    source(String.raw`<c'\glide \= #'a -1 e'\glide \= #'b -2>4 <d'\= #'a -3 f'\= #'b -4>4`),
  );
  const result = scores[0]!;

  validate(result.musicxml);
  const lines = glides(result.document);

  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((l) => [l.fromNotes, l.toNotes]),
    [
      [[1], [3]],
      [[2], [4]],
    ],
  );
  const starts = brackets(result.musicxml).filter((b) => b.getAttribute('type') === 'start');

  assert.equal(new Set(starts.map((b) => b.getAttribute('number'))).size, 2);
  const unfolded = await converter.convert(
    source(String.raw`\repeat unfold 2 { c'4\glide-1 d'4-1 }`),
  );

  assert.deepEqual(
    glides(unfolded.scores[0]!.document).map((l) => [l.fromNotes, l.toNotes]),
    [
      [[1], [2]],
      [[3], [4]],
    ],
  );
});

test('finger glide final broken pieces retain original endpoint labels and actual column bounds', async () => {
  const { scores } = await converter.convert(source(String.raw`c'1\glide-1 \break d'1-1`));
  const result = scores[0]!;

  validate(result.musicxml);
  const lines = glides(result.document);

  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((l) => [l.id, l.piece]),
    [
      [1, 1],
      [1, 2],
    ],
  );
  assert.ok(
    lines.every(
      (l) => l.fromLabel?.id === lines[0]!.fromLabel?.id && l.toLabel?.id === lines[0]!.toLabel?.id,
    ),
  );
  assert.deepEqual(
    lines.map((l) => [l.fromNotes, l.toNotes]),
    [
      [[1], [2]],
      [[1], [2]],
    ],
  );
  assert.equal(brackets(result.musicxml).length, 4);
});

test('finger glide actual omission, transparency, suicide and custom drawing do not restore standard ink', async () => {
  for (const [name, setup, music, config, hidden, custom] of [
    [
      'transparent',
      String.raw`\override FingerGlideSpanner.transparent = ##t`,
      String.raw`c'4\glide-1 d'4-1`,
      '',
      true,
      false,
    ],
    ['omit', String.raw`\omit FingerGlideSpanner`, String.raw`c'4\glide-1 d'4-1`, '', true, false],
    [
      'none',
      String.raw`\override FingerGlideSpanner.style = #'none`,
      String.raw`c'4\glide-1 d'4-1`,
      '',
      true,
      false,
    ],
    [
      'removed',
      '',
      String.raw`c'4\glide-1 d'4-1`,
      String.raw`\remove Finger_glide_engraver`,
      true,
      false,
    ],
    ['unterminated', '', String.raw`c'4\glide-1 d'4-2`, '', true, false],
    [
      'custom',
      String.raw`\override FingerGlideSpanner.stencil = #ly:text-interface::print \override FingerGlideSpanner.text = "customglide"`,
      String.raw`c'4\glide-1 d'4-1`,
      '',
      false,
      true,
    ],
    [
      'late',
      String.raw`\override FingerGlideSpanner.after-line-breaking = #(lambda (g) #t)`,
      String.raw`c'4\glide-1 d'4-1`,
      '',
      false,
      true,
    ],
  ] as const) {
    const text = source(`${setup} ${music}`, config);
    const { scores } = await converter.convert(text);
    const result = scores[0]!;

    validate(result.musicxml);
    const native = brackets(result.musicxml),
      lines = glides(result.document);

    if (name === 'removed') {
      assert.equal(lines.length, 0);
      assert.equal(native.length, 0);
      continue;
    }

    assert.equal(lines[0]!.hidden, hidden, name);
    assert.equal(lines[0]!.custom, custom, name);

    if (custom) {
      assert.equal(native.length, 0, name);
      assert.ok(result.diagnostics.some((d) => d.code === 'finger-glide-stencil'));
    } else {
      assert.ok(
        native.every((b) => b.getAttribute('color') === '#00000000'),
        name,
      );
    }

    if (name === 'transparent' || name === 'unterminated') {
      const independent = await compiler.compile(text, { format: 'svg' });

      assert.equal(coloredLines(svg(independent.files)).length, 0, name);
    }
  }
});

test('finger glide available line styles remain native and diagnose unverified shapes', async () => {
  for (const [style, native] of [
    ['dashed-line', 'dashed'],
    ['dotted-line', 'dotted'],
    ['zigzag', 'wavy'],
    ['stub-both', 'solid'],
    ['bow', 'solid'],
  ]) {
    const { scores } = await converter.convert(
      source(String.raw`\override FingerGlideSpanner.style = #'${style} c'4\glide-1 d'4-1`),
    );
    const result = scores[0]!;

    validate(result.musicxml);
    assert.equal(glides(result.document)[0]!.style, style);
    assert.ok(
      brackets(result.musicxml).every((b) => b.getAttribute('line-type') === native),
      style,
    );

    if (['zigzag', 'stub-both', 'bow'].includes(style!)) {
      assert.ok(
        result.diagnostics.some((d) => d.code === 'finger-glide-style'),
        style,
      );
    }

    if (style === 'dashed-line' || style === 'dotted-line') {
      const text = source(
        String.raw`\override FingerGlideSpanner.style = #'${style} c'4\glide-1 d'4-1`,
      );
      const independent = await compiler.compile(text, { format: 'svg' });

      proveGeometry(svg(independent.files), glides(result.document)[0]!);
      assert.ok(coloredLines(svg(independent.files))[0]!.hasAttribute('stroke-dasharray'), style);
      assert.ok(
        brackets(result.musicxml).every(
          (b, i) => Number(b.getAttribute('default-x')) === glides(result.document)[0]!.xTenths[i],
        ),
      );
      assert.ok(!result.diagnostics.some((d) => d.code === 'finger-glide-position'), style);
    }
  }
});

test('finger glide solid and dashed scaled endpoints match independent physical source coordinates', async () => {
  for (const style of ['line', 'dashed-line', 'dotted-line']) {
    const text =
      String.raw`#(set-global-staff-size 30)` +
      source(
        String.raw`\override Staff.StaffSymbol.staff-space = #0.7 \override FingerGlideSpanner.extra-offset = #'(3/2 . -7/4) \override FingerGlideSpanner.style = #'${style} c'4\glide-1 d'4-1`,
      );
    const { scores } = await converter.convert(text);
    const result = scores[0]!;

    validate(result.musicxml);
    const [line] = glides(result.document);

    assert.ok(line);
    assert.ok(Math.abs(line.staffSpace! / 0.7 - 1) < 0.00001);
    const independent = await compiler.compile(text, { format: 'svg' });

    proveGeometry(svg(independent.files), line);
    assert.ok(!result.diagnostics.some((d) => d.code === 'finger-glide-position'), style);
  }
});

test('finger glide cached metadata, missing native references and multi-score reset stay conservative', async () => {
  const text = source(String.raw`c'4\glide-1 d'4-1`) + source(String.raw`e'4 f'4`);
  const { scores } = await converter.convert(text);

  assert.equal(glides(scores[0]!.document).length, 1);
  assert.equal(glides(scores[1]!.document).length, 0);
  assert.equal(brackets(scores[1]!.musicxml).length, 0);
  const cached = JSON.parse(JSON.stringify(scores[0]!.document)) as ScoreDocument;
  const attrs = (xml: string) =>
    brackets(xml).map((b) => Array.from(b.attributes).map((a) => [a.name, a.value]));

  assert.deepEqual(attrs(toMusicXML(cached).musicxml), attrs(scores[0]!.musicxml));
  const line = glides(cached)[0]!;

  line.xReference = [null, null];
  const missing = toMusicXML(cached);

  validate(missing.musicxml);
  assert.ok(brackets(missing.musicxml).every((b) => !b.hasAttribute('default-x')));
  assert.ok(missing.diagnostics.some((d) => d.code === 'finger-glide-position'));
  line.endMoment = null;
  const invalid = toMusicXML(cached);

  assert.equal(brackets(invalid.musicxml).length, 0);
  assert.ok(invalid.diagnostics.some((d) => d.code === 'finger-glide-endpoints'));
});

test('finger glide measure origins stay on their actual owner staff under polymeter', async () => {
  const text = String.raw`\score { \new StaffGroup <<
    \new Staff = "four" { \time 4/4 c'2. d'4\glide-1 e'4-1 f'2. }
    \new Staff = "three" { \time 3/4 c2. d2. e2. }
  >> \layout { \enablePerStaffTiming } \midi {} }`;
  const { scores } = await converter.convert(text);
  const result = scores[0]!;

  validate(result.musicxml);
  const [line] = glides(result.document);

  assert.ok(line);
  assert.deepEqual([value(line.moment.main), value(line.endMoment!.main)], [0.75, 1]);
  assert.deepEqual(
    line.xReference.map((m) => m && value(m.main)),
    [0, 1],
  );
});

test('finger glide percent copies retain actual note-label ownership without extending performance', async () => {
  const text = source(String.raw`\repeat percent 2 { c'1\glide-1 d'1-1 }`);
  const { scores } = await converter.convert(text);
  const result = scores[0]!;

  validate(result.musicxml);
  assert.equal(glides(result.document).length, 1);
  assert.equal(brackets(result.musicxml).length, 4);
  assert.deepEqual(
    brackets(result.musicxml).map((b) => b.getAttribute('color')),
    ['#FF0000', '#FF0000', '#00000000', '#00000000'],
  );
  const independent = await compiler.compile(text, { format: ['svg', 'midi'] });

  assert.equal(coloredLines(svg(independent.files)).length, 1);
  const unfolded = await compiler.compile(text.replaceAll('\\repeat percent', '\\repeat unfold'), {
    format: 'midi',
  });

  reader.loadData(result.musicxml);
  const played = midiTimedNotes(reader.renderToMIDI()),
    original = midiTimedNotes(file(unfolded.files, '.midi'));

  assert.deepEqual(
    played.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
    original.map(({ pitch, onset, velocity }) => ({ pitch, onset, velocity })),
  );
  played.forEach((n, i) => assert.ok(Math.abs(n.duration! - original[i]!.duration!) < 0.01));
});
