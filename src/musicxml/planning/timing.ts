import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add } from '../types.js';
import type { Event, Tick, Time, Value } from './events.js';
import type { Warn } from '../../model/diagnostics.js';

export interface ScoreTimingInput {
  events: readonly Event[];
  finish: number;
  time: Time;
  value: Value;
  tick: Tick;
  ticksPerWholeNote: number;
  captured: boolean | undefined;
  staves?: readonly number[];
}

export function scoreTiming({
  events,
  finish,
  time,
  value,
  tick,
  ticksPerWholeNote,
  captured,
  staves,
}: ScoreTimingInput) {
  const global = events.filter((e) => e.kind === 'step').sort((a, b) => time(a) - time(b));
  const local = events.filter((e) => e.kind === 'staffStep').sort((a, b) => time(a) - time(b));
  const state = (e: (typeof global)[number] | (typeof local)[number] | undefined) =>
    e && JSON.stringify([e.bar, e.length, e.time, e.timing, tick(time(e) - value(e.position))]);
  const independent = local.some(
    (e) => state(e) !== state(global.filter((g) => tick(time(g)) <= tick(time(e))).at(-1)),
  );
  const timeEvents = independent
    ? local.filter((e) => !staves || staves.includes(e.staff))
    : global;
  const primary = staves?.[0] ?? local[0]?.staff;
  const steps =
    independent && timeEvents.length
      ? timeEvents.filter((e) => e.kind === 'staffStep' && e.staff === primary)
      : global;
  const free = steps.some((e) => !e.timing);
  const at = (position: number) => steps.filter((e) => tick(time(e)) <= tick(position)).at(-1);
  const fragments = new Set(
    free
      ? events
          .filter(
            (e) =>
              e.kind === 'layout' &&
              ['line-break-event', 'page-break-event'].includes(e.class) &&
              (e.permission === 'force' || e.permission === 'allow') &&
              at(time(e))?.timing === false,
          )
          .map(time)
      : [],
  );
  const starts = free
    ? steps.filter((e, i) => !i || e.bar !== steps[i - 1]?.bar).map(time)
    : steps.map((e) => tick(time(e) - value(e.position)) / ticksPerWholeNote);
  const repeatBoundaries = events
    .filter(
      (e) =>
        e.class === 'volta-repeat-start-event' ||
        e.class === 'volta-repeat-end-event' ||
        e.class === 'volta-span-event',
    )
    .map(time);

  for (const boundary of repeatBoundaries) {
    if (!starts.some((start) => tick(start) === tick(boundary))) {
      fragments.add(boundary);
    }
  }

  const boundaries = [...new Set([0, ...starts, ...fragments, ...repeatBoundaries])]
    .filter((t) => t < finish)
    .sort((a, b) => a - b);

  return {
    free,
    independent,
    timeEvents,
    staffAt: (staff: number, position: number) =>
      independent
        ? (local.filter((e) => e.staff === staff && tick(time(e)) <= tick(position)).at(-1) ??
          at(position))
        : at(position),
    at,
    fragments,
    boundaries: boundaries.length ? boundaries : [0],
    captured: captured || events.some((e) => e.kind === 'barline'),
    bars:
      captured || events.some((e) => e.kind === 'barline')
        ? events.filter((e) => e.kind === 'barline')
        : events
            .filter((e) => e.class === 'bar-event')
            .map((e): Extract<Event, { kind: 'barline' }> => ({
              moment: e.moment,
              kind: 'barline' as const,
              glyph: e.barType,
              hidden: false,
            })),
  };
}

export function writeBarline(
  parent: XMLBuilder,
  event: { glyph: string; hidden: boolean },
  location: string,
  add: Add,
  warn: Warn,
  backwardPlays = 1,
  repeatDirection: 'auto' | 'backward' | 'forward' = 'auto',
) {
  const styles: Record<string, string> = {
    '': 'none',
    '|': 'regular',
    '||': 'light-light',
    '|.': 'light-heavy',
    '.|': 'heavy-light',
    '.': 'heavy',
    '!': 'dashed',
    ';': 'dotted',
    "'": 'tick',
    ':|.': 'light-heavy',
    ':|': 'light-heavy',
    '.|:': 'heavy-light',
    '|:': 'heavy-light',
    ':|.|:': 'heavy-heavy',
  };
  const style = event.hidden ? 'none' : styles[event.glyph.split('-')[0]!];

  if (!style) {
    warn('barline-style', `Barline graphics require further native mapping: ${event.glyph}`);
  }

  const node = add(parent, 'barline', undefined, { location });

  add(node, 'bar-style', style || 'regular');

  if (!event.hidden && repeatDirection !== 'forward' && event.glyph.includes(':|')) {
    add(node, 'repeat', undefined, {
      direction: 'backward',
      times: backwardPlays,
    });
  } else if (!event.hidden && repeatDirection !== 'backward' && event.glyph.includes('|:')) {
    add(node, 'repeat', undefined, { direction: 'forward' });
  }

  return node;
}
