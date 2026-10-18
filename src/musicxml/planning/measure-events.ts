import type { Event } from './events.js';
import { eventTime } from '../../model/time.js';

const terminalKinds = new Set<Event['kind']>([
  'voice',
  'navigation',
  'navigationTarget',
  'score',
  'bracketPoint',
  'durationLinePoint',
  'ligaturePoint',
  'fingerGlidePoint',
  'episemaPoint',
  'optionalMaterialPoint',
  'bendHoldPoint',
  'measureCounterPoint',
  'combineTextPoint',
  'vowelTransitionPoint',
]);

export function planMeasureEvents(
  events: readonly Event[],
  boundaries: readonly number[],
  finish: number,
  endsSection: (event: Event) => boolean,
): Event[][] {
  const measures: Event[][] = boundaries.map(() => []);

  for (const event of events) {
    const at = eventTime(event);

    if (!Number.isFinite(at) || at > finish) {
      continue;
    }

    let low = 0,
      high = boundaries.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);

      if (boundaries[middle]! <= at) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    const index = low - 1;
    const measure = measures[index];

    if (!measure) {
      continue;
    }

    const sectionEnd = endsSection(event);

    if (index > 0 && at === boundaries[index] && sectionEnd) {
      measures[index - 1]!.push(event);
      continue;
    }

    if (at < finish || (at === finish && (sectionEnd || terminalKinds.has(event.kind)))) {
      measure.push(event);
    }
  }

  return measures;
}
