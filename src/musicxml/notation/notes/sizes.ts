import type { Rational } from '@sightread/lilypond-eventdocument';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add } from '../../types.js';
import type { Event, NoteLike, Timed } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import type { ScoreDocument } from '../../../model/document.js';

const value = (r: Rational) => r.numerator / r.denominator;
const isGrace = (e: Timed) => value(e.moment.grace) !== 0;
const key = (e: Event) =>
  `${e.voice}:${e.eventKind || e.kind}:${value(e.moment.main)}:${value(e.moment.grace)}`;
const category = (e: Timed, size: number) =>
  size === 0
    ? 'full'
    : size > 0
      ? 'large'
      : isGrace(e)
        ? size === -3
          ? 'grace'
          : 'grace-cue'
        : 'cue';

export function notationSizes(input: readonly ScoreDocument['events'][number][], warn: Warn) {
  const events = input.filter((event) => event.kind !== 'textColumnPosition') as readonly Event[];
  const graphics = events.filter((e) => e.kind === 'noteSize');
  const notes = new Map(graphics.filter((e) => e.noteId !== null).map((e) => [e.noteId, e]));
  const rests = new Map(graphics.filter((e) => e.noteId === null).map((e) => [key(e), e]));
  const defaults = new Map();
  const result: Event[] = events.map((e) => {
    if (!['note', 'rest', 'mmrest'].includes(e.kind)) {
      return e;
    }

    const graphic = e.kind === 'note' ? notes.get(e.noteId ?? null) : rests.get(key(e));

    if (e.cluster) {
      return { ...e, notationSize: 'full' };
    }

    if (!graphic || !Number.isFinite(graphic.fontSize)) {
      return e;
    }

    const size = graphic.fontSize;

    if (typeof graphic.stemFontSize === 'number' && graphic.stemFontSize !== size) {
      warn(
        'note-size-components',
        'This notehead and stem use different LilyPond font sizes; the native MusicXML note size retains the head size, but independent component scaling is not mapped.',
      );
    }

    const type = category(e, size);

    if (type !== 'full') {
      if (!defaults.has(type)) {
        defaults.set(type, size);
      } else if (defaults.get(type) !== size) {
        warn(
          'note-size-variation',
          `Multiple ${type} note sizes share one MusicXML size category; the first resolved size is used for that category.`,
        );
      }
    }

    return { ...e, notationSize: type };
  });

  return { events: result, defaults };
}

export function writeSizeDefaults(root: XMLBuilder, sizes: Map<string, number>, add: Add) {
  if (!sizes.size) {
    return;
  }

  const defaults = root.find((node) => node.node.nodeName === 'defaults') || add(root, 'defaults');
  const appearance = add(defaults, 'appearance');

  for (const [type, size] of sizes) {
    add(appearance, 'note-size', Math.round(100 * 2 ** (size / 6) * 1e9) / 1e9, { type });
  }
}

export function noteTypeSize(event: NoteLike) {
  return !event.notationSize ||
    event.notationSize === 'grace' ||
    (event.notationSize === 'full' && !isGrace(event) && !event.cue)
    ? {}
    : { size: event.notationSize };
}
