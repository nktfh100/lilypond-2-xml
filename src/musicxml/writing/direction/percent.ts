import type { Event } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import type { StaffLinePlan } from '../../layout/staff-lines.js';
import { eventTime } from '../../../model/time.js';
import type { WriteDirection } from '../measure/directions.js';

interface PercentDirectionInput {
  readonly writeDirection: WriteDirection;
  readonly linePlanAt: (staff: number, position: number) => StaffLinePlan;
  readonly fallbackStaff: number;
  readonly warn: Warn;
}

export function writePercentRepeatDirection(
  e: Extract<Event, { kind: 'percentRepeat' }>,
  { writeDirection, linePlanAt, fallbackStaff, warn }: PercentDirectionInput,
) {
  const graphic = e.graphics?.find((g) => !g.name.endsWith('Counter'));

  if (graphic && !graphic.hidden) {
    const grid = linePlanAt(e.staff ?? fallbackStaff, eventTime(e));
    const glyph =
      e.class === 'double-percent-event' || e.slashes === 0
        ? 'repeat2Bars'
        : e.class === 'percent-event'
          ? 'repeat1Bar'
          : 'repeatBarSlash';

    for (let i = 0; i < (glyph === 'repeatBarSlash' ? Math.max(1, e.slashes) : 1); i++) {
      writeDirection(e, 'symbol', glyph, {
        halign: 'center',
        valign: 'middle',
        'default-y': grid.centerY,
        'relative-x': i * 5,
      });
    }

    warn(
      'percent-layout',
      'Percent-repeat signs use native musical symbols and hidden written copies; exact source spacing and barline placement are not mapped.',
    );
  }

  for (const counter of e.graphics || []) {
    if (!counter.hidden && counter.name.endsWith('Counter') && counter.text) {
      writeDirection(
        {
          ...e,
          moment: e.class === 'percent-event' ? e.moment : counter.moment,
          direction: 1,
        },
        'words',
        counter.text,
        { halign: 'center', justify: 'center' },
      );
      warn(
        'percent-counter',
        'Repeat counter text is retained as native words; exact alignment with the repeat sign requires further layout mapping.',
      );
    }
  }
}
