import { writeArpeggios } from '../../notation/notes/arpeggios.js';
import { writeBends } from '../../notation/notes/bends.js';
import { writeGlissandi } from '../../notation/spans/glissandi.js';
import { type PlannedNote, hasDuration } from '../../planning/events.js';
import { writeSlurs } from '../../notation/spans/slurs.js';
import { writeTies } from '../../notation/spans/ties.js';
import type { PartWriterContext } from '../part/context.js';
import { add, placement } from '../../primitives.js';
import { eventGraceTime, eventTime } from '../../../model/time.js';
import type { NoteWritingFrame } from './context.js';

export function writeNoteNotations(
  writer: PartWriterContext,
  e: PlannedNote,
  frame: Pick<
    NoteWritingFrame,
    | 'notation'
    | 'settings'
    | 'stopTie'
    | 'startTie'
    | 'chord'
    | 'tab'
    | 'notePosition'
    | 'bendHead'
    | 'voice'
  >,
) {
  const { score: writingContext, session } = writer;
  const { arpeggios, slurs, glissandoGraphics, tieGraphics, tupletNumbers } = session.plan;
  const { bends } = writingContext.normalized;
  const { document, warn } = writingContext;
  const { tremolosByNote, events, context } = writingContext.plan;
  const { glissandi } = session.notation;
  const { allocateOrReleaseSpanNumber } = session.writers;
  const {
    notation,
    settings,
    stopTie,
    startTie,
    chord,
    tab,
    notePosition: at,
    bendHead,
    voice,
  } = frame;

  writeArpeggios(notation, e, arpeggios, add);
  writeBends(notation, e, bends, add);

  if (hasDuration(e)) {
    writeSlurs(notation, e, slurs, add);
    writeGlissandi(notation, e, glissandoGraphics, add);
  }

  if (document.tiesCaptured && hasDuration(e)) {
    writeTies(notation, e, tieGraphics, add, settings?.visibility?.Tie !== false);
  }

  if (!document.tiesCaptured && stopTie && settings?.visibility?.Tie !== false) {
    add(notation(), 'tied', undefined, { type: 'stop' });
  }

  if (!document.tiesCaptured && startTie && settings?.visibility?.Tie !== false) {
    add(notation(), 'tied', undefined, { type: 'start' });
  }

  const tremolo = tremolosByNote.get(e.noteId ?? NaN);

  if (tremolo && !chord && !e.continuation) {
    add(add(notation(), 'ornaments'), 'tremolo', tremolo.marks, {
      type: tremolo.type,
    });
  }

  if (tab) {
    const settings = events
      .filter(
        (a): a is typeof a & { kind: 'tabStaff' } =>
          a.kind === 'tabStaff' && a.staff === e.staff && eventTime(a) <= at,
      )
      .at(-1);
    const string =
      settings && !settings.stringOneTopmost
        ? settings.tunings.length + 1 - tab.string
        : tab.string;
    const technical = add(notation(), 'technical');

    add(technical, 'string', string);

    if (typeof tab.fret === 'number' && Number.isInteger(tab.fret) && tab.fret >= 0) {
      add(technical, 'fret', tab.fret, bendHead?.hidden ? { color: '#00000000' } : {});
    } else {
      warn('tab-fret', `Noninteger tablature fret requires further mapping: ${tab.fret}`);
    }
  } else if (context.get(e.staff)?.type === 'TabStaff' && e.kind === 'note') {
    warn('tab-selection', 'A tablature string/fret selection was not captured.');
  }

  for (const script of events.filter(
    (a): a is typeof a & { kind: 'percussionScript' } =>
      a.kind === 'percussionScript' && a.noteId === e.noteId && !e.continuation,
  )) {
    if (script.hidden) {
      continue;
    }

    const technical = (
      {
        open: 'open-string',
        stopped: 'stopped',
        thumb: 'thumb-position',
        flageolet: 'harmonic',
      } as Record<string, string>
    )[script.glyph];

    if (technical) {
      add(add(notation(), 'technical'), technical, undefined, placement(script));
    } else {
      warn('percussion-script', `Unmapped automatic drum symbol: ${script.glyph}`);
    }
  }

  if (!chord) {
    const tuplets = events.filter(
      (a): a is typeof a & { kind: 'voice' } =>
        a.kind === 'voice' && a.class === 'tuplet-span-event' && a.voice === voice,
    );

    for (const a of tuplets) {
      if (
        a.spanDirection === -1 &&
        eventTime(a) === at &&
        eventGraceTime(a) === eventGraceTime(e)
      ) {
        const tuplet = add(notation(), 'tuplet', undefined, {
          type: 'start',
          number: tupletNumbers.get(a) || 1,
        });

        if (typeof a.denominator === 'number' && typeof a.numerator === 'number') {
          add(add(tuplet, 'tuplet-actual'), 'tuplet-number', a.denominator);
          add(add(tuplet, 'tuplet-normal'), 'tuplet-number', a.numerator);
        }
      }

      if (
        a.spanDirection === 1 &&
        !eventGraceTime(e) &&
        Math.abs(eventTime(a) - (at + e.segmentDuration)) < 1e-10
      ) {
        add(notation(), 'tuplet', undefined, {
          type: 'stop',
          number: tupletNumbers.get(a) || 1,
        });
      }
    }

    if (!document.glissandosCaptured && glissandi.has(voice)) {
      add(notation(), 'glissando', undefined, {
        type: 'stop',
        number: glissandi.get(voice),
      });
      glissandi.delete(voice);
      allocateOrReleaseSpanNumber({ voice, spanDirection: 1 }, 'glissando');
    }
  }
}
