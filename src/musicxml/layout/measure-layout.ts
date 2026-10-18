import type { Moment } from '@sightread/lilypond-eventdocument';
import type { Attributes } from '../types.js';
import type { Warn } from '../../model/diagnostics.js';
import {
  compareRational,
  momentKey as key,
  rationalKey,
  isMoment as validMoment,
} from '../../model/time.js';
import type { MeasureLayoutEvent, ScoreDocument } from '../../model/document.js';

const sameMain = (a: Moment, b: Moment) => rationalKey(a.main) === rationalKey(b.main);
const finite = (n: number | null): n is number => typeof n === 'number' && Number.isFinite(n);
const close = (a: number, b: number) => Math.abs(a - b) < 1e-7;
const sameMeasureSystemBox = (a: MeasureLayoutEvent, b: MeasureLayoutEvent) =>
  close(a.widthTenths!, b.widthTenths!) &&
  a.system === b.system &&
  close(a.startXTenths!, b.startXTenths!) &&
  close(a.endXTenths!, b.endXTenths!) &&
  a.firstOnSystem === b.firstOnSystem &&
  a.lastOnSystem === b.lastOnSystem &&
  close(a.systemLeftXTenths!, b.systemLeftXTenths!) &&
  close(a.systemRightXTenths!, b.systemRightXTenths!) &&
  close(a.lineWidthTenths!, b.lineWidthTenths!);

interface NativeInterval {
  readonly end: Moment;
  readonly freeFragment: boolean;
}

export interface MeasureLayoutPlan {
  readonly attributes: (
    start: Moment,
    end: Moment,
    staves: readonly number[],
    interval?: NativeInterval,
  ) => Attributes;
  readonly printAttributes: (
    start: Moment,
    staves: readonly number[],
    interval?: NativeInterval,
  ) => Attributes;
  readonly systemMargins: (
    start: Moment,
    staves: readonly number[],
    pageContentWidth: number | null,
    interval?: NativeInterval,
  ) => { left: number; right: number } | null;
  readonly system: (
    start: Moment,
    staves: readonly number[],
    interval?: NativeInterval,
  ) => number | null;
  readonly systemBox: (
    start: Moment,
    staves: readonly number[],
    interval?: NativeInterval,
  ) => { left: number; right: number; layoutStaffSpace: number } | null;
}

