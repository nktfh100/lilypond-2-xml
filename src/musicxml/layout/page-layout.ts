import type { Moment } from '@sightread/lilypond-eventdocument';
import { coordinatesRelativelyNear as close } from './geometry.js';
import type { Attributes } from '../types.js';
import type { Warn } from '../../model/diagnostics.js';
import { compareMoments as compareMoment, isMoment as validMoment } from '../../model/time.js';
import { planStaffLines, type StaffLinePlan } from './staff-lines.js';
import type { PageSystemLayout, ScoreDocument } from '../../model/document.js';

export interface PageLayoutFrame {
  readonly attrs: Attributes;
  readonly firstOnPage: boolean;
  readonly source: PageSystemLayout;
  /** Standalone exported page ordinal, independent of source displayed numbering. */
  readonly nativePage: number;
  readonly page: {
    width: number;
    height: number;
    top: number;
    bottom: number;
    left: number;
    right: number;
  } | null;
  readonly topSystemDistance: number | null;
  readonly systemDistance: number | null;
  /** Source staff IDs, including the first staff of a later native part. */
  readonly staffDistances: ReadonlyMap<number, number>;
  readonly systemMargins: (
    leftXTenths: number,
    rightXTenths: number,
    layoutStaffSpace: number,
  ) => { left: number; right: number } | null;
}
export interface PageLayoutOptions {
  /** Systems that will actually have native print positions; omitted Systems remain source metadata. */
  readonly activeSystems?: ReadonlySet<number>;
  /** The writer's final clef-guarded grid, not a second interpretation of visible ink. */
  readonly gridForSystem: (staff: number, system: number) => StaffLinePlan | null;
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const difference = (a: number, b: number): number | null => (finite(a - b) ? a - b : null);

type StaffPiece = PageSystemLayout['staves'][number];
const hasPieceIdentity = (s: StaffPiece) =>
  s.originalId !== undefined ||
  s.piece !== undefined ||
  s.startMoment !== undefined ||
  s.endMoment !== undefined;

function samePageFrame(a: PageSystemLayout, b: PageSystemLayout): boolean {
  return [
    'outputScale',
    'width',
    'height',
    'topMargin',
    'bottomMargin',
    'leftMargin',
    'rightMargin',
    'displayedPage',
  ].every((k) => {
    const x = a[k as keyof PageSystemLayout],
      y = b[k as keyof PageSystemLayout];

    return finite(x) && finite(y) ? close(x, y) : x === y;
  });
}

function pageFrameInTenths(
  row: PageSystemLayout,
  tenthsPerSourceUnit: number | null,
): PageLayoutFrame['page'] {
  const fullPage =
    tenthsPerSourceUnit !== null &&
    positive(row.width) &&
    positive(row.height) &&
    [row.topMargin, row.bottomMargin, row.leftMargin, row.rightMargin].every(finite) &&
    row.width > row.leftMargin! + row.rightMargin! &&
    row.height > row.topMargin! + row.bottomMargin!;
  const convertedPage = fullPage
    ? {
        width: row.width! * tenthsPerSourceUnit!,
        height: row.height! * tenthsPerSourceUnit!,
        top: row.topMargin! * tenthsPerSourceUnit!,
        bottom: row.bottomMargin! * tenthsPerSourceUnit!,
        left: row.leftMargin! * tenthsPerSourceUnit!,
        right: row.rightMargin! * tenthsPerSourceUnit!,
      }
    : null;

  return convertedPage && Object.values(convertedPage).every(finite) ? convertedPage : null;
}

interface LogicalStaffFrame {
  readonly top: number;
  readonly bottom: number;
  readonly baseline: number;
  readonly staffSpace: number;
  readonly layoutStaffSpace: number;
}

/** Verify member ownership and pitch lattice before projecting its logical bounds. */
function staffMemberFrameInTenths(
  piece: StaffPiece,
  grid: StaffLinePlan | null,
  tenthsPerSourceUnit: number | null,
  badOriginals: ReadonlySet<number>,
  warn: Warn,
): LogicalStaffFrame | null {
  if (hasPieceIdentity(piece)) {
    if (!integer(piece.originalId) || !integer(piece.piece) || badOriginals.has(piece.originalId)) {
      warn(
        'page-layout-piece-ownership',
        'Actual staff original/member identities are malformed, duplicated or assigned to conflicting staff owners; no member is chosen arbitrarily.',
      );

      return null;
    }

    if (
      !validMoment(piece.startMoment) ||
      !validMoment(piece.endMoment) ||
      compareMoment(piece.startMoment, piece.endMoment) > 0
    ) {
      warn(
        'page-layout-piece-bounds',
        'An identified staff member lacks ordered actual bound-column full Moments. Its logical frame cannot establish the all-piece consensus.',
      );

      return null;
    }
  }

  if (
    piece.present !== true ||
    typeof piece.custom !== 'boolean' ||
    typeof piece.hidden !== 'boolean' ||
    !finite(piece.baselineY) ||
    !positive(piece.staffSpace) ||
    !positive(piece.layoutStaffSpace) ||
    !Array.isArray(piece.linePositions) ||
    piece.linePositions.some((p: number) => !finite(p)) ||
    tenthsPerSourceUnit === null ||
    !grid ||
    !grid.represented ||
    grid.legacy ||
    !integer(grid.logicalCount) ||
    !positive(grid.staffSizePercent) ||
    !close(piece.staffSpace * tenthsPerSourceUnit, (10 * grid.staffSizePercent) / 100)
  ) {
    return null;
  }

  const observed = planStaffLines({
    count: piece.linePositions.length,
    positions: piece.linePositions,
    staffSpace: piece.staffSpace,
    layoutStaffSpace: piece.layoutStaffSpace,
    hidden: piece.hidden,
    present: true,
  });

  // Visibility and sparse drawn subsets do not change a known common pitch lattice.
  if (
    !observed.represented ||
    observed.logicalCount !== grid.logicalCount ||
    !close(observed.staffSizePercent, grid.staffSizePercent)
  ) {
    return null;
  }

  const ink = piece.inkOffset;

  if (
    piece.custom ||
    ink === null ||
    (ink !== undefined &&
      (!Array.isArray(ink) ||
        ink.length !== 2 ||
        ink.some((v) => !finite(v)) ||
        ink.some((v) => v !== 0)))
  ) {
    warn(
      'page-layout-staff-ink',
      'Known native logical staff frames retain their source pitch-grid distances. Custom staff drawing or unresolved/nonzero ink-only StaffSymbol offsets are not mapped as staff-baseline movement.',
    );
  }

  const half = ((grid.logicalCount - 1) * piece.staffSpace * tenthsPerSourceUnit) / 2;
  const top = piece.baselineY * tenthsPerSourceUnit - half,
    bottom = piece.baselineY * tenthsPerSourceUnit + half;

  if (!finite(top) || !finite(bottom)) {
    return null;
  }

  return {
    top,
    bottom,
    baseline: piece.baselineY,
    staffSpace: piece.staffSpace,
    layoutStaffSpace: piece.layoutStaffSpace,
  };
}

/** Accept a logical frame only when every actual member proves the same grid. */
function agreedStaffFrame(
  matches: readonly StaffPiece[],
  grid: StaffLinePlan | null,
  tenthsPerSourceUnit: number | null,
  badOriginals: ReadonlySet<number>,
  warn: Warn,
): LogicalStaffFrame | null {
  if (matches.length > 1 && matches.some((piece) => !hasPieceIdentity(piece))) {
    warn(
      'page-layout-piece-history',
      'Repeated staff frames lack actual original/member identities. Legacy duplicate rows cannot establish an all-piece logical consensus.',
    );

    return null;
  }

  let common: LogicalStaffFrame | null = null;
  const ranges = {
    baseline: [Infinity, -Infinity],
    staffSpace: [Infinity, -Infinity],
    layoutStaffSpace: [Infinity, -Infinity],
  };
  let complete = true;

  for (const piece of matches) {
    const candidate = staffMemberFrameInTenths(
      piece,
      grid,
      tenthsPerSourceUnit,
      badOriginals,
      warn,
    );

    if (!candidate) {
      complete = false;
      break;
    }

    for (const name of ['baseline', 'staffSpace', 'layoutStaffSpace'] as const) {
      const range = ranges[name];

      range[0] = Math.min(range[0]!, candidate[name]);
      range[1] = Math.max(range[1]!, candidate[name]);

      if (!close(range[0]!, range[1]!)) {
        complete = false;
      }
    }

    if (!complete) {
      break;
    }

    common ??= candidate;
  }

  if (complete && common) {
    const spans = matches
      .filter((piece) => validMoment(piece.startMoment) && validMoment(piece.endMoment))
      .sort((a, b) => compareMoment(a.startMoment!, b.startMoment!));
    let priorEnd: Moment | null = null;

    for (const piece of spans) {
      if (compareMoment(piece.startMoment!, piece.endMoment!) === 0) {
        continue;
      }

      if (priorEnd && compareMoment(piece.startMoment!, priorEnd) < 0) {
        warn(
          'page-layout-piece-overlap',
          'Actual staff members have overlapping bound-column Moment spans. Their independently common logical frame is retained; overlapping line ink and endpoint fitting are not reconstructed from these spans.',
        );
        break;
      }

      if (!priorEnd || compareMoment(piece.endMoment!, priorEnd) > 0) {
        priorEnd = piece.endMoment!;
      }
    }

    return common;
  } else if (matches.length > 1) {
    warn(
      'page-layout-staff-consensus',
      'Not every actual StaffSymbol member agrees on one resolved logical baseline, spacing and native pitch grid within this System. No initial, final or visible member supplies a guessed frame.',
    );
  }

  return null;
}

/** Actual source pages provide physical frames; musical boundary ownership stays with the caller. */
export function pageLayoutPlan(
  document: ScoreDocument,
  orderedStaffs: readonly number[],
  warn: Warn,
  options: PageLayoutOptions,
): {
  at: (system: number) => PageLayoutFrame | null;
} {
  const empty = { at: (_system: number): PageLayoutFrame | null => null };

  if (!document.pageLayoutsCaptured) {
    if (document.pageLayouts?.length) {
      warn(
        'page-layout-history',
        'Source page rows lack confirmed capture provenance; native page geometry is not inferred.',
      );
    }

    return empty;
  }

  const stages = document.events.filter((e) => e.kind === 'finalLayout');

  if (
    stages.length !== 1 ||
    stages[0]!.status !== 'complete' ||
    stages[0]!.stage !== 'book' ||
    stages[0]!.attempted !== true
  ) {
    warn(
      'page-layout-capture',
      'Completed normal-book page capture is unavailable; native page geometry is not invented.',
    );

    return empty;
  }

  if (document.pageLayouts !== undefined && !Array.isArray(document.pageLayouts)) {
    warn(
      'page-layout-data',
      'Cached source page rows are not an array; native page geometry is omitted.',
    );

    return empty;
  }

  const rows = document.pageLayouts ?? [];

  if (!rows.length) {
    return empty;
  }

  if (
    !orderedStaffs.length ||
    new Set(orderedStaffs).size !== orderedStaffs.length ||
    orderedStaffs.some((s) => !integer(s))
  ) {
    warn(
      'page-layout-ownership',
      'Native staff ordering is ambiguous; source page geometry cannot be assigned.',
    );

    return empty;
  }

  const staffSpace = document.paper?.['staff-space'];

  if (!positive(staffSpace)) {
    warn(
      'page-layout-data',
      'The global physical staff-space is unavailable; source page units cannot become MusicXML tenths.',
    );

    return empty;
  }

  const bySystem = new Map<number, PageSystemLayout>();
  let lastSystem = 0,
    lastPage = 0;
  const owner = rows[0]!;

  for (const row of rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      ![row.book, row.scope, row.page, row.system].every(integer) ||
      !Number.isSafeInteger(row.bookpart) ||
      row.bookpart < 0 ||
      row.system !== lastSystem + 1 ||
      row.page < lastPage ||
      row.book !== owner.book ||
      row.bookpart !== owner.bookpart ||
      row.scope !== owner.scope ||
      !Array.isArray(row.staves) ||
      bySystem.has(row.system) ||
      (row.displayedPage !== null && !Number.isSafeInteger(row.displayedPage))
    ) {
      warn(
        'page-layout-ownership',
        'Cached source page/system identities are duplicate, unordered or cross paper-book scopes; no arbitrary page owner is selected.',
      );

      return empty;
    }

    bySystem.set(row.system, row);
    lastSystem = row.system;
    lastPage = row.page;
  }

