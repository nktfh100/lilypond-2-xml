import type { Moment } from '@sightread/lilypond-eventdocument';
import type { Attributes } from '../../types.js';
import type { Event, FingerGlidePoint } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { fittedLineAppearance, matchesMeasureReference } from './line-appearance.js';
import { compareMoments as compare, momentKey } from '../../../model/time.js';
import { uncertainStaffTopAt } from '../../layout/staff-reference.js';

/** Source label identity and actual surviving broken pieces establish ownership. */
export function fingerGlidePoints(events: Event[], warn: Warn, captured = true): Event[] {
  const points: FingerGlidePoint[] = [];

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'finger-glide-capture',
      'Final compiler layout failed; surviving finger-glide pieces and label bounds may be unavailable. No connector is inferred from adjacent notes or matching digits.',
    );
  }

  if (
    !captured &&
    events.some((e) =>
      e.attachments?.some((a) => a.class === 'ignored' && a.name === 'finger-glide-event'),
    )
  ) {
    warn(
      'finger-glide-history',
      'Finger-glide input lacks actual final label-bound pieces. No connector is guessed from note pitches, durations or fingering digits.',
    );
  }

  for (const span of events.filter((e) => e.kind === 'fingerGlide')) {
    if (span.custom) {
      warn(
        'finger-glide-stencil',
        'A custom FingerGlideSpanner drawing or late callback has no verified native bracket mapping. Actual label ownership remains in metadata without an invented standard drawing.',
      );
      continue;
    }

    if (!span.resolvedStart || !span.endMoment || compare(span.moment, span.endMoment) > 0) {
      if (!span.hidden) {
        warn(
          'finger-glide-endpoints',
          'A finger glide has missing or reversed actual graphical bounds; no native endpoints are inferred from nearby notes.',
        );
      }

      continue;
    }

    if (!span.fromLabel || !span.toLabel || !span.fromNotes.length || !span.toNotes.length) {
      if (!span.hidden) {
        warn(
          'finger-glide-ownership',
          'A finger glide lacks an actual original endpoint label identity or uniquely recorded NoteHead support. Its available graphical interval remains, without assigning it to a guessed note or fingering.',
        );
      }
    }

    const uncertainTop = uncertainStaffTopAt(events, span.staff, span.moment);
    const base = {
      ...span,
      ...(uncertainTop ? { yTenths: [null, null] as const } : {}),
      kind: 'fingerGlidePoint' as const,
      spanKey: `finger:${span.voice}:${span.id}:${span.piece}:${momentKey(span.moment)}`,
    };

    points.push({ ...base, point: 'start' }, { ...base, point: 'stop', moment: span.endMoment });

    if (!span.hidden) {
      warn(
        'finger-glide-layout',
        'Native brackets preserve actual finger-label connector intervals and available endpoints. Source label attachment, slope fitting, thickness and continuous geometry are not reconstructed by MusicXML bracket semantics.',
      );

      if (uncertainTop || span.yTenths.some((y) => y === null || !Number.isFinite(y))) {
        warn(
          'finger-glide-position',
          'A finger glide lacks a verified final line endpoint or native staff-top reference. No missing vertical coordinate is guessed.',
        );
      }

      if (span.xTenths.some((x) => x === null || !Number.isFinite(x))) {
        warn(
          'finger-glide-position',
          'A finger glide lacks a verified final line endpoint or actual measure-origin reference. No missing horizontal coordinate is guessed.',
        );
      }

      if (!['line', 'dashed-line', 'dotted-line', 'trill', 'zigzag', 'none'].includes(span.style)) {
        warn(
          'finger-glide-style',
          `Finger-glide style ${span.style} has no equivalent complete native bracket shape. Its actual interval uses a solid connector; source bow or detached stubs remain in metadata.`,
        );
      }

      if (span.style === 'zigzag') {
        warn(
          'finger-glide-style',
          'An angular finger glide uses a native wavy connector; its source zigzag geometry is not retained.',
        );
      }

      if (span.moment.grace.numerator || span.endMoment.grace.numerator) {
        warn(
          'finger-glide-grace',
          'Finger-glide bounds retain their main-note offsets; individual grace-column attachment is not represented by native direction offsets.',
        );
      }
    }
  }

  return [...events, ...points].sort((a, b) => compare(a.moment, b.moment));
}

export function fingerGlideAttributes(
  point: FingerGlidePoint,
  number: number,
  start: number | Moment,
  warn: Warn,
): Attributes {
  const index = point.point === 'start' ? 0 : 1;
  const x = point.xTenths[index];
  const matches = matchesMeasureReference(point.xReference[index], start);

  if (!point.hidden && x !== null && !matches) {
    warn(
      'finger-glide-position',
      'The captured finger-glide horizontal reference differs from this native measure start. Its source coordinate remains in metadata without applying an incorrect default-x.',
    );
  }

  return fittedLineAppearance(point, number, start);
}
