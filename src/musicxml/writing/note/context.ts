import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Attachment, Event } from '../../planning/events.js';
import type { Notation } from '../../types.js';
import type { BendHeadState } from '../../notation/notes/bends.js';
import type {
  ClusterGraphicEvent,
  NoteheadEvent,
  PercussionEvent,
  TabNoteEvent,
  TabStaffEvent,
} from '../../../model/document.js';

export interface NoteWritingPosition {
  measure: XMLBuilder;
  notePosition: number;
  measureStart: number;
  measureEnd: number;
  measureIndex: number;
  voiceIndex: number;
  chord: boolean;
  cursorPosition: number;
  inMeasure: Event[];
  /** Planned lane voice ID; source attachments use note.sourceVoice when present. */
  voice: number;
}

/** One note's native node and resolved inputs; notation callbacks own lazy XML containers. */
export interface NoteWritingFrame extends NoteWritingPosition {
  node: XMLBuilder;
  settings: TabStaffEvent | undefined;
  head: NoteheadEvent | undefined;
  bendHead: BendHeadState | undefined;
  cluster: ClusterGraphicEvent | undefined;
  percussion: PercussionEvent | undefined;
  tab: TabNoteEvent | undefined;
  attachments: readonly Attachment[];
  startTie: boolean;
  stopTie: boolean;
  notation: Notation;
}