  // A genuine original can span Systems, but cannot change owner or reuse a printed member.
  const pieceCounts = new Map<string, number>(),
    originalOwners = new Map<number, number>(),
    badOriginals = new Set<number>();

  for (const row of rows) {
    for (const s of row.staves) {
      if (!s || typeof s !== 'object' || !integer(s.originalId) || !integer(s.piece)) {
        continue;
      }

      const id = `${s.originalId}:${s.piece}`;

      pieceCounts.set(id, (pieceCounts.get(id) ?? 0) + 1);

      if ((pieceCounts.get(id) ?? 0) > 1 || !integer(s.staff)) {
        badOriginals.add(s.originalId);
      }

      const owner = originalOwners.get(s.originalId);

      if (owner !== undefined && owner !== s.staff) {
        badOriginals.add(s.originalId);
      } else {
        originalOwners.set(s.originalId, s.staff);
      }
    }
  }

  // A source physical page can contain other scores or markup; standalone output renumbers only its own pages.
  const pageOrdinal = new Map<number, number>();
  const pageRows = new Map<number, PageSystemLayout>();

  for (const row of rows) {
    const first = pageRows.get(row.page);

    if (first && !samePageFrame(first, row)) {
      warn(
        'page-layout-ownership',
        'Systems assigned to one source page disagree on its physical frame; no page geometry is selected.',
      );

      return empty;
    }

    if (!first) {
      pageRows.set(row.page, row);
      pageOrdinal.set(row.page, pageOrdinal.size + 1);
    }
  }

