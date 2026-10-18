import { musicXMLColor } from '../colors.js';
import type { Attributes } from '../../types.js';
import type { TieResolvedGeometry } from '../../../model/document.js';

interface Curve {
  direction: number;
  dash: readonly (readonly number[])[];
  hidden: boolean;
  color: readonly number[] | null;
  offset: readonly [number, number];
}

export interface ResolvedSlurGeometry {
  readonly slurId: number;
  readonly system: number;
  readonly staffContext: number;
  readonly fromNoteId: number;
  readonly toNoteId: number;
  readonly fromHeadId: number;
  readonly toHeadId: number;
  readonly staffSymbolContext: number;
  readonly units: 'lilypond-final-layout-coordinates';
  readonly points: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
  readonly curveOrigin: readonly [number, number];
  /** Actual NoteHead ink-left X and head-origin Y in the same raw frame. */
  readonly fromNoteOrigin: readonly [number, number];
  readonly toNoteOrigin: readonly [number, number];
  readonly staffTopY: number;
  readonly outputScale: number;
  readonly layoutStaffSpaceMm: number;
  readonly localStaffSpaceMm: number;
  readonly globalStaffSpaceMm: number | null;
}

/** Final, one-System normal Tie curve with independently owned endpoints. */
export type ResolvedTieGeometry = TieResolvedGeometry;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** Convert actual one-system source endpoints/control vectors into MusicXML tenths. */
export function resolvedSlurBezierAttributes(
  geometry: ResolvedSlurGeometry | undefined,
  expected: {
    slurId: number;
    staff: number;
    fromNoteId: number;
    toNoteId: number;
  },
  type: 'start' | 'stop',
  globalStaffSpaceMm: number | undefined,
): Attributes | null {
  if (!geometry || !finite(globalStaffSpaceMm) || globalStaffSpaceMm <= 0) {
    return null;
  }

  const { points, fromNoteOrigin, toNoteOrigin } = geometry;

  if (
    geometry.units !== 'lilypond-final-layout-coordinates' ||
    !Number.isSafeInteger(geometry.slurId) ||
    geometry.slurId !== expected.slurId ||
    !Number.isSafeInteger(geometry.system) ||
    geometry.system <= 0 ||
    !Number.isSafeInteger(geometry.staffContext) ||
    geometry.staffContext !== expected.staff ||
    !Number.isSafeInteger(geometry.staffSymbolContext) ||
    geometry.staffSymbolContext !== expected.staff ||
    !Number.isSafeInteger(geometry.fromNoteId) ||
    geometry.fromNoteId !== expected.fromNoteId ||
    !Number.isSafeInteger(geometry.toNoteId) ||
    geometry.toNoteId !== expected.toNoteId ||
    geometry.fromHeadId !== expected.fromNoteId ||
    geometry.toHeadId !== expected.toNoteId ||
    !Array.isArray(points) ||
    points.length !== 4 ||
    points.some((point) => !Array.isArray(point) || point.length !== 2 || !point.every(finite)) ||
    !Array.isArray(geometry.curveOrigin) ||
    geometry.curveOrigin.length !== 2 ||
    !geometry.curveOrigin.every(finite) ||
    !Array.isArray(fromNoteOrigin) ||
    fromNoteOrigin.length !== 2 ||
    !fromNoteOrigin.every(finite) ||
    !Array.isArray(toNoteOrigin) ||
    toNoteOrigin.length !== 2 ||
    !toNoteOrigin.every(finite) ||
    !finite(geometry.staffTopY) ||
    !finite(geometry.outputScale) ||
    geometry.outputScale <= 0 ||
    !finite(geometry.layoutStaffSpaceMm) ||
    geometry.layoutStaffSpaceMm <= 0 ||
    !finite(geometry.localStaffSpaceMm) ||
    geometry.localStaffSpaceMm <= 0 ||
    !finite(geometry.globalStaffSpaceMm) ||
    geometry.globalStaffSpaceMm <= 0 ||
    !close(geometry.globalStaffSpaceMm, globalStaffSpaceMm)
  ) {
    return null;
  }

  // MusicXML tenths use global paper scaling. Staff-size must not alter this
  // denominator; outputScale applies once to the captured physical layout deltas.
  const factor = (geometry.outputScale * 10) / globalStaffSpaceMm;

  if (!finite(factor) || factor <= 0) {
    return null;
  }

  const [p0, p1, p2, p3] = points;
  const endpoint = type === 'start' ? p0 : p3;
  const noteOrigin = type === 'start' ? fromNoteOrigin : toNoteOrigin;
  const control = type === 'start' ? p1 : p2;
  const attrs: Attributes = {
    'default-x': (endpoint[0] - noteOrigin[0]) * factor,
    'default-y': (endpoint[1] - geometry.staffTopY) * factor,
    'bezier-x': (control[0] - endpoint[0]) * factor,
    'bezier-y': (control[1] - endpoint[1]) * factor,
  };

  if (Object.values(attrs).some((value) => !finite(value))) {
    return null;
  }

  return attrs;
}

