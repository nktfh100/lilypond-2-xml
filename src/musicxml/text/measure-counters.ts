import { matchesMeasureReference } from '../notation/spans/line-appearance.js';
import type { Moment } from '@sightread/lilypond-eventdocument';
import { musicXMLColor } from '../notation/colors.js';
import { musicFontSize } from './music-fonts.js';
import type { Event, MeasureCounterPoint } from '../planning/events.js';
import type { Warn } from '../../model/diagnostics.js';
import { compareMoments as compare } from '../../model/time.js';
import { uncertainStaffTopAt } from '../layout/staff-reference.js';
import { textRuns, transparentText, type TextRun } from './runs.js';
import type { TextMarkup } from '../../model/document.js';

export function measureCounterPoints(events: Event[], warn: Warn, captured = true): Event[] {
  const points: MeasureCounterPoint[] = [];

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'measure-counter-capture',
      'Final compiler layout failed; actual measure-counter pieces may be unavailable. No count labels are invented.',
    );
  }

  if (
    !captured &&
    events.some((e) =>
      e.attachments?.some((a) => a.class === 'ignored' && a.name === 'measure-counter-event'),
    )
  ) {
    warn(
      'measure-counter-history',
      'Measure counting lacks actual final text-spanner capture. Source bar numbers do not determine these independent count labels.',
    );
  }

  for (const counter of events.filter((e) => e.kind === 'measureCounter')) {
    if (
      !counter.resolvedStart ||
      !counter.endMoment ||
      compare(counter.moment, counter.endMoment) > 0
    ) {
      if (!counter.hidden) {
        warn(
          'measure-counter-endpoints',
          'A measure counter lacks valid actual compiler bounds. No anchor is inferred from bar numbers or note durations.',
        );
      }

      continue;
    }

    if (counter.text === null) {
      if (!counter.hidden) {
        warn(
          'measure-counter-stencil',
          'A measure counter has no observed standard printed text. Custom graphics or unobserved formatter output are not replaced with an invented count.',
        );
      }

      continue;
    }

    const uncertainTop = uncertainStaffTopAt(events, counter.staff, counter.moment);

    points.push({
      ...counter,
      kind: 'measureCounterPoint',
      ...(uncertainTop ? { yTenths: null } : {}),
    });
  }

  return [...events, ...points].sort((a, b) => compare(a.moment, b.moment));
}

/** Normalize only source-proven text composition, never execute user markup. */
function counterMarkup(markup: TextMarkup, music: boolean, warn: Warn): TextMarkup {
  if (Array.isArray(markup)) {
    return markup.map((node) => counterMarkup(node, music, warn));
  }

  if (!markup || typeof markup !== 'object' || !('command' in markup)) {
    return markup;
  }

  const { command, args = [] } = markup;

  if (command === 'parenthesize-markup') {
    return {
      command: 'concat-markup',
      plain: markup.plain,
      args: [['(', counterMarkup(args[0] ?? '', music, warn), ')']],
    };
  }

  if (
    music &&
    ['bold-markup', 'normal-weight-markup', 'italic-markup', 'upright-markup'].includes(command)
  ) {
    return counterMarkup(args[0] ?? '', music, warn);
  } // fetaText ignores font series/shape.

  return {
    ...markup,
    args: args.map((node) => counterMarkup(node, music, warn)),
  };
}

function uncertainMusicFont(markup: TextMarkup | undefined): boolean {
  if (Array.isArray(markup)) {
    return markup.some(uncertainMusicFont);
  }

  if (!markup || typeof markup !== 'object' || !('command' in markup)) {
    return false;
  }

  if (
    [
      'normal-text-markup',
      'sans-markup',
      'roman-markup',
      'typewriter-markup',
      'override-markup',
      'abs-fontsize-markup',
    ].includes(markup.command)
  ) {
    return true;
  }

  return markup.args?.some(uncertainMusicFont) ?? false;
}

export function measureCounterRuns(
  point: MeasureCounterPoint,
  start: number | Moment,
  warn: Warn,
): TextRun[] {
  const reference = point.xReference;
  const matches = matchesMeasureReference(reference, start);
  const color = musicXMLColor(point.color);
  const font = point.fontContext,
    music = point.fontEncoding === 'fetaText';
  const markup = point.markup ?? point.text ?? '';
  const uncertainFont = music && uncertainMusicFont(markup);

  if (uncertainFont) {
    warn(
      'measure-counter-font',
      'A music-font measure counter contains a nested font-family, encoding or absolute-size switch without per-leaf font provenance. Available text and other styles remain without guessed font attributes.',
    );
  }

  const base = {
    ...(!uncertainFont ? font?.attrs : {}),
    ...(color ? { color } : {}),
    ...(matches && point.xTenths !== null && Number.isFinite(point.xTenths)
      ? { 'default-x': point.xTenths }
      : {}),
    ...(point.yTenths !== null && Number.isFinite(point.yTenths)
      ? { 'default-y': point.yTenths }
      : {}),
    halign: 'left',
    valign: 'baseline',
  };

  let runs = textRuns(
    counterMarkup(markup, music, warn),
    base,
    warn,
    !uncertainFont ? font?.reference : undefined,
    (size) => musicFontSize(point.musicFonts, size),
  );

  if (uncertainFont) {
    runs = runs.map(({ text, attrs }) => {
      const {
        'font-size': size,
        'font-family': family,
        'font-weight': weight,
        'font-style': style,
        ...rest
      } = attrs;

      return { text, attrs: rest };
    });
  }

  if (point.hidden) {
    runs = transparentText(runs);
  }

  if (!point.hidden) {
    if (point.custom) {
      warn(
        'measure-counter-stencil',
        'A custom measure-counter callback retains observed standard printed text; additional arbitrary drawing remains unmapped.',
      );
    }

    if (!font) {
      warn(
        'measure-counter-font-history',
        'A measure counter lacks actual selected font context. Available text remains without an inherited point-size guess.',
      );
    }

    if (font?.unsupported.length) {
      warn(
        'measure-counter-font',
        `Unsupported measure-counter font settings: ${font.unsupported.join(', ')}. Available styles remain.`,
      );
    }

    if (!matches || point.xTenths === null || point.yTenths === null) {
      warn(
        'measure-counter-position',
        'A measure counter lacks a verified native measure-origin or staff-top reference. Missing or incompatible coordinates remain omitted.',
      );
    }

    warn(
      'measure-counter-layout',
      'Actual counter text remains separate from source bar numbers. Source music-font glyph features, mixed markup fitting and automatic page/system layout are not fully mapped.',
    );
  }

  return runs;
}
