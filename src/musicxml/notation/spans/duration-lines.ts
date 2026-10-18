import { musicXMLColor } from '../colors.js';
import type { Attributes } from '../../types.js';
import type { DurationLinePoint, Event } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { compareMoments as compare, momentKey } from '../../../model/time.js';
import { uncertainStaffTopAt } from '../../layout/staff-reference.js';

/** Actual final pieces supply both bounds; written note durations are never endpoints. */
export function durationLinePoints(events: Event[], warn: Warn, captured = true): Event[] {
  const points: DurationLinePoint[] = [];

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'duration-line-capture',
      'Final compiler layout failed, so actual DurationLine pieces may be unavailable. No missing line bounds or drawings are invented.',
    );
  }

  if (
    !captured &&
    events.some((e) =>
      e.attachments?.some((a) => a.class === 'ignored' && a.name === 'duration-line-event'),
    )
  ) {
    warn(
      'duration-line-history',
      'Duration-line input lacks actual final grob bounds and appearance. No native line endpoints are guessed from written durations.',
    );
  }

  for (const span of events.filter((e) => e.kind === 'durationLine')) {
    if (span.custom) {
      warn(
        'duration-line-stencil',
        'A custom DurationLine drawing or late callback has no verified native bracket mapping. Its actual bounds and appearance remain in source metadata without an invented standard line.',
      );
      continue;
    }

    if (!span.resolvedStart || !span.endMoment || compare(span.moment, span.endMoment) > 0) {
      warn(
        'duration-line-endpoints',
        'A DurationLine has missing or reversed actual compiler bounds; no native endpoint is inferred from event duration.',
      );
      continue;
    }

    const uncertainTop = uncertainStaffTopAt(events, span.staff, span.moment);

    if (uncertainTop && !span.hidden) {
      warn(
        'duration-line-position',
        'A DurationLine uses a custom or sparse staff whose source top does not establish the native logical top reference. Actual source coordinates remain in metadata without a guessed native vertical position.',
      );
    }

    const base = {
      ...span,
      ...(uncertainTop ? { yTenths: null } : {}),
      kind: 'durationLinePoint' as const,
      spanKey: `duration:${span.voice}:${span.id}:${span.piece}:${momentKey(span.moment)}`,
    };

    points.push({ ...base, point: 'start' }, { ...base, point: 'stop', moment: span.endMoment });

    if (!span.hidden) {
      warn(
        'duration-line-layout',
        'Native brackets retain DurationLine spans and available line/end styles; source beam thickness, fitted padding, dashes, arrow dimensions and exact hook geometry are not preserved.',
      );

      if (span.yTenths === null || !Number.isFinite(span.yTenths)) {
        warn(
          'duration-line-position',
          'A DurationLine lacks an unambiguous actual staff-top reference; its native interval remains without a guessed vertical coordinate.',
        );
      }
    }

    if (span.moment.grace.numerator || span.endMoment.grace.numerator) {
      warn(
        'duration-line-grace',
        'DurationLine bounds retain their main-note offsets; exact individual grace-column anchoring is not represented by native direction offsets.',
      );
    }

    if (compare(span.moment, span.endMoment) === 0) {
      warn(
        'duration-line-single',
        'A DurationLine has coincident actual temporal bounds; native coincident endpoints cannot retain its fitted notehead-width geometry.',
      );
    }

    if (
      !['beam', 'line', 'dashed-line', 'dotted-line', 'zigzag', 'trill', 'none'].includes(
        span.style,
      )
    ) {
      warn(
        'duration-line-style',
        `Unmapped DurationLine style: ${span.style}. Its available interval uses a solid native bracket.`,
      );
    }

    if (span.style === 'zigzag') {
      warn(
        'duration-line-style',
        'An angular DurationLine zigzag uses the available native wavy line; its angular geometry is not mapped.',
      );
    }

    if (span.endStyle && !['arrow', 'hook'].includes(span.endStyle)) {
      warn(
        'duration-line-end-style',
        `Unmapped DurationLine end style: ${span.endStyle}. No end symbol is guessed.`,
      );
    }

    if (
      !span.hidden &&
      span.endStyle === 'arrow' &&
      ['dashed-line', 'dotted-line'].includes(span.style) &&
      span.dashPeriod <= 0
    ) {
      warn(
        'duration-line-end-visibility',
        'The source retains a standalone DurationLine arrow after suppressing its dashed line. A native bracket cannot independently suppress the line while retaining that arrow; this bracket stays hidden without inventing a visible connecting line.',
      );
    }
  }

  return [...events, ...points].sort((a, b) => compare(a.moment, b.moment));
}

export function durationLineAttributes(point: DurationLinePoint, number: number): Attributes {
  const fraction = Math.max(0, Math.min(1, point.dashFraction));
  const period = point.dashPeriod;
  const dashed = point.style === 'dashed-line' && fraction > 0 && fraction < 1;
  const dotted = point.style === 'dotted-line' || (point.style === 'dashed-line' && fraction === 0);
  // Source hooks exist only for beam style; broken-piece end style is already resolved.
  const hook = point.point === 'stop' && point.endStyle === 'hook' && point.style === 'beam';
  const layoutSpace = point.layoutStaffSpace;
  const globalScale =
    layoutSpace !== null && Number.isFinite(layoutSpace) && layoutSpace > 0
      ? 10 / layoutSpace
      : null;
  const dashPeriod =
    globalScale !== null && point.staffSpace !== null
      ? period * point.staffSpace * globalScale
      : null;
  const hookExtent =
    hook && point.thickness !== null
      ? point.hookDirection * (point.hookHeight + point.thickness)
      : null;
  const end =
    point.point === 'stop' && point.endStyle === 'arrow'
      ? 'arrow'
      : hookExtent !== null && Number.isFinite(hookExtent) && hookExtent !== 0
        ? hookExtent > 0
          ? 'up'
          : 'down'
        : 'none';
  const color = musicXMLColor(point.color);

  return {
    type: point.point,
    number,
    'line-end': end,
    ...(hookExtent !== null && Number.isFinite(hookExtent) && globalScale !== null
      ? { 'end-length': Math.abs(hookExtent) * globalScale }
      : {}),
    'line-type': dashed
      ? 'dashed'
      : dotted
        ? 'dotted'
        : ['zigzag', 'trill'].includes(point.style)
          ? 'wavy'
          : 'solid',
    ...(dashed && dashPeriod !== null && Number.isFinite(dashPeriod) && dashPeriod > 0
      ? {
          'dash-length': dashPeriod * fraction,
          'space-length': dashPeriod * (1 - fraction),
        }
      : {}),
    color:
      point.hidden || point.style === 'none' || ((dashed || dotted) && period <= 0)
        ? '#00000000'
        : color,
    ...(globalScale !== null &&
    point.staffSpace !== null &&
    Number.isFinite(point.extraOffset[0]) &&
    point.extraOffset[0] !== 0
      ? { 'relative-x': point.extraOffset[0] * point.staffSpace * globalScale }
      : {}),
    ...(point.yTenths !== null && Number.isFinite(point.yTenths)
      ? { 'default-y': point.yTenths }
      : {}),
  };
}
