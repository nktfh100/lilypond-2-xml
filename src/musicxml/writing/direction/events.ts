import { type Attachment, type Event, required } from '../../planning/events.js';

/** Expand attached directions, then retain their first occurrence in source order. */
export function collectDirectionEvents(
  inMeasure: readonly Event[],
  staves: readonly number[],
): Event[] {
  const directionAttachments = new Set([
    'absolute-dynamic-event',
    'text-script-event',
    'crescendo-event',
    'decrescendo-event',
    'sustain-event',
    'sostenuto-event',
    'una-corda-event',
    'text-span-event',
  ]);
  const directionEvents: Event[] = inMeasure.flatMap((e) => [
    e,
    ...(e.attachments ?? [])
      .filter(
        (a): a is Exclude<Attachment, { class: 'ignored' }> =>
          a.class !== 'ignored' && directionAttachments.has(a.class),
      )
      .map((a): Event => ({
        ...a,
        kind: 'voice',
        voice: required(e.voice, 'xml-measure-directions.ts: e.voice'),
        staff: required(e.staff, 'xml-measure-directions.ts: e.staff'),
        moment: e.moment,
      })),
  ]);
  const events: Event[] = [];
  const seenDirections = new Set();

  for (const e of directionEvents) {
    if (e.kind === 'voice' && directionAttachments.has(e.class)) {
      const key = JSON.stringify([
        e.voice,
        e.moment,
        e.class,
        e.spanDirection,
        e.text,
        e.markup,
        e.direction,
      ]);

      if (seenDirections.has(key)) {
        continue;
      }

      seenDirections.add(key);
    }

    if (e.staff !== undefined && e.staff !== null && !staves.includes(e.staff ?? NaN)) {
      continue;
    }

    events.push(e);
  }

  return events;
}
