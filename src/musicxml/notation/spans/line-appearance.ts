import type { Moment } from '@sightread/lilypond-eventdocument';
import { musicXMLColor } from '../colors.js';
import { coordinatesNear } from '../../layout/geometry.js';
import type { Attributes } from '../../types.js';
import type { EpisemaPoint, FingerGlidePoint } from '../../planning/events.js';
import { compareMoments, mainTime } from '../../../model/time.js';

type FittedLinePoint = EpisemaPoint | FingerGlidePoint;

/** Exact full Moments establish ownership; numeric writer offsets need a small rounding tolerance. */
export function matchesMeasureReference(reference: Moment | null, start: Moment | number): boolean {
  if (reference === null || reference.grace.numerator !== 0) {
    return false;
  }

  return typeof start === 'number'
    ? coordinatesNear(mainTime(reference), start, 1e-10)
    : compareMoments(reference, start) === 0;
}

export function lineStyleAttributes(
  point: Pick<FittedLinePoint, 'style' | 'dashFraction' | 'dashPeriod' | 'hidden' | 'color'>,
  period: number | null,
): Attributes {
  const fraction = Math.max(0, Math.min(1, point.dashFraction));
  const dashed = point.style === 'dashed-line' && fraction > 0 && fraction < 1;
  const dotted = point.style === 'dotted-line' || (point.style === 'dashed-line' && fraction === 0);

  return {
    'line-type': dashed
      ? 'dashed'
      : dotted
        ? 'dotted'
        : ['zigzag', 'trill'].includes(point.style)
          ? 'wavy'
          : 'solid',
    ...(dashed && period !== null && Number.isFinite(period) && period > 0
      ? {
          'dash-length': period * fraction,
          'space-length': period * (1 - fraction),
        }
      : {}),
    color:
      point.hidden || point.style === 'none' || ((dashed || dotted) && point.dashPeriod <= 0)
        ? '#00000000'
        : musicXMLColor(point.color),
  };
}

/** Common appearance for final fitted no-hook lines; ownership and diagnostics stay with each feature. */
export function fittedLineAppearance(
  point: FittedLinePoint,
  number: number,
  start: Moment | number,
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
  const x = point.xTenths[index],
    y = point.yTenths[index];

  return {
    type: point.point,
    number,
    'line-end': 'none',
    ...lineStyleAttributes(point, period),
    ...(matchesMeasureReference(point.xReference[index], start) && x !== null && Number.isFinite(x)
      ? { 'default-x': x }
      : {}),
    ...(y !== null && Number.isFinite(y) ? { 'default-y': y } : {}),
  };
}
