import type { Moment } from '@sightread/lilypond-eventdocument';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Attributes } from '../types.js';
import { type Event, type NameState, required } from '../planning/events.js';
import {
  compareRational,
  isMoment,
  sameMoments,
  eventGraceTime,
  eventTime,
  rationalValue,
} from '../../model/time.js';
import { pageLayoutPlan } from '../layout/page-layout.js';
import { writePaper } from '../layout/paper.js';
import type { Part } from '../planning/parts.js';
import { planStaffLinesWithClef } from '../layout/staff-lines.js';
import { systemBoundaries } from '../layout/system-boundaries.js';
import { scoreTiming } from '../planning/timing.js';
import { createGapWriter } from './gap-writer.js';
import { createNativeAnchors } from './native-anchors.js';
import type { ScoreWritingContext } from '../context.js';

export function createLayoutSession(
  context: ScoreWritingContext,
  pageSettings: ReturnType<typeof writePaper>,
) {
  const { document, warn } = context;
  const { tick, ticks, labels, finish, parts, events, boundaries, measureLayouts } = context.plan;
  const anchors = createNativeAnchors(labels, finish);
  const { registerLabelSibling } = anchors;
  const deferredNameUpdates = new Set<NameState>();
  const labelMoment = (at: number): Moment => ({
    main: { numerator: tick(at), denominator: ticks },
    grace: { numerator: 0, denominator: 1 },
  });
  const sourceSystemBoundaries = systemBoundaries(
    document,
    parts.flatMap((part) => part.staves),
    warn,
  );
  const sourceBoundaryBySystem = new Map(sourceSystemBoundaries.map((b) => [b.system, b]));
  const graceCursorSystems = new Set(
    sourceSystemBoundaries
      .filter(
        (b) =>
          b.moment.grace.numerator === 0 &&
          events.some(
            (e) =>
              eventGraceTime(e) !== 0 && tick(eventTime(e)) === tick(rationalValue(b.moment.main)),
          ),
      )
      .map((b) => b.system),
  );
  const systemBoundaryTicks = new Map<number, (typeof sourceSystemBoundaries)[number][]>();

  for (const boundary of sourceSystemBoundaries) {
    const position = tick(rationalValue(boundary.moment.main));

    if (
      !Number.isSafeInteger(position) ||
      compareRational({ numerator: position, denominator: ticks }, boundary.moment.main) !== 0
    ) {
      continue;
    }

    const bucket = systemBoundaryTicks.get(position) ?? [];

    bucket.push(boundary);
    systemBoundaryTicks.set(position, bucket);
  }

  const registerSystemCursor = (
    part: Part,
    node: XMLBuilder,
    at: number,
    print?: XMLBuilder,
    actualMoment?: Moment,
  ): boolean => {
    const position = tick(at),
      moment = actualMoment ?? {
        main: { numerator: position, denominator: ticks },
        grace: { numerator: 0, denominator: 1 },
      };

    if (!isMoment(moment)) {
      return false;
    }

    const boundary = systemBoundaryTicks.get(position)?.find((b) => sameMoments(b.moment, moment));

    if (
      !boundary ||
      (graceCursorSystems.has(boundary.system) &&
        !actualMoment &&
        events.some(
          (e) =>
            e.kind === 'note' &&
            part.staves.includes(e.staff ?? NaN) &&
            eventGraceTime(e) < 0 &&
            tick(eventTime(e)) === position,
        ))
    ) {
      return false;
    }

    anchors.registerSystem(boundary.system, part, node, print);

    return true;
  };
  const writeGap = createGapWriter({
    tick,
    ticksPerWholeNote: ticks,
    labels,
    systemBoundaryTicks,
    labelMoment,
    registerLabelSibling,
  });
  const partTimings = new Map(
    parts.map((part) => [
      part,
      scoreTiming({
        events,
        finish,
        time: eventTime,
        value: rationalValue,
        tick,
        ticksPerWholeNote: ticks,
        captured: document.barlinesCaptured,
        staves: part.staves,
      }),
    ]),
  );
  const sharedBoundaries = new Set(
    boundaries.filter((at) =>
      [...partTimings.values()].every((timing) => timing.boundaries.includes(at)),
    ),
  );
  const polymetricGrid = [...partTimings.values()].some(
    (timing) =>
      timing.independent &&
      (timing.boundaries.some((at) => !boundaries.includes(at)) ||
        boundaries.some((at) => !timing.boundaries.includes(at))),
  );

  const layoutMoment = (at: number): Moment => ({
    main: { numerator: tick(at), denominator: ticks },
    grace: { numerator: 0, denominator: 1 },
  });

  type MeasureGeometry = {
    attributes: Attributes;
    print: Attributes;
    margins: { left: number; right: number } | null;
    system: number | null;
    box: { left: number; right: number; layoutStaffSpace: number } | null;
  };
  const geometryCache = new Map<Part, Map<string, MeasureGeometry>>();
  const measureGeometry = (part: Part, start: number, end: number) => {
    const cache = geometryCache.get(part) ?? new Map<string, MeasureGeometry>();

    geometryCache.set(part, cache);
    const key = `${tick(start)}:${tick(end)}`,
      cached = cache.get(key);

    if (cached) {
      return cached;
    }

    const timing = required(partTimings.get(part), 'xml-layout-session.ts: partTimings.get(part)');
    const interval = {
      end: layoutMoment(end),
      freeFragment:
        timing.boundaries.includes(start) &&
        (timing.boundaries[timing.boundaries.indexOf(start) + 1] ?? finish) === end &&
        timing.free &&
        (timing.fragments.has(start) || timing.fragments.has(end)),
    };
    const at = layoutMoment(start),
      gracePrefix = sourceSystemBoundaries.some(
        (b) =>
          graceCursorSystems.has(b.system) && tick(rationalValue(b.moment.main)) === tick(start),
      );
    const attributes = gracePrefix
      ? {}
      : measureLayouts.attributes(at, interval.end, part.staves, interval);
    const result: MeasureGeometry =
      attributes.width === undefined
        ? { attributes, print: {}, margins: null, system: null, box: null }
        : {
            attributes,
            print: measureLayouts.printAttributes(at, part.staves, interval),
            margins: measureLayouts.systemMargins(
              at,
              part.staves,
              pageSettings
                ? pageSettings.page.width - pageSettings.page.left - pageSettings.page.right
                : null,
              interval,
            ),
            system: measureLayouts.system(at, part.staves, interval),
            box: measureLayouts.systemBox(at, part.staves, interval),
          };

    cache.set(key, result);

    return result;
  };
  const systemGeometryCache = new Map<
    number,
    Pick<MeasureGeometry, 'print' | 'margins' | 'system' | 'box'> | null
  >();
  const systemGeometry = (start: number) => {
    const key = tick(start);

    if (systemGeometryCache.has(key)) {
      return systemGeometryCache.get(key)!;
    }

    const all = parts.map((part) => {
      const boundaries = required(
          partTimings.get(part),
          'xml-layout-session.ts: partTimings.get(part)',
        ).boundaries,
        index = boundaries.indexOf(start);

      return index < 0 ? null : measureGeometry(part, start, boundaries[index + 1] ?? finish);
    });
    const first = all[0];
    const close = (a: number, b: number) => Math.abs(a - b) < 1e-7;
    const unanimous =
      !polymetricGrid &&
      first?.system != null &&
      all.every(
        (row) =>
          row?.system === first.system &&
          row.print['new-system'] === first.print['new-system'] &&
          ((row.margins === null && first.margins === null) ||
            (row.margins !== null &&
              first.margins !== null &&
              close(row.margins.left, first.margins.left) &&
              close(row.margins.right, first.margins.right))),
      );

    if (!unanimous) {
      if (all.some((row) => row?.system != null)) {
        warn(
          'measure-layout-parts',
          'Native parts do not share one uniquely captured source system at this exact measure boundary. Available per-part widths remain; no global system break or margin is selected from one part.',
        );
      }

      systemGeometryCache.set(key, null);

      return null;
    }

    const result = {
      print: first.print,
      margins: first.margins,
      system: first.system,
      box: first.box,
    };

    systemGeometryCache.set(key, result);

    return result;
  };
  const pageMeasureStarts = new Map<number, Set<number>>();

  for (const row of document.events.filter((e) => e.kind === 'measureLayout')) {
    if (row.firstOnSystem) {
      const starts = pageMeasureStarts.get(row.system) ?? new Set<number>();

      starts.add(eventTime(row));
      pageMeasureStarts.set(row.system, starts);
    }
  }

  const pageStaffLines = new Map<number, Extract<Event, { kind: 'staffLines' }>[]>();
  const pageClefs = new Map<number, Extract<Event, { kind: 'clef' }>[]>();

  for (const event of events) {
    if (event.kind === 'staffLines') {
      const rows = pageStaffLines.get(event.staff) ?? [];

      rows.push(event);
      pageStaffLines.set(event.staff, rows);
    }

    if (event.kind === 'clef') {
      const rows = pageClefs.get(event.staff) ?? [];

      rows.push(event);
      pageClefs.set(event.staff, rows);
    }
  }

  for (const rows of [...pageStaffLines.values(), ...pageClefs.values()]) {
    rows.sort((a, b) => eventTime(a) - eventTime(b));
  }

  const pageStarts = new Map<number, number | null>();
  const pageStart = (system: number) => {
    if (pageStarts.has(system)) {
      return pageStarts.get(system)!;
    }

    const starts = [...(pageMeasureStarts.get(system) ?? [])];
    const start = starts.length === 1 ? starts[0]! : null;
    const valid =
      start !== null &&
      systemGeometry(start)?.system === system &&
      systemGeometry(start)?.box !== null;

    pageStarts.set(system, valid ? start : null);

    return valid ? start : null;
  };
  const pageGrid = (staff: number, start: number) => {
    const line = pageStaffLines.get(staff)?.findLast((e) => eventTime(e) <= start);

    if (!line) {
      return null;
    }

    const clef = pageClefs.get(staff)?.findLast((e) => eventTime(e) <= eventTime(line));

    return planStaffLinesWithClef(line, clef);
  };
  const initialPageWarnings: [string, string][] = [];
  const pageLayouts = pageLayoutPlan(
    document,
    parts.flatMap((part) => part.staves),
    (code, message) => initialPageWarnings.push([code, message]),
    {
      gridForSystem(staff, system) {
        const start = pageStart(system);

        if (start === null) {
          return null;
        }

        return pageGrid(staff, start);
      },
    },
  );

  return {
    pageSettings,
    anchors,
    deferredNameUpdates,
    labelMoment,
    registerLabelSibling,
    sourceSystemBoundaries,
    sourceBoundaryBySystem,
    graceCursorSystems,
    registerSystemCursor,
    writeGap,
    partTimings,
    sharedBoundaries,
    polymetricGrid,
    layoutMoment,
    measureGeometry,
    systemGeometry,
    pageStart,
    pageGrid,
    initialPageWarnings,
    pageLayouts,
  };
}

export type LayoutSession = ReturnType<typeof createLayoutSession>;
