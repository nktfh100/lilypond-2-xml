import { builder } from '../../xml-builder.js';
import type { Event } from '../../planning/events.js';
import { writeBarline } from '../../planning/timing.js';
import type { PartWriterContext } from '../part/context.js';
import { add, isXmlElement } from '../../primitives.js';
import { eventGraceTime, eventTime, rationalValue } from '../../../model/time.js';
import type { MeasureWritingFrame } from './context.js';

export function writeMeasureBarlines(
  writer: PartWriterContext,
  frame: Pick<
    MeasureWritingFrame,
    'measureEnd' | 'measureIndex' | 'measure' | 'step' | 'measureStart' | 'inMeasure'
  >,
) {
  const { score: writingContext, layout, session, part } = writer;
  const { barlineLayouts, events, labels } = writingContext.plan;
  const { layoutMoment, anchors, registerLabelSibling, labelMoment } = layout;
  const { boundaries, backwardEnds, timing, partBars, repeatEvents } = session.plan;
  const { warn, document } = writingContext;
  const { consumeBackwardRepeatCount, repeatPlays } = session.writers;
  const { forwardBars, backwardBars } = session.notation;
  const { measureEnd, measureIndex, measure, step, measureStart, inMeasure } = frame;
  const actualRight = barlineLayouts.at(layoutMoment(measureEnd), part.staves, 'right');

  if (actualRight.status !== 'legacy') {
    const bars = actualRight.bars.filter(
      (bar) =>
        !bar.glyph.includes('|:') ||
        bar.glyph.includes(':|') ||
        measureIndex === boundaries.length - 1,
    );

    if (!bars.length) {
      anchors.excludeBarline(
        writeBarline(measure, { glyph: '', hidden: true }, 'right', add, warn).node,
      );
    }

    for (const bar of bars) {
      registerLabelSibling(
        writeBarline(
          measure,
          bar,
          'right',
          add,
          warn,
          !bar.hidden && bar.glyph.includes(':|') ? consumeBackwardRepeatCount(measureEnd) : 1,
          measureIndex === boundaries.length - 1 ? 'auto' : 'backward',
        ),
        labelMoment(measureEnd),
      );
    }

    if (
      (backwardEnds.get(measureEnd)?.length ?? 0) > 0 &&
      !bars.some((bar) => !bar.hidden && bar.glyph.includes(':|'))
    ) {
      warn(
        'barline-repeat-visibility',
        'A semantic backward repeat retains native playback while its source repeat drawing is absent, hidden or unproven. MusicXML has no general repeat visibility attribute; the reader may draw repeat dots.',
      );
    }
  } else if (timing.free || timing.independent) {
    const bars = partBars.filter((e) => eventTime(e) === measureEnd);

    if (!bars.length) {
      const inferred = !timing.captured && timing.at(measureEnd)?.bar !== step?.bar;
      const barline = writeBarline(
        measure,
        { glyph: inferred ? '|' : '', hidden: !inferred },
        'right',
        add,
        warn,
      );

      registerLabelSibling(barline, labelMoment(measureEnd));
    }

    for (const bar of bars) {
      registerLabelSibling(
        writeBarline(
          measure,
          bar,
          'right',
          add,
          warn,
          !bar.hidden && bar.glyph.includes(':|') ? consumeBackwardRepeatCount(measureEnd) : 1,
        ),
        bar.moment,
      );
    }
  } else {
    const bars = events.filter((e) => eventTime(e) === measureEnd && e.class === 'bar-event');

    for (const e of bars) {
      const bar = add(measure, 'barline', undefined, { location: 'right' });

      registerLabelSibling(bar, e.moment);
      const styles: Record<string, string> = {
        '|.': 'light-heavy',
        '||': 'light-light',
        '|': 'regular',
        ':|.': 'light-heavy',
        ':|': 'light-heavy',
      };

      add(bar, 'bar-style', styles[e.barType || ''] || 'regular');

      if (e.barType?.includes(':|')) {
        add(bar, 'repeat', undefined, {
          direction: 'backward',
          times: consumeBackwardRepeatCount(measureEnd),
        });
      }
    }
  }

  for (const e of repeatEvents.filter(
    (e) =>
      e.class === 'volta-span-event' &&
      ((e.spanDirection === -1 && eventTime(e) === measureStart) ||
        (e.spanDirection === 1 && eventTime(e) === measureEnd)),
  )) {
    const bar = add(measure, 'barline', undefined, {
      location: e.spanDirection === -1 ? 'left' : 'right',
    });

    add(bar, 'ending', undefined, {
      number: e.voltaNumbers?.join(','),
      type:
        e.spanDirection === -1
          ? 'start'
          : e.voltaNumbers?.includes(e.repeatCount ?? NaN)
            ? 'discontinue'
            : 'stop',
    });
  }

  if (document.barlineLayoutsCaptured) {
    const left = barlineLayouts.at(layoutMoment(measureStart), part.staves, 'left');
    const unbroken = barlineLayouts.at(layoutMoment(measureStart), part.staves, 'middle');
    const bars =
      left.status !== 'resolved'
        ? []
        : left.bars.length
          ? left.bars
          : unbroken.bars.filter((bar) => bar.glyph.includes('|:'));

    for (const bar of bars.filter((bar) => !bar.hidden && bar.glyph !== '')) {
      registerLabelSibling(
        writeBarline(measure, bar, 'left', add, warn, 1, 'forward'),
        labelMoment(measureStart),
      );

      if (bar.glyph.includes('|:')) {
        forwardBars.add(measureStart);
      }
    }

    if (
      inMeasure.some(
        (e) => e.class === 'volta-repeat-start-event' && eventTime(e) === measureStart,
      ) &&
      !forwardBars.has(measureStart)
    ) {
      warn(
        'barline-repeat-visibility',
        'A semantic forward repeat retains native playback while its source repeat drawing is absent, hidden or unproven. MusicXML has no general repeat visibility attribute; the reader may draw repeat dots.',
      );
    }
  }

  repeatEvents
    .filter(
      (e) =>
        eventTime(e) === measureStart &&
        !forwardBars.has(measureStart) &&
        e.class === 'volta-repeat-start-event',
    )
    .forEach(() =>
      add(add(measure, 'barline', undefined, { location: 'left' }), 'repeat', undefined, {
        direction: 'forward',
      }),
    );

  for (const event of backwardBars.has(measureEnd) ? [] : (backwardEnds.get(measureEnd) ?? [])) {
    add(add(measure, 'barline', undefined, { location: 'right' }), 'repeat', undefined, {
      direction: 'backward',
      times: repeatPlays(event),
    });
  }

  for (const location of ['left', 'right']) {
    const bars = Array.from(measure.node.childNodes)
      .filter(isXmlElement)
      .filter(
        (child) => child.nodeName === 'barline' && child.getAttribute('location') === location,
      );
    const base =
      bars.find((bar) =>
        Array.from(bar.childNodes).some((child) => child?.nodeName === 'bar-style'),
      ) ?? bars[0];

    if (!base) {
      continue;
    }

    for (const bar of bars.filter(
      (bar) =>
        bar !== base &&
        !Array.from(bar.childNodes).some((child) => child?.nodeName === 'bar-style'),
    )) {
      const children = Array.from(bar.childNodes).filter(isXmlElement);

      if (
        children.some((child) =>
          Array.from(base.childNodes).some((existing) => existing?.nodeName === child.nodeName),
        )
      ) {
        continue;
      }

      const repeat = children.find((child) => child.nodeName === 'repeat');
      const style = Array.from(base.childNodes).find(
        (child) => child?.nodeName === 'bar-style',
      )?.textContent;

      if (repeat && style && !['light-heavy', 'heavy-light', 'heavy-heavy'].includes(style)) {
        continue;
      }

      for (const child of children) {
        const repeat = Array.from(base.childNodes).find((node) => node?.nodeName === 'repeat');

        if (child.nodeName === 'ending' && repeat) {
          base.insertBefore(child, repeat);
        } else {
          base.appendChild(child);
        }
      }

      measure.node.removeChild(bar);
    }
  }

  const measureChildren = Array.from(measure.node.childNodes).filter(isXmlElement);
  const leftBars = measureChildren.filter(
    (child) => child.nodeName === 'barline' && child.getAttribute('location') === 'left',
  );
  const firstContent = measureChildren.find(
    (child) => !['print', 'bookmark', 'link'].includes(child.nodeName) && !leftBars.includes(child),
  );

  if (firstContent) {
    for (const bar of leftBars) {
      measure.node.insertBefore(bar, firstContent);
    }
  }

  if (labels.length) {
    for (const child of Array.from(measure.node.childNodes)) {
      if (isXmlElement(child) && child.nodeName === 'barline' && anchors.needsBarlineLabel(child)) {
        registerLabelSibling(
          builder(child),
          labelMoment(child.getAttribute('location') === 'left' ? measureStart : measureEnd),
        );
      }
    }

    const terminal =
      measureIndex === boundaries.length - 1 &&
      labels.some(
        (label) =>
          rationalValue(label.moment.main) === measureEnd && label.moment.grace.numerator === 0,
      );
    const hasRight = Array.from(measure.node.childNodes).some(
      (child) =>
        isXmlElement(child) &&
        child.nodeName === 'barline' &&
        child.getAttribute('location') === 'right',
    );

    if (terminal && !hasRight && document.barlinesCaptured) {
      const actual = events.filter(
        (e): e is Extract<Event, { kind: 'barline' }> =>
          e.kind === 'barline' &&
          eventTime(e) === measureEnd &&
          !eventGraceTime(e) &&
          (e.staff === undefined || part.staves.includes(e.staff)),
      );

      if (
        actual.length &&
        actual.every((bar) => bar.glyph === actual[0]!.glyph && bar.hidden === actual[0]!.hidden)
      ) {
        const bar = writeBarline(measure, actual[0]!, 'right', add, warn);

        registerLabelSibling(bar, labelMoment(measureEnd));
      }
    }
  }
}
