import { matchesMeasureReference } from './line-appearance.js';
import type { Moment } from '@sightread/lilypond-eventdocument';
import { musicXMLColor } from '../colors.js';
import type { Attributes } from '../../types.js';
import type { Event, OptionalMaterialPoint } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { compareMoments as compare } from '../../../model/time.js';
import { uncertainStaffTopAt } from '../../layout/staff-reference.js';

type Segment = readonly [number, number, number, number];

/** Verify the three actual source rectangles before extracting their centerlines. */
function segments(boxes: readonly (readonly number[])[] | null): Segment[] | null {
  if (
    !boxes ||
    boxes.length !== 3 ||
    boxes.some(
      (b) =>
        b.length !== 5 || b.some((n) => !Number.isFinite(n)) || b[1]! <= b[0]! || b[3]! <= b[2]!,
    )
  ) {
    return null;
  }

  const vertical = boxes.filter((b) => b[3]! - b[2]! > b[1]! - b[0]!);

  if (vertical.length !== 1) {
    return null;
  }

  const stem = vertical[0]!,
    edges = boxes.filter((b) => b !== stem).sort((a, b) => a[2]! - b[2]!);
  const width = stem[1]! - stem[0]!,
    center = (stem[0]! + stem[1]!) / 2;
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;

  if (
    edges.some(
      (b) => !close(b[3]! - b[2]!, width) || !(close(b[0]!, stem[0]!) || close(b[1]!, stem[1]!)),
    ) ||
    !close(edges[0]![2]!, stem[2]!) ||
    !close(edges[1]![3]!, stem[3]!)
  ) {
    return null;
  }

  const bottom = (edges[0]![2]! + edges[0]![3]!) / 2,
    top = (edges[1]![2]! + edges[1]![3]!) / 2;

  return [
    [center, bottom, center, top],
    ...edges.map((b) => {
      const y = (b[2]! + b[3]!) / 2;

      return [
        center,
        y,
        close(b[0]!, stem[0]!) ? b[1]! - width / 2 : b[0]! + width / 2,
        y,
      ] as const;
    }),
  ];
}

export function optionalMaterialPoints(events: Event[], warn: Warn, captured = true): Event[] {
  const points: OptionalMaterialPoint[] = [];

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'optional-material-capture',
      'Final compiler layout failed; optional-material delimiter pieces may be unavailable. No endpoints are invented.',
    );
  }

  if (
    !captured &&
    events.some((e) =>
      e.attachments?.some((a) => a.class === 'ignored' && a.name === 'optional-material-event'),
    )
  ) {
    warn(
      'optional-material-history',
      'Optional-material input lacks final Item capture. No paired passage or note-duration endpoint is inferred.',
    );
  }

  for (const item of events.filter((e) => e.kind === 'optionalMaterial')) {
    if (item.custom) {
      warn(
        'optional-material-stencil',
        'A custom optional-material delimiter stencil or late callback has no verified native geometry mapping.',
      );
      continue;
    }

    const lines = segments(item.rectangles);

    if (!lines) {
      if (!item.hidden) {
        warn(
          'optional-material-geometry',
          'An optional-material Item lacks verified final three-rectangle geometry or a source coordinate reference. No font glyph or bracket span is guessed.',
        );
      }

      continue;
    }

    const uncertainTop = uncertainStaffTopAt(events, item.staff, item.moment);

    lines.forEach((_line, segment) => {
      const base = {
        ...item,
        kind: 'optionalMaterialPoint' as const,
        segment,
        endMoment: item.moment,
        ySupported: !uncertainTop,
        spanKey: `optional:${item.context}:${item.id}:${item.piece}:${segment}`,
      };

      points.push({ ...base, point: 'start' }, { ...base, point: 'stop' });
    });

    if (!item.hidden) {
      warn(
        'optional-material-layout',
        'Native bracket segments retain source centerlines. MusicXML bracket attributes cannot retain the source per-segment thickness or rounded box corners; source automatic spacing is not reproduced.',
      );

      if (uncertainTop) {
        warn(
          'optional-material-position',
          'The source staff top has no verified native grid reference. Source rectangle metadata remains, without guessed default-y coordinates.',
        );
      }
    }
  }

  return [...events, ...points].sort((a, b) => compare(a.moment, b.moment));
}

export function optionalMaterialAttributes(
  point: OptionalMaterialPoint,
  number: number,
  start: number | Moment,
  warn: Warn,
): Attributes {
  const line = segments(point.rectangles)?.[point.segment];
  const index = point.point === 'start' ? 0 : 2;
  const reference = point.xReference;
  const matches = matchesMeasureReference(reference, start);

  if (!point.hidden && line && !matches) {
    warn(
      'optional-material-position',
      'The captured optional-material X origin differs from this native measure start. No incorrect default-x is applied.',
    );
  }

  const color = musicXMLColor(point.color);

  return {
    type: point.point,
    number,
    'line-end': 'none',
    'line-type': 'solid',
    color: point.hidden ? '#00000000' : color,
    ...(line && matches ? { 'default-x': line[index] } : {}),
    ...(line && point.ySupported ? { 'default-y': line[index + 1] } : {}),
  };
}
