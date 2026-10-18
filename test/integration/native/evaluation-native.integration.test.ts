import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluationNotes } from '../../../tools/evaluation/playback.js';
import { readMidiAttacks } from '../../../tools/evaluation/midi.js';
import {
  compareWrittenNotes,
  musicXmlWrittenNotes,
  nativeWrittenNotes,
} from '../../../tools/evaluation/written.js';

test(
  'native evaluation ignores MIDI-only scores and MIDI settings while preserving printed score identity',
  {
    skip:
      !process.env.LILYPOND_BIN &&
      'LILYPOND_BIN is unset; npm run test:native requires a native LilyPond executable',
  },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'evaluation-native-test-'));
    const prefix = path.join(directory, 'reference');
    const helper = fileURLToPath(
      new URL('../../../tools/evaluation/reference/evaluate-reference.ily', import.meta.url),
    );
    const source = path.join(directory, 'source.ly');

    await writeFile(
      source,
      `\\version "2.26.0"
#(define evaluation-output-prefix ${JSON.stringify(prefix)})
\\include ${JSON.stringify(helper)}
\\score { \\new Staff \\with { midiInstrument = "violin" } { \\set Staff.midiMaximumVolume = #0 \\repeat volta 2 { c'1 d'1 } } \\layout {} }
\\score { \\new Staff { \\repeat volta 2 { e'1 f'1 } }
  \\midi { \\context { \\Staff midiInstrument = "violin" } } }
\\score { \\new Staff \\with { midiMaximumVolume = #0 midiInstrument = "violin" } { g'1 } \\layout {} \\midi { \\context { \\Staff midiInstrument = "violin" } } }
\\score { \\new Staff { \\repeat percent 2 { c'4 d'4 } \\grace { e'16 f'16 } g'2 } \\layout {} }
`,
    );
    const result = spawnSync(process.env.LILYPOND_BIN!, ['-dno-print-pages', source], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /programming error:/);
    assert.equal(await readFile(`${prefix}.tsv`, 'utf8'), '1\tprinted\n3\tprinted\n4\tprinted\n');
    const written = nativeWrittenNotes(await readFile(`${prefix}-1.written.tsv`, 'utf8'));

    assert.deepEqual(
      written.map((note) => [note.pitch, note.start, note.duration]),
      [
        ['C:0:4', 0, 4],
        ['D:0:4', 4, 4],
      ],
    );
    assert.deepEqual(
      nativeWrittenNotes(await readFile(`${prefix}-3.written.tsv`, 'utf8')).map(
        (note) => note.pitch,
      ),
      ['G:0:4'],
    );
    assert.deepEqual(
      nativeWrittenNotes(await readFile(`${prefix}-4.written.tsv`, 'utf8')).map((note) => [
        note.pitch,
        note.start,
        note.grace,
        note.duration,
      ]),
      [
        ['C:0:4', 0, 0, 1],
        ['D:0:4', 1, 0, 1],
        ['C:0:4', 2, 0, 1],
        ['D:0:4', 3, 0, 1],
        ['E:0:4', 4, -0.5, 0.25],
        ['F:0:4', 4, -0.25, 0.25],
        ['G:0:4', 4, 0, 2],
      ],
    );
    const first = await readFile(`${prefix}-1.midi`),
      second = await readFile(`${prefix}-3.midi`);

    assert.deepEqual(
      evaluationNotes(first).map((note) => [note.pitch, note.start, note.duration]),
      [
        [60, 0, 4],
        [62, 4, 4],
        [60, 8, 4],
        [62, 12, 4],
      ],
    );
    assert.deepEqual(
      evaluationNotes(second).map((note) => note.pitch),
      [67],
    );
    assert.ok(
      readMidiAttacks(second).tracks.every((track) =>
        track.programs.every((program) => program.program !== 40),
      ),
    );
  },
);

