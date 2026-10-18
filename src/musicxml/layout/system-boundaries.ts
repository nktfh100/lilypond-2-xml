import type { Moment } from '@sightread/lilypond-eventdocument';
import { coordinatesNear as close } from './geometry.js';
import type { Warn } from '../../model/diagnostics.js';
import {
  compareMoments as compareMoment,
  compareRational,
  isMoment as validMoment,
} from '../../model/time.js';
import type { MeasureLayoutEvent, ScoreDocument } from '../../model/document.js';

export interface SystemBoundary {
  readonly moment: Moment;
  readonly system: number;
  /** Actual System box; this is never a whole native measure width. */
  readonly box: {
    readonly left: number;
    readonly right: number;
    readonly layoutStaffSpace: number;
  };
}

const positiveId = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Locate actual System LEFT columns independently of native measure boxes. */
export function systemBoundaries(
  document: ScoreDocument,
  orderedStaffs: readonly number[],
  warn: Warn,
): readonly SystemBoundary[] {
  const rows = document.events.filter((e) => e.kind === 'measureLayout');

  if (document.measureLayoutsCaptured !== true) {
    warn(
      'system-boundary-history',
      'Actual System-left column capture is unavailable. System boundaries are not inferred from note or measure order.',
    );

    return [];
  }

  const stages = document.events.filter((e) => e.kind === 'finalLayout');

  if (
    stages.length !== 1 ||
    stages[0]!.status !== 'complete' ||
    stages[0]!.stage !== 'book' ||
    stages[0]!.attempted !== true
  ) {
    warn(
      'system-boundary-capture',
      'A uniquely completed normal-book layout is required for actual System-left column ownership.',
    );

    return [];
  }

  if (
    !orderedStaffs.length ||
    orderedStaffs.some((s) => !positiveId(s)) ||
    new Set(orderedStaffs).size !== orderedStaffs.length
  ) {
    warn(
      'system-boundary-ownership',
      'Native staff ownership is empty, duplicated or invalid. No source System boundary is selected.',
    );

    return [];
  }

  const staffs = new Set(orderedStaffs),
    groups = new Map<number, MeasureLayoutEvent[]>(),
    identities = new Map<string, number>();

  for (const row of rows) {
    const identity = `${row.id}:${row.piece}`;

    identities.set(identity, (identities.get(identity) ?? 0) + 1);

    if (!positiveId(row.system)) {
      warn(
        'system-boundary-data',
        'A captured measure segment lacks a valid System identity; it cannot establish a System boundary.',
      );
      continue;
    }

    const group = groups.get(row.system) ?? [];

    group.push(row);
    groups.set(row.system, group);
  }

  const valid = (row: MeasureLayoutEvent) => {
    if (
      !positiveId(row.id) ||
      !positiveId(row.piece) ||
      identities.get(`${row.id}:${row.piece}`) !== 1 ||
      !positiveId(row.staff) ||
      !staffs.has(row.staff) ||
      typeof row.firstOnSystem !== 'boolean' ||
      typeof row.lastOnSystem !== 'boolean' ||
      !validMoment(row.moment) ||
      !validMoment(row.endMoment) ||
      !validMoment(row.columnMoment) ||
      !validMoment(row.endColumnMoment) ||
      row.moment.grace.numerator !== 0 ||
      row.endMoment.grace.numerator !== 0 ||
      compareRational(row.moment.main, row.endMoment.main) > 0 ||
      compareRational(row.moment.main, row.columnMoment.main) !== 0 ||
      compareRational(row.endMoment.main, row.endColumnMoment.main) !== 0 ||
      compareMoment(row.columnMoment, row.endColumnMoment) >= 0 ||
      !finite(row.startXTenths) ||
      !finite(row.endXTenths) ||
      !finite(row.widthTenths) ||
      row.widthTenths <= 0 ||
      !finite(row.systemLeftXTenths) ||
      !finite(row.systemRightXTenths) ||
      row.systemRightXTenths <= row.systemLeftXTenths ||
      !finite(row.layoutStaffSpace) ||
      row.layoutStaffSpace <= 0 ||
      !finite(row.lineWidthTenths) ||
      row.lineWidthTenths <= 0 ||
      !close(row.endXTenths - row.startXTenths, row.widthTenths) ||
      row.startXTenths < row.systemLeftXTenths - 1e-7 ||
      row.endXTenths > row.systemRightXTenths + 1e-7 ||
      row.firstOnSystem !== close(row.startXTenths, row.systemLeftXTenths) ||
      row.lastOnSystem !== close(row.endXTenths, row.systemRightXTenths)
    ) {
      warn(
        'system-boundary-data',
        'A source segment has contradictory identities, full column moments or actual System coordinates. Its System boundary is omitted.',
      );

      return false;
    }

    return true;
  };
  const candidates: SystemBoundary[] = [];

  for (const [system, group] of [...groups].sort(([a], [b]) => a - b)) {
    // Inspect every row: ignoring malformed interior evidence could hide a duplicate LEFT owner.
    if (!group.map(valid).every(Boolean)) {
      continue;
    }

    const left = orderedStaffs.map((staff) =>
      group.filter((row) => row.staff === staff && row.firstOnSystem),
    );

    if (left.some((matches) => matches.length !== 1)) {
      warn(
        'system-boundary-ownership',
        'A source System lacks one unique actual LEFT column on every native staff. No nearby row is substituted.',
      );
      continue;
    }

    const first = left[0]![0]!;

    if (left.some((matches) => matches[0]!.columnMoment!.grace.numerator > 0)) {
      warn(
        'system-boundary-grace',
        'An actual System-left column has a positive grace Moment. No additional intra-measure print is placed from that column without proven native grace cursor ownership; independent whole-measure mappings remain available.',
      );
      continue;
    }

    if (
      !left.every(
        (matches) => compareMoment(first.columnMoment!, matches[0]!.columnMoment!) === 0,
      ) ||
      !group.every(
        (row) =>
          close(first.systemLeftXTenths!, row.systemLeftXTenths!) &&
          close(first.systemRightXTenths!, row.systemRightXTenths!) &&
          close(first.layoutStaffSpace!, row.layoutStaffSpace!) &&
          close(first.lineWidthTenths!, row.lineWidthTenths!),
      )
    ) {
      warn(
        'system-boundary-ownership',
        "Native staves disagree about their actual System-left full Moment or physical box. No staff's boundary is chosen arbitrarily.",
      );
      continue;
    }

    candidates.push({
      moment: first.columnMoment!,
      system,
      box: {
        left: first.systemLeftXTenths!,
        right: first.systemRightXTenths!,
        layoutStaffSpace: first.layoutStaffSpace!,
      },
    });
  }

  // Reject both sides of a temporal contradiction rather than selecting an arbitrary sequence.
  const unordered = new Set<SystemBoundary>();
  let maximum: SystemBoundary | undefined;

  for (const row of candidates) {
    if (maximum && compareMoment(maximum.moment, row.moment) >= 0) {
      unordered.add(row);
    }

    if (!maximum || compareMoment(row.moment, maximum.moment) > 0) {
      maximum = row;
    }
  }

  let minimum: SystemBoundary | undefined;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const row = candidates[i]!;

    if (minimum && compareMoment(row.moment, minimum.moment) >= 0) {
      unordered.add(row);
    }

    if (!minimum || compareMoment(row.moment, minimum.moment) < 0) {
      minimum = row;
    }
  }

  if (unordered.size) {
    warn(
      'system-boundary-order',
      'Actual System identities have coincident or reversed boundary Moments. Conflicting Systems are omitted without reordering source ownership.',
    );
  }

  return candidates.filter((row) => !unordered.has(row));
}
