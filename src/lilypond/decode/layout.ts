import {
  type DecodedExtension,
  fontContext,
  musicFonts,
  nullableMoment,
  nullableNumber,
  numeric,
  rational,
} from './values.js';
import type { WireEvent } from '../wire.js';

export function decodeAccidentalGraphic(
  e: Extract<WireEvent, { k: 'accidental-graphic' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'accidentalGraphic',
    grobName: e.grob,
    id: e.id,
    noteId: e.nid,
    staff: e.s,
    moment,
    pieces: e.pieces.map((p, pIndex) => ({
      system: p.system,
      piece: p.piece,
      hidden: p.hidden,
      custom: p.custom,
      glyph: p.glyph,
      parenthesized: p.parenthesized,
      restoreFirst: p['restore-first'],
      color:
        p.color?.map((value, valueIndex) =>
          numeric(value, `pieces[${pIndex}].color[${valueIndex}]`),
        ) ?? null,
      fontPoints: nullableNumber(p['font-points'], `pieces[${pIndex}].font-points`),
    })),
  };
}

export function decodeFinalLayout(e: Extract<WireEvent, { k: 'finallayout' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'finalLayout',
    moment,
    status: e.status,
    ...(e.stage ? { stage: e.stage } : {}),
    attempted: e.attempted,
    failure: e.failure,
  };
}

export function decodeNamepiece(e: Extract<WireEvent, { k: 'namepiece' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'instrumentLabelPiece',
    moment,
    context: e.context,
    nameId: e['name-id'],
    system: e.system,
    endMoment:
      e['end-m'] === null || e['end-g'] === null
        ? null
        : {
            main: rational(e['end-m'], 'end-m'),
            grace: rational(e['end-g'], 'end-g'),
          },
    text: e.text,
    markup: e.markup,
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    hidden: e.hidden,
    custom: e.custom,
    x: e.x === null ? null : numeric(e.x, 'x'),
    y: e.y === null ? null : numeric(e.y, 'y'),
    outputScale: numeric(e['output-scale'], 'output-scale'),
    staffSpace: e['staff-space'] === null ? null : numeric(e['staff-space'], 'staff-space'),
    ...(e['font-context'] ? { fontContext: fontContext(e['font-context']) } : {}),
    ...(e['music-fonts'] !== undefined ? { musicFonts: musicFonts(e['music-fonts']) } : {}),
  };
}

export function decodeStaffstep(e: Extract<WireEvent, { k: 'staffstep' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'staffStep',
    staff: e.s,
    bar: e.bar,
    position: rational(e.pos, 'pos'),
    length: rational(e.len, 'len'),
    timing: e.timing,
    moment,
    ...(e.time ? { time: { numerator: e.time[0], denominator: e.time[1] } } : {}),
  };
}

