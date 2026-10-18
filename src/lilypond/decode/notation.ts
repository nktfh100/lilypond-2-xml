import { type DecodedExtension, fontContext, nullableMoment, numeric, rational } from './values.js';
import type { WireEvent } from '../wire.js';

export function decodeFingerGlide(
  e: Extract<WireEvent, { k: 'fingerglide' | 'episema' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  const label = (value: Extract<WireEvent, { k: 'fingerglide' }>['from-label']) =>
    value
      ? {
          id: value.id,
          kind: value.kind,
          text: value.text,
          noteIds: value['note-ids'],
        }
      : null;
  const reference = (side: 0 | 1) => nullableMoment(e['x-ref-m'][side], e['x-ref-g'][side]);
  const coordinate = (value: number | string | null, field: string) =>
    value == null ? null : numeric(value, field);
  const data = {
    id: e.id,
    piece: e.piece,
    voice: e.voice,
    staff: e.s,
    moment,
    resolvedStart: e['resolved-start'],
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    leftKind: e['left-kind'],
    fromNotes: e['from-notes'],
    rightKind: e['right-kind'],
    toNotes: e['to-notes'],
    style: e.style,
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    hidden: e.hidden,
    custom: e.custom,
    dashFraction: numeric(e['dash-fraction'], 'dash-fraction'),
    dashPeriod: numeric(e['dash-period'], 'dash-period'),
    staffSpace: e['staff-space'] == null ? null : numeric(e['staff-space'], 'staff-space'),
    layoutStaffSpace:
      e['layout-staff-space'] == null
        ? null
        : numeric(e['layout-staff-space'], 'layout-staff-space'),
    xTenths: [
      coordinate(e['x-tenths'][0], 'x-tenths[0]'),
      coordinate(e['x-tenths'][1], 'x-tenths[1]'),
    ] as const,
    yTenths: [
      coordinate(e['y-tenths'][0], 'y-tenths[0]'),
      coordinate(e['y-tenths'][1], 'y-tenths[1]'),
    ] as const,
    xReference: [reference(0), reference(1)] as const,
  };

  return e.k === 'episema'
    ? { ...data, kind: 'episema' }
    : {
        ...data,
        kind: 'fingerGlide',
        fromLabel: label(e['from-label']),
        toLabel: label(e['to-label']),
      };
}

export function decodeBendgraphic(e: Extract<WireEvent, { k: 'bendgraphic' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  const head = (h: Extract<WireEvent, { k: 'bendgraphic' }>['from-heads'][number]) => ({
    noteId: h.nid,
    kind: h.kind,
    eligible: h.eligible,
    hidden: h.hidden,
    parenthesized: h.parenthesized,
    stemHidden: h['stem-hidden'],
    flagHidden: h['flag-hidden'],
    dotsHidden: h['dots-hidden'],
    beamHidden: h['beam-hidden'],
  });

  return {
    kind: 'bendGraphic',
    id: e.id,
    piece: e.piece,
    voice: e.voice,
    staff: e.s,
    moment,
    resolvedStart: e['resolved-start'],
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    leftKind: e['left-kind'],
    rightKind: e['right-kind'],
    fromHeads: e['from-heads'].map(head),
    toHeads: e['to-heads'].map(head),
    fromNotes: e['from-notes'],
    toNotes: e['to-notes'],
    quarterDifference:
      e['quarter-difference'] == null
        ? null
        : numeric(e['quarter-difference'], 'quarter-difference'),
    style: e.style,
    text: e.text,
    textCustom: e['text-custom'],
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    hidden: e.hidden,
    custom: e.custom,
    successiveLevel:
      e['successive-level'] == null ? null : numeric(e['successive-level'], 'successive-level'),
    ...(e['font-context'] ? { fontContext: fontContext(e['font-context']) } : {}),
    dashSettings: e['dash-settings']
      ? ([
          numeric(e['dash-settings'][0], 'dash-settings[0]'),
          numeric(e['dash-settings'][1], 'dash-settings[1]'),
          numeric(e['dash-settings'][2], 'dash-settings[2]'),
        ] as const)
      : null,
    staffSpace: e['staff-space'] == null ? null : numeric(e['staff-space'], 'staff-space'),
    layoutStaffSpace:
      e['layout-staff-space'] == null
        ? null
        : numeric(e['layout-staff-space'], 'layout-staff-space'),
  };
}

export function decodeOptionalMaterial(
  e: Extract<WireEvent, { k: 'optional-material' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'optionalMaterial',
    id: e.id,
    piece: e.piece,
    context: e.context,
    staff: e.s,
    moment,
    passageDirection: e['passage-direction'],
    rectangles:
      e.rectangles?.map(
        (r, rIndex) =>
          [
            numeric(r[0], `rectangles[${rIndex}][0]`),
            numeric(r[1], `rectangles[${rIndex}][1]`),
            numeric(r[2], `rectangles[${rIndex}][2]`),
            numeric(r[3], `rectangles[${rIndex}][3]`),
            numeric(r[4], `rectangles[${rIndex}][4]`),
          ] as const,
      ) ?? null,
    xReference: nullableMoment(e['x-ref-m'], e['x-ref-g'], 'x-ref-m', 'x-ref-g'),
    staffSpace: e['staff-space'] == null ? null : numeric(e['staff-space'], 'staff-space'),
    layoutStaffSpace:
      e['layout-staff-space'] == null
        ? null
        : numeric(e['layout-staff-space'], 'layout-staff-space'),
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    hidden: e.hidden,
    custom: e.custom,
  };
}

export function decodeLigature(e: Extract<WireEvent, { k: 'ligature' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'ligature',
    id: e.id,
    piece: e.piece,
    voice: e.voice,
    staff: e.s,
    moment,
    name: e.name,
    resolvedStart: e['resolved-start'],
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    leftKind: e['left-kind'],
    fromNotes: e['from-notes'],
    rightKind: e['right-kind'],
    toNotes: e['to-notes'],
    direction: e.direction,
    edges: [numeric(e.edges[0], 'edges[0]'), numeric(e.edges[1], 'edges[1]')],
    style: e.style,
    dashedEdges: e['dashed-edges'],
    dashFraction: numeric(e['dash-fraction'], 'dash-fraction'),
    dashPeriod: numeric(e['dash-period'], 'dash-period'),
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    hidden: e.hidden,
    custom: e.custom,
    slur: e.slur,
    yTenths: e['y-tenths']
      ? [numeric(e['y-tenths'][0], 'y-tenths[0]'), numeric(e['y-tenths'][1], 'y-tenths[1]')]
      : null,
    positions: e.positions
      ? [numeric(e.positions[0], 'positions[0]'), numeric(e.positions[1], 'positions[1]')]
      : null,
    xPositions: e['x-positions']
      ? [
          numeric(e['x-positions'][0], 'x-positions[0]'),
          numeric(e['x-positions'][1], 'x-positions[1]'),
        ]
      : null,
    staffSpace: e['staff-space'] == null ? null : numeric(e['staff-space'], 'staff-space'),
    layoutStaffSpace:
      e['layout-staff-space'] == null
        ? null
        : numeric(e['layout-staff-space'], 'layout-staff-space'),
    extraOffset: [
      numeric(e['extra-offset'][0], 'extra-offset[0]'),
      numeric(e['extra-offset'][1], 'extra-offset[1]'),
    ],
    flare: [numeric(e.flare[0], 'flare[0]'), numeric(e.flare[1], 'flare[1]')],
    shorten: [numeric(e.shorten[0], 'shorten[0]'), numeric(e.shorten[1], 'shorten[1]')],
    connect: e.connect,
  };
}

export function decodeDurationline(e: Extract<WireEvent, { k: 'durationline' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'durationLine',
    id: e.id,
    piece: e.piece,
    voice: e.voice,
    staff: e.s,
    moment,
    resolvedStart: e['resolved-start'],
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    leftKind: e['left-kind'],
    fromNotes: e['from-notes'],
    rightKind: e['right-kind'],
    toNotes: e['to-notes'],
    style: e.style,
    endStyle: typeof e['end-style'] === 'string' ? e['end-style'] : null,
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    hidden: e.hidden,
    custom: e.custom,
    yTenths: e['y-tenths'] == null ? null : numeric(e['y-tenths'], 'y-tenths'),
    staffSpace: e['staff-space'] == null ? null : numeric(e['staff-space'], 'staff-space'),
    layoutStaffSpace:
      e['layout-staff-space'] == null
        ? null
        : numeric(e['layout-staff-space'], 'layout-staff-space'),
    thickness: e.thickness == null ? null : numeric(e.thickness, 'thickness'),
    extraOffset: [
      numeric(e['extra-offset'][0], 'extra-offset[0]'),
      numeric(e['extra-offset'][1], 'extra-offset[1]'),
    ],
    hookDirection: e['hook-direction'],
    hookHeight: numeric(e['hook-height'], 'hook-height'),
    dashFraction: numeric(e['dash-fraction'], 'dash-fraction'),
    dashPeriod: numeric(e['dash-period'], 'dash-period'),
  };
}

export function decodeBracket(e: Extract<WireEvent, { k: 'bracket' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'bracket',
    id: e.id,
    context: e.context,
    staff: e.s,
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    textColor: e['text-color']
      ? e['text-color'].map((value, valueIndex) => numeric(value, `text-color[${valueIndex}]`))
      : null,
    textCustom: e['text-custom'],
    dashFraction: numeric(e['dash-fraction'], 'dash-fraction'),
    dashPeriod: numeric(e['dash-period'], 'dash-period'),
    bracketType: e.kind,
    resolvedStart: e['resolved-start'],
    moment,
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    direction: e.direction,
    edges: [numeric(e.edges[0], 'edges[0]'), numeric(e.edges[1], 'edges[1]')],
    flare: [numeric(e.flare[0], 'flare[0]'), numeric(e.flare[1], 'flare[1]')],
    shorten: [numeric(e.shorten[0], 'shorten[0]'), numeric(e.shorten[1], 'shorten[1]')],
    style: e.style,
    hidden: e.hidden,
    custom: e.custom,
    text: e.text,
    markup: e.markup,
    textHidden: e['text-hidden'],
    textSize: numeric(e['text-size'], 'text-size'),
  };
}

export function decodeArpeggio(e: Extract<WireEvent, { k: 'arpeggio' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'arpeggio',
    id: e.id,
    context: e.context,
    noteIds: e.notes,
    style: e.style,
    direction: e.arrow,
    side: e.side,
    dashed: e.dashed,
    fontSize: numeric(e.size, 'size'),
    positions: e.positions
      ? [numeric(e.positions[0], 'positions[0]'), numeric(e.positions[1], 'positions[1]')]
      : null,
    ...(e.color !== undefined
      ? {
          color: e.color
            ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
            : null,
        }
      : {}),
    ...(e.offset
      ? {
          offset: [numeric(e.offset[0], 'offset[0]'), numeric(e.offset[1], 'offset[1]')],
        }
      : {}),
    ...(e['head-positions']
      ? {
          headPositions: e['head-positions'].map(
            ([id, pos]) => [id, numeric(pos, `head-positions for note ${id}`)] as const,
          ),
        }
      : {}),
    ...(e['range-reference'] ? { rangeReference: e['range-reference'] } : {}),
    ...(e['range-base'] !== undefined
      ? {
          rangeBase: e['range-base'] === null ? null : numeric(e['range-base'], 'range-base'),
        }
      : {}),
    ...(e['range-staff-top'] !== undefined
      ? {
          rangeStaffTop:
            e['range-staff-top'] === null ? null : numeric(e['range-staff-top'], 'range-staff-top'),
        }
      : {}),
    ...(e['default-x'] !== undefined
      ? {
          defaultX: e['default-x'] === null ? null : numeric(e['default-x'], 'default-x'),
        }
      : {}),
    ...(e['custom-positions'] !== undefined ? { customPositions: e['custom-positions'] } : {}),
    ...(e['custom-geometry'] !== undefined ? { customGeometry: e['custom-geometry'] } : {}),
    hidden: e.hidden,
    custom: e.custom,
    moment,
  };
}

export function decodeScript(e: Extract<WireEvent, { k: 'script' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'script',
    ...(e['glyph-missing'] !== undefined ? { glyphMissing: e['glyph-missing'] } : {}),
    ...(e['font-points'] !== undefined
      ? {
          fontPoints: e['font-points'] === null ? null : numeric(e['font-points'], 'font-points'),
        }
      : {}),
    ...(e.breath !== undefined ? { breathSign: e.breath } : {}),
    ...(e.color !== undefined
      ? {
          color: e.color
            ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
            : null,
        }
      : {}),
    ...(e.offset
      ? {
          offset: [numeric(e.offset[0], 'offset[0]'), numeric(e.offset[1], 'offset[1]')] as const,
        }
      : {}),
    ...(typeof e.nid === 'number' ? { noteId: e.nid } : {}),
    ...(e['font-style'] ? { techniqueFontStyle: e['font-style'] } : {}),
    ...(e.text != null ? { techniqueMarkup: e.text } : {}),
    ...(typeof e.delta === 'number' ? { deltaPosition: e.delta } : {}),
    id: e.id,
    voice: e.v,
    staff: e.s,
    articulationType: e.articulation,
    axis: e.axis,
    staffPosition: typeof e['staff-position'] === 'number' ? e['staff-position'] : null,
    glyph: typeof e.glyph === 'string' ? e.glyph : '',
    direction: e.direction,
    fontSize: e['font-size'],
    hidden: e.hidden,
    custom: e.custom,
    moment,
  };
}

export function decodeNotesize(e: Extract<WireEvent, { k: 'notesize' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'noteSize',
    noteId: typeof e.nid === 'number' ? e.nid : null,
    voice: e.v,
    staff: e.s,
    eventKind: e.kind,
    fontSize: e.size,
    stemFontSize: typeof e['stem-size'] === 'number' ? e['stem-size'] : null,
    moment,
  };
}

export function decodeNotehead(e: Extract<WireEvent, { k: 'notehead' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'notehead',
    noteId: e.nid,
    style: typeof e.style === 'string' ? e.style : '',
    glyph: typeof e.glyph === 'string' ? e.glyph : '',
    durationLog: e.log,
    direction: e.direction,
    hidden: e.hidden,
    custom: e.custom,
    moment,
  };
}

export function decodeTabnote(e: Extract<WireEvent, { k: 'tabnote' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'tabNote',
    noteId: e.nid,
    staff: e.s,
    string: e.string,
    fret: e.fret,
    stems: e.stems,
    moment,
  };
}

export function decodeDrumscript(e: Extract<WireEvent, { k: 'drumscript' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'percussionScript',
    noteId: e.nid,
    glyph: e.glyph,
    direction: e.direction,
    hidden: e.hidden,
    moment,
  };
}

export function decodePercussion(e: Extract<WireEvent, { k: 'percussion' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'percussion',
    noteId: e.nid,
    staff: e.s,
    drumType: e.drum,
    position: e.position,
    noteheadStyle: e.style,
    moment,
  };
}

export function decodeTranspose(e: Extract<WireEvent, { k: 'transpose' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'transposition',
    staff: e.s,
    pitch: {
      octave: e.pitch[0],
      step: e.pitch[1],
      alteration: rational(e.pitch[2]),
    },
    moment,
  };
}
