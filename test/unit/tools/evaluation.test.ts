import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareNotes,
  evaluationNotes,
  summarizeComparisons,
} from '../../../tools/evaluation/playback.js';

const note = (pitch: number, start: number, duration: number | null = 1) => ({
  pitch,
  start,
  duration,
});

test('evaluation measures missing and extra attacks without shifting the performance', () => {
  const result = compareNotes([note(60, 0), note(62, 1)], [note(60, 0), note(64, 1)]);

  assert.equal(result.startsPercent, 50);
  assert.equal(result.missing, 1);
  assert.equal(result.extra, 1);
  assert.equal(result.lengthsPercent, 100);
  assert.equal(compareNotes([note(60, 0)], [note(60, 1)]).startsPercent, 0);
});

test('evaluation counts duplicate attacks and tolerates independent MIDI rounding', () => {
  const result = compareNotes([note(60, 0), note(60, 0)], [note(60, 1 / 120)]);

  assert.equal(result.matched, 1);
  assert.equal(result.startsPercent, 200 / 3);
  assert.equal(result.missing, 1);
  assert.equal(compareNotes([note(60, 0)], [note(60, 0.02)]).matched, 0);
});

test('length scoring separates wrong releases from unknown ownership', () => {
  const result = compareNotes(
    [note(60, 0), note(62, 1), note(64, 2)],
    [note(60, 0, 0.5), note(62, 1, null), note(64, 2)],
  );

  assert.equal(result.startsPercent, 100);
  assert.equal(result.lengthsPercent, 50);
  assert.equal(result.comparableLengths, 2);
  assert.equal(result.unknownLengths, 1);
});

test('empty references never produce a success percentage and invalid inputs reject', () => {
  assert.equal(compareNotes([], []).startsPercent, null);
  assert.equal(compareNotes([], [note(60, 0)]).startsPercent, null);
  assert.equal(compareNotes([note(60, 0)], []).startsPercent, 0);
  assert.equal(compareNotes([note(60, 0)], []).lengthsPercent, null);
  assert.throws(() => compareNotes([], [], -1), /Tolerance/);
  assert.throws(() => compareNotes([note(128, 0)], []), /MIDI pitch/);
});

test('combined scores weight individual notes rather than averaging percentages', () => {
  const summary = summarizeComparisons([
    compareNotes([note(60, 0)], [note(60, 0)]),
    compareNotes([note(61, 0), note(62, 1), note(63, 2)], []),
  ]);

  assert.equal(summary.startsPercent, 40);
  assert.equal(summary.matched, 1);
  assert.equal(summary.referenceNotes, 4);
});

test('MIDI evaluation preserves all attacks even when their releases are missing', () => {
  const midi = new Uint8Array([
    77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 1, 224, 77, 84, 114, 107, 0, 0, 0, 8, 0, 144, 60, 80,
    0, 255, 47, 0,
  ]);

  assert.deepEqual(evaluationNotes(midi), [note(60, 0, null)]);
  assert.throws(() => evaluationNotes(new Uint8Array()), /Invalid MIDI/);
});
