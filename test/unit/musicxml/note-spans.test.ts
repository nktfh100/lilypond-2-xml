import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Moment } from '@sightread/lilypond-eventdocument';
import type { NoteLike } from '../../../src/musicxml/planning/events.js';
import { noteKey, noteSpanMarks } from '../../../src/musicxml/notation/spans/note-spans.js';

const at = (numerator: number, denominator: number): Moment => ({
  main: { numerator, denominator },
  grace: { numerator: 0, denominator: 1 },
});
const note = (moment: Moment): NoteLike => ({
  kind: 'note',
  noteId: 7,
  voice: 2,
  staff: 1,
  moment,
  duration: { log: 2, dots: 0, scale: { numerator: 1, denominator: 1 } },
  attachments: [],
});
const marksBetween = (start: Moment, stop: Moment, notes: NoteLike[]) =>
  noteSpanMarks(
    [
      {
        id: 1,
        voice: 2,
        moment: start,
        endMoment: stop,
        fromNotes: [],
        toNotes: [],
        resolvedStart: true,
      },
    ],
    { notes, boundaries: [0], voices: [2] },
    {
      family: 'test spans',
      onMissingEndpoints: () => assert.fail('span bounds must remain resolved'),
      onMissingAnchor: () => assert.fail('exact source Moments must resolve to their notes'),
      inspect: () => {},
    },
  );

test('equivalent rational main and grace times share note keys and span anchors', () => {
  const start = { ...at(1, 2), grace: { numerator: -1, denominator: 8 } };
  const equivalentStart = {
    ...at(2, 4),
    grace: { numerator: -2, denominator: 16 },
  };
  const stop = at(3, 4),
    equivalentStop = at(6, 8);

  assert.equal(noteKey(note(start)), noteKey(note(equivalentStart)));
  const marks = marksBetween(equivalentStart, equivalentStop, [note(start), note(stop)]);

  assert.deepEqual(
    marks.get(noteKey(note(start)))?.map((mark) => mark.type),
    ['start'],
  );
  assert.deepEqual(
    marks.get(noteKey(note(stop)))?.map((mark) => mark.type),
    ['stop'],
  );
});

for (const field of ['main', 'grace'] as const) {
  test(`distinct ${field} times keep separate span endpoints when floating quotients coincide`, () => {
    const n = Number.MAX_SAFE_INTEGER;
    const earlier = { numerator: n - 2, denominator: n - 1 };
    const later = { numerator: n - 1, denominator: n };

    assert.equal(earlier.numerator / earlier.denominator, later.numerator / later.denominator);
    const start = { ...at(0, 1), [field]: earlier };
    const stop = { ...at(0, 1), [field]: later };
    const from = note(start),
      to = note(stop);

    assert.notEqual(noteKey(from), noteKey(to));
    // Reversed input must not make the later source note capture both endpoints.
    const marks = marksBetween(start, stop, [to, from]);

    assert.equal(marks.size, 2);
    assert.deepEqual(
      marks.get(noteKey(from))?.map((mark) => [mark.type, mark.number]),
      [['start', 1]],
    );
    assert.deepEqual(
      marks.get(noteKey(to))?.map((mark) => [mark.type, mark.number]),
      [['stop', 1]],
    );
  });
}
