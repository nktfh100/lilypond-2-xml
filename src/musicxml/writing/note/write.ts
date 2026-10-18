import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { isBreath } from '../../notation/notes/breaths.js';
import { planFiguredBassPosition } from '../../notation/harmony/figured-bass-position.js';
import { writeFigures } from '../../notation/harmony/figured-bass.js';
import type { Attachment, PlannedNote } from '../../planning/events.js';
import { writeLyric } from '../../text/lyrics.js';
import { writeNoteAppearance } from './appearance.js';
import { writeNoteAttachments } from './attachments.js';
import { writeNoteIdentity } from './identity.js';
import { writeNoteNotations } from './notations.js';
import { writeNotePlayback } from './playback.js';
import type { PartWriterContext } from '../part/context.js';
import { add } from '../../primitives.js';
import { durationValue, eventGraceTime, eventTime } from '../../../model/time.js';
import type { NoteWritingPosition } from './context.js';

export function writeNote(
  writer: PartWriterContext,
  e: PlannedNote,
  position: NoteWritingPosition,
) {
  const { score: writingContext, layout, session } = writer;
  const { figuredAnchors, breaths, lyricsByMoment } = session.plan;
  const {
    finish,
    extensions,
    tick,
    sourceMeasureLayouts,
    globalFigureStaffSpace,
    finalLayoutComplete,
  } = writingContext.plan;
  const { warn } = writingContext;
  const { registerLabelSibling, layoutMoment } = layout;

  const {
    measure,
    notePosition,
    measureStart,
    measureEnd,
    measureIndex,
    voiceIndex,
    chord,
    cursorPosition,
    inMeasure,
    voice,
  } = position;

  writeFigures(measure, figuredAnchors.get(e), {
    at: notePosition,
    finish: finish,
    extensions: extensions,
    timing: { time: eventTime, duration: durationValue, tick: tick },
    output: { add: add, warn: warn, onNative: registerLabelSibling },
    positionForGroup: (group) =>
      planFiguredBassPosition(
        group,
        layoutMoment(measureStart),
        layoutMoment(measureEnd),
        sourceMeasureLayouts,
        globalFigureStaffSpace,
        finalLayoutComplete,
        warn,
      ),
  });
  const { settings, head, bendHead, cluster, node, percussion, tab } = writeNoteIdentity(
    {
      tabSettings: session.plan.tabSettings,
      linePlanAt: session.plan.linePlanAt,
      noteheadsByNote: writingContext.plan.noteheadsByNote,
      clustersByNote: writingContext.plan.clustersByNote,
      bendHeads: writingContext.normalized.bends.heads,
      notePositions: writingContext.plan.notePositions,
      tick,
      percussionByNote: writingContext.plan.percussionByNote,
      tabByNote: writingContext.plan.tabByNote,
      registerLabelSibling,
      registerSystemCursor: (node, notePosition, moment) => {
        layout.registerSystemCursor(writer.part, node, notePosition, undefined, moment);
      },
      warn,
    },
    e,
    {
      notePosition,
      measure,
      measureStart,
      measureIndex,
      voiceIndex,
      chord,
      cursorPosition,
    },
  );
  const attachments: readonly Attachment[] = e.continuation
    ? []
    : [
        ...(e.attachments ?? []),
        ...inMeasure.filter(
          (a): a is typeof a & { kind: 'voice' } =>
            a.kind === 'voice' &&
            !isBreath(a) &&
            a.voice === (e.sourceVoice ?? voice) &&
            (!a.multiMeasureRest || e.kind === 'mmrest') &&
            eventTime(a) === notePosition &&
            eventGraceTime(a) === eventGraceTime(e),
        ),
      ];
  const { stopTie, startTie } = writeNotePlayback(
    {
      ties: session.notation.tiePlayback,
      tieGraphics: session.plan.tieGraphics,
    },
    e,
    {
      voice,
      notePosition,
      attachments,
      node,
    },
  );

  writeNoteAppearance(
    {
      percussionInstruments: writer.part.percussion,
      multipleStaves: writer.part.staves.length > 1,
      footnotes: writingContext.normalized.footnotes,
      accidentalGraphics: writingContext.normalized.accidentalGraphics,
      voiceNumber: session.plan.voiceNumber,
      staffNumber: session.plan.staffNumber,
      tick,
      beamsByNote: writingContext.plan.beamsByNote,
      warn,
    },
    e,
    {
      percussion,
      node,
      voice,
      bendHead,
      settings,
      inMeasure,
      chord,
      tab,
      head,
      cluster,
    },
  );
  let notations: XMLBuilder | undefined;
  let hiddenNotations: XMLBuilder | undefined;
  const notation = (hidden = false) =>
    hidden
      ? (hiddenNotations ??= add(node, 'notations', undefined, {
          'print-object': 'no',
        }))
      : (notations ??= add(
          node,
          'notations',
          undefined,
          e.percentCopy ? { 'print-object': 'no' } : {},
        ));

  writeNoteNotations(writer, e, {
    notation,
    settings,
    stopTie,
    startTie,
    chord,
    tab,
    notePosition,
    bendHead,
    voice,
  });
  writeNoteAttachments(writer, e, {
    attachments,
    chord,
    notation,
    stopTie,
    voice,
    tab,
  });
  breaths.write(e, notation, add);

  if (!chord && !eventGraceTime(e)) {
    for (const lyric of lyricsByMoment.get(`${voice}:${notePosition}`) || []) {
      writeLyric(node, lyric, add, warn);
    }
  }
}
