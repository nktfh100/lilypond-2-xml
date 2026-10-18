import type { Warn } from '../../../model/diagnostics.js';
import type { Event } from '../../planning/events.js';
import type { DiscoveredParts } from '../../planning/parts.js';
import { durationValue, eventGraceTime, eventTime } from '../../../model/time.js';

export function preparePartRepeats(
  events: Event[],
  ancestors: DiscoveredParts['ancestors'],
  warn: Warn,
) {
  const repeatEventKeys = new Set<string>();
  const repeatEvents = events.filter((event) => {
    if (
      !['volta-repeat-start-event', 'volta-repeat-end-event', 'volta-span-event'].includes(
        event.class ?? '',
      )
    ) {
      return false;
    }

    const key = JSON.stringify([
      event.class,
      eventTime(event),
      eventGraceTime(event),
      event.repeatCount,
      event.spanDirection,
      event.voltaNumbers,
    ]);

    if (repeatEventKeys.has(key)) {
      return false;
    }

    repeatEventKeys.add(key);

    return true;
  });

  if (repeatEvents.length) {
    const sourceRepeats = events.filter((event) =>
      ['volta-repeat-start-event', 'volta-repeat-end-event', 'volta-span-event'].includes(
        event.class ?? '',
      ),
    );
    const captured = sourceRepeats.every((event) => typeof event.repeatContext === 'number');

    if (!captured) {
      warn(
        'repeat-playback-ownership',
        'Source repeat ownership was not captured. Independent repeat playback cannot be verified from this event document.',
      );
    } else {
      const boundaries = [...new Set(sourceRepeats.map(eventTime))].sort((a, b) => a - b);
      const notes = events.filter((event) => event.kind === 'note');
      const hasConflict = repeatEvents.some((repeat) => {
        const at = eventTime(repeat);
        const index = boundaries.indexOf(at);
        const opens = repeat.class === 'volta-repeat-start-event' || repeat.spanDirection === -1;
        const start = opens ? at : (boundaries[index - 1] ?? at);
        const end = opens ? (boundaries[index + 1] ?? at) : at;
        const owners = new Set(
          sourceRepeats
            .filter(
              (event) =>
                eventTime(event) === at &&
                event.class === repeat.class &&
                event.repeatCount === repeat.repeatCount &&
                event.spanDirection === repeat.spanDirection &&
                JSON.stringify(event.voltaNumbers) === JSON.stringify(repeat.voltaNumbers),
            )
            .map((event) => event.repeatContext),
        );

        return notes.some((note) => {
          const noteStart = eventTime(note);
          const noteEnd = noteStart + (note.duration ? durationValue(note.duration) : 0);

          return (
            noteStart < end &&
            (noteEnd > start || noteStart >= start) &&
            !ancestors(note.sourceVoice ?? note.voice).some((context) => owners.has(context.id))
          );
        });
      });

      if (hasConflict) {
        warn(
          'repeat-playback-scope',
          'Some parts have different repeats or endings. Playback may repeat or skip music in other parts too.',
        );
      }
    }
  }

  const backwardEnds = new Map<number, Event[]>();

  for (const event of repeatEvents.filter((e) => e.class === 'volta-repeat-end-event')) {
    const at = eventTime(event),
      previous = backwardEnds.get(at) ?? [];

    previous.push(event);
    backwardEnds.set(at, previous);
  }

  return { repeatEvents, backwardEnds };
}

export function createPartRepeatSession(
  prepared: { readonly backwardEnds: ReadonlyMap<number, readonly Event[]> },
  warn: Warn,
) {
  const { backwardEnds } = prepared;
  const backwardBars = new Set<number>();
  const forwardBars = new Set<number>();
  const repeatPlays = (event: Event) => {
    const count = event.repeatCount ?? 2;

    if (!Number.isSafeInteger(count) || count < 1) {
      warn(
        'repeat-count-data',
        'An invalid repeat count remains in metadata. The native sign plays once instead of inventing a number of loops.',
      );

      return 1;
    }

    return count;
  };
  const consumeBackwardRepeatCount = (at: number) => {
    const ends = backwardEnds.get(at) ?? [];

    if (ends.length === 1) {
      backwardBars.add(at);

      return repeatPlays(ends[0]!);
    }

    if (ends.length > 1) {
      warn(
        'barline-repeat-ownership',
        'A captured repeat glyph coincides with multiple semantic repeat ends. The glyph plays once and the original native repeat structures remain separate rather than selecting one count by event order.',
      );
    }

    return 1;
  };

  return {
    repeatPlays,
    consumeBackwardRepeatCount,
    backwardBars,
    forwardBars,
  };
}