/** Source measure boxes use their actual columns, never first/last-note ink. */
export function measureLayoutPlan(document: ScoreDocument, warn: Warn): MeasureLayoutPlan {
  const rows = document.events.filter((e) => e.kind === 'measureLayout');
  const none: MeasureLayoutPlan = {
    attributes: () => ({}),
    printAttributes: () => ({}),
    systemMargins: () => null,
    system: () => null,
    systemBox: () => null,
  };

  if (!document.measureLayoutsCaptured) {
    if (rows.length || document.events.some((e) => e.kind === 'note')) {
      warn(
        'measure-layout-history',
        'Actual completed source measure boxes are unavailable in this document. Native measure widths and automatic system boundaries are not inferred from note positions or durations.',
      );
    }

    return none;
  }

  if (document.events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'measure-layout-capture',
      'Final source layout failed; no source measure width or system box is invented.',
    );

    return none;
  }

  const byStart = new Map<string, MeasureLayoutEvent[]>();
  const identities = new Map<string, number>();

  for (const row of rows) {
    const identity = `${row.id}:${row.piece}`;

    identities.set(identity, (identities.get(identity) ?? 0) + 1);

    if (!validMoment(row.moment)) {
      warn(
        'measure-layout-data',
        'A cached measure box has an invalid full Moment; it cannot own native geometry.',
      );
      continue;
    }

    const k = key(row.moment),
      previous = byStart.get(k);

    if (previous) {
      previous.push(row);
    } else {
      byStart.set(k, [row]);
    }
  }

  const acceptsNativeMeasureBox = (row: MeasureLayoutEvent, freeFragment: boolean) => {
    const uniqueOwnedBox = !(
      !Number.isSafeInteger(row.id) ||
      row.id < 1 ||
      !Number.isSafeInteger(row.piece) ||
      row.piece < 1 ||
      identities.get(`${row.id}:${row.piece}`) !== 1 ||
      !Number.isSafeInteger(row.staff) ||
      !Number.isSafeInteger(row.system) ||
      row.system < 1 ||
      typeof row.firstOnSystem !== 'boolean' ||
      typeof row.lastOnSystem !== 'boolean'
    );
    const orderedColumnInterval =
      uniqueOwnedBox &&
      !(
        !validMoment(row.endMoment) ||
        !validMoment(row.columnMoment) ||
        !validMoment(row.endColumnMoment) ||
        row.moment.grace.numerator !== 0 ||
        row.endMoment.grace.numerator !== 0 ||
        compareRational(row.endMoment.main, row.moment.main) <= 0 ||
        !sameMain(row.columnMoment, row.moment) ||
        !sameMain(row.endColumnMoment, row.endMoment) ||
        row.columnMoment.grace.numerator > 0 ||
        row.endColumnMoment.grace.numerator > 0
      );
    const {
      widthTenths,
      startXTenths,
      endXTenths,
      layoutStaffSpace,
      lineWidthTenths,
      systemLeftXTenths,
      systemRightXTenths,
    } = row;
    const resolvedDimensions =
      orderedColumnInterval &&
      !(
        !finite(widthTenths) ||
        widthTenths <= 0 ||
        !finite(startXTenths) ||
        !finite(endXTenths) ||
        !finite(layoutStaffSpace) ||
        layoutStaffSpace <= 0 ||
        !finite(lineWidthTenths) ||
        lineWidthTenths <= 0 ||
        !finite(systemLeftXTenths) ||
        !finite(systemRightXTenths) ||
        systemRightXTenths <= systemLeftXTenths
      );
    const agreesWithSystemBox =
      resolvedDimensions &&
      !(
        !close(endXTenths - startXTenths, widthTenths) ||
        startXTenths < systemLeftXTenths - 1e-7 ||
        endXTenths > systemRightXTenths + 1e-7 ||
        row.firstOnSystem !== close(startXTenths, systemLeftXTenths) ||
        row.lastOnSystem !== close(endXTenths, systemRightXTenths)
      );

    if (!agreesWithSystemBox) {
      warn(
        'measure-layout-data',
        'A source measure box has invalid or contradictory identities, column moments, dimensions or system references. No partial width is guessed.',
      );

      return false;
    }

    const ownsNativeBoundaries = freeFragment
      ? ['measure', 'system'].includes(row.startKind) &&
        ['measure', 'system', 'terminal'].includes(row.endKind)
      : row.startKind === 'measure' && ['measure', 'terminal'].includes(row.endKind);

    if (!ownsNativeBoundaries) {
      warn(
        'measure-layout-boundary',
        'A system cuts through a source measure, or its boundary lacks actual measure ownership. Its segment geometry remains metadata instead of a whole native measure width.',
      );

      return false;
    }

    return true;
  };
  const select = (start: Moment, staves: readonly number[], end?: Moment, freeFragment = false) => {
    if (!validMoment(start) || (end && !validMoment(end)) || !staves.length) {
      return null;
    }

    const candidates = byStart.get(key(start)) ?? [],
      selected: MeasureLayoutEvent[] = [];

    for (const staff of staves) {
      const matches = candidates.filter(
        (row) =>
          row.staff === staff &&
          (!end || (validMoment(row.endMoment) && key(row.endMoment) === key(end))),
      );

      if (matches.length !== 1) {
        warn(
          'measure-layout-boundary',
          'This native measure has no unique actual source box on every staff. Split, polymetric, missing or duplicated intervals retain automatic widths.',
        );

        return null;
      }

      const row = matches[0]!;

      if (!acceptsNativeMeasureBox(row, freeFragment && end !== undefined)) {
        return null;
      }

      selected.push(row);
    }

    const first = selected[0]!;
    const stavesAgree = selected.every(
      (row) => key(row.endMoment) === key(first.endMoment) && sameMeasureSystemBox(first, row),
    );

    if (!stavesAgree) {
      warn(
        'measure-layout-ownership',
        "The staves of a native part disagree about their actual source measure/system boxes. No staff's dimensions are selected arbitrarily.",
      );

      return null;
    }

    return first;
  };
  const reportLayoutLimits = () =>
    warn(
      'measure-layout-fitting',
      'Native widths, system boundaries and horizontal system margins retain actual source boxes; full page/vertical layout and detailed descendant fitting remain partial.',
    );

  return {
    systemBox(start, staves, interval) {
      const row = select(start, staves, interval?.end, interval?.freeFragment);

      return row?.firstOnSystem
        ? {
            left: row.systemLeftXTenths!,
            right: row.systemRightXTenths!,
            layoutStaffSpace: row.layoutStaffSpace!,
          }
        : null;
    },
    system(start, staves, interval) {
      return select(start, staves, interval?.end, interval?.freeFragment)?.system ?? null;
    },
    attributes(start, end, staves, interval) {
      const row = select(
        start,
        staves,
        end,
        interval?.freeFragment && validMoment(interval.end) && key(interval.end) === key(end),
      );

      if (!row) {
        return {};
      }

      reportLayoutLimits();

      return { width: row.widthTenths! };
    },
    printAttributes(start, staves, interval) {
      const row = select(start, staves, interval?.end, interval?.freeFragment);

      if (!row) {
        return {};
      }

      reportLayoutLimits();

      return row.system === 1 && row.firstOnSystem
        ? {}
        : { 'new-system': row.firstOnSystem ? 'yes' : 'no' };
    },
    systemMargins(start, staves, pageContentWidth, interval) {
      const row = select(start, staves, interval?.end, interval?.freeFragment);

      if (!row || !row.firstOnSystem) {
        return null;
      }

      if (!finite(pageContentWidth) || pageContentWidth <= 0) {
        warn(
          'measure-layout-page',
          'The native page content width is unavailable or invalid. Source system boxes remain metadata instead of margins in an unproven page reference frame.',
        );

        return null;
      }

      reportLayoutLimits();

      return {
        left: row.systemLeftXTenths!,
        right: pageContentWidth - row.systemRightXTenths!,
      };
    },
  };
}
