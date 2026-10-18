import type { Moment, Rational } from '@sightread/lilypond-eventdocument';
import type { Event, Timed } from './events.js';
import type { Warn } from '../../model/diagnostics.js';
import { isNoteBoundSpan } from '../notation/spans/note-bound-spans.js';
import { rationalValue, eventTime, eventGraceTime, gcd } from '../../model/time.js';

const shifted = (r: Rational, amount: Rational) => {
  const numerator = r.numerator * amount.denominator + amount.numerator * r.denominator;
  const denominator = r.denominator * amount.denominator;

  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new Error('Percent-repeat timing exceeds supported precision');
  }

  const divisor = gcd(Math.abs(numerator), denominator);

  return { numerator: numerator / divisor, denominator: denominator / divisor };
};

function isCompletePatternEvent(
  e: Event,
  end: number,
  ids: ReadonlyMap<number | null | undefined, number>,
  warn: Warn,
): boolean {
  if (
    isNoteBoundSpan(e) &&
    (!e.endMoment ||
      rationalValue(e.endMoment.main) > end ||
      e.fromNotes.some((id) => !ids.has(id)) ||
      e.toNotes.some((id) => !ids.has(id)))
  ) {
    if (e.kind === 'episema') {
      warn(
        'episema-percent',
        'An episema crosses a percent-repeat pattern boundary; its actual original bounds remain without guessed repeated endpoints.',
      );
    } else if (e.kind === 'fingerGlide') {
      warn(
        'finger-glide-percent',
        'A finger glide crosses a percent-repeat pattern boundary; its actual original bounds remain without guessed repeated endpoints.',
      );
    } else if (e.kind === 'ligature') {
      warn(
        'ligature-percent',
        'A ligature crosses a percent-repeat pattern boundary; its actual original bounds remain without guessed repeated endpoints.',
      );
    } else if (e.kind === 'durationLine') {
      warn(
        'duration-line-percent',
        'A DurationLine crosses a percent-repeat pattern boundary; its actual original span remains without guessed repeated endpoints.',
      );
    } else if (e.kind === 'tieGraphic') {
      warn(
        'tie-percent',
        'A tie crosses a percent-repeat pattern boundary; its original native curve is retained without guessed repeated endpoints.',
      );
    } else if (e.kind === 'glissando') {
      warn(
        'glissando-percent',
        'A glissando crosses a percent-repeat pattern boundary; its original native span is retained without guessed repeated endpoints.',
      );
    } else {
      warn(
        'slur-percent',
        'A slur crosses a percent-repeat pattern boundary; its original native span is retained without guessed repeated endpoints.',
      );
    }

    return false;
  }

  if (e.kind !== 'bracket' || (e.endMoment && rationalValue(e.endMoment.main) <= end)) {
    return true;
  }

  warn(
    'bracket-percent',
    'A bracket crosses a percent-repeat pattern boundary; its original native span is retained without guessing a repeated endpoint.',
  );

  return false;
}

/** Remap a copy only after the caller has accepted its pattern ownership. */
function copyPercentEvent(
  source: Event,
  shift: Rational,
  ids: ReadonlyMap<number | null | undefined, number>,
  repeatId: number,
): Event {
  const copy = { ...structuredClone(source) };
  const shiftMoment = (moment: Moment): Moment => ({
    ...moment,
    main: shifted(moment.main, shift),
  });
  const remapNotes = (noteIds: readonly number[]) =>
    noteIds.flatMap((id) => {
      const mapped = ids.get(id);

      return mapped === undefined ? [] : [mapped];
    });

  copy.moment = shiftMoment(copy.moment);
  copy.percentCopy = repeatId;
  copy.hidden = copy.kind === 'script' ? copy.hidden : true;

  if (copy.noteId !== undefined && copy.noteId !== null) {
    const mapped = ids.get(copy.noteId);

    if (mapped === undefined) {
      delete copy.noteId;
    } else {
      copy.noteId = mapped;
    }
  }

  if (isNoteBoundSpan(copy)) {
    if (copy.endMoment) {
      copy.endMoment = shiftMoment(copy.endMoment);
    }

    copy.fromNotes = remapNotes(copy.fromNotes);
    copy.toNotes = remapNotes(copy.toNotes);
  }

  switch (copy.kind) {
    case 'bracket':
      if (copy.endMoment) {
        copy.endMoment = shiftMoment(copy.endMoment);
      }

      break;
    case 'fingerGlide':
      copy.fromLabel = copy.fromLabel
        ? { ...copy.fromLabel, noteIds: remapNotes(copy.fromLabel.noteIds) }
        : null;
      copy.toLabel = copy.toLabel
        ? { ...copy.toLabel, noteIds: remapNotes(copy.toLabel.noteIds) }
        : null;
      copy.xReference = [
        copy.xReference[0] ? shiftMoment(copy.xReference[0]) : null,
        copy.xReference[1] ? shiftMoment(copy.xReference[1]) : null,
      ];
      break;
    case 'episema':
      copy.xReference = [
        copy.xReference[0] ? shiftMoment(copy.xReference[0]) : null,
        copy.xReference[1] ? shiftMoment(copy.xReference[1]) : null,
      ];
      break;
    case 'clusterGraphic':
      copy.noteIds = remapNotes(copy.noteIds);
      break;
    case 'arpeggio':
      if (copy.headPositions) {
        copy.headPositions = copy.headPositions.flatMap(([id, position]) => {
          const mapped = ids.get(id);

          return mapped === undefined ? [] : [[mapped, position] as const];
        });
      }

      if (copy.rangeReference) {
        copy.rangeReference = remapNotes(copy.rangeReference);
      }

      copy.noteIds = remapNotes(copy.noteIds);
      break;
  }

  return copy;
}

