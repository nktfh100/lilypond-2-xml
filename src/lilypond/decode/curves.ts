import { type DecodedExtension, nullableMoment, numeric, rational } from './values.js';
import type { TieResolvedGeometry } from '../../model/document.js';
import type { WireEvent } from '../wire.js';

function tiePoints(
  points: readonly (readonly [number | string, number | string])[],
): TieResolvedGeometry['points'] {
  if (points.length !== 4) {
    throw new TypeError(
      'Invalid extracted resolved tie field geometry.points: expected four control points',
    );
  }

  const point = (index: number): readonly [number, number] => {
    const row = points[index];

    if (!row || row.length !== 2) {
      throw new TypeError(
        `Invalid extracted resolved tie point field geometry.points[${index}]: expected two coordinates`,
      );
    }

    return [
      numeric(row[0], `geometry.points[${index}][0]`),
      numeric(row[1], `geometry.points[${index}][1]`),
    ];
  };

  return [point(0), point(1), point(2), point(3)];
}

export function decodeTiestate(e: Extract<WireEvent, { k: 'tiestate' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return { kind: 'tieState', voice: e.v, waitForNote: e.wait, moment };
}

export function decodeTiegraphic(e: Extract<WireEvent, { k: 'tiegraphic' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'tieGraphic',
    id: e.id,
    voice: e.v,
    staff: e.s,
    tieType: e.kind,
    fromNotes: e.from,
    toNotes: e.to,
    resolvedStart: e['resolved-start'],
    moment,
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    direction: e.direction,
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    offset: [numeric(e.offset[0], 'offset[0]'), numeric(e.offset[1], 'offset[1]')],
    dash: e.dash.map((row, rowIndex) =>
      row.map((value, valueIndex) => numeric(value, `dash[${rowIndex}][${valueIndex}]`)),
    ),
    customControls: e['custom-controls'],
    customDetails: e['custom-details'],
    controlPoints:
      e.controls?.map((row, rowIndex) => {
        if (row.length !== 2) {
          throw new TypeError(
            `Invalid extracted tie control point field controls[${rowIndex}]: expected two coordinates`,
          );
        }

        return [
          numeric(row[0]!, `controls[${rowIndex}][0]`),
          numeric(row[1]!, `controls[${rowIndex}][1]`),
        ] as const;
      }) ?? null,
    thickness: numeric(e.thickness, 'thickness'),
    lineThickness: numeric(e['line-thickness'], 'line-thickness'),
    hidden: e.hidden,
    custom: e.custom,
    ...(e.geometry
      ? {
          resolvedGeometry: {
            tieId: e.geometry['tie-id'],
            system: e.geometry.system,
            fromNoteId: e.geometry['from-note-id'],
            toNoteId: e.geometry['to-note-id'],
            fromHeadId: e.geometry['from-head-id'],
            toHeadId: e.geometry['to-head-id'],
            fromStaffContext: e.geometry['from-staff-context'],
            toStaffContext: e.geometry['to-staff-context'],
            fromStaffSymbolContext: e.geometry['from-staff-symbol-context'],
            toStaffSymbolContext: e.geometry['to-staff-symbol-context'],
            units: e.geometry.units,
            points: tiePoints(e.geometry.points),
            curveOrigin: [
              numeric(e.geometry['curve-origin'][0], 'geometry.curve-origin[0]'),
              numeric(e.geometry['curve-origin'][1], 'geometry.curve-origin[1]'),
            ] as const,
            fromNoteOrigin: [
              numeric(e.geometry['from-note-origin'][0], 'geometry.from-note-origin[0]'),
              numeric(e.geometry['from-note-origin'][1], 'geometry.from-note-origin[1]'),
            ] as const,
            toNoteOrigin: [
              numeric(e.geometry['to-note-origin'][0], 'geometry.to-note-origin[0]'),
              numeric(e.geometry['to-note-origin'][1], 'geometry.to-note-origin[1]'),
            ] as const,
            fromStaffTopY: numeric(e.geometry['from-staff-top-y'], 'geometry.from-staff-top-y'),
            toStaffTopY: numeric(e.geometry['to-staff-top-y'], 'geometry.to-staff-top-y'),
            outputScale: numeric(e.geometry['output-scale'], 'geometry.output-scale'),
            layoutStaffSpaceMm: numeric(
              e.geometry['layout-staff-space-mm'],
              'geometry.layout-staff-space-mm',
            ),
            fromLocalStaffSpaceMm: numeric(
              e.geometry['from-local-staff-space-mm'],
              'geometry.from-local-staff-space-mm',
            ),
            toLocalStaffSpaceMm: numeric(
              e.geometry['to-local-staff-space-mm'],
              'geometry.to-local-staff-space-mm',
            ),
            globalStaffSpaceMm: numeric(
              e.geometry['global-staff-space-mm'],
              'geometry.global-staff-space-mm',
            ),
          },
        }
      : {}),
  };
}

export function decodeGlissando(e: Extract<WireEvent, { k: 'glissando' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'glissando',
    id: e.id,
    voice: e.v,
    staff: e.s,
    fromNotes: e.from,
    toNotes: e.to,
    resolvedStart: e['resolved-start'],
    moment,
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    style: e.style,
    dashFraction: numeric(e['dash-fraction'], 'dash-fraction'),
    dashPeriod: numeric(e['dash-period'], 'dash-period'),
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    offset: [numeric(e.offset[0], 'offset[0]'), numeric(e.offset[1], 'offset[1]')],
    hidden: e.hidden,
    custom: e.custom,
    customBounds: e['custom-bounds'],
    thickness: numeric(e.thickness, 'thickness'),
  };
}

export function decodeSlur(e: Extract<WireEvent, { k: 'slur' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'slur',
    id: e.id,
    label: e.label,
    voice: e.v,
    staff: e.s,
    phrasing: e.phrasing,
    fromNotes: e.from,
    toNotes: e.to,
    fromHead: e['from-head'],
    toHead: e['to-head'],
    resolvedStart: e['resolved-start'],
    moment,
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    direction: e.direction,
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    offset: [numeric(e.offset[0], 'offset[0]'), numeric(e.offset[1], 'offset[1]')],
    dash: e.dash.map((row, rowIndex) =>
      row.map((value, valueIndex) => numeric(value, `dash[${rowIndex}][${valueIndex}]`)),
    ),
    customControls: e['custom-controls'],
    controlPoints:
      e.controls?.map((row, rowIndex) => {
        if (row.length !== 2) {
          throw new TypeError(
            `Invalid extracted slur control point field controls[${rowIndex}]: expected two coordinates`,
          );
        }

        return [
          numeric(row[0]!, `controls[${rowIndex}][0]`),
          numeric(row[1]!, `controls[${rowIndex}][1]`),
        ] as const;
      }) ?? null,
    ...(e.geometry
      ? {
          resolvedGeometry: {
            slurId: e.geometry['slur-id'],
            system: e.geometry.system,
            staffContext: e.geometry['staff-context'],
            staffSymbolContext: e.geometry['staff-symbol-context'],
            fromNoteId: e.geometry['from-note-id'],
            toNoteId: e.geometry['to-note-id'],
            fromHeadId: e.geometry['from-head-id'],
            toHeadId: e.geometry['to-head-id'],
            units: e.geometry.units,
            points: e.geometry.points.map((point, pointIndex) => {
              if (point.length !== 2) {
                throw new TypeError(
                  `Invalid extracted resolved slur point field geometry.points[${pointIndex}]: expected two coordinates`,
                );
              }

              return [
                numeric(point[0], `geometry.points[${pointIndex}][0]`),
                numeric(point[1], `geometry.points[${pointIndex}][1]`),
              ] as const;
            }),
            curveOrigin: [
              numeric(e.geometry['curve-origin'][0], 'geometry.curve-origin[0]'),
              numeric(e.geometry['curve-origin'][1], 'geometry.curve-origin[1]'),
            ] as const,
            fromNoteOrigin: [
              numeric(e.geometry['from-note-origin'][0], 'geometry.from-note-origin[0]'),
              numeric(e.geometry['from-note-origin'][1], 'geometry.from-note-origin[1]'),
            ] as const,
            toNoteOrigin: [
              numeric(e.geometry['to-note-origin'][0], 'geometry.to-note-origin[0]'),
              numeric(e.geometry['to-note-origin'][1], 'geometry.to-note-origin[1]'),
            ] as const,
            staffTopY: numeric(e.geometry['staff-top-y'], 'geometry.staff-top-y'),
            outputScale: numeric(e.geometry['output-scale'], 'geometry.output-scale'),
            layoutStaffSpaceMm: numeric(
              e.geometry['layout-staff-space-mm'],
              'geometry.layout-staff-space-mm',
            ),
            localStaffSpaceMm: numeric(
              e.geometry['local-staff-space-mm'],
              'geometry.local-staff-space-mm',
            ),
            globalStaffSpaceMm:
              e.geometry['global-staff-space-mm'] === null
                ? null
                : numeric(e.geometry['global-staff-space-mm'], 'geometry.global-staff-space-mm'),
          },
        }
      : {}),
    heightLimit: numeric(e['height-limit'], 'height-limit'),
    ratio: numeric(e.ratio, 'ratio'),
    thickness: numeric(e.thickness, 'thickness'),
    hidden: e.hidden,
    custom: e.custom,
  };
}

export function decodeClustergraphic(
  e: Extract<WireEvent, { k: 'clustergraphic' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'clusterGraphic',
    voice: e.v,
    staff: e.s,
    noteIds: e.notes,
    moment,
    present: e.present,
    hidden: e.hidden,
    custom: e.custom,
    style: e.style,
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    positions: e.positions
      ? [numeric(e.positions[0], 'positions[0]'), numeric(e.positions[1], 'positions[1]')]
      : null,
  };
}
