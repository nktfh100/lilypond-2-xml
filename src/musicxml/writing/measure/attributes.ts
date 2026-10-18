import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { type Event, required } from '../../planning/events.js';
import { staffLineClefLine } from '../../layout/staff-lines.js';
import type { PartWriterContext } from '../part/context.js';
import { add } from '../../primitives.js';
import { durationValue, eventTime } from '../../../model/time.js';
import type { MeasureWritingFrame } from './context.js';

export function writeMeasureAttributes(
  writer: PartWriterContext,
  frame: Pick<
    MeasureWritingFrame,
    | 'measure'
    | 'measureStart'
    | 'printNode'
    | 'sourceSystem'
    | 'measureIndex'
    | 'inMeasure'
    | 'step'
    | 'measureEnd'
  >,
) {
  const { score: writingContext, layout, session, part } = writer;
  const { registerLabelSibling, labelMoment, registerSystemCursor, anchors } = layout;
  const { ticks, context } = writingContext.plan;
  const { writeKey, writeTime, writeStaffLines, writeTabStaff, writeTranspose } = session.writers;
  const { timeStyles } = session.notation;
  const { timing, staffNumber, linePlanAt, lineEvents, clefAt, clefEvents, linePlans, partNotes } =
    session.plan;
  const { warn } = writingContext;
  const {
    measure,
    measureStart,
    printNode,
    sourceSystem,
    measureIndex,
    inMeasure,
    step,
    measureEnd,
  } = frame;
  const attributes = add(measure, 'attributes');

  registerLabelSibling(attributes, labelMoment(measureStart));
  let cursorAnchor = registerSystemCursor(part, attributes, measureStart, printNode);

  if (sourceSystem?.system != null && sourceSystem.box) {
    anchors.registerPage(sourceSystem.system, part, attributes, printNode);
    cursorAnchor = true;
  }

  if (measureIndex === 0) {
    add(attributes, 'divisions', ticks / 4);
  }

  for (const staff of part.staves) {
    const key = inMeasure.find(
      (e): e is typeof e & { kind: 'staff' } =>
        e.kind === 'staff' &&
        e.class === 'key-change-event' &&
        e.staff === staff &&
        eventTime(e) === measureStart,
    );

    if (key) {
      writeKey(attributes, key);
    }
  }

  for (const e of inMeasure.filter(
    (e): e is typeof e & { kind: 'timeSignatureStyle' } =>
      e.kind === 'timeSignatureStyle' &&
      part.staves.includes(e.staff ?? NaN) &&
      eventTime(e) === measureStart,
  )) {
    timeStyles.set(e.staff, e.style);
  }

  if (timing.independent) {
    for (const staff of part.staves) {
      writeTime(attributes, timing.staffAt(staff, measureStart), measureStart);
    }
  } else {
    writeTime(attributes, step, measureStart);
  }

  if (measureIndex === 0 && part.staves.length > 1) {
    add(attributes, 'staves', part.staves.length);
  }

  const writeClef = (
    parent: XMLBuilder,
    e: Extract<Event, { kind: 'clef' }>,
    at = eventTime(e),
    hidden = false,
  ) => {
    const sign = (
      {
        'clefs.G': 'G',
        'clefs.F': 'F',
        'clefs.C': 'C',
        'clefs.mensural.g': 'G',
        'clefs.mensural.f': 'F',
        'clefs.mensural.c': 'C',
        'clefs.percussion': 'percussion',
        'clefs.tab': 'TAB',
      } as Record<string, string>
    )[e.glyph || ''];

    if (!sign) {
      return;
    }

    if (e.glyph?.startsWith('clefs.mensural.')) {
      warn(
        'clef-historical',
        'A mensural clef retains its sign, staff line and pitch reference using a modern MusicXML clef; its historical glyph drawing is not reproduced.',
      );
    }

    const clef = add(parent, 'clef', undefined, {
      ...(part.staves.length > 1 ? { number: staffNumber(e.staff) } : {}),
      ...(hidden ? { 'print-object': 'no' } : {}),
    });

    add(clef, 'sign', sign);

    if (['G', 'F', 'C'].includes(sign)) {
      const line = staffLineClefLine(e.position, linePlanAt(e.staff, at));

      if (line === null) {
        warn(
          'staff-lines-clef',
          'A clef falls between integer native staff lines on the selected grid. Its available sign remains without a guessed clef line; exact source geometry requires further mapping.',
        );
      } else {
        add(clef, 'line', line);
      }
    }

    if (e.transposition) {
      add(clef, 'clef-octave-change', -e.transposition / 7);
    }
  };

  for (const e of lineEvents.filter((e) => eventTime(e) === measureStart && measureStart > 0)) {
    const old = lineEvents.findLast((p) => p.staff === e.staff && eventTime(p) < measureStart);
    const clef = clefAt(e.staff, measureStart);

    if (
      clef &&
      !clefEvents.some((c) => c.staff === e.staff && eventTime(c) === measureStart) &&
      (old
        ? required(linePlans.get(old), 'xml-measure-attributes.ts: linePlans.get(old)').logicalCount
        : 5) !==
        required(linePlans.get(e), 'xml-measure-attributes.ts: linePlans.get(e)').logicalCount
    ) {
      writeClef(attributes, clef, measureStart, true);
      warn(
        'staff-lines-clef-layout',
        'A staff-grid change uses an invisible native clef-state update to preserve pitch positioning. Exact automatic or forced clef repetition requires actual Clef-grob capture.',
      );
    }
  }

  for (const e of inMeasure.filter(
    (e): e is typeof e & { kind: 'clef' } =>
      e.kind === 'clef' && part.staves.includes(e.staff ?? NaN) && eventTime(e) === measureStart,
  )) {
    writeClef(attributes, e);
  }

  if (
    measureIndex === 0 &&
    part.staves.every((id) => ['ChordNames', 'FiguredBass'].includes(context.get(id)?.type || ''))
  ) {
    add(add(attributes, 'staff-details', undefined, { 'print-object': 'no' }), 'staff-lines', 0);
  }

  for (const e of inMeasure.filter(
    (e): e is typeof e & { kind: 'staffLines' } =>
      e.kind === 'staffLines' &&
      part.staves.includes(e.staff ?? NaN) &&
      eventTime(e) === measureStart,
  )) {
    writeStaffLines(attributes, e);
  }

  for (const e of inMeasure.filter(
    (e): e is typeof e & { kind: 'tabStaff' } =>
      e.kind === 'tabStaff' &&
      part.staves.includes(e.staff ?? NaN) &&
      eventTime(e) === measureStart,
  )) {
    writeTabStaff(attributes, e);
  }

  for (const e of inMeasure.filter(
    (e): e is typeof e & { kind: 'transposition' } =>
      e.kind === 'transposition' &&
      part.staves.includes(e.staff ?? NaN) &&
      eventTime(e) === measureStart,
  )) {
    writeTranspose(attributes, e);
  }

  const multirests = part.staves.flatMap((staff) => {
    const rest = partNotes.find(
      (e): e is typeof e & { kind: 'mmrest' } =>
        e.kind === 'mmrest' &&
        e.staff === staff &&
        !e.percentCopy &&
        !e.continuation &&
        eventTime(e) === measureStart &&
        durationValue(e.duration) > measureEnd - measureStart,
    );

    return rest ? [rest] : [];
  });

  for (const multirest of multirests) {
    add(
      add(
        attributes,
        'measure-style',
        undefined,
        part.staves.length > 1
          ? {
              number: staffNumber(
                required(multirest.staff, 'xml-measure-attributes.ts: multirest.staff'),
              ),
            }
          : {},
      ),
      'multiple-rest',
      Math.round(durationValue(multirest.duration) / (measureEnd - measureStart)),
    );
  }

  if (!attributes.node.childNodes.length && !cursorAnchor) {
    attributes.remove();
  }

  return { writeClef };
}