export function expandPercentRepeats(input: Event[], warn: Warn) {
  const events = [...input];
  let noteId = input.reduce(
    (max, e) =>
      typeof e.noteId === 'number' && Number.isSafeInteger(e.noteId)
        ? Math.max(max, e.noteId)
        : max,
    0,
  );

  for (const repeat of input
    .filter((e) => e.kind === 'percentRepeat')
    .sort((a, b) => eventTime(a) - eventTime(b))) {
    const length = rationalValue(repeat.length);

    if (!(length > 0)) {
      warn('percent-length', 'A percent-repeat placeholder has no valid pattern length.');
      continue;
    }

    const retainDuration = () =>
      events.push({
        kind: 'skip',
        voice: repeat.voice,
        staff: repeat.staff,
        moment: repeat.moment,
        duration: { log: 0, dots: 0, scale: repeat.length },
      });

    if (!Number.isSafeInteger(repeat.count) || repeat.count < 2) {
      warn(
        'percent-isolated',
        'An isolated percent sign has no compiler repeat count; its duration and sign are retained without inferring playback from preceding notes.',
      );
      retainDuration();
      continue;
    }

    const shift = {
      numerator: repeat.length.numerator * (repeat.count - 1),
      denominator: repeat.length.denominator,
    };
    const from = rationalValue(
      shifted(repeat.moment.main, { ...shift, numerator: -shift.numerator }),
    );
    const end = from + length;
    const within = (e: Timed) => eventTime(e) >= from - 1e-10 && eventTime(e) < end - 1e-10;
    const material = events.filter(
      (e) =>
        within(e) &&
        ((['note', 'rest', 'mmrest', 'skip'].includes(e.kind) && e.voice === repeat.voice) ||
          (e.kind === 'harmony' && e.context === repeat.voice)),
    );

    if (!material.length) {
      warn(
        'percent-source',
        'The percent-repeat pattern could not be associated with its original voice; its duration is retained without guessed notes.',
      );
      retainDuration();
      continue;
    }

    if (
      events.some(
        (e) =>
          eventTime(e) > from &&
          eventTime(e) < end &&
          ['transposition', 'tempo', 'ottava', 'tabStaff', 'tieState'].includes(e.kind),
      )
    ) {
      warn(
        'percent-state',
        'Printed property changes inside a percent-repeat pattern require further verification; repeated written notes are retained.',
      );
    }

    if (
      events.some(
        (e) =>
          e.kind === 'note' &&
          e.voice === repeat.voice &&
          Math.abs(eventTime(e) - end) < 1e-10 &&
          eventGraceTime(e),
      )
    ) {
      warn(
        'percent-grace',
        'Grace notes at a percent-pattern boundary require further ownership mapping.',
      );
    }

    const ids = new Map(
      material.filter((e) => e.noteId !== undefined).map((e) => [e.noteId, ++noteId]),
    );
    const related = events.filter(
      (e) =>
        !material.includes(e) &&
        ((e.kind === 'voice' &&
          e.voice === repeat.voice &&
          (within(e) || (e.spanDirection === 1 && Math.abs(eventTime(e) - end) < 1e-10))) ||
          (e.kind === 'script' && e.voice === repeat.voice && within(e)) ||
          (e.kind === 'tieState' && e.voice === repeat.voice && within(e)) ||
          (e.kind === 'bracket' && e.context === repeat.voice && within(e)) ||
          (e.kind === 'clusterGraphic' && e.voice === repeat.voice && within(e)) ||
          (isNoteBoundSpan(e) && e.voice === repeat.voice && within(e)) ||
          (e.kind === 'arpeggio' && e.noteIds.some((id) => ids.has(id))) ||
          (e.noteId !== undefined && ids.has(e.noteId))),
    );
    const complete = related.filter((event) => isCompletePatternEvent(event, end, ids, warn));
    const copies = [...material, ...complete].map((source) =>
      copyPercentEvent(source, shift, ids, repeat.id),
    );

    events.push(...copies);
  }

  return events.sort(
    (a, b) => eventTime(a) - eventTime(b) || eventGraceTime(a) - eventGraceTime(b),
  );
}

export function positionPercentSign(event: Event): Event {
  if (event.kind !== 'percentRepeat' || event.class === 'repeat-slash-event') {
    return event;
  }

  return {
    ...event,
    moment: {
      ...event.moment,
      main: shifted(event.moment.main, {
        numerator: event.length.numerator,
        denominator: event.length.denominator * 2,
      }),
    },
  };
}
