import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversionNotes } from '../../../frontend/src/lib/conversion-notes.js';
import { errorMessage, UserFacingError } from '../../../frontend/src/lib/error-message.js';
import { LilyPondCompileError } from '@sightread/lilypond-wasm';

const diagnostics = (...codes: string[]) =>
  codes.map((code) => ({ code, message: `Internal details: ${code}; Verovio 6.3.0` }));

test('a long list of formatting reports becomes one useful repeat warning', () => {
  assert.deepEqual(
    conversionNotes(
      diagnostics(
        'unsupported-glyph-substituted',
        'accidental-size-reader',
        'bracket-reader',
        'bracket-stencil',
        'bracket-layout',
        'grace-playback',
        'header-layout',
        'header-reader',
        'markup-command',
        'measure-layout-reader',
        'repeat-playback-scope',
        'bracket-staff-reader',
        'slur-bezier-reader',
        'note-position-reference',
        'barline-repeat-visibility',
        'note-position-reader',
        'note-position-layout',
        'page-layout-reader',
        'page-credit-drawing',
        'page-credit-transform',
        'page-credit-position',
        'page-credit-reader',
        'page-credit-layout-reader',
        'engraving',
      ),
    ),
    [
      'Check repeats and endings. Some passages may play back in the wrong order or the wrong number of times.',
    ],
  );
});

test('minor differences and reader reports produce no notes', () => {
  assert.deepEqual(
    conversionNotes(
      diagnostics(
        'engraving',
        'grace-playback',
        'page-breaking-fallback',
        'tie-layout',
        'half-duration-reader',
        'figured-bass-end-column',
        'bend-playback',
        'future-reader-detail',
      ),
    ),
    [],
  );
  assert.deepEqual(conversionNotes([]), []);
});

test('related problems are grouped while separate musical problems remain visible', () => {
  const input = diagnostics(
    'repeat-count-data',
    'repeat-playback-ownership',
    'navigation-coda',
    'tie-anchor',
    'tie-endpoints',
    'tie-playback-unresolved',
    'lyric-extender-owner',
    'vowel-transition-endpoints',
    'tab-selection',
  );
  const before = structuredClone(input);
  const notes = conversionNotes(input);

  assert.equal(notes.length, 4);
  assert.match(notes[0]!, /repeats and endings/);
  assert.match(notes[1]!, /ties/);
  assert.match(notes[2]!, /lyrics/);
  assert.match(notes[3]!, /tablature/);
  assert.doesNotMatch(notes.join(' '), /Verovio|Internal details|metadata|native|endpoints/);
  assert.deepEqual(input, before);
});

test('meaningful losses remain visible even among many minor differences', () => {
  const notes = conversionNotes([
    ...diagnostics(...Array<string>(100).fill('engraving')),
    ...diagnostics('unpitched-mapping', 'crossing-measure', 'unmapped-event', 'footnote-body'),
  ]);

  assert.equal(notes.length, 4);
  assert.match(notes.join(' '), /percussion/);
  assert.match(notes.join(' '), /rhythms/);
  assert.match(notes.join(' '), /markings/);
  assert.match(notes.join(' '), /footnotes/);
});

test('unexpected failures do not expose internal error messages', () => {
  assert.equal(
    errorMessage(new Error('RuntimeError: unreachable at wasm-function[1843]')),
    'Something went wrong. Please try again.',
  );
  assert.equal(errorMessage('private internal details'), 'Something went wrong. Please try again.');
  assert.equal(errorMessage(null), 'Something went wrong. Please try again.');
});

test('download and empty-score errors explain the next step', () => {
  assert.equal(
    errorMessage(new TypeError('Failed to fetch')),
    'A required download failed. Check your internet connection and try again.',
  );
  assert.equal(
    errorMessage(new Error('LilyPond source must be a nonempty string')),
    'Choose a LilyPond file or paste a score before converting.',
  );
  assert.equal(
    errorMessage(
      new Error('LilyPond produced no printed score documents; MIDI-only scores are not converted'),
    ),
    'This file has no sheet music to convert. Choose a file that produces a printed score.',
  );
});

test('missing characters and accidentals are reported even though font details are hidden', () => {
  const notes = conversionNotes(
    diagnostics(
      'unsupported-glyph-substituted',
      'unsupported-text-stripped',
      'accidental-size-reader',
      'accidental-capture',
      'accidental-owner',
    ),
  );

  assert.equal(notes.length, 2);
  assert.match(notes[0]!, /sharp, flat or natural/);
  assert.match(notes[1]!, /text characters/);
});

test('compiler errors identify a useful source location without exposing the compiler log', () => {
  const error = new LilyPondCompileError(1, [
    'GNU LilyPond 2.26.0',
    '/tmp/working/score.ly:12:4: error: syntax error, unexpected STRING',
    'fatal error: failed files: score.ly',
  ]);

  assert.equal(
    errorMessage(error),
    'The score could not be read near line 12 in “score.ly”. Check that part of the file and try again.',
  );
  assert.equal(
    errorMessage(
      new LilyPondCompileError(1, ["score.ly:3:10: error: cannot find file: `parts.ily'"]),
    ),
    'This score needs another file. Add the missing file using “Include files”, then try again.',
  );
  assert.equal(
    errorMessage(new LilyPondCompileError(1, [])),
    'The score could not be read. Check that it opens correctly in LilyPond and that all required files are included.',
  );
});

test('file validation remains specific and unexpected errors use the supplied fallback', () => {
  assert.equal(
    errorMessage(
      new UserFacingError('This file is empty. Choose a LilyPond file with a score in it.'),
    ),
    'This file is empty. Choose a LilyPond file with a score in it.',
  );
  assert.equal(
    errorMessage(
      new Error('NotReadableError'),
      'This file could not be read. Try choosing it again.',
    ),
    'This file could not be read. Try choosing it again.',
  );
});
