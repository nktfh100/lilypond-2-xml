import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { musicXMLColor } from '../../notation/colors.js';
import { type Event, required } from '../../planning/events.js';
import type { Part } from '../../planning/parts.js';
import {
  planStaffLines,
  planStaffLinesWithClef,
  type StaffLinePlan,
} from '../../layout/staff-lines.js';
import type { ScoreWritingContext } from '../../context.js';
import { add, steps } from '../../primitives.js';
import { eventGraceTime, eventTime, rationalValue } from '../../../model/time.js';

/** Staff grids and the attribute writers that use those grids share one part-local owner. */
export function createPartStaffSession(writingContext: ScoreWritingContext, part: Part) {
  const { events } = writingContext.plan;
  const { warn } = writingContext;
  const staffNumber = (id: number) => part.staves.indexOf(id) + 1;
  const lineEvents = events
    .filter((e) => e.kind === 'staffLines')
    .filter((e) => part.staves.includes(e.staff))
    .sort((a, b) => eventTime(a) - eventTime(b));
  const clefEvents = events
    .filter((e) => e.kind === 'clef')
    .filter((e) => part.staves.includes(e.staff))
    .sort((a, b) => eventTime(a) - eventTime(b));
  const clefAt = (staff: number, at: number) =>
    clefEvents.findLast((e) => e.staff === staff && eventTime(e) <= at);
  const linePlans = new Map<Extract<Event, { kind: 'staffLines' }>, StaffLinePlan>();

  for (const e of lineEvents) {
    const plan = planStaffLinesWithClef(e, clefAt(e.staff, eventTime(e)));

    if (plan.legacy) {
      warn(
        'staff-lines-history',
        'A cached staff-line count lacks actual StaffSymbol positions and spacing. Its historical native grid is retained without verified pitch-position or sparse-line geometry.',
      );
    }

    if (!plan.represented) {
      warn(
        'staff-lines-geometry',
        `Staff-line positions or pitch grid cannot be represented by the current native staff lattice (${plan.reason}). A standard grid remains without guessed line positions; resolved geometry is retained in metadata.`,
      );
    }

    if (e.custom) {
      warn(
        'staff-lines-stencil',
        'A custom or late staff-line drawing retains available native line geometry. Arbitrary drawing and after-line callback changes are not mapped.',
      );
    }

    if (
      (e.color && musicXMLColor(e.color) !== '#000000') ||
      (e.lineWidth !== undefined &&
        e.lineWidth !== null &&
        e.layoutStaffSpace &&
        Math.abs((10 * e.lineWidth) / e.layoutStaffSpace - 1) > 1e-9)
    ) {
      warn(
        'staff-lines-ledger-layout',
        'Native line-detail color and width retain the source staff-line appearance; related source ledger-line thickness and fitting are not mapped per staff.',
      );
    }

    const previous = lineEvents.findLast((p) => p.staff === e.staff && eventTime(p) < eventTime(e));

    if (
      e.present === false &&
      previous?.staffSpace !== undefined &&
      previous.staffSpace !== previous.layoutStaffSpace &&
      events.some(
        (n) =>
          n.kind === 'note' &&
          n.staff === e.staff &&
          eventTime(n) === eventTime(e) &&
          eventGraceTime(n) === eventGraceTime(e),
      )
    ) {
      warn(
        'staff-lines-stop-reference',
        'A stopped custom-spaced staff can retain its previous StaffSymbol reference on notes in the stop timestep. The invisible native grid is retained; those note-specific transitional positions require further capture.',
      );
    }

    linePlans.set(e, plan);
  }

  const lineEventAt = (staff: number, at: number) =>
    lineEvents.findLast((e) => e.staff === staff && eventTime(e) <= at);
  const linePlanAt = (staff: number, at: number) => {
    const event = lineEventAt(staff, at);

    return event
      ? required(linePlans.get(event), 'xml-part-staff.ts: linePlans.get(event)')
      : planStaffLines({ count: 5 });
  };
  const writeKey = (parent: XMLBuilder, key: Extract<Event, { kind: 'staff' }>) => {
    const k = add(
      parent,
      'key',
      undefined,
      part.staves.length > 1 ? { number: staffNumber(key.staff) } : {},
    );
    const fifths = key.pitchAlist.reduce((sum, [, alt]) => sum + rationalValue(alt) * 2, 0);
    const altered = new Map(key.pitchAlist.map(([step, alt]) => [step, rationalValue(alt) * 2]));
    const order = fifths < 0 ? [6, 2, 5, 1, 4, 0, 3] : [3, 0, 4, 1, 5, 2, 6];
    const standard =
      Number.isInteger(fifths) &&
      Math.abs(fifths) <= 7 &&
      [...steps].every(
        (_, step) =>
          (altered.get(step) || 0) ===
          (order.slice(0, Math.abs(fifths)).includes(step) ? Math.sign(fifths) : 0),
      );

    if (standard) {
      add(k, 'fifths', fifths);
      const semitones = [0, 2, 4, 5, 7, 9, 11];
      const intervals = Array.from({ length: 7 }, (_, index) => {
        const step = (key.tonic.step + index) % 7;

        return (
          (required(semitones[step], 'xml-part-staff.ts: semitones[step]') +
            (altered.get(step) || 0) -
            required(semitones[key.tonic.step], 'xml-part-staff.ts: semitones[key.tonic.step]') -
            rationalValue(key.tonic.alteration) * 2 +
            12) %
          12
        );
      }).join(',');
      const modes: Record<string, string> = {
        '0,2,4,5,7,9,11': 'major',
        '0,2,3,5,7,8,10': 'minor',
        '0,2,3,5,7,9,10': 'dorian',
        '0,1,3,5,7,8,10': 'phrygian',
        '0,2,4,6,7,9,11': 'lydian',
        '0,2,4,5,7,9,10': 'mixolydian',
        '0,1,3,5,6,8,10': 'locrian',
      };

      add(k, 'mode', modes[intervals] || 'other');
    } else {
      for (const [s, alt] of key.pitchAlist) {
        add(k, 'key-step', steps[s]);
        add(k, 'key-alter', rationalValue(alt) * 2);
      }
    }
  };
  const tabSettings = (staff: number, at: number) =>
    events
      .filter(
        (e): e is typeof e & { kind: 'tabStaff' } =>
          e.kind === 'tabStaff' && e.staff === staff && eventTime(e) <= at,
      )
      .at(-1);
  const writeStaffLines = (parent: XMLBuilder, e: Extract<Event, { kind: 'staffLines' }>) => {
    const plan = required(linePlans.get(e), 'xml-part-staff.ts: linePlans.get(e)');
    const color = musicXMLColor(e.color ?? null);
    const width =
      typeof e.lineWidth === 'number' &&
      Number.isFinite(e.lineWidth) &&
      e.lineWidth >= 0 &&
      typeof e.layoutStaffSpace === 'number' &&
      Number.isFinite(e.layoutStaffSpace) &&
      e.layoutStaffSpace > 0
        ? (10 * e.lineWidth) / e.layoutStaffSpace
        : undefined;

    if (e.lineWidth !== undefined && e.lineWidth !== null && width === undefined) {
      warn(
        'staff-lines-appearance-data',
        'An invalid staff-line width is omitted from native output; available line geometry and color remain.',
      );
    }

    if (
      eventTime(e) === 0 &&
      plan.logicalCount === 5 &&
      plan.visibleLines.length === 5 &&
      plan.staffSizePercent === 100 &&
      (!color || color === '#000000') &&
      (width === undefined || Math.abs(width - 1) < 1e-9)
    ) {
      return;
    }

    const details = add(
      parent,
      'staff-details',
      undefined,
      part.staves.length > 1
        ? {
            number: staffNumber(required(e.staff, 'xml-part-staff.ts: e.staff')),
          }
        : {},
    );

    add(details, 'staff-lines', plan.logicalCount);

    for (let line = 1; line <= plan.logicalCount; line++) {
      add(details, 'line-detail', undefined, {
        line,
        'print-object': plan.visibleLines.includes(line) ? 'yes' : 'no',
        color,
        width,
      });
    }

    add(details, 'staff-size', plan.staffSizePercent, { scaling: 100 });
  };
  const writeTabStaff = (parent: XMLBuilder, e: Extract<Event, { kind: 'tabStaff' }>) => {
    const details = add(
      parent,
      'staff-details',
      undefined,
      part.staves.length > 1
        ? {
            number: staffNumber(required(e.staff, 'xml-part-staff.ts: e.staff')),
          }
        : {},
    );

    for (const [i, pitch] of e.tunings.entries()) {
      const tuning = add(details, 'staff-tuning', undefined, {
        line: e.stringOneTopmost ? e.tunings.length - i : i + 1,
      });

      add(tuning, 'tuning-step', steps[pitch.step]);

      if (rationalValue(pitch.alteration)) {
        add(tuning, 'tuning-alter', rationalValue(pitch.alteration) * 2);
      }

      add(tuning, 'tuning-octave', pitch.octave + 4);
    }

    if (e.capo) {
      add(details, 'capo', e.capo);
    }
  };
  const writeTranspose = (parent: XMLBuilder, e: Extract<Event, { kind: 'transposition' }>) => {
    const diatonic = e.pitch.octave * 7 + e.pitch.step;
    const chromatic =
      e.pitch.octave * 12 +
      required(
        [0, 2, 4, 5, 7, 9, 11][e.pitch.step],
        'xml-part-staff.ts: [0, 2, 4, 5, 7, 9, 11][e.pitch.step]',
      ) +
      rationalValue(e.pitch.alteration) * 2;

    if (eventTime(e) === 0 && diatonic === 0 && chromatic === 0) {
      return;
    }

    const octaves = Math.trunc(diatonic / 7);
    const node = add(
      parent,
      'transpose',
      undefined,
      part.staves.length > 1
        ? {
            number: staffNumber(required(e.staff, 'xml-part-staff.ts: e.staff')),
          }
        : {},
    );

    add(node, 'diatonic', diatonic - octaves * 7);
    add(node, 'chromatic', chromatic - octaves * 12);

    if (octaves) {
      add(node, 'octave-change', octaves);
    }
  };

  return {
    plan: {
      staffNumber,
      lineEvents,
      clefEvents,
      clefAt,
      linePlans,
      linePlanAt,
      tabSettings,
    },
    writers: { writeKey, writeStaffLines, writeTabStaff, writeTranspose },
  };
}
