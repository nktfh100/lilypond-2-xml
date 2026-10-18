import { musicXMLColor } from '../colors.js';
import type { Add, Notation } from '../../types.js';
import type { Event, NoteLike } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { noteKey, noteSpanMarks, type SpanMark } from './note-spans.js';
import type { GlissandoEvent } from '../../../model/document.js';

export function glissandoMarks(
  events: Event[],
  notes: NoteLike[],
  boundaries: number[],
  voices: number[],
  warn: Warn,
) {
  return noteSpanMarks(
    events.filter((e) => e.kind === 'glissando'),
    { notes: notes, boundaries: boundaries, voices: voices },
    {
      family: 'glissandi',
      onMissingEndpoints: () =>
        warn(
          'glissando-endpoints',
          'A glissando has missing compiler bounds; its resolved data remains in metadata without guessed native endpoints.',
        ),
      onMissingAnchor: () =>
        warn(
          'glissando-anchor',
          'A resolved glissando endpoint is outside its MusicXML part or has no matching written note; native pairing requires further endpoint support.',
        ),
      inspect: (span) => {
        if (span.custom) {
          warn(
            'glissando-stencil',
            'A custom glissando drawing has no mapped native MusicXML equivalent; its native endpoints and available line style are retained.',
          );
        }

        if (span.customBounds || span.thickness !== 1) {
          warn(
            'glissando-layout',
            'Custom glissando endpoint text, arrows, padding, attachment geometry or thickness have no verified native mapping; available line style and endpoints are retained.',
          );
        }

        if (
          !['line', 'dashed-line', 'dotted-line', 'zigzag', 'trill', 'none'].includes(span.style)
        ) {
          warn(
            'glissando-style',
            `Unmapped glissando line style: ${span.style}; native endpoints are retained with a solid line.`,
          );
        }

        if (['zigzag', 'trill'].includes(span.style)) {
          warn(
            'glissando-wave',
            'Native wavy glissandi retain the source line family without exact LilyPond zigzag or trill geometry.',
          );
        }
      },
    },
  );
}

export function writeGlissandi(
  notation: Notation,
  note: NoteLike,
  marks: ReadonlyMap<string, readonly SpanMark<GlissandoEvent>[]>,
  add: Add,
) {
  if (note.continuation) {
    return;
  }

  for (const { span, type, number } of marks.get(noteKey(note)) ?? []) {
    const fraction = Math.max(0, Math.min(1, span.dashFraction));
    const dashed = span.style === 'dashed-line' && fraction > 0 && fraction < 1;
    const line =
      span.style === 'dotted-line' || (span.style === 'dashed-line' && fraction === 0)
        ? 'dotted'
        : dashed
          ? 'dashed'
          : ['zigzag', 'trill'].includes(span.style)
            ? 'wavy'
            : 'solid';

    add(notation(span.hidden), 'glissando', undefined, {
      type,
      number,
      'line-type': line,
      ...(dashed && span.dashPeriod > 0
        ? {
            'dash-length': 10 * span.dashPeriod * fraction,
            'space-length': 10 * span.dashPeriod * (1 - fraction),
          }
        : {}),
      color: span.hidden ? '#00000000' : musicXMLColor(span.color),
      ...(span.offset[0] ? { 'relative-x': span.offset[0] * 10 } : {}),
      ...(span.offset[1] ? { 'relative-y': span.offset[1] * 10 } : {}),
    });
  }
}
