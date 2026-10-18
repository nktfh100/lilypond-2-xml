import {
  type DecodedExtension,
  fontContext,
  musicFonts,
  nullableMoment,
  numeric,
  pitch,
  rational,
} from './values.js';
import type { WireEvent } from '../wire.js';

export function decodeVowelTransitionRequest(
  e: Extract<WireEvent, { k: 'vowel-transition-request' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'vowelTransitionRequest',
    verse: e.verse,
    voice: e.voice,
    moment,
  };
}

export function decodeVowelTransition(
  e: Extract<WireEvent, { k: 'vowel-transition' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  const coordinate = (value: number | string | null, field: string) =>
    value == null ? null : numeric(value, field);
  const reference = (side: 0 | 1) => nullableMoment(e['x-ref-m'][side], e['x-ref-g'][side]);

  return {
    kind: 'vowelTransition',
    id: e.id,
    piece: e.piece,
    verse: e.verse,
    voice: e.voice,
    staff: e.s,
    moment,
    resolvedStart: e['resolved-start'],
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    leftKind: e['left-kind'],
    rightKind: e['right-kind'],
    fromLyricId: e['from-lyric-id'],
    toLyricId: e['to-lyric-id'],
    fromLyricMoment: nullableMoment(
      e['from-lyric-m'],
      e['from-lyric-g'],
      'from-lyric-m',
      'from-lyric-g',
    ),
    toLyricMoment: nullableMoment(e['to-lyric-m'], e['to-lyric-g'], 'to-lyric-m', 'to-lyric-g'),
    style: e.style,
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    hidden: e.hidden,
    custom: e.custom,
    leftArrow: e['left-arrow'],
    rightArrow: e['right-arrow'],
    xTenths: [
      coordinate(e['x-tenths'][0], 'x-tenths[0]'),
      coordinate(e['x-tenths'][1], 'x-tenths[1]'),
    ] as const,
    yTenths: [
      coordinate(e['y-tenths'][0], 'y-tenths[0]'),
      coordinate(e['y-tenths'][1], 'y-tenths[1]'),
    ] as const,
    xReference: [reference(0), reference(1)] as const,
    staffSpace: coordinate(e['staff-space'], 'staff-space'),
    layoutStaffSpace: coordinate(e['layout-staff-space'], 'layout-staff-space'),
    dashFraction: numeric(e['dash-fraction'], 'dash-fraction'),
    dashPeriod: numeric(e['dash-period'], 'dash-period'),
    arrowLength: coordinate(e['arrow-length'], 'arrow-length'),
    arrowWidth: coordinate(e['arrow-width'], 'arrow-width'),
  };
}

export function decodeLabelAnchor(e: Extract<WireEvent, { k: 'label-anchor' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'label',
    id: e.id,
    context: e.context,
    moment,
    names: e.labels,
    observedMoment: {
      main: rational(e['observed-m'], 'observed-m'),
      grace: rational(e['observed-g'], 'observed-g'),
    },
    columnMoment: nullableMoment(e['column-m'], e['column-g'], 'column-m', 'column-g'),
  };
}

export function decodeCombineText(e: Extract<WireEvent, { k: 'combine-text' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'combineText',
    id: e.id,
    piece: e.piece,
    context: e.context,
    staff: e.s,
    moment,
    status: e.status,
    present: e.present,
    text: e.text,
    textObserved: e['text-observed'],
    ...(e.markup != null ? { markup: e.markup } : {}),
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
    direction: e.direction,
    hidden: e.hidden,
    custom: e.custom,
    ...(e['font-context'] ? { fontContext: fontContext(e['font-context']) } : {}),
    fontEncoding: e['font-encoding'],
    fontName: e['font-name'],
    ...(e['music-fonts'] !== undefined ? { musicFonts: musicFonts(e['music-fonts']) } : {}),
    xTenths: e['x-tenths'] == null ? null : numeric(e['x-tenths'], 'x-tenths'),
    yTenths: e['y-tenths'] == null ? null : numeric(e['y-tenths'], 'y-tenths'),
    xReference: nullableMoment(e['x-ref-m'], e['x-ref-g'], 'x-ref-m', 'x-ref-g'),
    columnMoment: nullableMoment(e['column-m'], e['column-g'], 'column-m', 'column-g'),
    staffSpace: e['staff-space'] == null ? null : numeric(e['staff-space'], 'staff-space'),
    layoutStaffSpace:
      e['layout-staff-space'] == null
        ? null
        : numeric(e['layout-staff-space'], 'layout-staff-space'),
  };
}

export function decodeFootnote(e: Extract<WireEvent, { k: 'footnote' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'footnote',
    id: e.id,
    piece: e.piece,
    context: e.context,
    staff: e.s,
    moment,
    hostKind: e['host-kind'],
    noteId: e.nid,
    body: e.body,
    ...(e.markup != null ? { markup: e.markup } : {}),
    marker: e.marker,
    ...(e['marker-markup'] != null ? { markerMarkup: e['marker-markup'] } : {}),
    automaticallyNumbered: e['automatically-numbered'],
    present: e.present,
    markerHidden: e['marker-hidden'],
    custom: e.custom,
  };
}

export function decodeLyricExtender(
  e: Extract<WireEvent, { k: 'lyric-extender' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'lyricExtender',
    id: e.id,
    piece: e.piece,
    verse: e.verse,
    voice: e.voice,
    staff: e.s,
    moment,
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    leftKind: e['left-kind'],
    rightKind: e['right-kind'],
    lyricMoment: nullableMoment(e['lyric-m'], e['lyric-g'], 'lyric-m', 'lyric-g'),
    headNotes: e['head-notes'],
    toNotes: e['to-notes'],
    hidden: e.hidden,
    custom: e.custom,
    autoGenerated: e['auto-generated'],
    color: e.color
      ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
      : null,
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
  };
}

export function decodeMeasureCounter(
  e: Extract<WireEvent, { k: 'measure-counter' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'measureCounter',
    id: e.id,
    piece: e.piece,
    context: e.context,
    staff: e.s,
    moment,
    endMoment: nullableMoment(e['end-m'], e['end-g'], 'end-m', 'end-g'),
    resolvedStart: e['resolved-start'],
    leftKind: e['left-kind'],
    rightKind: e['right-kind'],
    text: e.text,
    fontEncoding: e['font-encoding'],
    ...(e.markup !== undefined ? { markup: e.markup } : {}),
    ...(e['font-context'] ? { fontContext: fontContext(e['font-context']) } : {}),
    ...(e['music-fonts'] !== undefined ? { musicFonts: musicFonts(e['music-fonts']) } : {}),
    xTenths: e['x-tenths'] == null ? null : numeric(e['x-tenths'], 'x-tenths'),
    yTenths: e['y-tenths'] == null ? null : numeric(e['y-tenths'], 'y-tenths'),
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

export function decodePercent(
  e: Extract<WireEvent, { k: 'percent' }>,
  extensions: readonly WireEvent[],
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'percentRepeat',
    id: e.id,
    voice: e.v,
    staff: e.s,
    class: e.c,
    length: rational(e.length, 'length'),
    count: e.count,
    slashes: e.slashes,
    moment,
    graphics: extensions
      .filter((g) => g.k === 'percentgraphic')
      .filter((g) => g.id === e.id)
      .map((g) => ({
        name: g.name,
        text: typeof g.text === 'string' ? g.text : '',
        hidden: g.hidden,
        moment: { main: rational(g.m), grace: rational(g.g) },
      })),
  };
}

export function decodeInstrumentname(
  e: Extract<WireEvent, { k: 'instrumentname' }>,
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'instrumentName',
    ...(typeof e['name-id'] === 'number' ? { nameId: e['name-id'] } : {}),
    ...(e.color !== undefined
      ? {
          color: e.color
            ? e.color.map((value, valueIndex) => numeric(value, `color[${valueIndex}]`))
            : null,
        }
      : {}),
    context: e.context,
    text: typeof e.text === 'string' ? e.text : '',
    shortText: typeof e.short === 'string' ? e.short : '',
    markup: e.markup,
    shortMarkup: e['short-markup'],
    hidden: e.hidden,
    custom: e.custom,
    moment,
  };
}

export function decodeFiguredbass(
  e: Extract<WireEvent, { k: 'figuredbass' }>,
  extensions: readonly WireEvent[],
): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'figuredBass',
    context: e.v,
    staff: typeof e.s === 'number' ? e.s : null,
    direction: typeof e.direction === 'number' ? e.direction : 0,
    duration: {
      log: e.d[0],
      dots: e.d[1],
      scale: rational(e.d[2]),
    },
    skip: e.skip,
    alterationDirection: e['alt-direction'],
    plusDirection: e['plus-direction'],
    custom: e.custom,
    moment,
    figures: e.figures.map((f) => {
      const graphic = extensions.find(
        (g): g is Extract<WireEvent, { k: 'figuregraphic' }> =>
          g.k === 'figuregraphic' && g.id === f.id,
      );
      const line = extensions.find(
        (g): g is Extract<WireEvent, { k: 'figureline' }> =>
          g.k === 'figureline' && g.from === f.id,
      );

      return {
        id: f.id,
        ...(graphic
          ? { graphic: true }
          : e['graphics-captured'] === true
            ? { graphic: false }
            : {}),
        ...(graphic?.column === null
          ? { column: null }
          : graphic?.column
            ? {
                column: {
                  main: rational(graphic.column.m),
                  grace: rational(graphic.column.g),
                },
              }
            : {}),
        ...(graphic?.column && typeof graphic.column.used === 'boolean'
          ? { columnUsed: graphic.column.used }
          : {}),
        ...(graphic?.position === null
          ? { graphicPosition: null }
          : graphic?.position
            ? {
                graphicPosition: {
                  units: graphic.position.units,
                  system: graphic.position.system,
                  staffContext: graphic.position['staff-context'],
                  columnMoment: {
                    main: rational(graphic.position['column-m']),
                    grace: rational(graphic.position['column-g']),
                  },
                  columnUsed: graphic.position['column-used'],
                  systemXTenths: graphic.position['system-x-tenths'],
                  columnXTenths: graphic.position['column-x-tenths'],
                  itemColumnXTenths: graphic.position['item-column-x-tenths'],
                  systemYTenths: graphic.position['system-y-tenths'],
                  staffTopSystemYTenths: graphic.position['staff-top-system-y-tenths'],
                  yTenths: graphic.position['y-tenths'],
                  stencilXExtentTenths: graphic.position['stencil-x-tenths'] as [number, number],
                  stencilYExtentTenths: graphic.position['stencil-y-tenths'] as [number, number],
                  layoutStaffSpace: graphic.position['layout-staff-space'],
                  localStaffSpace: graphic.position['local-staff-space'],
                  outputScale:
                    typeof graphic.position['output-scale'] === 'number'
                      ? graphic.position['output-scale']
                      : null,
                  stencilLive: graphic.position['stencil-live'],
                  ...(graphic.position.tokens
                    ? {
                        tokens: Object.fromEntries(
                          Object.entries(graphic.position.tokens).map(([role, offset]) => [
                            role,
                            offset.map((value, valueIndex) =>
                              numeric(value, `graphic.position.tokens.${role}[${valueIndex}]`),
                            ),
                          ]),
                        ),
                      }
                    : {}),
                },
              }
            : {}),
        ...(graphic?.display !== undefined ? { display: graphic.display } : {}),
        ...(line?.offset
          ? {
              continuation: {
                color: line.color
                  ? line.color.map((value, valueIndex) =>
                      numeric(value, `line.color[${valueIndex}]`),
                    )
                  : null,
                offset: line.offset.map((value, valueIndex) =>
                  numeric(value, `line.offset[${valueIndex}]`),
                ) as [number, number],
                hidden: line.hidden === true,
                custom: line.custom === true,
                style: line.style ?? 'line',
                thickness: numeric(line.thickness ?? 1, 'line.thickness'),
              },
            }
          : {}),
        ...(graphic?.color !== undefined
          ? {
              color: graphic.color
                ? graphic.color.map((value, valueIndex) =>
                    numeric(value, `graphic.color[${valueIndex}]`),
                  )
                : null,
            }
          : {}),
        ...(graphic?.['font-context'] ? { fontContext: fontContext(graphic['font-context']) } : {}),
        ...(graphic?.['number-font-context']
          ? {
              numberFontContext: {
                ...fontContext(graphic['number-font-context']),
                encoding: graphic['number-font-context'].encoding,
              },
            }
          : {}),
        ...(graphic?.custom !== undefined ? { custom: graphic.custom } : {}),
        number: typeof f.figure === 'number' ? f.figure : null,
        alteration: f.alteration === false ? null : rational(f.alteration),
        augmented: f.augmented === true,
        diminished: f.diminished === true,
        augmentedSlash: f['augmented-slash'] === true,
        bracketStart: f['bracket-start'] === true,
        bracketStop: f['bracket-stop'] === true,
        alterationBracket: f['alteration-bracket'] === true,
        noContinuation: f['no-continuation'] === true,
        text: typeof f.text === 'string' ? f.text : null,
        markup: f.markup || null,
        row: typeof graphic?.row === 'number' ? graphic.row : null,
        hidden:
          (e['graphics-captured'] === true && !graphic) ||
          (graphic?.hidden ?? false) ||
          graphic?.column === null ||
          (!!graphic?.column && graphic.column.used === false),
        implicit: graphic?.implicit ?? false,
        extendTo: typeof line?.to === 'number' ? line.to : null,
      };
    }),
  };
}

