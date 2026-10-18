import type { Event } from '../../planning/events.js';

const noteBoundSpanKinds = [
  'slur',
  'glissando',
  'tieGraphic',
  'durationLine',
  'ligature',
  'fingerGlide',
  'episema',
] as const satisfies readonly Event['kind'][];

/** Source spans whose endpoints belong to captured notes. */
export type NoteBoundSpan = Extract<Event, { kind: (typeof noteBoundSpanKinds)[number] }>;

export function isNoteBoundSpan(event: Event): event is NoteBoundSpan {
  return noteBoundSpanKinds.some((kind) => event.kind === kind);
}
