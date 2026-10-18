import { accidentalPlans } from '../notation/notes/accidentals.js';
import { bendHoldPoints, bendPlans } from '../notation/notes/bends.js';
import { bracketPoints } from '../notation/spans/brackets.js';
import { combineTextPoints } from '../text/combine-text.js';
import { durationLinePoints } from '../notation/spans/duration-lines.js';
import { episemaPoints } from '../notation/spans/episemas.js';
import { fingerGlidePoints } from '../notation/spans/finger-glides.js';
import { footnotePlans } from '../text/footnotes.js';
import type { Attachment, Event } from './events.js';
import { ligaturePoints } from '../notation/spans/ligatures.js';
import { measureCounterPoints } from '../text/measure-counters.js';
import { optionalMaterialPoints } from '../notation/spans/optional-material.js';
import { expandPercentRepeats, positionPercentSign } from './percent-repeats.js';
import { notationSizes } from '../notation/notes/sizes.js';
import type { ScoreDocument } from '../../model/document.js';
import { vowelTransitionPoints } from '../text/vowel-transitions.js';
import type { Warn } from '../../model/diagnostics.js';
import { compareMoments, eventGraceTime, isDuration } from '../../model/time.js';

export function normalizeScore(document: ScoreDocument, warn: Warn) {
  for (const event of document.events) {
    if (
      event.kind === 'note' ||
      event.kind === 'rest' ||
      event.kind === 'mmrest' ||
      event.kind === 'skip' ||
      event.kind === 'harmony' ||
      event.kind === 'figuredBass'
    ) {
      if (event.duration === null && event.kind !== 'harmony' && event.kind !== 'figuredBass') {
        continue;
      }

      if (!isDuration(event.duration)) {
        throw new TypeError(
          `Invalid ${event.kind} duration: expected a positive finite musical duration`,
        );
      }
    }
  }

  const capturedAttachment = (attachment: Attachment) =>
    attachment.class === 'ignored' &&
    ((document.durationLinesCaptured && attachment.name === 'duration-line-event') ||
      (document.fingerGlidesCaptured && attachment.name === 'finger-glide-event') ||
      (document.ligaturesCaptured && attachment.name === 'ligature-event') ||
      (document.episemasCaptured && attachment.name === 'episema-event') ||
      (document.optionalMaterialCaptured && attachment.name === 'optional-material-event') ||
      (document.bendsCaptured && attachment.name === 'bend-span-event') ||
      (document.measureCountersCaptured && attachment.name === 'measure-counter-event'));

  if (document.layoutRequested === false) {
    throw new Error(
      'MIDI-only score documents are not supported; only printed scores are converted',
    );
  }

  const sizes = notationSizes(document.events, warn);

  let events = expandPercentRepeats(sizes.events, warn).map(positionPercentSign);
  const accidentalGraphics = accidentalPlans(document, events, warn);

  events = durationLinePoints(events, warn, document.durationLinesCaptured === true);
  events = bracketPoints(events, warn);
  events = ligaturePoints(events, warn, document.ligaturesCaptured === true);
  events = fingerGlidePoints(events, warn, document.fingerGlidesCaptured === true);
  events = episemaPoints(events, warn, document.episemasCaptured === true);
  events = optionalMaterialPoints(events, warn, document.optionalMaterialCaptured === true);
  const bends = bendPlans(events, warn, document.bendsCaptured === true);
  const footnotes = footnotePlans(events, warn, document.footnotesCaptured === true);

  events = bendHoldPoints(events, warn, document.bendsCaptured === true);
  events = measureCounterPoints(events, warn, document.measureCountersCaptured === true);
  events = combineTextPoints(events, warn, document.combineTextCaptured === true);
  events = vowelTransitionPoints(events, warn, document.vowelTransitionsCaptured === true);
  const directionBracket = (event: Event) =>
    [
      'bracketPoint',
      'durationLinePoint',
      'ligaturePoint',
      'fingerGlidePoint',
      'episemaPoint',
      'optionalMaterialPoint',
      'bendHoldPoint',
      'vowelTransitionPoint',
    ].includes(event.kind);
  const coincidentBrackets = new Set(
    events.flatMap((event) =>
      directionBracket(event) &&
      event.point === 'start' &&
      event.endMoment &&
      compareMoments(event.moment, event.endMoment) === 0
        ? [event.spanKey]
        : [],
    ),
  );
  const bracketOrder = (event: Event) => {
    if (!directionBracket(event)) {
      return 0;
    }

    if (event.spanKey !== undefined && coincidentBrackets.has(event.spanKey)) {
      return 0;
    }

    if (event.point === 'stop') {
      return -1;
    }

    if (event.point === 'start') {
      return 1;
    }

    return 0;
  };

  events.sort((a, b) => compareMoments(a.moment, b.moment) || bracketOrder(a) - bracketOrder(b));

  if (events.some((e) => e.kind === 'note' && e.cue)) {
    warn(
      'cue-playback',
      'Source cue notation is retained; source MIDI filtering is not converted.',
    );
  }

  if (events.some((e) => e.kind === 'note' && eventGraceTime(e))) {
    warn(
      'grace-playback',
      'Grace notation is retained; source performed grace timing is not captured.',
    );
  }

  return {
    capturedAttachment,
    sizes,
    events,
    accidentalGraphics,
    bends,
    footnotes,
  };
}

export type NormalizedScore = ReturnType<typeof normalizeScore>;
