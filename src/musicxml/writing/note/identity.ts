import type { PlannedNote, Tick } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Moment } from '@sightread/lilypond-eventdocument';
import type { BendHeadState } from '../../notation/notes/bends.js';
import type { NotePositionPlan } from '../../layout/note-positions.js';
import type { StaffLinePlan } from '../../layout/staff-lines.js';
import type {
  ClusterGraphicEvent,
  NoteheadEvent,
  PercussionEvent,
  TabNoteEvent,
  TabStaffEvent,
} from '../../../model/document.js';
import { add, steps } from '../../primitives.js';
import { eventGraceTime, rationalValue } from '../../../model/time.js';
import type { NoteWritingFrame } from './context.js';

/** Resolved note facts and the two native-anchor registrations used by identity writing. */
export interface NoteIdentityInput {
  readonly tabSettings: (staff: number, notePosition: number) => TabStaffEvent | undefined;
  readonly linePlanAt: (staff: number, notePosition: number) => StaffLinePlan;
  readonly noteheadsByNote: ReadonlyMap<number, NoteheadEvent>;
  readonly clustersByNote: ReadonlyMap<number, ClusterGraphicEvent>;
  readonly bendHeads: ReadonlyMap<number, BendHeadState>;
  readonly percussionByNote: ReadonlyMap<number, PercussionEvent>;
  readonly tabByNote: ReadonlyMap<number, TabNoteEvent>;
  readonly notePositions: NotePositionPlan;
  readonly tick: Tick;
  readonly registerLabelSibling: (node: XMLBuilder, moment: Moment) => void;
  readonly registerSystemCursor: (node: XMLBuilder, notePosition: number, moment: Moment) => void;
  readonly warn: Warn;
}

export function writeNoteIdentity(
  input: NoteIdentityInput,
  e: PlannedNote,
  frame: Pick<
    NoteWritingFrame,
    | 'notePosition'
    | 'measure'
    | 'measureStart'
    | 'measureIndex'
    | 'voiceIndex'
    | 'chord'
    | 'cursorPosition'
  >,
) {
  const {
    tabSettings,
    linePlanAt,
    noteheadsByNote,
    clustersByNote,
    bendHeads,
    notePositions,
    tick,
    percussionByNote,
    tabByNote,
    registerLabelSibling,
    registerSystemCursor,
    warn,
  } = input;
  const { notePosition, measure, measureStart, measureIndex, voiceIndex, chord, cursorPosition } =
    frame;
  const settings = tabSettings(e.staff, notePosition);
  const head = noteheadsByNote.get(e.noteId ?? NaN);
  const bendHead = bendHeads.get(e.noteId ?? NaN);
  const cluster = clustersByNote.get(e.noteId ?? NaN);
  const node = add(measure, 'note', undefined, {
    ...notePositions.attributes(e, measureStart),
    ...((e.hidden && (!head || e.stemHidden || e.percentCopy)) ||
    (e.kind !== 'note' && settings?.visibility?.Rest === false) ||
    (e.cluster && (!cluster || !cluster.present || cluster.hidden))
      ? { 'print-object': 'no' }
      : {}),
    ...(e.cue ? { id: `lilypond-cue-${e.noteId}-${measureIndex}` } : {}),
  });

  if (!e.figureAnchor && !e.percentCopy) {
    registerLabelSibling(node, e.moment);
  }

  if (
    voiceIndex === 0 &&
    !chord &&
    !e.figureAnchor &&
    !e.percentCopy &&
    tick(notePosition) >= tick(cursorPosition)
  ) {
    registerSystemCursor(node, notePosition, e.moment);
  }

  if (eventGraceTime(e)) {
    add(node, 'grace', undefined, e.slash ? { slash: 'yes' } : {});
  }

  if (e.cue) {
    add(node, 'cue');
  }

  if (chord) {
    add(node, 'chord');
  }

  const percussion = percussionByNote.get(e.noteId ?? NaN);
  const tab = tabByNote.get(e.noteId ?? NaN);

  if (e.kind === 'note' && e.pitch) {
    const p = add(node, 'pitch');

    add(p, 'step', steps[e.pitch.step]);

    if (rationalValue(e.pitch.alteration)) {
      add(p, 'alter', rationalValue(e.pitch.alteration) * 2);
    }

    add(p, 'octave', e.pitch.octave + 4);
  } else if (e.kind === 'note') {
    const p = add(node, 'unpitched');

    if (percussion && Number.isInteger(percussion.position)) {
      const position =
        34 +
        percussion.position +
        linePlanAt(percussion.staff, notePosition).percussionDiatonicShift;

      add(p, 'display-step', steps[((position % 7) + 7) % 7]);
      add(p, 'display-octave', Math.floor(position / 7));
    } else {
      add(p, 'display-step', 'C');
      add(p, 'display-octave', 5);
      warn('unpitched-mapping', 'Unpitched note placement could not be resolved.');
    }
  } else {
    const rest = add(node, 'rest', undefined, e.kind === 'mmrest' ? { measure: 'yes' } : {});

    if (e.pitch) {
      add(rest, 'display-step', steps[e.pitch.step]);
      add(rest, 'display-octave', e.pitch.octave + 4);
    }
  }

  if (!eventGraceTime(e)) {
    add(node, 'duration', tick(e.segmentDuration));
  }

  return { settings, head, bendHead, cluster, node, percussion, tab };
}
