import { decodeEventDocument } from '@sightread/lilypond-eventdocument';
import { decodeExtension } from './extensions.js';
import { isExtensionEvent, isWireEvent } from './kinds.js';
import { fontContext, nullableNumber, numeric, rational } from './values.js';
import type { ScoreDocument } from '../../model/document.js';
import type { RawDocument, RawEvent } from '../wire.js';

/** Keep protocol flags explicit; the compiler requires every wire capture flag. */
const captureFlags = {
  'names-captured': 'namesCaptured',
  'scripts-captured': 'scriptsCaptured',
  'breaths-captured': 'breathsCaptured',
  'slurs-captured': 'slursCaptured',
  'glissandos-captured': 'glissandosCaptured',
  'ties-captured': 'tiesCaptured',
  'clusters-captured': 'clustersCaptured',
  'episemas-captured': 'episemasCaptured',
  'optional-material-captured': 'optionalMaterialCaptured',
  'bends-captured': 'bendsCaptured',
  'measure-counters-captured': 'measureCountersCaptured',
  'footnotes-captured': 'footnotesCaptured',
  'lyric-extenders-captured': 'lyricExtendersCaptured',
  'note-positions-captured': 'notePositionsCaptured',
  'measure-layouts-captured': 'measureLayoutsCaptured',
  'labels-captured': 'labelsCaptured',
  'combine-text-captured': 'combineTextCaptured',
  'vowel-transitions-captured': 'vowelTransitionsCaptured',
  'finger-glides-captured': 'fingerGlidesCaptured',
  'ligatures-captured': 'ligaturesCaptured',
  'duration-lines-captured': 'durationLinesCaptured',
  'brackets-captured': 'bracketsCaptured',
  'arpeggios-captured': 'arpeggiosCaptured',
  'accidentals-captured': 'accidentalsCaptured',
  'barline-layouts-captured': 'barlineLayoutsCaptured',
  'barlines-captured': 'barlinesCaptured',
  'page-credits-captured': 'pageCreditsCaptured',
  'page-layouts-captured': 'pageLayoutsCaptured',
} as const satisfies Record<
  Extract<keyof RawDocument, `${string}-captured`>,
  Extract<keyof ScoreDocument, `${string}Captured`>
>;

