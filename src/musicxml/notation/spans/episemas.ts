import type { Moment } from '@sightread/lilypond-eventdocument';
import type { Attributes } from '../../types.js';
import type { EpisemaPoint, Event } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { fittedLineAppearance, matchesMeasureReference } from './line-appearance.js';
import { compareMoments as compare, momentKey } from '../../../model/time.js';
import { uncertainStaffTopAt } from '../../layout/staff-reference.js';

/** An episema is a chant line, not a tenuto articulation. */
export function episemaPoints(events: Event[], warn: Warn, captured = true): Event[] {
  const points: EpisemaPoint[] = [];

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'episema-capture',
      'Final compiler layout failed, so surviving episema pieces may be unavailable. Missing lines and endpoints are not invented.',
    );
  }

  if (
    !captured &&
    events.some((e) =>
      e.attachments?.some((a) => a.class === 'ignored' && a.name === 'episema-event'),
    )
  ) {
    warn(
      'episema-history',
      'Episema input lacks actual final grob capture. No chant line is inferred from note durations or substituted with a tenuto articulation.',
    );
  }

  for (const span of events.filter((e) => e.kind === 'episema')) {
    if (span.custom) {
      warn(
        'episema-stencil',
        'A custom episema drawing, late callback or endpoint stencil has no verified native bracket mapping. Actual source data remains without inventing a plain line or tenuto articulation.',
      );
      continue;
    }

    if (!span.resolvedStart || !span.endMoment || compare(span.moment, span.endMoment) > 0) {
      if (!span.hidden) {
        warn(
          'episema-endpoints',
          'An episema has missing or reversed actual compiler bounds. No native endpoints are guessed from note timing.',
        );
      }

      continue;
    }

    const uncertainTop = uncertainStaffTopAt(events, span.staff, span.moment);
    const base = {
      ...span,
      ...(uncertainTop ? { yTenths: [null, null] as const } : {}),
      kind: 'episemaPoint' as const,
      spanKey: `episema:${span.voice}:${span.id}:${span.piece}:${momentKey(span.moment)}`,
    };

    points.push({ ...base, point: 'start' }, { ...base, point: 'stop', moment: span.endMoment });

    if (!span.hidden) {
      warn(
        'episema-layout',
        'Available fitted episema endpoints are retained in native coordinates. Per-line source thickness, optical line geometry and automatic page/system layout are not fully mapped.',
      );

      if (uncertainTop || span.yTenths.some((y) => y === null || !Number.isFinite(y))) {
        warn(
          'episema-position',
          'An episema lacks a verified final line endpoint or native staff-top reference. No missing vertical coordinate is guessed.',
        );
      }

      if (span.xTenths.some((x) => x === null || !Number.isFinite(x))) {
        warn(
          'episema-position',
          'An episema lacks a verified final line endpoint or actual measure-origin reference. No missing horizontal coordinate is guessed.',
        );
      }

      if (
        !['line', 'dashed-line', 'dotted-line', 'trill', 'zigzag', 'none'].includes(span.style) ||
        span.style === 'zigzag'
      ) {
        warn(
          'episema-style',
          `Episema style ${span.style} retains its available native line category; its exact source glyph geometry is not mapped.`,
        );
      }

      if (span.moment.grace.numerator || span.endMoment.grace.numerator) {
        warn(
          'episema-grace',
          'An episema retains main-note direction offsets and verified source coordinates; attachment to individual grace columns is not encoded.',
        );
      }
    }
  }

  return [...events, ...points].sort((a, b) => compare(a.moment, b.moment));
}

export function episemaAttributes(
  point: EpisemaPoint,
  number: number,
  start: number | Moment,
  warn: Warn,
): Attributes {
  const index = point.point === 'start' ? 0 : 1;
  const x = point.xTenths[index];
  const matches = matchesMeasureReference(point.xReference[index], start);

  if (!point.hidden && x !== null && !matches) {
    warn(
      'episema-position',
      'The captured episema X reference differs from this native measure start. Its source coordinate remains in metadata without applying an incorrect default-x.',
    );
  }

  return fittedLineAppearance(point, number, start);
}
