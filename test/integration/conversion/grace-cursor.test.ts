import type { Element } from '@oozcitak/dom/lib/dom/interfaces.js';
import { createReusableCompiler } from '@sightread/lilypond-wasm';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { VerovioToolkit } from 'verovio/esm';
import createModule from 'verovio/wasm';
import { createConverter, toMusicXML } from '../../../dist/index.js';
import listener from '../../../dist/lilypond/generated/listener.js';
import type { ScoreDocument } from '../../../src/model/document.js';
import { midiTimedNotes } from '../../support/midi.js';
import { validate } from '../../support/schema.js';
import { elements as all, parse } from '../../support/xml-support.js';

const compiler = createReusableCompiler(),
  converter = createConverter(),
  reader = new VerovioToolkit(await createModule());

after(() => {
  compiler.dispose();
  converter.dispose();
  reader.destroy();
});

const text = (node: Element, tag: string) => all(node, tag)[0]?.textContent;
const next = (node: Element) => {
  let n = node.nextSibling;

  while (n && n.nodeType !== 1) {
    n = n.nextSibling;
  }

  return n as Element | null;
};
const prelude = String.raw`\version "2.26.0"
#(define (cursor-source-after g)
 (format #t "CURSOR-SOURCE-AFTER ~s\n"
  (list (ly:grob-property-data (ly:item-get-column g) 'when)
   (ly:grob-property-data (ly:spanner-bound (ly:grob-system g) LEFT) 'when))) #t)
#(define (cursor-source-post paper pages) (format #t "CURSOR-SOURCE-POST ~a\n" (length pages)))
\paper { ragged-right=##t page-post-process=#cursor-source-post }
\header { tagline=##f }
`;
const melody = String.raw`\override NoteHead.after-line-breaking=#cursor-source-after
 c'1 \grace { \autoBeamOff d'16 \break e'16 \break f'16 } g'1`;
const source = (music: string) =>
  prelude +
  String.raw`\score { ${music}
 \layout { \context { \Voice \remove Forbid_line_break_engraver } }
 \midi { \tempo 4=120 } }`;
const file = (files: Record<string, Uint8Array>, suffix: string) =>
  Object.entries(files).find(([n]) => n.endsWith(suffix))![1];

function bare(document: ScoreDocument, original: string) {
  return toMusicXML(
    { ...document, measureLayoutsCaptured: false, pageLayoutsCaptured: false },
    { source: original },
  ).musicxml;
}

function musical(xml: string) {
  const d = parse(xml);

  return all(d, 'part').map((part) =>
    all(part, 'measure').map((measure) =>
      all(measure, 'note').map((note) => ({
        step: text(note, 'step'),
        octave: text(note, 'octave'),
        grace: all(note, 'grace').length,
        duration: text(note, 'duration'),
        type: text(note, 'type'),
        chord: all(note, 'chord').length,
      })),
    ),
  );
}

function assertPrintedOwners(xml: string, expected: readonly string[]) {
  const d = parse(xml);

  for (const part of all(d, 'part')) {
    const prints = all(part, 'print').filter((p) => p.getAttribute('new-system') === 'yes');

    assert.deepEqual(
      prints.map((p) => {
        const owner = next(p);

        assert.equal(owner?.tagName, 'note');
        assert.equal(all(owner!, 'grace').length, 1);

        return text(owner!, 'step');
      }),
      expected,
    );
  }
}

function assertUnchangedReader(
  xml: string,
  unpositioned: string,
  sourceNotes: ReturnType<typeof midiTimedNotes>,
) {
  assert.equal(reader.loadData(xml), 1);
  const positioned = midiTimedNotes(reader.renderToMIDI());

  assert.equal(reader.loadData(unpositioned), 1);
  assert.deepEqual(
    positioned,
    midiTimedNotes(reader.renderToMIDI()),
    'native layout changes neither grace timing nor playback',
  );
  assert.deepEqual(
    positioned.map((n) => n.pitch).sort((a, b) => a - b),
    sourceNotes.map((n) => n.pitch).sort((a, b) => a - b),
  );
}