/** Interpret collector wire data independently of compilation and XML writing. */
export function decodeDocument(raw: RawDocument): ScoreDocument {
  const extensions = raw.events.filter(isWireEvent);
  const baseEvents = raw.events
    .filter(
      (e): e is RawEvent =>
        !isWireEvent(e) &&
        !(
          e.k === 'score' &&
          [
            'rehearsal-mark-event',
            'ad-hoc-mark-event',
            'segno-mark-event',
            'coda-mark-event',
            'section-label-event',
            'dal-segno-event',
            'fine-event',
            'ad-hoc-jump-event',
          ].includes(e.c)
        ),
    )
    .map((e) =>
      e.k === 'ev' && e.c === 'multi-measure-articulation-event'
        ? { ...e, c: 'articulation-event', 'xml-multi-rest': true }
        : e,
    );
  const decoded = decodeEventDocument(JSON.stringify({ ...raw, events: baseEvents }));
  const document: Omit<ScoreDocument, 'events'> & {
    events: ScoreDocument['events'][number][];
  } = { ...decoded, events: [...decoded.events] };

  if (typeof raw['layout-requested'] === 'boolean') {
    document.layoutRequested = raw['layout-requested'];
  }

  for (const [wire, domain] of Object.entries(captureFlags)) {
    if (raw[wire as keyof typeof captureFlags] === true) {
      document[domain] = true;
    }
  }

  const retainMarkup = (target: object, rawEvent: Partial<RawEvent>): void => {
    const event = target as {
      multiMeasureRest?: boolean;
      repeatContext?: number;
      scriptId?: number;
      textColumnId?: number;
      markup?: import('../../model/document.js').TextMarkup;
      quotedCue?: boolean;
      cue?: boolean;
      cluster?: boolean;
      attachments?: object[];
    };

    if (typeof rawEvent['repeat-context'] === 'number') {
      event.repeatContext = rawEvent['repeat-context'];
    }

    if (rawEvent.cluster === true) {
      event.cluster = true;
    }

    if (rawEvent['quoted-cue'] === true) {
      event.quotedCue = true;
      event.cue = rawEvent.cue === true;
    }

    if (rawEvent['xml-multi-rest'] === true) {
      event.multiMeasureRest = true;
    }

    if (typeof rawEvent['xml-script-id'] === 'number') {
      event.scriptId = rawEvent['xml-script-id'];
    }

    if (typeof rawEvent['xml-text-column-id'] === 'number') {
      event.textColumnId = rawEvent['xml-text-column-id'];
    }

    if (rawEvent['xml-markup'] !== undefined) {
      event.markup = rawEvent['xml-markup'];
    }

    event.attachments?.forEach((attachment, i) => retainMarkup(attachment, rawEvent.a?.[i] || {}));
  };

  document.events.forEach((event, i) => retainMarkup(event, baseEvents[i] || {}));

  if (raw['cue-quotes'] === true) {
    document.cueQuotes = true;
  }

  if (raw['header-scopes']) {
    document.headerScopes = raw['header-scopes'];
  }

  if (raw['header-styles']) {
    document.headerStyles = Object.fromEntries(
      Object.entries(raw['header-styles']).map(([key, value]) => [key, fontContext(value)]),
    );
  }

  if (raw['header-style-base']) {
    document.headerStyleBase = fontContext(raw['header-style-base']);
  }

  if (raw['header-markup']) {
    document.headerMarkup = raw['header-markup'];
  }

  if (raw['page-header-markup']) {
    document.pageHeaderMarkup = raw['page-header-markup'];
  }

  if (raw.paper && typeof raw.paper === 'object') {
    document.paper = raw.paper;
  }

  if (Array.isArray(raw['page-credits'])) {
    document.pageCredits = raw['page-credits'].map(
      (region: NonNullable<RawDocument['page-credits']>[number], regionIndex) => ({
        book: region.book,
        bookpart: region.bookpart,
        scope: region.scope,
        page: region.page,
        displayedPage: nullableNumber(
          region['displayed-page'],
          `raw.page-credits[${regionIndex}].displayed-page`,
        ),
        region: region.region,
        resolved: region.resolved,
        outputScale: nullableNumber(
          region['output-scale'],
          `raw.page-credits[${regionIndex}].output-scale`,
        ),
        width: nullableNumber(region.width, `raw.page-credits[${regionIndex}].width`),
        height: nullableNumber(region.height, `raw.page-credits[${regionIndex}].height`),
        items: region.items.map((item, itemIndex) => ({
          piece: item.piece,
          text: item.text,
          fontDescription: item['font-description'],
          x: nullableNumber(item.x, `raw.page-credits[${regionIndex}].items[${itemIndex}].x`),
          y: nullableNumber(item.y, `raw.page-credits[${regionIndex}].items[${itemIndex}].y`),
          fontScale: nullableNumber(
            item['font-scale'],
            `raw.page-credits[${regionIndex}].items[${itemIndex}].font-scale`,
          ),
          color:
            item.color?.map((value, valueIndex) =>
              numeric(
                value,
                `raw.page-credits[${regionIndex}].items[${itemIndex}].color[${valueIndex}]`,
              ),
            ) ?? null,
          unsupported: item.unsupported,
        })),
        primitives: region.primitives,
      }),
    );
  }

  if (Array.isArray(raw['page-layouts'])) {
    document.pageLayouts = raw['page-layouts'].map(
      (page: NonNullable<RawDocument['page-layouts']>[number], pageIndex) => ({
        book: page.book,
        bookpart: page.bookpart,
        scope: page.scope,
        page: page.page,
        displayedPage: page['displayed-page'],
        system: page.system,
        outputScale: nullableNumber(
          page['output-scale'],
          `raw.page-layouts[${pageIndex}].output-scale`,
        ),
        width: nullableNumber(page.width, `raw.page-layouts[${pageIndex}].width`),
        height: nullableNumber(page.height, `raw.page-layouts[${pageIndex}].height`),
        topMargin: nullableNumber(page['top-margin'], `raw.page-layouts[${pageIndex}].top-margin`),
        bottomMargin: nullableNumber(
          page['bottom-margin'],
          `raw.page-layouts[${pageIndex}].bottom-margin`,
        ),
        leftMargin: nullableNumber(
          page['left-margin'],
          `raw.page-layouts[${pageIndex}].left-margin`,
        ),
        rightMargin: nullableNumber(
          page['right-margin'],
          `raw.page-layouts[${pageIndex}].right-margin`,
        ),
        systemX: nullableNumber(page['system-x'], `raw.page-layouts[${pageIndex}].system-x`),
        systemY: nullableNumber(page['system-y'], `raw.page-layouts[${pageIndex}].system-y`),
        staves: page.staves.map((staff, staffIndex) => ({
          staff: staff.s,
          baselineY: nullableNumber(
            staff['baseline-y'],
            `raw.page-layouts[${pageIndex}].staves[${staffIndex}].baseline-y`,
          ),
          ...(staff['original-id'] !== undefined ? { originalId: staff['original-id'] } : {}),
          ...(staff.piece !== undefined ? { piece: staff.piece } : {}),
          ...(staff.start !== undefined
            ? {
                startMoment:
                  staff.start === null
                    ? null
                    : {
                        main: rational(staff.start.m),
                        grace: rational(staff.start.g),
                      },
              }
            : {}),
          ...(staff.end !== undefined
            ? {
                endMoment:
                  staff.end === null
                    ? null
                    : {
                        main: rational(staff.end.m),
                        grace: rational(staff.end.g),
                      },
              }
            : {}),
          ...(staff['ink-offset'] !== undefined
            ? {
                inkOffset:
                  staff['ink-offset'] === null
                    ? null
                    : (staff['ink-offset'].map((value, valueIndex) =>
                        numeric(
                          value,
                          `raw.page-layouts[${pageIndex}].staves[${staffIndex}].ink-offset[${valueIndex}]`,
                        ),
                      ) as [number, number]),
              }
            : {}),
          staffSpace: nullableNumber(
            staff['staff-space'],
            `raw.page-layouts[${pageIndex}].staves[${staffIndex}].staff-space`,
          ),
          layoutStaffSpace: nullableNumber(
            staff['layout-staff-space'],
            `raw.page-layouts[${pageIndex}].staves[${staffIndex}].layout-staff-space`,
          ),
          linePositions:
            staff['line-positions']?.map((value, valueIndex) =>
              numeric(
                value,
                `raw.page-layouts[${pageIndex}].staves[${staffIndex}].line-positions[${valueIndex}]`,
              ),
            ) ?? null,
          hidden: staff.hidden,
          custom: staff.custom,
          present: staff.present,
        })),
      }),
    );
  }

  document.events.push(
    ...extensions.filter(isExtensionEvent).map((e) => {
      try {
        return decodeExtension(e, extensions);
      } catch (cause) {
        throw new TypeError(`Event ${raw.events.indexOf(e)} in ${String(decoded.source)}`, {
          cause,
        });
      }
    }),
  );

  return document;
}