test(
  'written observer covers pitched staff contexts without collapsing duplicate notes or voice identities',
  {
    skip:
      !process.env.LILYPOND_BIN &&
      'LILYPOND_BIN is unset; npm run test:native requires a native LilyPond executable',
  },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'evaluation-contexts-test-'));
    const prefix = path.join(directory, 'reference');
    const helper = fileURLToPath(
      new URL('../../../tools/evaluation/reference/evaluate-reference.ily', import.meta.url),
    );
    const source = path.join(directory, 'source.ly');
    const staffs = [
      'Staff',
      'TabStaff',
      'MensuralStaff',
      'PetrucciStaff',
      'VaticanaStaff',
      'GregorianTranscriptionStaff',
      'KievanStaff',
    ];

    await writeFile(
      source,
      `\\version "2.26.0"
\\layout { \\context { \\Voice \\name UnobservedVoice \\alias Voice } \\context { \\Staff \\accepts UnobservedVoice } }
#(define evaluation-output-prefix ${JSON.stringify(prefix)})
\\include ${JSON.stringify(helper)}
${staffs.map((staff) => `\\score { << \\new Staff { c'1 d'1 } \\new ${staff} { c'1 d'1 } >> \\layout {} }`).join('\n')}
\\score { \\new Staff << \\new Voice { c'1 d'1 } \\new CueVoice { c'1 d'1 } >> \\layout {} }
\\score { \\new StandaloneRhythmScore \\new StandaloneRhythmStaff << \\new StandaloneRhythmVoice { c'1 d'1 } \\new StandaloneRhythmVoice { c'1 d'1 } >> \\layout {} }
\\score { << \\new Staff << \\new Voice { c'1 d'1 } \\new NullVoice { e'1 f'1 } >> \\new ChordNames \\chordmode { c1 d1 } >> \\layout {} }
\\score { \\new PianoStaff << \\new Staff = "up" { <c' e' g'>2 \\hideNotes a'2 \\unHideNotes \\change Staff = "down" b'1 } \\new Staff = "down" { c1 d1 } >> \\layout {} }
\\score { << \\new Staff { c'1 } \\new Staff \\new UnobservedVoice { e'1 } >> \\layout {} }
`,
    );
    const result = spawnSync(process.env.LILYPOND_BIN!, ['-dno-print-pages', source], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /programming error:/);

    for (let index = 1; index <= staffs.length + 2; index++) {
      const written = nativeWrittenNotes(await readFile(`${prefix}-${index}.written.tsv`, 'utf8'));

      assert.deepEqual(
        written.map((note) => [note.pitch, note.start, note.duration]),
        [
          ['C:0:4', 0, 4],
          ['C:0:4', 0, 4],
          ['D:0:4', 4, 4],
          ['D:0:4', 4, 4],
        ],
        `score ${index}`,
      );
      assert.equal(new Set(written.map((note) => note.voice)).size, 2, `score ${index}`);
    }

    const harmony = nativeWrittenNotes(await readFile(`${prefix}-10.written.tsv`, 'utf8'));
    const crossStaff = nativeWrittenNotes(await readFile(`${prefix}-11.written.tsv`, 'utf8'));

    assert.deepEqual(
      harmony.map((note) => note.pitch),
      ['C:0:4', 'D:0:4'],
    );
    assert.deepEqual(
      crossStaff.map((note) => note.pitch),
      ['C:0:4', 'E:0:4', 'G:0:4', 'C:0:3', 'A:0:4', 'B:0:4', 'D:0:3'],
    );
    const incomplete = await readFile(`${prefix}-12.written.tsv`, 'utf8');

    assert.throws(
      () => nativeWrittenNotes(incomplete),
      /Uncaptured pitched notes.*UnobservedVoice/,
    );
  },
);

test(
  'evaluation CLI reports an incomplete reference when a pitched voice escapes observation',
  {
    skip:
      !process.env.LILYPOND_BIN &&
      'LILYPOND_BIN is unset; npm run test:native requires a native LilyPond executable',
  },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'evaluation-incomplete-test-'));
    const source = path.join(directory, 'source.ly');
    const musicxml = path.join(directory, 'score.musicxml');
    const output = path.join(directory, 'evaluation');
    const cli = fileURLToPath(new URL('../../../tools/evaluation/cli.ts', import.meta.url));
    const loader = createRequire(import.meta.url).resolve('tsx/esm');

    await writeFile(
      source,
      String.raw`\version "2.26.0"
\score {
  << \new Staff { c'1 } \new MensuralStaff { e'1 } >>
  \layout { \context { \MensuralVoice \remove #evaluation-written-engraver } }
}
`,
    );
    await writeFile(
      musicxml,
      '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>',
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        loader,
        cli,
        source,
        '--score',
        '1',
        '--lilypond',
        process.env.LILYPOND_BIN!,
        '--musicxml',
        musicxml,
        '--out-dir',
        output,
        '--min-written',
        '100',
      ],
      { cwd: directory, encoding: 'utf8', timeout: 30_000 },
    );
    const report = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));

    assert.equal(result.status, 2, result.stderr);
    assert.equal(report.status, 'incomplete');
    assert.equal(report.thresholdStatus, 'unavailable');
    assert.equal(report.writtenSummary, null);
    assert.equal(report.scores[0].written, null);
    assert.match(report.scores[0].writtenError, /Uncaptured pitched notes.*MensuralVoice/);
    assert.ok(report.scores[0].comparison);
  },
);

test(
  'written reference counts mensural notes and detects an export missing their entire part',
  {
    skip:
      !process.env.LILYPOND_BIN &&
      'LILYPOND_BIN is unset; npm run test:native requires a native LilyPond executable',
  },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'evaluation-mensural-test-'));
    const prefix = path.join(directory, 'reference');
    const helper = fileURLToPath(
      new URL('../../../tools/evaluation/reference/evaluate-reference.ily', import.meta.url),
    );
    const source = path.join(directory, 'source.ly');

    await writeFile(
      source,
      `\\version "2.26.0"
#(define evaluation-output-prefix ${JSON.stringify(prefix)})
\\include ${JSON.stringify(helper)}
<< \\new Staff { c'1 d'1 } \\new MensuralStaff { e'1 f'1 } >>
`,
    );
    const result = spawnSync(process.env.LILYPOND_BIN!, ['-dno-print-pages', source], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /programming error:/);
    const written = nativeWrittenNotes(await readFile(`${prefix}-1.written.tsv`, 'utf8'));
    const incomplete = musicXmlWrittenNotes(
      '<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure><measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>',
    );
    const comparison = compareWrittenNotes(written, incomplete);

    assert.equal(comparison.referenceNotes, 4);
    assert.equal(comparison.exportedNotes, 2);
    assert.equal(comparison.matched, 2);
    assert.equal(comparison.missing, 2);
    assert.equal(comparison.percent, 200 / 3);
    assert.deepEqual(
      comparison.examples.missing.map((note) => [note.pitch, note.start, note.duration]),
      [
        ['E:0:4', 0, 4],
        ['F:0:4', 4, 4],
      ],
    );
  },
);