export function decodeMeasureLayout(
  e: Extract<WireEvent, { k: 'measure-layout' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  const coordinate = (v: number | string | null, field: string) =>
    v == null ? null : numeric(v, field);

  return {
    kind: 'measureLayout',
    id: e.id,
    piece: e.piece,
    staff: e.s,
    system: e.system,
    moment,
    endMoment: {
      main: rational(e['end-m'], 'end-m'),
      grace: rational(e['end-g'], 'end-g'),
    },
    columnMoment: nullableMoment(e['column-m'], e['column-g'], 'column-m', 'column-g'),
    endColumnMoment: nullableMoment(
      e['end-column-m'],
      e['end-column-g'],
      'end-column-m',
      'end-column-g',
    ),
    startXTenths: coordinate(e['start-x-tenths'], 'start-x-tenths'),
    endXTenths: coordinate(e['end-x-tenths'], 'end-x-tenths'),
    widthTenths: coordinate(e['width-tenths'], 'width-tenths'),
    layoutStaffSpace: coordinate(e['layout-staff-space'], 'layout-staff-space'),
    lineWidthTenths: coordinate(e['line-width-tenths'], 'line-width-tenths'),
    systemLeftXTenths: coordinate(e['system-left-x-tenths'], 'system-left-x-tenths'),
    systemRightXTenths: coordinate(e['system-right-x-tenths'], 'system-right-x-tenths'),
    firstOnSystem: e['first-on-system'],
    lastOnSystem: e['last-on-system'],
    startKind: e['start-kind'],
    endKind: e['end-kind'],
  };
}

export function decodeTextcolumnposition(
  e: Extract<WireEvent, { k: 'textcolumnposition' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  const safeCoordinate = (v: unknown): number => {
    if (typeof v !== 'number' && typeof v !== 'string') {
      return Number.NaN;
    }

    try {
      return numeric(v);
    } catch {
      return Number.NaN;
    }
  };
  const positionMoment = (() => {
    try {
      return {
        main: rational(e['column-moment'].main),
        grace: rational(e['column-moment'].grace),
      };
    } catch {
      return null;
    }
  })();

  return {
    kind: 'textColumnPosition',
    id: e.id,
    context: e.context,
    staffContext: e['staff-context'],
    system: e.system,
    moment: positionMoment ?? moment,
    momentValid: positionMoment !== null,
    units: e.units,
    systemLeftOriginXTenths: safeCoordinate(e['system-left-origin-x-tenths']),
    outputScale: safeCoordinate(e['output-scale']),
    globalLayoutStaffSpace: safeCoordinate(e['global-layout-staff-space']),
    globalStaffSpaceMm: safeCoordinate(e['global-staff-space-mm']),
    lines: Array.isArray(e.lines)
      ? e.lines.map((rawLine) => {
          const line =
            rawLine && typeof rawLine === 'object' && !Array.isArray(rawLine)
              ? (rawLine as Record<string, unknown>)
              : {};

          return {
            index: Number.isSafeInteger(line.index) ? (line.index as number) : Number.NaN,
            text: typeof line.text === 'string' ? line.text : '',
            systemLeftRelativeXTenths: safeCoordinate(line['system-left-relative-x-tenths']),
            staffTopYTenths: safeCoordinate(line['staff-top-y-tenths']),
          };
        })
      : [],
  };
}

export function decodeNotePosition(
  e: Extract<WireEvent, { k: 'note-position' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  const coordinate = (v: number | string | null, field: string) =>
    v == null ? null : numeric(v, field);

  return {
    kind: 'notePosition',
    noteId: e.nid,
    id: e.id,
    piece: e.piece,
    voice: e.voice,
    staff: e.s,
    moment,
    columnMoment: nullableMoment(e['column-m'], e['column-g'], 'column-m', 'column-g'),
    xTenths: coordinate(e['x-tenths'], 'x-tenths'),
    yTenths: coordinate(e['y-tenths'], 'y-tenths'),
    xReference: nullableMoment(e['x-ref-m'], e['x-ref-g'], 'x-ref-m', 'x-ref-g'),
    originXTenths: coordinate(e['origin-x-tenths'], 'origin-x-tenths'),
    glyphLeftXTenths: coordinate(e['glyph-left-x-tenths'], 'glyph-left-x-tenths'),
    staffSpace: coordinate(e['staff-space'], 'staff-space'),
    layoutStaffSpace: coordinate(e['layout-staff-space'], 'layout-staff-space'),
    hidden: e.hidden,
    custom: e.custom,
    headOnlyOffset: e['head-only-offset'],
    grobName: e['grob-name'],
  };
}

export function decodeBarlineLayout(
  e: Extract<WireEvent, { k: 'barline-layout' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'barlineLayout',
    barlineId: e.id,
    staff: e.s,
    moment,
    pieces: e.pieces.map((piece) => ({
      system: piece.system,
      breakDirection: piece['break-direction'],
      glyph: piece.glyph,
      hidden: piece.hidden,
      custom: piece.custom,
    })),
  };
}

export function decodeBarline(e: Extract<WireEvent, { k: 'barline' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'barline',
    ...(e.id !== undefined ? { id: e.id } : {}),
    staff: e.s,
    glyph: e.glyph,
    hidden: e.hidden,
    moment,
  };
}

export function decodeLayout(e: Extract<WireEvent, { k: 'layout' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'layout',
    class: e.c,
    permission: e.permission,
    moment,
  };
}

export function decodeTabstaff(e: Extract<WireEvent, { k: 'tabstaff' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'tabStaff',
    staff: e.s,
    tunings: e.tunings.map((p) => ({
      octave: p[0],
      step: p[1],
      alteration: rational(p[2]),
    })),
    stringOneTopmost: e.topmost,
    capo: e.capo,
    visibility: e.visibility,
    moment,
  };
}

export function decodeStafflines(e: Extract<WireEvent, { k: 'stafflines' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'staffLines',
    staff: e.s,
    count: e.count,
    ...(e.positions !== undefined
      ? {
          positions:
            e.positions === null
              ? null
              : e.positions.map((value, valueIndex) => numeric(value, `positions[${valueIndex}]`)),
        }
      : {}),
    ...(e['staff-space'] !== undefined
      ? { staffSpace: numeric(e['staff-space'], 'staff-space') }
      : {}),
    ...(e['layout-staff-space'] !== undefined
      ? {
          layoutStaffSpace: numeric(e['layout-staff-space'], 'layout-staff-space'),
        }
      : {}),
    ...(e.hidden !== undefined ? { hidden: e.hidden } : {}),
    ...(e.custom !== undefined ? { custom: e.custom } : {}),
    ...(e.present !== undefined ? { present: e.present } : {}),
    ...(e.color !== undefined
      ? {
          color: e.color
            ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
            : null,
        }
      : {}),
    ...(e['line-width'] !== undefined
      ? {
          lineWidth: e['line-width'] === null ? null : numeric(e['line-width'], 'line-width'),
        }
      : {}),
    moment,
  };
}