test('a real nongrace LEFT after a grace group uses the following note rather than the measure-leading attributes', async () => {
  for (const duration of ['2', '1']) {
    for (const cut of ['break', 'pageBreak']) {
      const original = source(String.raw`\new Staff {
      \override NoteHead.after-line-breaking=#cursor-source-after
      c'${duration} \grace { d'16 e'16 } ${'\\' + cut} f'${duration} }`);
      const plain = await compiler.compile(original, {
        format: ['svg', 'midi'],
      });
      const observed = await compiler.compile(original, {
        format: ['svg', 'midi'],
        files: { 'cursor-observer.ily': listener },
        includeSettings: 'cursor-observer.ily',
      });

      for (const name of Object.keys(plain.files).filter((n) => n.endsWith('.svg'))) {
        assert.deepEqual(observed.files[name], plain.files[name]);
      }

      assert.ok(
        Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
        'notation observer emits no MIDI',
      );

      for (const prefix of ['CURSOR-SOURCE-AFTER', 'CURSOR-SOURCE-POST']) {
        assert.deepEqual(
          observed.logs.filter((l) => l.startsWith(prefix)),
          plain.logs.filter((l) => l.startsWith(prefix)),
        );
      }

      const result = (await converter.convert(original)).scores[0]!;

      validate(result.musicxml);
      const left = result.document.events.find(
        (e) => e.kind === 'measureLayout' && e.firstOnSystem && e.system === 2,
      );

      assert.ok(left?.kind === 'measureLayout');
      assert.equal(left.columnMoment!.grace.numerator, 0);
      const xml = parse(result.musicxml),
        prints = all(xml, 'print').filter((p) => p.getAttribute('new-system') === 'yes');

      assert.equal(prints.length, 1);
      const print = prints[0]!,
        owner = next(print)!;

      assert.equal(owner.tagName, 'note');
      assert.equal(text(owner, 'step'), 'F');
      assert.equal(all(owner, 'grace').length, 0);

      if (cut === 'pageBreak') {
        assert.equal(print.getAttribute('new-page'), 'yes');
      }

      const siblings = Array.from(print.parentNode!.childNodes).filter(
          (n): n is Element => n?.nodeType === 1,
        ),
        at = siblings.indexOf(print);

      assert.equal(text(siblings[at - 1]!, 'step'), 'E');
      assert.equal(all(siblings[at - 1]!, 'grace').length, 1);
      assert.equal(
        (print.parentNode as Element).getAttribute('width'),
        null,
        'the post-grace System box is not a whole native measure width',
      );
      const unpositioned = bare(result.document, original);

      assert.deepEqual(musical(result.musicxml), musical(unpositioned));
      assertUnchangedReader(
        result.musicxml,
        unpositioned,
        midiTimedNotes(file(plain.files, '.midi')),
      );
      assert.equal(
        toMusicXML(JSON.parse(JSON.stringify(result.document)) as ScoreDocument, {
          source: original,
        }).musicxml,
        result.musicxml,
      );
      assert.ok(!result.diagnostics.some((d) => d.code === 'page-layout-midmeasure-reader'));
      assert.ok(!result.diagnostics.some((d) => d.code === 'system-boundary-grace-cursor'));
      const damaged: ScoreDocument = {
        ...result.document,
        events: result.document.events.filter((e) => !(e.kind === 'note' && e.noteId === 4)),
      };
      const refused = toMusicXML(damaged, { source: original });

      validate(refused.musicxml);
      assert.ok(
        !all(parse(refused.musicxml), 'print').some((p) => p.getAttribute('new-system') === 'yes'),
      );
      assert.ok(refused.diagnostics.some((d) => d.code === 'system-boundary-grace-cursor'));
    }
  }
});

