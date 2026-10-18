import type { Moment } from '@sightread/lilypond-eventdocument';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { NoteLike } from '../planning/events.js';
import { add } from '../primitives.js';
import { durationValue, eventTime, rationalValue } from '../../model/time.js';
import { notationDuration, durationTypeNames } from '../planning/rhythm.js';

export interface GapWriterContext {
  tick: (wholeNotes: number) => number;
  ticksPerWholeNote: number;
  labels: readonly { moment: Moment }[];
  systemBoundaryTicks: ReadonlyMap<number, unknown>;
  labelMoment: (at: number) => Moment;
  registerLabelSibling: (node: XMLBuilder, moment: Moment) => void;
}

/** Serialization choices; voice and staff numbers are already mapped to MusicXML. */
export interface GapWritingOptions {
  outputVoiceNumber?: number | undefined;
  onCursor?: ((node: XMLBuilder, position: number) => void) | undefined;
  skips?: readonly NoteLike[];
  outputStaffNumber?: number | undefined;
  terminalVoiceSilence?: boolean;
}

export function createGapWriter(context: GapWriterContext) {
  const {
    tick,
    ticksPerWholeNote,
    labels,
    systemBoundaryTicks,
    labelMoment,
    registerLabelSibling,
  } = context;
  const writeGap = (
    measure: XMLBuilder,
    from: number,
    to: number,
    options: GapWritingOptions = {},
  ) => {
    const {
      outputVoiceNumber,
      onCursor,
      skips = [],
      outputStaffNumber,
      terminalVoiceSilence = false,
    } = options;
    const first = tick(from),
      last = tick(to);
    const sourceSkips = skips.filter(
      (skip) =>
        (rationalValue(skip.duration.scale) !== 1 || terminalVoiceSilence) &&
        tick(eventTime(skip)) < last &&
        tick(eventTime(skip) + (skip.segmentDuration ?? durationValue(skip.duration))) > first,
    );
    const cuts = [
      first,
      ...new Set(
        [
          ...labels
            .filter((label) => label.moment.grace.numerator === 0)
            .map((label) => tick(rationalValue(label.moment.main))),
          ...systemBoundaryTicks.keys(),
          ...sourceSkips.flatMap((skip) => [
            tick(eventTime(skip)),
            tick(eventTime(skip) + (skip.segmentDuration ?? durationValue(skip.duration))),
          ]),
        ].filter((at) => at > first && at < last),
      ),
      last,
    ].sort((a, b) => a - b);

    for (let i = 0; i < cuts.length - 1; i++) {
      const begin = cuts[i]!,
        end = cuts[i + 1]!;
      const skip = sourceSkips.find(
        (skip) =>
          tick(eventTime(skip)) <= begin &&
          tick(eventTime(skip) + (skip.segmentDuration ?? durationValue(skip.duration))) >= end,
      );
      const exact = skip && notationDuration((end - begin) / ticksPerWholeNote);
      const notation =
        exact ??
        (skip &&
          notationDuration((end - begin) / ticksPerWholeNote / rationalValue(skip.duration.scale)));
      const node = add(
        measure,
        notation ? 'note' : 'forward',
        undefined,
        notation ? { 'print-object': 'no' } : {},
      );

      if (notation) {
        add(node, 'rest');
      }

      add(node, 'duration', end - begin);

      if (outputVoiceNumber !== undefined) {
        add(node, 'voice', outputVoiceNumber);
      }

      if (notation && skip) {
        const type =
          ({ [-3]: 'maxima', [-2]: 'long', [-1]: 'breve' } as Record<number, string>)[
            notation.log
          ] ?? durationTypeNames[notation.log];

        if (type) {
          add(node, 'type', type);
        }

        for (let j = 0; j < notation.dots; j++) {
          add(node, 'dot');
        }

        if (!exact) {
          const modification = add(node, 'time-modification');

          add(modification, 'actual-notes', skip.duration.scale.denominator);
          add(modification, 'normal-notes', skip.duration.scale.numerator);
        }
      }

      if (outputStaffNumber !== undefined) {
        add(node, 'staff', outputStaffNumber);
      }

      registerLabelSibling(node, labelMoment(begin / ticksPerWholeNote));
      onCursor?.(node, begin / ticksPerWholeNote);
    }
  };

  return writeGap;
}
