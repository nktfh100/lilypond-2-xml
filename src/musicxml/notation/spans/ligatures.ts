import { lineStyleAttributes } from './line-appearance.js';
import type { Attributes } from '../../types.js';
import type { Event, LigaturePoint } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { compareMoments as compare, momentKey } from '../../../model/time.js';
import { uncertainStaffTopAt } from '../../layout/staff-reference.js';

export function ligaturePoints(events: Event[], warn: Warn, captured = true): Event[] {
  const points: LigaturePoint[] = [];

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'ligature-capture',
      'Final compiler layout failed, so actual ligature pieces may be unavailable. Missing bounds and drawings are not invented.',
    );
  }

  if (
    !captured &&
    events.some((e) =>
      e.attachments?.some((a) => a.class === 'ignored' && a.name === 'ligature-event'),
    )
  ) {
    warn(
      'ligature-history',
      'Ligature input lacks actual graphic capture. No native bracket endpoints are guessed from event timing or note durations.',
    );
  }

  for (const span of events.filter((e) => e.kind === 'ligature')) {
    if (span.name !== 'LigatureBracket') {
      warn(
        'ligature-historical',
        `The ${span.name} graphic replaces or joins historical notehead primitives. Available written notes remain; an ordinary bracket cannot preserve those glyphs, spacing or accidental ownership.`,
      );
      continue;
    }

    if (span.slur) {
      warn(
        'ligature-slur',
        "A ligature bracket uses the source's curved tuplet-slur drawing. Its actual data remains without substituting an ordinary native bracket for that curve.",
      );
      continue;
    }

    if (span.custom) {
      warn(
        'ligature-stencil',
        'A custom ligature drawing, late callback or broken-edge text has no verified native bracket mapping. Actual bounds and appearance remain without an invented standard drawing.',
      );
      continue;
    }

    if (!span.resolvedStart || !span.endMoment || compare(span.moment, span.endMoment) > 0) {
      warn(
        'ligature-endpoints',
        'A ligature bracket has missing or reversed actual compiler bounds; native endpoints are not inferred from written durations.',
      );
      continue;
    }

    const uncertainTop = uncertainStaffTopAt(events, span.staff, span.moment);
    const yTenths = uncertainTop ? null : span.yTenths;

    if (!span.hidden && (!yTenths || yTenths.some((n) => !Number.isFinite(n)))) {
      warn(
        'ligature-position',
        'A ligature bracket lacks a verified native staff-top reference. Its actual coordinates remain in metadata without a guessed vertical position.',
      );
    }

    const base = {
      ...span,
      yTenths,
      kind: 'ligaturePoint' as const,
      spanKey: `ligature:${span.voice}:${span.id}:${span.piece}:${momentKey(span.moment)}`,
    };

    points.push({ ...base, point: 'start' }, { ...base, point: 'stop', moment: span.endMoment });

    if (!span.hidden) {
      warn(
        'ligature-layout',
        'Native ligature brackets retain available line styles and nominal hooks. Exact source fitting, shortening, slanted hooks, thickness, text and automatic placement are not reconstructed.',
      );
    }

    if (span.moment.grace.numerator || span.endMoment.grace.numerator) {
      warn(
        'ligature-grace',
        'A ligature bracket uses native main-note offsets; exact individual grace-column anchoring is not represented by direction offsets.',
      );
    }

    if (compare(span.moment, span.endMoment) === 0) {
      warn(
        'ligature-single',
        'A ligature bracket has coincident actual temporal bounds. Its fitted single-note width is not reconstructed from those native offsets.',
      );
    }

    if (
      span.style === 'zigzag' ||
      !['line', 'dashed-line', 'dotted-line', 'trill', 'none'].includes(span.style)
    ) {
      warn(
        'ligature-style',
        `The source ligature style ${span.style} retains its available native line category; exact glyph geometry is not mapped.`,
      );
    }

    if (!span.hidden && span.style === 'dashed-line' && !span.dashedEdges) {
      warn(
        'ligature-edge-style',
        'The source ligature has a dashed main line and solid hooks. Native bracket line styling does not separately encode those edge styles; exact hook appearance is not retained.',
      );
    }
  }

  return [...events, ...points].sort((a, b) => compare(a.moment, b.moment));
}

export function ligatureAttributes(point: LigaturePoint, number: number): Attributes {
  const side = point.point === 'start' ? 0 : 1;
  const scale =
    point.layoutStaffSpace !== null &&
    Number.isFinite(point.layoutStaffSpace) &&
    point.layoutStaffSpace > 0
      ? 10 / point.layoutStaffSpace
      : null;
  const localScale = scale !== null && point.staffSpace !== null ? scale * point.staffSpace : null;
  const height =
    localScale !== null && !point.connect[side]
      ? -point.direction * point.edges[side] * localScale
      : 0;
  const period = localScale !== null ? point.dashPeriod * localScale : null;
  const y = point.yTenths?.[side];

  return {
    type: point.point,
    number,
    'line-end': !Number.isFinite(height) || height === 0 ? 'none' : height > 0 ? 'up' : 'down',
    ...(Number.isFinite(height) && height !== 0 ? { 'end-length': Math.abs(height) } : {}),
    ...lineStyleAttributes(point, period),
    ...(y !== undefined && Number.isFinite(y) ? { 'default-y': y } : {}),
    ...(localScale !== null && Number.isFinite(point.extraOffset[0]) && point.extraOffset[0] !== 0
      ? { 'relative-x': point.extraOffset[0] * localScale }
      : {}),
  };
}
