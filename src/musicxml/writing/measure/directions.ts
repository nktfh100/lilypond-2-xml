import { writeBracketPointDirection } from '../direction/brackets.js';
import { collectDirectionEvents } from '../direction/events.js';
import { createHairpinDirectionWriter } from '../direction/hairpins.js';
import { writePercentRepeatDirection } from '../direction/percent.js';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { combineTextRuns } from '../../text/combine-text.js';
import type { Attributes } from '../../types.js';
import { type Event, required } from '../../planning/events.js';
import { measureCounterRuns } from '../../text/measure-counters.js';
import { writeText } from '../../text/runs.js';
import type { PartWriterContext } from '../part/context.js';
import { add, placement } from '../../primitives.js';
import { durationTypeNames } from '../../planning/rhythm.js';
import { eventTime, rationalValue } from '../../../model/time.js';
import type { MeasureWritingFrame } from './context.js';

export type WriteDirection = (
  event: Event,
  kind: string,
  text?: string,
  attributes?: Attributes,
) => { node: XMLBuilder; direction: XMLBuilder };

export function writeMeasureDirections(
  writer: PartWriterContext,
  frame: Pick<MeasureWritingFrame, 'measure' | 'measureStart' | 'inMeasure' | 'measureIndex'>,
) {
  const { score: writingContext, layout, session, part } = writer;
  const { registerLabelSibling } = layout;
  const { textColumnPositions, tick, ticks, finish, navigation } = writingContext.plan;
  const { warn } = writingContext;
  const { voices, voiceNumber, staffNumber, bracketIds, linePlanAt } = session.plan;
  const { activeHairpins, octaveShifts } = session.notation;
  const { allocateOrReleaseSpanNumber } = session.writers;
  const { measure, measureStart, inMeasure, measureIndex } = frame;
  const writeDirection: WriteDirection = (
    e: Event,
    kind: string,
    text?: string,
    attrs: Attributes = {},
  ) => {
    const d = add(measure, 'direction', undefined, placement(e));

    registerLabelSibling(d, e.moment);

    if (e.percentCopy) {
      attrs = { ...attrs, color: '#00000000' };
    }

    if (kind === 'symbol') {
      add(add(d, 'direction-type'), 'words', '');
    }

    const dt = add(d, 'direction-type');
    const textColumnId = e.textColumnId;
    const textColumn =
      kind === 'words' && e.class === 'text-script-event' && Number.isSafeInteger(textColumnId)
        ? textColumnPositions.get(textColumnId!)
        : undefined;
    let result: XMLBuilder;

    if (textColumn) {
      for (const line of textColumn.lines) {
        result = add(dt, 'words', line.text, {
          ...attrs,
          'default-x': line['default-x'],
          'default-y': line['default-y'],
        });
      }

      result = dt;
    } else {
      result =
        ['words', 'rehearsal'].includes(kind) && e.markup !== undefined && text === e.text
          ? writeText(dt, kind, text, e.markup, attrs, warn, !!(e.percentCopy || e.hidden))
          : add(dt, kind, text, attrs);
    }

    if (eventTime(e) !== measureStart) {
      add(d, 'offset', tick(eventTime(e) - measureStart), { sound: 'yes' });
    }

    if (e.kind === 'percentRepeat' && voices.includes(e.voice)) {
      add(d, 'voice', voiceNumber(required(e.voice, 'xml-measure-directions.ts: e.voice')));
    }

    if (part.staves.length > 1 && part.staves.includes(e.staff ?? NaN)) {
      add(d, 'staff', staffNumber(required(e.staff, 'xml-measure-directions.ts: e.staff')));
    }

    return { node: result, direction: d };
  };
  const { stopHairpin, writeHairpin } = createHairpinDirectionWriter({
    writeDirection,
    activeHairpins,
    allocateOrReleaseSpanNumber,
  });

  for (const e of collectDirectionEvents(inMeasure, part.staves)) {
    if (e.kind === 'measureCounterPoint' || e.kind === 'combineTextPoint') {
      const runs =
        e.kind === 'measureCounterPoint'
          ? measureCounterRuns(e, measureStart, warn)
          : combineTextRuns(e, measureStart, warn);

      if (runs.length) {
        const d = add(measure, 'direction', undefined, placement(e));

        registerLabelSibling(d, e.moment);
        const dt = add(d, 'direction-type');

        for (const run of runs) {
          add(dt, 'words', run.text, { ...run.attrs, 'xml:space': 'preserve' });
        }

        if (eventTime(e) !== measureStart) {
          add(d, 'offset', tick(eventTime(e) - measureStart), { sound: 'yes' });
        }

        if (part.staves.length > 1) {
          add(d, 'staff', staffNumber(e.staff));
        }
      }

      continue;
    }

    switch (e.kind) {
      case 'vowelTransitionPoint':
      case 'bendHoldPoint':
      case 'optionalMaterialPoint':
      case 'episemaPoint':
      case 'fingerGlidePoint':
      case 'ligaturePoint':
      case 'durationLinePoint':
      case 'bracketPoint':
        writeBracketPointDirection(e, {
          bracketIds,
          measureStart,
          warn,
          writeDirection,
        });
        continue;
    }

    if (e.kind === 'percentRepeat') {
      writePercentRepeatDirection(e, {
        writeDirection,
        linePlanAt,
        fallbackStaff: part.staves[0]!,
        warn,
      });
      continue;
    }

    if (e.kind === 'navigationTarget') {
      const { direction: d } = writeDirection(e, 'words', '');

      add(d, 'sound', undefined, { coda: e.target, divisions: ticks / 4 });
      continue;
    }

    if (e.kind === 'navigation') {
      const symbol = (
        {
          'segno-mark-event': ['segno', '𝄋'],
          'coda-mark-event': ['coda', '𝄌'],
        } as Record<string, [string, string]>
      )[e.class];
      const rehearsal = ['rehearsal-mark-event', 'ad-hoc-mark-event'].includes(e.class || '');
      const hidden =
        e.hidden || (e.class === 'fine-event' && eventTime(e) === finish && !e.finalVisible);
      const { direction: d } = writeDirection(
        e,
        !hidden && symbol && e.text === symbol[1]
          ? symbol[0]
          : !hidden && rehearsal
            ? 'rehearsal'
            : 'words',
        hidden ? '' : symbol && e.text === symbol[1] ? undefined : e.text,
        !symbol || e.text !== symbol[1]
          ? {
              enclosure: e.enclosure,
              'font-weight': e.bold ? 'bold' : 'normal',
              'font-style': e.italic ? 'italic' : 'normal',
            }
          : {},
      );

      if (symbol) {
        add(d, 'sound', undefined, {
          ...navigation.destinations.get(e),
          divisions: ticks / 4,
        });
      }

      for (const sound of navigation.sounds.get(e) || []) {
        const { direction: jump } = writeDirection(e, 'words', '');

        add(jump, 'sound', undefined, sound);
      }

      if (e.class === 'fine-event') {
        add(d, 'sound', undefined, { fine: 'yes' });
      }

      if (e.class === 'dal-segno-event') {
        add(d, 'sound', undefined, {
          ...navigation.backwards.get(e),
          ...(e.returnCount > 1
            ? {
                'time-only': Array.from({ length: e.returnCount }, (_, i) => i + 1).join(','),
              }
            : {}),
        });
      }

      continue;
    }

    if (e.kind === 'tempo') {
      if (measureIndex === 0 && eventTime(e) === measureStart) {
        add(measure, 'sound', undefined, {
          tempo: rationalValue(e.wholesPerMinute) * 4,
        });
      }

      const { direction: d } = writeDirection(e, 'other-direction', undefined, {
        'print-object': 'no',
      });

      add(d, 'sound', undefined, {
        tempo: rationalValue(e.wholesPerMinute) * 4,
      });
    }

    if (e.class === 'tempo-change-event') {
      if (e.text) {
        writeDirection(e, 'words', e.text ?? undefined);
      }

      if (e.tempoUnit && e.metronomeCount !== undefined) {
        const { node } = writeDirection(e, 'metronome');

        add(node, 'beat-unit', durationTypeNames[e.tempoUnit.log] || 'quarter');

        for (let j = 0; j < e.tempoUnit.dots; j++) {
          add(node, 'beat-unit-dot');
        }

        add(
          node,
          'per-minute',
          typeof e.metronomeCount === 'object' ? e.metronomeCount.join('–') : e.metronomeCount,
        );
      }
    }

    if (e.class === 'absolute-dynamic-event') {
      stopHairpin(e);
      const { node } = writeDirection(
        e,
        'dynamics',
        undefined,
        e.hidden ? { color: '#00000000' } : {},
      );

      add(
        node,
        /^(p{1,6}|f{1,6}|mp|mf|sf|sfp|sfpp|fp|rf|rfz|sfz|sffz|fz|n|pf|sfzp)$/.test(e.text)
          ? e.text
          : 'other-dynamics',
        /^(p{1,6}|f{1,6}|mp|mf|sf|sfp|sfpp|fp|rf|rfz|sfz|sffz|fz|n|pf|sfzp)$/.test(e.text)
          ? undefined
          : e.text,
      );
    }

    if (
      [
        'text-script-event',
        'multi-measure-text-event',
        'ad-hoc-mark-event',
        'text-mark-event',
        'ad-hoc-jump-event',
        'section-label-event',
      ].includes(e.class || '')
    ) {
      writeDirection(e, 'words', e.text ?? undefined);
    }

    if (e.class === 'text-span-event') {
      if (e.spanDirection === -1 && e.text) {
        writeDirection(e, 'words', e.text ?? undefined);
      }

      writeDirection(e, 'dashes', undefined, {
        type: e.spanDirection === -1 ? 'start' : 'stop',
        number: allocateOrReleaseSpanNumber(e, 'text-span', 'dashes'),
      });
    }

    if (['crescendo-event', 'decrescendo-event'].includes(e.class || '')) {
      writeHairpin(e);
    }

    if (['sustain-event', 'sostenuto-event'].includes(e.class || '')) {
      writeDirection(e, 'pedal', undefined, {
        type:
          e.spanDirection === -1 ? (e.class === 'sostenuto-event' ? 'sostenuto' : 'start') : 'stop',
        line: e.pedalStyle === 'text' ? 'no' : 'yes',
        sign: e.pedalStyle === 'bracket' ? 'no' : 'yes',
      });
    }

    if (e.class === 'una-corda-event') {
      writeDirection(e, 'words', e.spanDirection === -1 ? 'una corda' : 'tre corde');
    }

    if (e.kind === 'ottava') {
      const previous = octaveShifts.get(e.staff);

      if (previous) {
        writeDirection(e, 'octave-shift', undefined, {
          type: 'stop',
          size: Math.abs(previous) + 1,
        });
      }

      if (e.offset) {
        writeDirection(e, 'octave-shift', undefined, {
          type: e.offset < 0 ? 'down' : 'up',
          size: Math.abs(e.offset) + 1,
        });
      }

      octaveShifts.set(e.staff, e.offset);
    }

    if (e.class === 'fine-event') {
      writeDirection(e, 'words', 'Fine');
    }

    if (e.class === 'rehearsal-mark-event') {
      writeDirection(e, 'rehearsal', String(e.label ?? ''));
    }

    if (['segno-mark-event', 'coda-mark-event'].includes(e.class || '')) {
      writeDirection(e, e.class === 'segno-mark-event' ? 'segno' : 'coda');
    }
  }
}
