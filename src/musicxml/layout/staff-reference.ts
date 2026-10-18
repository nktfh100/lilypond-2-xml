import type { Moment } from '@sightread/lilypond-eventdocument';
import type { Event } from '../planning/events.js';
import { compareMoments } from '../../model/time.js';
import { planStaffLines } from './staff-lines.js';

type Grid = Extract<Event, { kind: 'staffLines' }>;
type Clef = Extract<Event, { kind: 'clef' }>;

/** Source visible ink is not always the top of the native logical staff grid. */
export function uncertainStaffTop(grid: Grid | undefined, clef: Clef | undefined): boolean {
  if (!grid) {
    return false;
  }

  const plan = planStaffLines(grid);
  const clefFallback =
    plan.logicalCount % 2 === 0 && (!clef || /^clefs\.[GFC]/.test(clef.glyph ?? ''));
  const positions = grid.positions;
  const asymmetricTop =
    !!positions?.length && Math.max(...positions) < Math.max(...positions.map(Math.abs));

  return !plan.represented || !!grid.custom || clefFallback || asymmetricTop;
}

export function uncertainStaffTopAt(
  events: readonly Event[],
  staff: number,
  moment: Moment,
): boolean {
  let grid: Grid | undefined;
  let clef: Clef | undefined;

  for (const event of events) {
    if (
      (event.kind !== 'staffLines' && event.kind !== 'clef') ||
      event.staff !== staff ||
      compareMoments(event.moment, moment) > 0
    ) {
      continue;
    }

    if (event.kind === 'staffLines' && (!grid || compareMoments(grid.moment, event.moment) <= 0)) {
      grid = event;
    }

    if (event.kind === 'clef' && (!clef || compareMoments(clef.moment, event.moment) <= 0)) {
      clef = event;
    }
  }

  return uncertainStaffTop(grid, clef);
}
