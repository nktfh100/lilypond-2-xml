import type { Event } from './events.js';
import type { Part } from './parts.js';
import { availableSpanNumber } from '../primitives.js';
import { eventTime } from '../../model/time.js';

export function planPartTuplets(
  events: Event[],
  lanes: {
    part: Part;
    voices: number[];
    voiceNumber: (voice: number) => number;
  },
) {
  const { part, voices, voiceNumber } = lanes;
  const tupletNumbers = new Map<Event, number | undefined>();
  const tupletStack = new Map<number | null | undefined, number[]>();
  const tupletStarts = new Map<string, Event>();
  const tupletGapSpans: {
    voice: number;
    number: number;
    start: number;
    end: number;
  }[] = [];

  for (const e of events.filter(
    (e) => e.class === 'tuplet-span-event' && part.staves.includes(e.staff ?? NaN),
  )) {
    const stack = tupletStack.get(e.voice) || [];

    if (e.spanDirection === -1) {
      stack.push(availableSpanNumber([...tupletStack.values()].flat()));
      tupletNumbers.set(e, stack.at(-1));
      tupletStarts.set(`${e.voice}:${stack.at(-1)}`, e);
    } else {
      const number = stack.pop() || 1;

      tupletNumbers.set(e, number);
      const first = tupletStarts.get(`${e.voice}:${number}`);

      if (first && typeof e.voice === 'number' && voices.includes(e.voice)) {
        tupletGapSpans.push({
          voice: voiceNumber(e.voice),
          number,
          start: eventTime(first) * 4,
          end: eventTime(e) * 4,
        });
      }

      tupletStarts.delete(`${e.voice}:${number}`);
    }

    tupletStack.set(e.voice, stack);
  }

  return { tupletNumbers, tupletGapSpans };
}
