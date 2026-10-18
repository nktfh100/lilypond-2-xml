import type { Moment, Rational } from '@sightread/lilypond-eventdocument';
import { musicXMLColor } from '../colors.js';
import type { Attributes } from '../../types.js';
import type { BracketPoint, Event } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { compareMoments as compare, momentKey, gcd } from '../../../model/time.js';

const midpoint = (a: Rational, b: Rational): Rational => {
  const numerator = a.numerator * b.denominator + b.numerator * a.denominator;
  const denominator = 2 * a.denominator * b.denominator;

  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new Error('Bracket label timing exceeds supported precision');
  }

  const divisor = gcd(Math.abs(numerator), denominator);

  return { numerator: numerator / divisor, denominator: denominator / divisor };
};

export function bracketPoints(events: Event[], warn: Warn): Event[] {
  const points: BracketPoint[] = [];

  for (const span of events.filter((e) => e.kind === 'bracket')) {
    if (!span.resolvedStart || !span.endMoment || compare(span.moment, span.endMoment) > 0) {
      warn(
        'bracket-endpoints',
        'A bracket has missing or reversed compiler bounds; its resolved data is retained without guessing native endpoints.',
      );
      continue;
    }

    const spanKey = `${span.context}:${span.id}:${momentKey(span.moment)}`;
    const base = { ...span, kind: 'bracketPoint' as const, spanKey };

    points.push({ ...base, point: 'start' }, { ...base, point: 'stop', moment: span.endMoment });

    if (span.text) {
      points.push({
        ...base,
        point: 'label',
        hidden: span.textHidden,
        moment: {
          main: midpoint(span.moment.main, span.endMoment.main),
          grace: midpoint(span.moment.grace, span.endMoment.grace),
        },
      });
      warn(
        'bracket-label-layout',
        'Bracket labels retain native words and text styles at the temporal midpoint; exact graphical centering, font scaling, and parenthesized labels after system breaks require further mapping.',
      );
    }

    if (span.style === 'zigzag') {
      warn(
        'bracket-style',
        'An angular zigzag bracket uses the available native wavy line; its exact angular shape is not mapped.',
      );
    }

    if (span.custom || span.textCustom) {
      warn(
        'bracket-stencil',
        'A custom bracket drawing has no mapped native MusicXML equivalent; its available standard bracket shape is retained.',
      );
    }

    if (
      span.flare.some((n) => n !== 0) ||
      span.shorten.some((n) => n !== 0) ||
      span.dashFraction !== 0.4 ||
      span.dashPeriod !== 1
    ) {
      warn(
        'bracket-layout',
        'Native bracket endpoints and hook heights are retained; slanted hooks, custom shortening, spacing, and automatic stacking are not mapped exactly.',
      );
    }

    if (span.moment.grace.numerator || span.endMoment.grace.numerator) {
      warn(
        'bracket-grace',
        'Native bracket directions retain their main-note offsets; exact anchoring to individual grace notes is not represented by the direction offsets.',
      );
    }

    if (compare(span.moment, span.endMoment) === 0) {
      warn(
        'bracket-single',
        'A bracket enclosing one note retains coincident native endpoints; its source notehead-width geometry is not mapped.',
      );
    }

    if (!['line', 'dashed-line', 'dotted-line', 'zigzag', 'trill', 'none'].includes(span.style)) {
      warn(
        'bracket-style',
        `Unmapped bracket line style: ${span.style}. A solid native line is retained.`,
      );
    }
  }

  return [...events, ...points].sort((a, b) => compare(a.moment, b.moment));
}

export function bracketNumbers(events: Event[], staves: number[]) {
  const active = new Map<string, { number: number; end: Moment }>();
  const numbers = new Map<string, number>();
  const spans = events.filter(
    (
      e,
    ): e is Extract<
      Event,
      {
        kind:
          | 'bracketPoint'
          | 'durationLinePoint'
          | 'ligaturePoint'
          | 'fingerGlidePoint'
          | 'episemaPoint'
          | 'optionalMaterialPoint'
          | 'bendHoldPoint'
          | 'vowelTransitionPoint';
      }
    > =>
      (e.kind === 'bracketPoint' ||
        e.kind === 'durationLinePoint' ||
        e.kind === 'ligaturePoint' ||
        e.kind === 'fingerGlidePoint' ||
        e.kind === 'episemaPoint' ||
        e.kind === 'optionalMaterialPoint' ||
        e.kind === 'bendHoldPoint' ||
        e.kind === 'vowelTransitionPoint') &&
      e.point === 'start' &&
      staves.includes(e.staff),
  );

  for (const span of spans.sort((a, b) => compare(a.moment, b.moment))) {
    for (const [key, previous] of active) {
      if (compare(previous.end, span.moment) <= 0) {
        active.delete(key);
      }
    }

    const number = Array.from({ length: 16 }, (_, i) => i + 1).find(
      (n) => ![...active.values()].some((a) => a.number === n),
    );

    if (number === undefined) {
      throw new Error(
        'More than 16 overlapping brackets cannot be represented by MusicXML in one part',
      );
    }

    if (span.endMoment) {
      active.set(span.spanKey, { number, end: span.endMoment });
    }

    numbers.set(span.spanKey, number);
  }

  return numbers;
}

export function bracketAttributes(point: BracketPoint, number: number): Attributes {
  const edge = point.edges[point.point === 'stop' ? 1 : 0];
  const height = -point.direction * edge;
  const fraction = Math.max(0, Math.min(1, point.dashFraction ?? 0.4));
  const period = point.dashPeriod ?? 1;
  const dashed = point.style === 'dashed-line' && fraction > 0 && fraction < 1;
  const dotted = point.style === 'dotted-line' || (point.style === 'dashed-line' && fraction === 0);

  return {
    type: point.point,
    number,
    'line-end': height === 0 ? 'none' : height > 0 ? 'up' : 'down',
    'end-length': Math.abs(edge) * 10,
    'line-type': dashed
      ? 'dashed'
      : dotted
        ? 'dotted'
        : ['zigzag', 'trill'].includes(point.style)
          ? 'wavy'
          : 'solid',
    ...(dashed && period > 0
      ? {
          'dash-length': 10 * period * fraction,
          'space-length': 10 * period * (1 - fraction),
        }
      : {}),
    color:
      point.hidden || point.style === 'none' || ((dashed || dotted) && period <= 0)
        ? '#00000000'
        : musicXMLColor(point.color),
  };
}
