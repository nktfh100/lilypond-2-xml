/** Resolved StaffSymbol geometry. Positions use LilyPond half-staff-space units. */
export interface StaffLineGeometry {
  readonly count: number;
  readonly positions?: readonly number[] | null;
  readonly staffSpace?: number;
  readonly layoutStaffSpace?: number;
  readonly hidden?: boolean;
  readonly custom?: boolean;
  readonly present?: boolean;
}

export interface StaffLinePlan {
  readonly represented: boolean;
  readonly legacy: boolean;
  readonly reason?: string;
  /** Includes the hidden lines that maintain the original pitch-position grid. */
  readonly logicalCount: number;
  readonly visibleLines: readonly number[];
  readonly clefLineShift: number;
  readonly percussionDiatonicShift: number;
  readonly staffSizePercent: number;
  readonly centerY: number;
}

/** Pure geometry plan; the caller owns diagnostics and the active clef history. */
export function planStaffLines(event: StaffLineGeometry): StaffLinePlan {
  const legacy = event.positions === undefined && event.present === undefined;
  const measuredRatio =
    event.staffSpace !== undefined && event.layoutStaffSpace !== undefined
      ? event.staffSpace / event.layoutStaffSpace
      : 1;
  const validSpace = Number.isFinite(measuredRatio) && measuredRatio > 0;
  const ratio = validSpace ? measuredRatio : 1;
  const result = (
    n: number,
    visibleLines: readonly number[],
    represented = true,
    reason?: string,
  ): StaffLinePlan => ({
    represented,
    legacy,
    ...(reason ? { reason } : {}),
    logicalCount: n,
    visibleLines: event.hidden ? [] : visibleLines,
    clefLineShift: legacy ? 0 : (n - 5) / 2,
    percussionDiatonicShift: legacy ? 0 : n - 5,
    staffSizePercent: 100 * ratio,
    centerY: -5 * (n - 1) * ratio,
  });

  if (!validSpace) {
    return result(5, [1, 2, 3, 4, 5], false, 'invalid-staff-space');
  }

  if (legacy) {
    if (!Number.isSafeInteger(event.count) || event.count < 0) {
      return result(5, [1, 2, 3, 4, 5], false, 'invalid-count');
    }

    return result(
      event.count,
      Array.from({ length: event.hidden ? 0 : event.count }, (_, i) => i + 1),
    );
  }

  // A missing StaffSymbol has the standard pitch grid but no staff-line ink.
  if (event.present === false) {
    return result(5, []);
  }

  const positions = event.positions;

  if (!positions) {
    return result(5, [1, 2, 3, 4, 5], false, 'unknown-line-positions');
  }

  if (!positions.length) {
    return result(5, []);
  }

  if (positions.some((p) => !Number.isSafeInteger(p))) {
    return result(5, [1, 2, 3, 4, 5], false, 'fractional-line-positions');
  }

  const parity = Math.abs(positions[0]!) % 2;

  if (positions.some((p) => Math.abs(p) % 2 !== parity)) {
    return result(5, [1, 2, 3, 4, 5], false, 'mixed-line-position-grid');
  }

  const n = Math.max(...positions.map(Math.abs)) + 1;
  // Source line position p maps to native line (p + N + 1)/2.
  const lines = event.hidden
    ? []
    : [...new Set(positions)].map((p) => (p + n + 1) / 2).sort((a, b) => a - b);

  return result(n, lines);
}

/** A native G/F/C clef needs an integral line on the selected logical grid. */
export function staffLineClefLine(sourcePosition: number, plan: StaffLinePlan): number | null {
  const line = (sourcePosition + 6) / 2 + plan.clefLineShift;

  return Number.isSafeInteger(line) ? line : null;
}

/** Use the same logical lattice for staff details and page-distance references. */
export function planStaffLinesWithClef(
  event: StaffLineGeometry,
  clef?: { glyph?: string | null; position: number },
): StaffLinePlan {
  const plan = planStaffLines(event);

  return !plan.legacy &&
    plan.represented &&
    clef &&
    ['clefs.G', 'clefs.F', 'clefs.C'].includes(clef.glyph ?? '') &&
    (plan.logicalCount % 2 === 0 || staffLineClefLine(clef.position, plan) === null)
    ? {
        ...plan,
        logicalCount: 5,
        visibleLines: event.hidden ? [] : [1, 2, 3, 4, 5],
        clefLineShift: 0,
        percussionDiatonicShift: 0,
        centerY: (-20 * plan.staffSizePercent) / 100,
        represented: false,
        reason: 'unresolved-clef-pitch-grid',
      }
    : plan;
}
