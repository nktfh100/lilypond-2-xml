import type { Event, NoteLike } from './events.js';
import { mainTime } from '../../model/time.js';

interface VoiceSpan {
  readonly voice: number;
  readonly first: number;
  readonly last: number;
  readonly staves: string;
  lane: number;
}

// Grace notes have no main-time duration, but occupy a distinct lane at the onset.
const graceOccupancy = 1e-9;
const overlapTolerance = 1e-10;

function conflicts(a: VoiceSpan, b: VoiceSpan): boolean {
  return (
    a.staves !== b.staves ||
    (a.first < b.last - overlapTolerance && b.first < a.last - overlapTolerance)
  );
}

/** Reuse native voice lanes only when source voices share staves and do not overlap. */
export function voiceLanes(
  notes: NoteLike[],
  events: Event[],
  time: (event: Event) => number,
  grace: (event: Event) => number,
  duration: (duration: NoteLike['duration']) => number,
): (voice: number) => number {
  const voices = [...new Set(notes.map((note) => note.voice))];
  const spans: VoiceSpan[] = voices.map((voice) => {
    const owned = notes.filter((note) => note.voice === voice);
    const sourceVoices = new Set(owned.map((note) => note.sourceVoice ?? voice));
    const related = events.filter(
      (event) => typeof event.voice === 'number' && sourceVoices.has(event.voice),
    );
    const starts = owned.map((note) => time(note) - (grace(note) < 0 ? graceOccupancy : 0));
    const ends = owned.map((note) => {
      const occupiedDuration = grace(note)
        ? graceOccupancy
        : (note.segmentDuration ?? duration(note.duration));

      return time(note) + occupiedDuration;
    });

    for (const event of related) {
      starts.push(time(event));
      ends.push(event.endMoment ? mainTime(event.endMoment) : time(event));
    }

    return {
      voice,
      first: Math.min(...starts),
      last: Math.max(...ends),
      staves: [...new Set(owned.map((note) => note.staff))].sort().join(':'),
      lane: 0,
    };
  });
  const lanes = new Map<number, number>();

  for (const span of spans) {
    const occupied = new Set(
      spans.filter((other) => other.lane > 0 && conflicts(span, other)).map((other) => other.lane),
    );

    span.lane = 1;

    while (occupied.has(span.lane)) {
      span.lane++;
    }

    lanes.set(span.voice, span.lane);
  }

  return (voice) => {
    const lane = lanes.get(voice);

    if (lane === undefined) {
      throw new Error(`No native lane planned for source voice ${voice}`);
    }

    return lane;
  };
}
