import { writeHarmony } from '../../notation/harmony/harmony.js';
import { required } from '../../planning/events.js';
import { writeMeasureAttributes } from './attributes.js';
import { writeMeasureBarlines } from './barlines.js';
import { writeMeasureDirections } from './directions.js';
import { writeMeasureLanes } from './lanes.js';
import { writeMeasurePrint } from './print.js';
import type { PartWriterContext } from '../part/context.js';
import { add } from '../../primitives.js';
import { eventTime, rationalValue } from '../../../model/time.js';

export function writeMeasure(writer: PartWriterContext, measureIndex: number) {
  const { score: writingContext, layout, session, part } = writer;
  const { boundaries, timing, staffNumber, eventsByMeasure } = session.plan;
  const { partNode } = session.nodes;
  const { finish, tick, staffLabels, harmonyStaff } = writingContext.plan;

  const {
    measureGeometry,
    systemGeometry,
    pageLayouts,
    polymetricGrid,
    sharedBoundaries,
    registerLabelSibling,
  } = layout;

  const measureStart = required(
    boundaries[measureIndex],
    'xml-measure-writer.ts: boundaries[measureIndex]',
  );
  const measureEnd = boundaries[measureIndex + 1] ?? finish;
  const step = timing.at(measureStart);
  const pickup =
    measureIndex === 0 &&
    timing.timeEvents.some((e) => eventTime(e) === measureStart && rationalValue(e.position) < 0);
  const sourceGeometry = measureGeometry(part, measureStart, measureEnd);
  const sourceSystem = systemGeometry(measureStart);
  const sourcePage =
    sourceSystem?.system != null && sourceSystem.box ? pageLayouts.at(sourceSystem.system) : null;
  const measure = add(partNode, 'measure', undefined, {
    ...sourceGeometry.attributes,
    number: polymetricGrid ? `T${tick(measureStart)}` : pickup ? 0 : (step?.bar ?? measureIndex),
    ...(polymetricGrid ? { text: String(pickup ? 0 : (step?.bar ?? measureIndex)) } : {}),
    ...(polymetricGrid && !sharedBoundaries.has(measureStart) ? { 'non-controlling': 'yes' } : {}),
    ...(pickup || timing.fragments.has(measureStart) || timing.fragments.has(measureEnd)
      ? { implicit: 'yes' }
      : {}),
  });
  const inMeasure = required(eventsByMeasure[measureIndex], 'measure events');
  const { printNode } = writeMeasurePrint(writer, {
    inMeasure,
    measureStart,
    measure,
    sourceSystem,
    sourcePage,
    measureIndex,
  });
  const { writeClef } = writeMeasureAttributes(writer, {
    measure,
    measureStart,
    printNode,
    sourceSystem,
    measureIndex,
    inMeasure,
    step,
    measureEnd,
  });

  staffLabels.write(part, measure, measureStart, measureEnd, add);

  for (const chord of inMeasure.filter(
    (e): e is typeof e & { kind: 'harmony' } =>
      e.kind === 'harmony' && !e.skip && part.staves.includes(harmonyStaff.get(e.context) ?? NaN),
  )) {
    const newSystem = inMeasure.some(
      (e) => e.kind === 'layout' && eventTime(e) === eventTime(chord) && e.permission === 'force',
    );
    const harmony = writeHarmony(measure, chord, {
      offset: tick(eventTime(chord) - measureStart),
      staff:
        part.staves.length > 1
          ? staffNumber(
              required(
                harmonyStaff.get(chord.context),
                'xml-measure-writer.ts: harmonyStaff.get(chord.context)',
              ),
            )
          : undefined,
      hidden: !!chord.percentCopy || (chord.repeated && !newSystem),
    });

    if (!chord.percentCopy) {
      registerLabelSibling(harmony, chord.moment);
    }
  }

  writeMeasureDirections(writer, {
    measure,
    measureStart,
    inMeasure,
    measureIndex,
  });
  writeMeasureLanes(writer, {
    measureIndex,
    measure,
    measureEnd,
    measureStart,
    inMeasure,
    writeClef,
  });
  writeMeasureBarlines(writer, {
    measureEnd,
    measureIndex,
    measure,
    step,
    measureStart,
    inMeasure,
  });
}