export function decodeNavigation(e: Extract<WireEvent, { k: 'navigation' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'navigation',
    class: e.c,
    text: e.text,
    markup: e.markup,
    enclosure: e.enclosure,
    bold: e.bold,
    italic: e.italic,
    direction: e.direction,
    hidden: e.hidden,
    finalVisible: e['final-visible'],
    segno: e.segno,
    coda: e.coda,
    returnCount: e['return-count'],
    alternativeNumber: e['alternative-number'],
    moment,
  };
}

export function decodeHarmony(e: Extract<WireEvent, { k: 'harmony' }>): DecodedExtension {
  const moment = { main: rational(e.m, 'm'), grace: rational(e.g, 'g') };

  return {
    kind: 'harmony',
    context: e.v,
    duration: {
      log: e.d[0],
      dots: e.d[1],
      scale: rational(e.d[2]),
    },
    pitches: e.pitches.map((p) => ({
      octave: p[0],
      step: p[1],
      alteration: rational(p[2]),
    })),
    playedPitches: e.played.map((p) => ({
      octave: p[0],
      step: p[1],
      alteration: rational(p[2]),
    })),
    bass: pitch(e.bass),
    inversion: pitch(e.inversion),
    text: typeof e.text === 'string' ? e.text : '',
    skip: e.skip,
    repeated: e.repeat,
    moment,
  };
}
