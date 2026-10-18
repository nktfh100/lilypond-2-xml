import { type Event, hasDuration, isKind, required } from '../../planning/events.js';
import { writeBarline } from '../../planning/timing.js';
import { writeNote } from '../note/write.js';
import type { PartWriterContext } from '../part/context.js';
import { add } from '../../primitives.js';
import { eventGraceTime, eventTime } from '../../../model/time.js';
import type { MeasureWritingFrame } from './context.js';

export function writeMeasureLanes(
  writer: PartWriterContext,
  frame: Pick<
    MeasureWritingFrame,
    'measureIndex' | 'measure' | 'measureEnd' | 'measureStart' | 'inMeasure' | 'writeClef'
  >,
) {
  const { score: writingContext, layout, session, part } = writer;
  const {
    voices,
    partNotes,
    timing,
    partBars,
    voiceNumber,
    staffNumber,
    lineEvents,
    clefAt,
    clefEvents,
    linePlans,
  } = session.plan;
  const { tick } = writingContext.plan;
  const { document, warn } = writingContext;
  const { writeGap, registerSystemCursor, registerLabelSibling } = layout;
  const {
    consumeBackwardRepeatCount,
    writeTime,
    writeTranspose,
    writeStaffLines,
    writeTabStaff,
    writeKey,
  } = session.writers;
  const { measureIndex, measure, measureEnd, measureStart, inMeasure, writeClef } = frame;

  for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex++) {
    const voice = required(voices[voiceIndex], 'xml-measure-lanes.ts: voices[voiceIndex]');

    if (voiceIndex) {
      add(add(measure, 'backup'), 'duration', tick(measureEnd - measureStart));
    }

    let cursor = measureStart;
    let lastMoment: string | undefined;
    const voiceStaff = partNotes.find((e) => e.voice === voice)?.staff;
    const voiceSkips = partNotes.filter(
      (e) => e.kind === 'skip' && e.voice === voice && !eventGraceTime(e),
    );
    const attributeEvents =
      voices.find((v) => partNotes.some((e) => e.voice === v && e.staff === voiceStaff)) === voice
        ? inMeasure.filter(
            (
              e,
            ): e is Extract<
              Event,
              {
                kind: 'clef' | 'transposition' | 'staffLines' | 'tabStaff' | 'staff';
              }
            > =>
              (e.kind === 'clef' ||
                e.kind === 'transposition' ||
                e.kind === 'staffLines' ||
                e.kind === 'tabStaff' ||
                (e.kind === 'staff' && e.class === 'key-change-event')) &&
              e.staff === voiceStaff &&
              eventTime(e) > measureStart,
          )
        : [];
    const lane = [
      ...partNotes.filter(
        (e) =>
          e.kind !== 'skip' &&
          e.voice === voice &&
          eventTime(e) >= measureStart &&
          eventTime(e) < measureEnd,
      ),
      ...attributeEvents,
      ...(voiceIndex === 0
        ? timing.timeEvents.filter((e) => eventTime(e) > measureStart && eventTime(e) < measureEnd)
        : []),
      ...(voiceIndex === 0 && (timing.free || document.barlineLayoutsCaptured)
        ? partBars.filter((e) => eventTime(e) > measureStart && eventTime(e) < measureEnd)
        : []),
    ].sort(
      (a, b) =>
        eventTime(a) - eventTime(b) ||
        eventGraceTime(a) - eventGraceTime(b) ||
        Number(
          isKind(
            b,
            'clef',
            'staff',
            'transposition',
            'staffLines',
            'tabStaff',
            'step',
            'staffStep',
            'barline',
          ),
        ) -
          Number(
            isKind(
              a,
              'clef',
              'staff',
              'transposition',
              'staffLines',
              'tabStaff',
              'step',
              'staffStep',
              'barline',
            ),
          ),
    );

    for (const e of lane) {
      const at = eventTime(e);
      const chord = e.kind === 'note' && lastMoment === `${at}:${eventGraceTime(e)}`;

      if (!chord && tick(at) > tick(cursor)) {
        writeGap(measure, cursor, at, {
          outputVoiceNumber: voiceNumber(voice),
          onCursor:
            voiceIndex === 0
              ? (node, position) => registerSystemCursor(part, node, position)
              : undefined,
          skips: voiceSkips,
          outputStaffNumber:
            part.staves.length > 1 && voiceStaff !== undefined
              ? staffNumber(voiceStaff)
              : undefined,
        });
        cursor = at;
      }

      if (
        isKind(
          e,
          'clef',
          'staff',
          'transposition',
          'staffLines',
          'tabStaff',
          'step',
          'staffStep',
          'barline',
        )
      ) {
        if (tick(at) < tick(cursor)) {
          add(add(measure, 'backup'), 'duration', tick(cursor - at));
        }

        if (e.kind === 'barline') {
          registerLabelSibling(
            writeBarline(
              measure,
              e,
              'middle',
              add,
              warn,
              !e.hidden && e.glyph.includes(':|') ? consumeBackwardRepeatCount(at) : 1,
            ),
            e.moment,
          );
          cursor = at;
          lastMoment = undefined;
          continue;
        }

        const attributes = add(measure, 'attributes');

        registerLabelSibling(attributes, e.moment);

        if (voiceIndex === 0 && !eventGraceTime(e)) {
          registerSystemCursor(part, attributes, at);
        }

        if (e.kind === 'step' || e.kind === 'staffStep') {
          writeTime(attributes, e, at);
        } else if (e.kind === 'clef') {
          writeClef(attributes, e);
        } else if (e.kind === 'transposition') {
          writeTranspose(attributes, e);
        } else if (e.kind === 'staffLines') {
          const old = lineEvents.findLast((p) => p.staff === e.staff && eventTime(p) < at),
            clef = clefAt(e.staff, at);

          if (
            clef &&
            !clefEvents.some((c) => c.staff === e.staff && eventTime(c) === at) &&
            (old
              ? required(linePlans.get(old), 'xml-measure-lanes.ts: linePlans.get(old)')
                  .logicalCount
              : 5) !==
              required(linePlans.get(e), 'xml-measure-lanes.ts: linePlans.get(e)').logicalCount
          ) {
            writeClef(attributes, clef, at, true);
            warn(
              'staff-lines-clef-layout',
              'A staff-grid change uses an invisible native clef-state update to preserve pitch positioning. Exact automatic or forced clef repetition requires actual Clef-grob capture.',
            );
          }

          writeStaffLines(attributes, e);
        } else if (e.kind === 'tabStaff') {
          writeTabStaff(attributes, e);
        } else {
          writeKey(attributes, e);
        }

        cursor = at;
        lastMoment = undefined;
        continue;
      }

      if (!hasDuration(e)) {
        continue;
      }

      if (!chord && tick(at) < tick(cursor)) {
        add(add(measure, 'backup'), 'duration', tick(cursor - at));
        cursor = at;
      }

      writeNote(writer, e, {
        measure,
        notePosition: at,
        measureStart,
        measureEnd,
        measureIndex,
        voiceIndex,
        chord,
        cursorPosition: cursor,
        inMeasure,
        voice,
      });

      if (!chord && !eventGraceTime(e)) {
        cursor = at + e.segmentDuration;
      }

      lastMoment = e.kind === 'note' ? `${at}:${eventGraceTime(e)}` : undefined;
    }

    if (tick(cursor) < tick(measureEnd)) {
      writeGap(measure, cursor, measureEnd, {
        outputVoiceNumber: voiceNumber(voice),
        onCursor:
          voiceIndex === 0
            ? (node, position) => registerSystemCursor(part, node, position)
            : undefined,
        skips: voiceSkips,
        outputStaffNumber:
          part.staves.length > 1 && voiceStaff !== undefined ? staffNumber(voiceStaff) : undefined,
        terminalVoiceSilence: lane.some(
          (e) => (e.kind === 'note' || e.kind === 'rest') && !eventGraceTime(e),
        ),
      });
    }

    if (tick(cursor) > tick(measureEnd)) {
      warn('crossing-measure', 'A note crosses a measure boundary and needs splitting.');
    }
  }

  if (!voices.length && tick(measureEnd - measureStart) > 0) {
    writeGap(measure, measureStart, measureEnd, {
      onCursor: (node, position) => registerSystemCursor(part, node, position),
    });
  }
}
