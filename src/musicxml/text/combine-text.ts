import { matchesMeasureReference } from '../notation/spans/line-appearance.js';
import type { Moment } from '@sightread/lilypond-eventdocument';
import { musicXMLColor } from '../notation/colors.js';
import { musicFontSize } from './music-fonts.js';
import type { CombineTextPoint, Event } from '../planning/events.js';
import type { Warn } from '../../model/diagnostics.js';
import { compareMoments as compare } from '../../model/time.js';
import { uncertainStaffTopAt } from '../layout/staff-reference.js';
import { textRuns, transparentText, type TextRun } from './runs.js';
import type { TextMarkup } from '../../model/document.js';

const faceKeys = ['font-family', 'font-weight', 'font-style'] as const;

function namedFace(name: string) {
  const match = /^(serif|sans-serif|monospace)(?: (Bold))?(?: (Italic))?$/i.exec(name.trim());

  return match
    ? {
        'font-family': match[1]!.toLowerCase(),
        'font-weight': match[2] ? 'bold' : 'normal',
        'font-style': match[3] ? 'italic' : 'normal',
      }
    : null;
}

function namedMarkup(node: TextMarkup): { markup: TextMarkup; reset: boolean } {
  if (Array.isArray(node)) {
    const children = node.map(namedMarkup);

    return {
      markup: children.map((c) => c.markup),
      reset: children.some((c) => c.reset),
    };
  }

  if (!node || typeof node !== 'object' || !('command' in node)) {
    return { markup: node, reset: false };
  }

  const args = node.args ?? [],
    pair = args[0];

  if (node.command === 'override-markup' && Array.isArray(pair) && pair[0] === 'font-name') {
    return { markup: node, reset: true };
  }

  if (
    [
      'bold-markup',
      'normal-weight-markup',
      'italic-markup',
      'upright-markup',
      'sans-markup',
      'roman-markup',
      'typewriter-markup',
      'normal-text-markup',
    ].includes(node.command)
  ) {
    return namedMarkup(args[0] ?? '');
  }

  if (
    node.command === 'override-markup' &&
    Array.isArray(pair) &&
    ['font-series', 'font-shape', 'font-family'].includes(String(pair[0]))
  ) {
    return namedMarkup(args[1] ?? '');
  }

  const children = args.map(namedMarkup);

  return {
    markup: { ...node, args: children.map((c) => c.markup) },
    reset: children.some((c) => c.reset),
  };
}

/** Only actual surviving text Items supply words; status never supplies a label. */
export function combineTextPoints(events: Event[], warn: Warn, captured = true): Event[] {
  const points: CombineTextPoint[] = [];
  const labels = events.filter((e) => e.kind === 'combineText');

  if (
    !captured &&
    (labels.length ||
      events.some((e) =>
        e.attachments?.some((a) => a.class === 'ignored' && a.name === 'part-combine-event'),
      ))
  ) {
    warn(
      'combine-text-history',
      'Part-combine text lacks confirmed final Item capture. Status events and voice names do not determine a printed label or its delayed timestamp.',
    );
  }

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'combine-text-capture',
      'Final compiler layout failed; actual CombineTextScript words or their fitted positions may be unavailable. No Solo or a2 label is invented.',
    );
  }

  for (const label of labels) {
    if (!label.present) {
      continue;
    }

    if (label.text === null || (!label.textObserved && !label.hidden)) {
      if (!label.hidden) {
        warn(
          'combine-text-stencil',
          'A CombineTextScript has no observed standard printed markup. Available literal data remains in metadata without replacing opaque drawing with invented visible words.',
        );
      }

      continue;
    }

    const uncertainTop = uncertainStaffTopAt(events, label.staff, label.moment);

    if (label.columnMoment && compare(label.moment, label.columnMoment) !== 0) {
      warn(
        'combine-text-retiming',
        'A final CombineTextScript paper column differs from its actual creation time. Its source column remains in metadata; native words retain the observed creation timestamp without guessing a new temporal owner.',
      );
    }

    points.push({
      ...label,
      kind: 'combineTextPoint',
      ...(uncertainTop ? { yTenths: null } : {}),
    });
  }

  return [...events, ...points].sort((a, b) => compare(a.moment, b.moment));
}

export function combineTextRuns(
  point: CombineTextPoint,
  start: number | Moment,
  warn: Warn,
): TextRun[] {
  const reference = point.xReference;
  const matches = matchesMeasureReference(reference, start);
  const color = musicXMLColor(point.color),
    font = point.fontContext;
  const fontKnown = Object.hasOwn(point, 'fontName'),
    named = typeof point.fontName === 'string';
  const face = named ? namedFace(point.fontName!) : null;
  const normalized = named
    ? namedMarkup(point.markup ?? point.text ?? '')
    : { markup: point.markup ?? point.text ?? '', reset: false };
  const inherited = { ...font?.attrs };

  if (named || !fontKnown) {
    for (const key of faceKeys) {
      delete inherited[key];
    }
  }

  if (named && face && !normalized.reset) {
    Object.assign(inherited, face);
  }

  const x =
    matches && point.xTenths !== null && Number.isFinite(point.xTenths) ? point.xTenths : null;
  const y = point.yTenths !== null && Number.isFinite(point.yTenths) ? point.yTenths : null;
  const base = {
    ...inherited,
    ...(color ? { color } : {}),
    ...(x !== null ? { 'default-x': x } : {}),
    ...(y !== null ? { 'default-y': y } : {}),
    halign: 'left',
    valign: 'baseline',
  };

  let runs = textRuns(normalized.markup, base, warn, font?.reference, (size) =>
    musicFontSize(point.musicFonts, size),
  );

  if (named && normalized.reset) {
    runs = runs.map((run) => ({
      text: run.text,
      attrs: Object.fromEntries(
        Object.entries(run.attrs).filter(
          ([key]) => !faceKeys.includes(key as (typeof faceKeys)[number]),
        ),
      ),
    }));
  }

  if (named && (!face || normalized.reset) && !point.hidden) {
    warn(
      'combine-text-named-font',
      'An explicit Pango font name or nested font-name switch lacks a verified native face mapping. Available text, physical sizes and other attributes remain without guessed family, weight or style.',
    );
  }

  if (point.hidden) {
    runs = transparentText(runs);
  }

  if (!point.hidden) {
    if (point.custom) {
      warn(
        'combine-text-stencil',
        'Observed standard CombineTextScript text remains native, but a custom drawing or line-breaking callback can add graphics that are not reconstructed.',
      );
    }

    if (!font || !fontKnown) {
      warn(
        'combine-text-font-history',
        'A CombineTextScript lacks selected text-font context. Available text remains without borrowing a measure-counter music font or guessing inherited point size.',
      );
    }

    if (font?.unsupported.length) {
      warn(
        'combine-text-font',
        `Unsupported part-combine label font settings: ${font.unsupported.join(', ')}. Available styles remain.`,
      );
    }

    if (x === null || y === null) {
      warn(
        'combine-text-position',
        'A part-combine label lacks a verified source measure-origin or staff-top reference compatible with the native measure. Missing coordinates remain omitted.',
      );
    }

    if (point.moment.grace.numerator) {
      warn(
        'combine-text-grace',
        'Native words retain main-note offsets without reconstructing individual source grace-column placement.',
      );
    }

    warn(
      'combine-text-layout',
      'Native words retain actual part-combine text, staff, selected font and available baseline. Composite markup fitting, automatic collision spacing and arbitrary drawing remain partial.',
    );
  }

  return runs;
}
