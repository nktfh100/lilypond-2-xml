import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { type Event, required } from '../../planning/events.js';
import type { Part } from '../../planning/parts.js';
import type { ScoreWritingContext } from '../../context.js';
import { add } from '../../primitives.js';

export function createPartTimeWriter(
  writingContext: ScoreWritingContext,
  part: Part,
  timing: import('./session.js').PreparedPartTiming,
  staff: Pick<
    ReturnType<typeof import('./staff.js').createPartStaffSession>['plan'],
    'tabSettings'
  >,
) {
  const { context } = writingContext.plan;
  const { tabSettings } = staff;
  const staffNumber = (id: number) => part.staves.indexOf(id) + 1;
  const timeStyles = new Map<number, string | undefined>();
  const previousSignatures = new Map<number, string>();
  const nativeTimings = new Map<number, boolean>();
  const writeTime = (
    parent: XMLBuilder,
    step: Extract<Event, { kind: 'step' | 'staffStep' }> | undefined,
    at: number,
  ) => {
    if (!step) {
      return;
    }

    const staff =
      step.kind === 'staffStep'
        ? step.staff
        : required(part.staves[0], 'xml-part-time.ts: part.staves[0]');
    const previousSignature = previousSignatures.get(staff);
    let nativeTiming = nativeTimings.get(staff) ?? true;
    const staffAttrs =
      timing.independent && part.staves.length > 1 ? { number: staffNumber(staff) } : {};
    const signature = step.time;

    if (signature) {
      const style = timeStyles.get(staff);
      const symbol =
        style === 'C' && signature.denominator === 4 && signature.numerator === 4
          ? 'common'
          : style === 'C' && signature.denominator === 2 && signature.numerator === 2
            ? 'cut'
            : undefined;
      const timeHidden =
        tabSettings(staff, at)?.visibility?.TimeSignature === false ||
        part.staves.every((id) =>
          ['ChordNames', 'FiguredBass'].includes(context.get(id)?.type || ''),
        );
      const signatureKey = `${signature.numerator}/${signature.denominator}:${symbol}:${timeHidden}`;
      const changed = signatureKey !== previousSignature;

      if (changed || (step.timing && !nativeTiming)) {
        const node = add(parent, 'time', undefined, {
          ...staffAttrs,
          ...(symbol ? { symbol } : {}),
          ...(timeHidden || !changed ? { 'print-object': 'no' } : {}),
        });

        add(node, 'beats', signature.numerator);
        add(node, 'beat-type', signature.denominator);
        previousSignatures.set(staff, signatureKey);
        nativeTiming = true;
      }
    }

    if (!step.timing && nativeTiming) {
      add(
        add(parent, 'time', undefined, { ...staffAttrs, 'print-object': 'no' }),
        'senza-misura',
        '',
      );
      nativeTiming = false;
    }

    nativeTimings.set(staff, nativeTiming);
  };

  return { timeStyles, writeTime };
}