test('three source Systems at one main time place native prints before the exact E and F grace siblings', async () => {
  const original = source(String.raw`\new Staff { ${melody} }`);
  const plain = await compiler.compile(original, { format: ['svg', 'midi'] });
  const observed = await compiler.compile(original, {
    format: ['svg', 'midi'],
    files: { 'cursor-observer.ily': listener },
    includeSettings: 'cursor-observer.ily',
  });

  for (const name of Object.keys(plain.files).filter((n) => n.endsWith('.svg'))) {
    assert.deepEqual(observed.files[name], plain.files[name]);
  }

  assert.ok(
    Object.keys(observed.files).every((name) => !name.endsWith('.midi')),
    'notation observer emits no MIDI',
  );

  for (const prefix of ['CURSOR-SOURCE-AFTER', 'CURSOR-SOURCE-POST']) {
    assert.deepEqual(
      observed.logs.filter((l) => l.startsWith(prefix)),
      plain.logs.filter((l) => l.startsWith(prefix)),
    );
  }

  const result = (await converter.convert(original)).scores[0]!;

  validate(result.musicxml);
  const starts = result.document.events
    .filter((e) => e.kind === 'measureLayout')
    .filter((e) => e.firstOnSystem);

  assert.deepEqual(
    starts.map((r) => [r.system, r.columnMoment?.main.numerator, r.columnMoment?.grace]),
    [
      [1, 0, { numerator: 0, denominator: 1 }],
      [2, 1, { numerator: -1, denominator: 8 }],
      [3, 1, { numerator: -1, denominator: 16 }],
    ],
  );
  assertPrintedOwners(result.musicxml, ['E', 'F']);
  const unpositioned = bare(result.document, original);

  assert.deepEqual(musical(result.musicxml), musical(unpositioned));
  assert.deepEqual(
    musical(result.musicxml).map((p) => p.map((m) => m.length)),
    [[1, 4]],
  );
  assert.equal(all(parse(result.musicxml), 'grace').length, 3);
  assert.equal(all(parse(result.musicxml), 'image').length, 0);
  // Existing tempo playback uses a hidden native other-direction/sound carrier.
  const tempoCarriers = (xml: string) =>
    all(parse(xml), 'other-direction').map((e) => ({
      attributes: Array.from(e.attributes).map((a) => [a.name, a.value]),
      text: e.textContent,
    }));

  assert.deepEqual(tempoCarriers(result.musicxml), tempoCarriers(unpositioned));
  const cached = JSON.parse(JSON.stringify(result.document)) as ScoreDocument;

  assert.equal(toMusicXML(cached, { source: original }).musicxml, result.musicxml);
  const withoutOwners: ScoreDocument = {
    ...cached,
    measureLayoutsCaptured: false,
    pageLayoutsCaptured: false,
    events: cached.events.filter((e) => e.kind !== 'measureLayout'),
  };
  const unresolved = toMusicXML(withoutOwners, { source: original });

  assert.ok(unresolved.diagnostics.some((d) => d.code === 'mid-measure-break'));
  assert.ok(
    !all(parse(unresolved.musicxml), 'print').some((p) => p.getAttribute('new-system') === 'yes'),
    'negative grace break events cannot independently become ordinary measure-start prints',
  );
  const ordinaryBreaks: ScoreDocument = {
    ...withoutOwners,
    events: withoutOwners.events
      .filter((e) => e.kind !== 'note' || e.moment.grace.numerator === 0)
      .map((e) =>
        e.kind === 'layout'
          ? {
              ...e,
              moment: { ...e.moment, grace: { numerator: 0, denominator: 1 } },
            }
          : e,
      ),
  };

  assert.ok(
    all(parse(toMusicXML(ordinaryBreaks, { source: original }).musicxml), 'print').some(
      (p) => p.getAttribute('new-system') === 'yes',
    ),
    'exact ordinary break requests retain their legacy native mapping',
  );
  assertUnchangedReader(result.musicxml, unpositioned, midiTimedNotes(file(plain.files, '.midi')));
  assert.ok(
    !result.diagnostics.some(
      (d) => d.code === 'system-boundary-reader' || d.code === 'page-layout-reader',
    ),
  );
});

test('every independent native part owns the same exact negative grace break siblings', async () => {
  const original = source(
    String.raw`\new StaffGroup << \new Staff { ${melody} } \new Staff { ${melody} } >>`,
  );
  const plain = await compiler.compile(original, { format: ['svg', 'midi'] });
  const result = (await converter.convert(original)).scores[0]!;

  validate(result.musicxml);
  assert.equal(all(parse(result.musicxml), 'part').length, 2);
  assertPrintedOwners(result.musicxml, ['E', 'F']);
  const unpositioned = bare(result.document, original);

  assert.deepEqual(musical(result.musicxml), musical(unpositioned));
  assertUnchangedReader(result.musicxml, unpositioned, midiTimedNotes(file(plain.files, '.midi')));
});

test('a graceless other part refuses invented full-Moment cursor ownership', async () => {
  const original = source(
    String.raw`\new StaffGroup << \new Staff { ${melody} } \new Staff { c'1 g'1 } >>`,
  );
  const result = (await converter.convert(original)).scores[0]!;

  validate(result.musicxml);
  assert.equal(all(parse(result.musicxml), 'part').length, 2);
  const starts = result.document.events
    .filter((e) => e.kind === 'measureLayout')
    .filter((e) => e.firstOnSystem);

  assert.ok(starts.some((r) => r.system === 2 && r.columnMoment?.grace.numerator === -1));
  assert.ok(
    !all(parse(result.musicxml), 'print').some((p) => p.getAttribute('new-system') === 'yes'),
  );
  assert.ok(
    result.diagnostics.some(
      (d) => d.code === 'page-layout-boundary' || d.code === 'system-boundary-ownership',
    ),
  );
  assert.deepEqual(musical(result.musicxml), musical(bare(result.document, original)));
});
