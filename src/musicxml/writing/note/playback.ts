import { type PlannedNote, hasDuration, required } from '../../planning/events.js';
import { tieSoundKey, type TieMark } from '../../notation/spans/ties.js';
import type { TiePlaybackSession } from '../tie-session.js';
import { add } from '../../primitives.js';
import { rationalValue } from '../../../model/time.js';
import type { NoteWritingFrame } from './context.js';

export interface NotePlaybackInput {
  readonly ties: TiePlaybackSession;
  readonly tieGraphics: ReadonlyMap<string, readonly TieMark[]>;
}

export function writeNotePlayback(
  input: NotePlaybackInput,
  e: PlannedNote,
  frame: Pick<NoteWritingFrame, 'voice' | 'notePosition' | 'attachments' | 'node'>,
) {
  const { ties, tieGraphics } = input;
  const { voice, notePosition: at, attachments, node } = frame;
  const pitchKey = `${voice}:${e.drumType || ''}:${e.pitch ? e.pitch.octave * 12 + required([0, 2, 4, 5, 7, 9, 11][e.pitch.step], `pitch step ${e.pitch.step} for source note ${e.noteId ?? 'without id'} in voice ${e.sourceVoice ?? e.voice} (written voice ${voice})`) + rationalValue(e.pitch.alteration) * 2 : ''}`;
  const stopKey = hasDuration(e) ? (tieSoundKey(e, tieGraphics, 'stop') ?? pitchKey) : pitchKey;
  const startKey = hasDuration(e) ? (tieSoundKey(e, tieGraphics, 'start') ?? pitchKey) : pitchKey;
  const { stopTie, stopSoundTie } = ties.stop({
    key: stopKey,
    at,
    cue: !!e.cue,
    acceptsStop: e.kind === 'note',
    expireAcrossGap: stopKey === pitchKey,
  });
  const startTie =
    e.kind === 'note' &&
    (e.continues || e.tieAtEnd || attachments.some((a) => a.class === 'tie-event'));

  if (stopSoundTie) {
    add(node, 'tie', undefined, { type: 'stop' });
  }

  if (startTie) {
    ties.start(
      startKey,
      voice,
      at + e.segmentDuration,
      e.cue ? undefined : add(node, 'tie', undefined, { type: 'start' }),
    );
  }

  return { stopTie, startTie };
}
