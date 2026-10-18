import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Attributes } from '../../types.js';
import { xmlNumber, add } from '../../primitives.js';
import { fullNameKey, shortNameKey, writeNameDisplay } from '../../text/names.js';
import { writeSystemMargins } from '../../layout/paper.js';
import type { PartWriterContext } from '../part/context.js';
import { eventGraceTime, eventTime } from '../../../model/time.js';
import type { MeasureWritingFrame } from './context.js';

export function writeMeasurePrint(
  writer: PartWriterContext,
  frame: Pick<
    MeasureWritingFrame,
    'inMeasure' | 'measureStart' | 'measure' | 'sourceSystem' | 'sourcePage' | 'measureIndex'
  >,
) {
  const { score: writingContext, layout, session, part } = writer;
  const { events, tick, parts, staffLabels } = writingContext.plan;
  const { pageSettings } = layout;
  const { staffNumber, nameSeries } = session.plan;
  const { nameDisplayState } = session.notation;
  const { warn } = writingContext;
  const { inMeasure, measureStart, measure, sourceSystem, sourcePage, measureIndex } = frame;
  let printNode: XMLBuilder | undefined;
  const breaks = inMeasure.filter(
    (e): e is typeof e & { kind: 'layout' } =>
      e.kind === 'layout' &&
      eventTime(e) === measureStart &&
      e.moment.grace.numerator === 0 &&
      !events.some(
        (note) =>
          note.kind === 'note' &&
          eventGraceTime(note) < 0 &&
          tick(eventTime(note)) === tick(measureStart),
      ),
  );
  const pageBreak = breaks.find((e) => e.class === 'page-break-event');
  const lineBreak = breaks.find((e) => e.class === 'line-break-event');

  if (pageBreak || lineBreak) {
    const attrs: Attributes = {};

    if (lineBreak && lineBreak.permission !== 'allow') {
      attrs['new-system'] = lineBreak.permission === 'force' ? 'yes' : 'no';
    }

    if (pageBreak && pageBreak.permission !== 'allow') {
      attrs['new-page'] = pageBreak.permission === 'force' ? 'yes' : 'no';
    }

    if (Object.keys(attrs).length) {
      printNode = add(measure, 'print', undefined, attrs);
    }
  }

  if (sourceSystem) {
    if (Object.keys(sourceSystem.print).length) {
      printNode ||= add(measure, 'print');

      for (const [name, value] of Object.entries(sourceSystem.print)) {
        if (value !== undefined) {
          printNode.att(name, String(value));
        }
      }
    }
  }

  if (sourcePage) {
    printNode ||= add(measure, 'print');

    for (const [name, value] of Object.entries(sourcePage.attrs)) {
      if (value !== undefined) {
        printNode.att(name, String(value));
      }
    }

    if (sourcePage.page && (sourcePage.attrs['new-page'] === 'yes' || measureIndex === 0)) {
      const page = add(printNode, 'page-layout'),
        frame = sourcePage.page;

      add(page, 'page-height', xmlNumber(frame.height));
      add(page, 'page-width', xmlNumber(frame.width));
      const margins = add(page, 'page-margins', undefined, { type: 'both' });

      for (const [name, value] of [
        ['left-margin', frame.left],
        ['right-margin', frame.right],
        ['top-margin', frame.top],
        ['bottom-margin', frame.bottom],
      ] as const) {
        add(margins, name, xmlNumber(value));
      }
    }
  }

  const box = sourceSystem?.box;
  const pageMargins =
    sourcePage && box ? sourcePage.systemMargins(box.left, box.right, box.layoutStaffSpace) : null;
  const systemMargins =
    pageMargins ??
    sourceSystem?.margins ??
    (measureIndex === 0 &&
    part === parts[0] &&
    pageSettings &&
    pageSettings.indent !== pageSettings.shortIndent
      ? { left: pageSettings.indent, right: pageSettings.systemRight }
      : null);

  if (
    systemMargins ||
    sourcePage?.topSystemDistance != null ||
    sourcePage?.systemDistance != null
  ) {
    printNode ||= add(measure, 'print');
    const system = add(printNode, 'system-layout');

    if (systemMargins) {
      writeSystemMargins(system, systemMargins.left, systemMargins.right);
    }

    if (sourcePage?.systemDistance != null) {
      add(system, 'system-distance', xmlNumber(sourcePage.systemDistance));
    }

    if (sourcePage?.topSystemDistance != null) {
      add(system, 'top-system-distance', xmlNumber(sourcePage.topSystemDistance));
    }
  }

  if (sourcePage) {
    for (const [staff, distance] of sourcePage.staffDistances) {
      if (part.staves.includes(staff)) {
        printNode ||= add(measure, 'print');
        add(
          add(printNode, 'staff-layout', undefined, {
            number: staffNumber(staff),
          }),
          'staff-distance',
          xmlNumber(distance),
        );
      }
    }
  }

  if (measureIndex > 0 && staffLabels.starts(part, measureStart)) {
    printNode ||= add(measure, 'print');
    printNode.att('new-system', 'yes');
  }

  const nameState = nameSeries.findLast((e) => eventTime(e) <= measureStart);

  if (nameState?.fullPiece && fullNameKey(nameState) !== nameDisplayState.full) {
    printNode ||= add(measure, 'print');

    if (nameState.pieceUpdate && eventTime(nameState) === measureStart && measureStart > 0) {
      printNode.att('new-system', 'yes');
    }

    writeNameDisplay(printNode, 'part-name-display', nameState, false, add, warn);
    nameDisplayState.full = fullNameKey(nameState);
  }

  if (shortNameKey(nameState) !== nameDisplayState.short) {
    printNode ||= add(measure, 'print');

    if (nameState?.pieceUpdate && eventTime(nameState) === measureStart && measureStart > 0) {
      printNode.att('new-system', 'yes');
    }

    writeNameDisplay(printNode, 'part-abbreviation-display', nameState, true, add, warn);
    nameDisplayState.short = shortNameKey(nameState);
  }

  return { printNode };
}
