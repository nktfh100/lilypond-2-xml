import {
  curveAttributes,
  resolvedSlurBezierAttributes,
  type ResolvedSlurGeometry,
} from './curves.js';
import type { Add, Attributes, Notation } from '../../types.js';
import type { Event, NoteLike } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { noteKey, noteSpanMarks, type SpanMark } from './note-spans.js';
import type { SlurEvent } from '../../../model/document.js';

export interface NativeSlurMark extends SpanMark<SlurEvent> {
  bezierAttrs?: Attributes;
}
type ResolvedSlurEvent = SlurEvent & {
  resolvedGeometry?: ResolvedSlurGeometry | null;
};
type SlurMark = NativeSlurMark;

export function slurMarks(
  events: Event[],
  notes: NoteLike[],
  boundaries: number[],
  voices: number[],
  warn: Warn,
  globalStaffSpaceMm?: number,
) {
  const geometries = new Map<SlurEvent, { start: Attributes; stop: Attributes } | null>();
  const marks = noteSpanMarks(
    events.filter((e) => e.kind === 'slur'),
    { notes: notes, boundaries: boundaries, voices: voices },
    {
      family: 'slurs',
      onMissingEndpoints: () =>
        warn(
          'slur-endpoints',
          'A slur has missing compiler bounds; its resolved data remains in metadata without guessed native endpoints.',
        ),
      onMissingAnchor: () =>
        warn(
          'slur-anchor',
          'A resolved slur endpoint is outside its MusicXML part or has no matching written note; native pairing requires further endpoint support.',
        ),
      inspect: (span) => {
        const fromNoteId = span.fromNotes.length === 1 ? (span.fromNotes[0] ?? -1) : -1;
        const toNoteId = span.toNotes.length === 1 ? (span.toNotes[0] ?? -1) : -1;
        const sourceGeometry = (span as ResolvedSlurEvent).resolvedGeometry ?? undefined;
        const eligible =
          !span.custom &&
          (sourceGeometry !== undefined || (!span.customControls && span.controlPoints === null)) &&
          Number.isSafeInteger(fromNoteId) &&
          Number.isSafeInteger(toNoteId);
        const start = eligible
          ? resolvedSlurBezierAttributes(
              sourceGeometry,
              { slurId: span.id, staff: span.staff, fromNoteId, toNoteId },
              'start',
              globalStaffSpaceMm,
            )
          : null;
        const stop = eligible
          ? resolvedSlurBezierAttributes(
              sourceGeometry,
              { slurId: span.id, staff: span.staff, fromNoteId, toNoteId },
              'stop',
              globalStaffSpaceMm,
            )
          : null;
        const resolved = start && stop ? { start, stop } : null;

        geometries.set(span, resolved);

        if (sourceGeometry && !resolved) {
          warn(
            'slur-layout',
            'Resolved source slur geometry has invalid endpoint ownership, coordinate units or scale. It remains in metadata without guessed native control points.',
          );
        }

        if (span.custom) {
          warn(
            'slur-stencil',
            'A custom slur drawing has no mapped native MusicXML equivalent; its available native slur, endpoints, and placement are retained.',
          );
        }

        if (
          ((span.customControls ||
            span.controlPoints !== null ||
            span.heightLimit !== 2 ||
            span.ratio !== (span.phrasing ? 0.333 : 0.25)) &&
            !resolved) ||
          span.thickness !== 1.2
        ) {
          warn(
            'slur-layout',
            'A custom slur curve without resolved geometry, or a line thickness with no separate MusicXML field, remains only partially represented; available endpoints and placement are retained.',
          );
        }

        if (
          span.dash.length > 1 ||
          (span.dash[0] && (span.dash[0][0] !== 0 || span.dash[0][1] !== 1))
        ) {
          warn(
            'slur-dash-pattern',
            'A slur changes dash patterns along its curve; native endpoints and the initial line style are retained without the exact partial-curve pattern.',
          );
        }
      },
    },
  ) as Map<string, NativeSlurMark[]>;

  for (const entries of marks.values()) {
    for (const mark of entries) {
      const geometry = geometries.get(mark.span);
      const attrs = geometry?.[mark.type];

      if (attrs) {
        mark.bezierAttrs = attrs;
      }
    }
  }

  return marks;
}

export function writeSlurs(
  notation: Notation,
  note: NoteLike,
  marks: ReadonlyMap<string, readonly SlurMark[]>,
  add: Add,
) {
  if (note.continuation) {
    return;
  }

  for (const mark of marks.get(noteKey(note)) ?? []) {
    add(notation(mark.span.hidden), 'slur', undefined, {
      ...curveAttributes(mark, !mark.bezierAttrs),
      ...(mark.bezierAttrs ?? {}),
    });
  }
}
