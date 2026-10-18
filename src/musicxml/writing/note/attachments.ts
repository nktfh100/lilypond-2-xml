import { isThumbFingering, writeArticulation } from '../../notation/notes/articulations.js';
import type { PlannedNote } from '../../planning/events.js';
import { scriptKey, writeOrnament } from '../../notation/notes/ornaments.js';
import { writeTechnique } from '../../notation/notes/techniques.js';
import type { PartWriterContext } from '../part/context.js';
import { add, placement } from '../../primitives.js';
import { rationalValue } from '../../../model/time.js';
import type { NoteWritingFrame } from './context.js';

export function writeNoteAttachments(
  writer: PartWriterContext,
  e: PlannedNote,
  frame: Pick<NoteWritingFrame, 'attachments' | 'chord' | 'notation' | 'stopTie' | 'voice' | 'tab'>,
) {
  const { score: writingContext, session } = writer;
  const { document, warn } = writingContext;
  const { allocateOrReleaseSpanNumber } = session.writers;
  const { writtenScripts, glissandi } = session.notation;
  const { scripts } = writingContext.plan;
  const { capturedAttachment } = writingContext.normalized;
  const { attachments, chord, notation, stopTie, voice, tab } = frame;

  for (const a of attachments) {
    if (
      ['slur-event', 'phrasing-slur-event'].includes(a.class) &&
      !document.slursCaptured &&
      !chord
    ) {
      add(notation(), 'slur', undefined, {
        type: a.spanDirection === -1 ? 'start' : 'stop',
        number: allocateOrReleaseSpanNumber({ ...a, voice }, a.class, 'slur'),
        ...placement(a),
      });
    }

    if (!document.tiesCaptured && a.class === 'repeat-tie-event' && !stopTie) {
      add(notation(), 'tied', undefined, {
        type: 'stop',
        ...(a.grobDirection || a.direction
          ? {
              orientation: (a.grobDirection || a.direction) === 1 ? 'over' : 'under',
            }
          : {}),
      });
    }

    if (a.class === 'trill-span-event' && !chord) {
      const ornaments = add(notation(), 'ornaments');

      if (a.spanDirection === -1) {
        add(ornaments, 'trill-mark', undefined, placement(a));
      }

      add(ornaments, 'wavy-line', undefined, {
        type: a.spanDirection === -1 ? 'start' : 'stop',
        number: allocateOrReleaseSpanNumber({ ...a, voice }, 'trill'),
        ...placement(a),
      });

      if (a.pitch && a.spanDirection === -1) {
        const accidental = {
          [-2]: 'flat-flat',
          [-1]: 'flat',
          [0]: 'natural',
          [1]: 'sharp',
          [2]: 'double-sharp',
          [-0.5]: 'quarter-flat',
          [0.5]: 'quarter-sharp',
        }[rationalValue(a.pitch.alteration) * 2];

        if (accidental) {
          add(ornaments, 'accidental-mark', accidental, {
            placement: 'above',
          });
        }

        if (
          e.pitch &&
          a.pitch.octave * 7 + a.pitch.step - e.pitch.octave * 7 - e.pitch.step !== 1
        ) {
          warn(
            'trill-auxiliary',
            'Non-adjacent auxiliary trill pitches need additional MusicXML playback support.',
          );
        }
      }
    }

    if (a.class === 'articulation-event') {
      const key = scriptKey(a.scriptId, e.sourceVoice ?? voice, e.moment);

      if (a.scriptId !== undefined && writtenScripts.has(key)) {
        continue;
      }

      if (a.scriptId !== undefined) {
        writtenScripts.add(key);
      }

      const graphic = scripts.get(scriptKey(a.scriptId, e.sourceVoice ?? voice, e.moment));

      if (writeOrnament(notation, a, graphic, document.scriptsCaptured, add, warn)) {
        continue;
      }

      if (!writeArticulation(notation, a, graphic, document.scriptsCaptured, add, warn)) {
        warn('articulation', `Unmapped articulation: ${a.articulationType}`);
      }
    }

    if (a.class === 'stroke-finger-event' || a.class === 'bend-after-event') {
      const key = scriptKey(a.scriptId, e.sourceVoice ?? voice, e.moment);
      const graphic = scripts.get(key);

      if (graphic?.noteId !== undefined && graphic.noteId !== e.noteId) {
        continue;
      }

      if (a.scriptId !== undefined && writtenScripts.has(key)) {
        continue;
      }

      if (!graphic && chord) {
        continue;
      }

      if (a.scriptId !== undefined) {
        writtenScripts.add(key);
      }

      writeTechnique(notation, a, graphic, document.scriptsCaptured, add, warn);
    }

    if (a.class === 'fingering-event') {
      if (isThumbFingering(a.markup)) {
        add(add(notation(), 'technical'), 'thumb-position', undefined, placement(a));
      } else {
        add(add(notation(), 'technical'), 'fingering', a.text ?? a.digit, placement(a));
      }
    }

    if (a.class === 'string-number-event' && !tab) {
      add(add(notation(), 'technical'), 'string', a.stringNumber);
    }

    if (a.class === 'tremolo-event') {
      add(add(notation(), 'ornaments'), 'tremolo', Math.max(1, Math.log2(a.tremoloType) - 2), {
        type: 'single',
      });
    }

    if (a.class === 'glissando-event' && !document.glissandosCaptured && !chord) {
      const number = allocateOrReleaseSpanNumber({ voice, spanDirection: -1 }, 'glissando');

      add(notation(), 'glissando', undefined, {
        type: 'start',
        number,
      });
      glissandi.set(voice, number);
    }

    if (!document.tiesCaptured && a.class === 'laissez-vibrer-event') {
      add(notation(), 'tied', undefined, { type: 'let-ring' });
    }

    if (a.class === 'harmonic-event') {
      add(add(notation(), 'technical'), 'harmonic');
    }

    if (a.class === 'ignored' && !capturedAttachment(a)) {
      warn('attachment', `Unmapped attachment: ${a.name}`);
    }
  }
}