/**
 * Convert one endpoint of a measured source tie centerline into MusicXML
 * position and endpoint-relative Bezier coordinates. MusicXML's tied element
 * position is relative to the corresponding note; its Bezier vector is then
 * relative to that position. Ties may connect notes on different staves, so
 * validate each endpoint's StaffSymbol ownership independently.
 */
export function resolvedTieBezierAttributes(
  geometry: ResolvedTieGeometry | undefined,
  expected: {
    tieId: number;
    fromNoteId: number;
    toNoteId: number;
    fromStaffContext: number;
    toStaffContext: number;
    fromStaffSymbolContext: number;
    toStaffSymbolContext: number;
  },
  type: 'start' | 'stop',
  globalStaffSpaceMm: number | undefined,
): Attributes | null {
  if (!geometry || !finite(globalStaffSpaceMm) || globalStaffSpaceMm <= 0) {
    return null;
  }

  const { points, fromNoteOrigin, toNoteOrigin } = geometry;

  if (
    geometry.units !== 'lilypond-final-layout-coordinates' ||
    !Number.isSafeInteger(geometry.tieId) ||
    geometry.tieId <= 0 ||
    geometry.tieId !== expected.tieId ||
    !Number.isSafeInteger(geometry.system) ||
    geometry.system <= 0 ||
    !Number.isSafeInteger(geometry.fromNoteId) ||
    geometry.fromNoteId <= 0 ||
    geometry.fromNoteId !== expected.fromNoteId ||
    !Number.isSafeInteger(geometry.toNoteId) ||
    geometry.toNoteId <= 0 ||
    geometry.toNoteId !== expected.toNoteId ||
    geometry.fromHeadId !== expected.fromNoteId ||
    geometry.toHeadId !== expected.toNoteId ||
    !Number.isSafeInteger(expected.tieId) ||
    expected.tieId <= 0 ||
    !Number.isSafeInteger(expected.fromNoteId) ||
    expected.fromNoteId <= 0 ||
    !Number.isSafeInteger(expected.toNoteId) ||
    expected.toNoteId <= 0 ||
    !Number.isSafeInteger(geometry.fromStaffContext) ||
    geometry.fromStaffContext <= 0 ||
    geometry.fromStaffContext !== expected.fromStaffContext ||
    !Number.isSafeInteger(geometry.toStaffContext) ||
    geometry.toStaffContext <= 0 ||
    geometry.toStaffContext !== expected.toStaffContext ||
    !Number.isSafeInteger(geometry.fromStaffSymbolContext) ||
    geometry.fromStaffSymbolContext <= 0 ||
    geometry.fromStaffSymbolContext !== expected.fromStaffSymbolContext ||
    !Number.isSafeInteger(geometry.toStaffSymbolContext) ||
    geometry.toStaffSymbolContext <= 0 ||
    geometry.toStaffSymbolContext !== expected.toStaffSymbolContext ||
    !Number.isSafeInteger(expected.fromStaffContext) ||
    expected.fromStaffContext <= 0 ||
    !Number.isSafeInteger(expected.toStaffContext) ||
    expected.toStaffContext <= 0 ||
    !Number.isSafeInteger(expected.fromStaffSymbolContext) ||
    expected.fromStaffSymbolContext <= 0 ||
    !Number.isSafeInteger(expected.toStaffSymbolContext) ||
    expected.toStaffSymbolContext <= 0 ||
    !Array.isArray(points) ||
    points.length !== 4 ||
    points.some((point) => !Array.isArray(point) || point.length !== 2 || !point.every(finite)) ||
    !Array.isArray(geometry.curveOrigin) ||
    geometry.curveOrigin.length !== 2 ||
    !geometry.curveOrigin.every(finite) ||
    !Array.isArray(fromNoteOrigin) ||
    fromNoteOrigin.length !== 2 ||
    !fromNoteOrigin.every(finite) ||
    !Array.isArray(toNoteOrigin) ||
    toNoteOrigin.length !== 2 ||
    !toNoteOrigin.every(finite) ||
    !finite(geometry.fromStaffTopY) ||
    !finite(geometry.toStaffTopY) ||
    !finite(geometry.outputScale) ||
    geometry.outputScale <= 0 ||
    !finite(geometry.layoutStaffSpaceMm) ||
    geometry.layoutStaffSpaceMm <= 0 ||
    !finite(geometry.fromLocalStaffSpaceMm) ||
    geometry.fromLocalStaffSpaceMm <= 0 ||
    !finite(geometry.toLocalStaffSpaceMm) ||
    geometry.toLocalStaffSpaceMm <= 0 ||
    !finite(geometry.globalStaffSpaceMm) ||
    geometry.globalStaffSpaceMm <= 0 ||
    !close(geometry.layoutStaffSpaceMm, geometry.globalStaffSpaceMm) ||
    !close(geometry.globalStaffSpaceMm, globalStaffSpaceMm)
  ) {
    return null;
  }

  const factor = (geometry.outputScale * 10) / globalStaffSpaceMm;

  if (!finite(factor) || factor <= 0) {
    return null;
  }

  const [p0, p1, p2, p3] = points;
  const endpoint = type === 'start' ? p0 : p3;
  const noteOrigin = type === 'start' ? fromNoteOrigin : toNoteOrigin;
  const staffTopY = type === 'start' ? geometry.fromStaffTopY : geometry.toStaffTopY;
  const control = type === 'start' ? p1 : p2;
  const attrs: Attributes = {
    'default-x': (endpoint[0] - noteOrigin[0]) * factor,
    'default-y': (endpoint[1] - staffTopY) * factor,
    'bezier-x': (control[0] - endpoint[0]) * factor,
    'bezier-y': (control[1] - endpoint[1]) * factor,
  };

  if (Object.values(attrs).some((value) => !finite(value))) {
    return null;
  }

  return attrs;
}

export function curveAttributes(
  mark: { span: Curve; type: string; number: number },
  includeOffset = true,
): Attributes {
  const { span, type, number } = mark;
  const dash = span.dash[0];
  const fraction = dash?.[2] ?? 1,
    period = dash?.[3] ?? 1;
  const dotted = dash && fraction <= 0.1;
  const dashed = dash && fraction > 0.1 && fraction < 1;

  return {
    type,
    number,
    ...(span.direction
      ? {
          placement: span.direction === 1 ? 'above' : 'below',
          orientation: span.direction === 1 ? 'over' : 'under',
        }
      : {}),
    'line-type': dotted ? 'dotted' : dashed ? 'dashed' : 'solid',
    ...(dashed && period > 0
      ? {
          'dash-length': 10 * period * fraction,
          'space-length': 10 * period * (1 - fraction),
        }
      : {}),
    color: span.hidden ? '#00000000' : musicXMLColor(span.color),
    ...(includeOffset && span.offset[0] ? { 'relative-x': span.offset[0] * 10 } : {}),
    ...(includeOffset && span.offset[1] ? { 'relative-y': span.offset[1] * 10 } : {}),
  };
}
