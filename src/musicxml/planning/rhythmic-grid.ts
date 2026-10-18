import type { Event } from './events.js';
import { lcm } from '../../model/time.js';

export interface RhythmicGrid {
  ticks: number;
  tick: (wholeNotes: number) => number;
}

export function planRhythmicGrid(
  events: readonly Event[],
  figures: readonly Pick<Event, 'moment'>[],
): RhythmicGrid {
  let ticks = 1;

  for (const e of events) {
    ticks = lcm(ticks, e.moment.main.denominator);

    if (e.duration) {
      const d = e.duration;

      ticks = lcm(ticks, 2 ** Math.max(0, d.log + d.dots) * d.scale.denominator);
    }
  }

  for (const figure of figures) {
    ticks = lcm(ticks, figure.moment.main.denominator);
  }

  ticks = lcm(ticks, 4);

  if (!Number.isSafeInteger(ticks) || ticks > 1e9) {
    throw new Error('Rhythmic precision exceeds supported MusicXML divisions');
  }

  const tick = (n: number) => Math.round(n * ticks);

  return { ticks, tick };
}
