import { type Event, type PlannedNote, type ValidatedNote, isKind, required } from './events.js';
import { durationValue, eventGraceTime, eventTime } from '../../model/time.js';
import type { Part } from './parts.js';

export interface PartNoteTiming {
  part: Part;
  boundaries: readonly number[];
  ticks: number;
  tick: (position: number) => number;
}

/** Split sustained carriers without mutating source notes or changing their identities. */
export function planPartNotes(
  notes: readonly ValidatedNote[],
  events: readonly Event[],
  timing: PartNoteTiming,
): PlannedNote[] {
  const { part, boundaries, ticks, tick } = timing;

  return notes
    .filter((e) => part.staves.includes(e.staff ?? NaN))
    .flatMap((e) => {
      if (eventGraceTime(e)) {
        return [
          {
            ...e,
            segmentDuration: e.segmentDuration ?? durationValue(e.duration),
            continuation: e.continuation ?? false,
            continues: e.continues ?? false,
            tieAtEnd: e.tieAtEnd ?? false,
          },
        ];
      }

      const from = tick(eventTime(e));
      const to = from + tick(durationValue(e.duration));
      const cuts = [from, ...boundaries.map(tick).filter((t) => t > from && t < to), to];

      return cuts.slice(0, -1).map((at, i) => ({
        ...e,
        moment: {
          ...e.moment,
          main: { numerator: at, denominator: ticks },
        },
        segmentDuration: (required(cuts[i + 1], 'score-part-notes.ts: cuts[i + 1]') - at) / ticks,
        continuation: i > 0,
        continues: i < cuts.length - 2,
        tieAtEnd:
          (e.attachments || []).some((a) => a.class === 'tie-event') ||
          events.some(
            (a) =>
              a.kind === 'voice' &&
              a.class === 'tie-event' &&
              a.voice === e.voice &&
              eventTime(a) === eventTime(e) &&
              eventGraceTime(a) === eventGraceTime(e),
          ),
      }));
    })
    .map((e) =>
      isKind(e, 'rest', 'mmrest') &&
      !eventGraceTime(e) &&
      notes.some(
        (note) =>
          note.kind === 'note' &&
          note.voice === e.voice &&
          !eventGraceTime(note) &&
          tick(eventTime(note)) <
            tick(eventTime(e) + (e.segmentDuration ?? durationValue(e.duration))) &&
          tick(eventTime(note) + durationValue(note.duration)) > tick(eventTime(e)),
      )
        ? { ...e, voice: -e.voice - 1, sourceVoice: e.voice }
        : e,
    );
}
