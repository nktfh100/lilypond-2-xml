import { lineStyleAttributes, matchesMeasureReference } from '../notation/spans/line-appearance.js';
import type { Moment } from '@sightread/lilypond-eventdocument';
import type { Attributes } from '../types.js';
import type { Event, VowelTransitionPoint } from '../planning/events.js';
import type { Warn } from '../../model/diagnostics.js';
import { lyricHasText } from './lyrics.js';
import { compareMoments as compare, momentKey, isMoment as validMoment } from '../../model/time.js';
import { uncertainStaffTopAt } from '../layout/staff-reference.js';

/** A graphic between actual lyric syllables, without a performed pitch slide. */
export function vowelTransitionPoints(events: Event[], warn: Warn, captured = true): Event[] {
  const points: VowelTransitionPoint[] = [];
  const spans = events.filter((e) => e.kind === 'vowelTransition');

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'vowel-transition-capture',
      'Final compiler layout failed; actual vowel-transition pieces may be unavailable. No line is inferred from the next note or syllable.',
    );

    return events;
  }

  if (!captured) {
    if (spans.length || events.some((e) => e.kind === 'vowelTransitionRequest')) {
      warn(
        'vowel-transition-history',
        'This document lacks actual vowel-transition capture. No connector is inferred from lyric text or nearby notes.',
      );
    }

    return events;
  }

  const lyrics = events.filter(
    (e) => e.kind === 'lyric' && e.class === 'lyric-event' && lyricHasText(e.text, e.markup),
  );

  for (const span of spans) {
    if (span.custom) {
      warn(
        'vowel-transition-stencil',
        'A custom vowel-transition printer, late callback or endpoint stencil has no verified native bracket mapping. Its source metadata is retained without inventing a standard connector.',
      );
      continue;
    }

    if (
      !span.hidden &&
      (span.leftArrow || span.rightArrow) &&
      (span.style === 'none' ||
        (['dashed-line', 'dotted-line'].includes(span.style) && span.dashPeriod <= 0))
    ) {
      warn(
        'vowel-transition-arrow-visibility',
        'The source retains a standalone arrow while its shaft is absent. A native bracket cannot hide only its shaft, so no visible connecting line is invented; the actual arrow remains in source metadata.',
      );
      continue;
    }

    if (
      !span.resolvedStart ||
      !validMoment(span.moment) ||
      !validMoment(span.endMoment) ||
      span.leftKind == null ||
      span.rightKind == null ||
      compare(span.moment, span.endMoment) > 0
    ) {
      if (!span.hidden) {
        warn(
          'vowel-transition-endpoints',
          'A vowel transition has missing or reversed actual piece bounds. No endpoint is guessed from note duration.',
        );
      }

      continue;
    }

    const from = span.fromLyricMoment,
      to = span.toLyricMoment;
    const idsValid = [span.fromLyricId, span.toLyricId].every(
      (id) => id !== null && Number.isSafeInteger(id) && id > 0,
    );
    const matches = (m: Moment) =>
      lyrics.filter(
        (e) => e.verse === span.verse && compare(e.moment, m) === 0 && e.voice === span.voice,
      );
    const endpointsValid =
      validMoment(from) &&
      validMoment(to) &&
      compare(from, to) <= 0 &&
      compare(span.moment, from) >= 0 &&
      compare(span.endMoment, to) <= 0 &&
      (span.leftKind !== 'LyricText' || compare(span.moment, from) === 0) &&
      (span.rightKind !== 'LyricText' || compare(span.endMoment, to) === 0);
    const duplicated =
      spans.filter((e) => e.id === span.id && e.piece === span.piece && e.verse === span.verse)
        .length > 1;
    const labels = spans
      .filter((e) => e.verse === span.verse)
      .flatMap((e) => [
        {
          id: e.fromLyricId,
          moment: e.fromLyricMoment,
          voice: e.voice,
          staff: e.staff,
        },
        {
          id: e.toLyricId,
          moment: e.toLyricMoment,
          voice: e.voice,
          staff: e.staff,
        },
      ]);
    const conflictingIdentity = labels.some(
      (a) =>
        [span.fromLyricId, span.toLyricId].includes(a.id) &&
        labels.some(
          (b) =>
            b.id === a.id &&
            (a.voice !== b.voice ||
              a.staff !== b.staff ||
              (validMoment(a.moment) &&
                validMoment(b.moment) &&
                compare(a.moment, b.moment) !== 0)),
        ),
    );

    if (
      !idsValid ||
      !endpointsValid ||
      span.voice === null ||
      span.staff === null ||
      duplicated ||
      conflictingIdentity ||
      !events.some((e) => e.kind === 'note' && e.voice === span.voice && e.staff === span.staff) ||
      (validMoment(from) && matches(from).length !== 1) ||
      (validMoment(to) && matches(to).length !== 1)
    ) {
      if (!span.hidden) {
        warn(
          'vowel-transition-owner',
          'A vowel transition lacks unique actual LyricText, verse, Voice or Staff ownership, or its piece conflicts with the retained original syllables. No connector is assigned by text equality or note order.',
        );
      }

      continue;
    }

    if (
      span.moment.grace.numerator ||
      span.endMoment.grace.numerator ||
      from!.grace.numerator ||
      to!.grace.numerator
    ) {
      if (!span.hidden) {
        warn(
          'vowel-transition-grace',
          'A vowel transition has actual grace-column bounds that ordinary native direction offsets cannot uniquely address. No same-main-time endpoint is guessed.',
        );
      }

      continue;
    }

    const uncertainTop = uncertainStaffTopAt(events, span.staff, span.moment);
    const base = {
      ...span,
      staff: span.staff,
      ...(uncertainTop ? { yTenths: [null, null] as const } : {}),
      kind: 'vowelTransitionPoint' as const,
      spanKey: `vowel-transition:${span.verse}:${span.id}:${span.piece}:${momentKey(span.moment)}`,
    };

    points.push({ ...base, point: 'start' }, { ...base, point: 'stop', moment: span.endMoment });

    if (!span.hidden) {
      warn(
        'vowel-transition-layout',
        'Native line categories and arrows retain available source semantics. Source padding, spacing rods, minimum length, thickness and arrow dimensions remain partial.',
      );

      if (
        span.xTenths.some((x) => x === null) ||
        uncertainTop ||
        span.yTenths.some((y) => y === null)
      ) {
        warn(
          'vowel-transition-position',
          'Actual arrow-tip or measure/staff coordinate references are unverified. No fitted lyric-baseline coordinates are guessed from shaft endpoints or note positions.',
        );
      }

      if (!['line', 'dashed-line', 'dotted-line', 'none'].includes(span.style)) {
        warn(
          'vowel-transition-style',
          `Vowel-transition style ${span.style} retains an available native line category; exact source geometry is not mapped.`,
        );
      }
    }
  }

  return [...events, ...points].sort((a, b) => compare(a.moment, b.moment));
}

export function vowelTransitionAttributes(
  point: VowelTransitionPoint,
  number: number,
  start: number | Moment,
  warn: Warn,
): Attributes {
  const index = point.point === 'start' ? 0 : 1;
  const scale =
    point.layoutStaffSpace !== null && point.layoutStaffSpace > 0
      ? 10 / point.layoutStaffSpace
      : null;
  const period =
    scale !== null && point.staffSpace !== null
      ? point.dashPeriod * point.staffSpace * scale
      : null;
  const reference = point.xReference[index],
    x = point.xTenths[index],
    y = point.yTenths[index];
  const matches = matchesMeasureReference(reference, start);

  if (!point.hidden && x !== null && !matches) {
    warn(
      'vowel-transition-position',
      'A captured transition X reference differs from the native measure start. The source coordinate is retained without applying an incorrect default-x.',
    );
  }

  return {
    type: point.point,
    number,
    'line-end': (index === 0 ? point.leftArrow : point.rightArrow) ? 'arrow' : 'none',
    ...lineStyleAttributes(point, period),
    ...(matches && x !== null && Number.isFinite(x) ? { 'default-x': x } : {}),
    ...(y !== null && Number.isFinite(y) ? { 'default-y': y } : {}),
  };
}