  const activeRows = rows.filter((row) => options.activeSystems?.has(row.system) ?? true);

  pageOrdinal.clear();

  for (const row of activeRows) {
    if (!pageOrdinal.has(row.page)) {
      pageOrdinal.set(row.page, pageOrdinal.size + 1);
    }
  }

  if (activeRows.some((r, i) => i > 0 && r.page > activeRows[i - 1]!.page + 1)) {
    warn(
      'page-layout-content',
      "Source pages without this score's systems are not recreated as invented blank native pages.",
    );
  }

  const frames = new Map<number, PageLayoutFrame>();
  let previous: { row: PageSystemLayout; bottom: number | null } | null = null;

  for (const row of activeRows) {
    const convertedScale = positive(row.outputScale) ? (row.outputScale * 10) / staffSpace : null;
    const tenthsPerSourceUnit = positive(convertedScale) ? convertedScale : null;
    const page = pageFrameInTenths(row, tenthsPerSourceUnit);

    if (!page) {
      warn(
        'page-layout-data',
        'A source page has unresolved physical dimensions or margins; available page boundaries are retained without guessed distances.',
      );
    }

    const firstOnPage = previous === null || previous.row.page !== row.page;
    const attrs: Attributes = {};

    if (firstOnPage && (previous !== null || row.displayedPage !== null)) {
      attrs['new-page'] = 'yes';
    } else if (previous !== null) {
      attrs['new-page'] = 'no';
      attrs['new-system'] = 'yes';
    }

    if (firstOnPage && row.displayedPage !== null) {
      attrs['page-number'] = row.displayedPage;
    }

    const staffDistances = new Map<number, number>();
    const bounds = new Map<number, { top: number; bottom: number }>();
    const unknownStaff = row.staves.some(
      (s: PageSystemLayout['staves'][number]) =>
        !s || typeof s !== 'object' || !integer(s.staff) || !orderedStaffs.includes(s.staff),
    );

    if (unknownStaff) {
      warn(
        'page-layout-ownership',
        'Actual source staff frames cannot all be joined to native staff ownership; no source vertical frame is selected arbitrarily.',
      );
    }

    if (!unknownStaff) {
      for (const staff of orderedStaffs) {
        const matches: readonly StaffPiece[] = row.staves.filter(
          (s: StaffPiece) => s.staff === staff,
        );
        const grid = options.gridForSystem(staff, row.system);

        if (!matches.length) {
          continue;
        }

        const common = agreedStaffFrame(matches, grid, tenthsPerSourceUnit, badOriginals, warn);

        if (common) {
          bounds.set(staff, common);
        }
      }
    }

    if (bounds.size !== orderedStaffs.length) {
      warn(
        'page-layout-staves',
        'A native logical staff frame lacks an actual resolved source baseline or matching represented grid; only distances with independently known endpoint frames are retained.',
      );
    }

    for (let i = 1; i < orderedStaffs.length; i++) {
      const current = bounds.get(orderedStaffs[i]!),
        prior = bounds.get(orderedStaffs[i - 1]!);

      if (current && prior) {
        const gap = difference(current.top, prior.bottom);

        if (gap !== null) {
          staffDistances.set(orderedStaffs[i]!, gap);
        } else {
          warn('page-layout-data', 'A converted staff distance is nonfinite and is omitted.');
        }
      }
    }

    const top = bounds.get(orderedStaffs[0]!)?.top ?? null,
      bottom = bounds.get(orderedStaffs[orderedStaffs.length - 1]!)?.bottom ?? null;
    const topSystemDistance =
      firstOnPage && top !== null && page !== null ? difference(top, page.top) : null;
    const systemDistance =
      !firstOnPage && top !== null && previous?.bottom != null
        ? difference(top, previous.bottom)
        : null;

    frames.set(row.system, {
      attrs,
      firstOnPage,
      source: row,
      nativePage: pageOrdinal.get(row.page)!,
      page,
      topSystemDistance,
      systemDistance,
      staffDistances,
      systemMargins: (left, right, layoutStaffSpace) => {
        if (
          !page ||
          tenthsPerSourceUnit === null ||
          !finite(row.systemX) ||
          !finite(left) ||
          !finite(right) ||
          right <= left ||
          !positive(layoutStaffSpace) ||
          !close(layoutStaffSpace * tenthsPerSourceUnit, 10)
        ) {
          warn(
            'page-layout-horizontal',
            'Source page and measure-box coordinates lack a common proven physical frame; existing native measure widths are retained without page-relative margin guesses.',
          );

          return null;
        }

        const margins = {
          left: row.systemX * tenthsPerSourceUnit + left - page.left,
          right: page.width - page.right - (row.systemX * tenthsPerSourceUnit + right),
        };

        if (!Object.values(margins).every(finite)) {
          warn(
            'page-layout-horizontal',
            'A converted source page margin is nonfinite and is omitted.',
          );

          return null;
        }

        return margins;
      },
    });
    previous = { row, bottom };
  }

  return { at: (system) => frames.get(system) ?? null };
}
