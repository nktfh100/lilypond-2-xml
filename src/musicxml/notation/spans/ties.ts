import {
  curveAttributes,
  resolvedTieBezierAttributes,
  type ResolvedTieGeometry,
} from './curves.js';
import type { Add, Attributes, Notation } from '../../types.js';
import type { Event, NoteLike } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { noteKey, noteSpanMarks, type SpanMark } from './note-spans.js';
import { momentKey, eventTime, rationalValue } from '../../../model/time.js';
import type { TieGraphicEvent } from '../../../model/document.js';

const pitchKey = (n: NoteLike | undefined) =>
  n?.pitch
    ? `${n.voice}:${n.pitch.octave * 12 + [0, 2, 4, 5, 7, 9, 11][n.pitch.step]! + 2 * rationalValue(n.pitch.alteration)}`
    : `${n?.voice}:${n?.drumType ?? n?.noteId}`;
const sourceKey = (span: TieGraphicEvent) =>
  `tie:${span.voice}:${span.id}:${momentKey(span.moment)}`;

export interface TieMark extends SpanMark<TieGraphicEvent> {
  bezierAttrs?: Attributes;
}

export function tieMarks(
  events: Event[],
  notes: NoteLike[],
  boundaries: number[],
  voices: number[],
  warn: Warn,
  globalStaffSpaceMm?: number,
) {
  const geometries = new Map<TieGraphicEvent, { start: Attributes; stop: Attributes } | null>();
  const anchor = (span: TieGraphicEvent, side: 'start' | 'stop', local: NoteLike[]) => {
    const ids = side === 'start' ? span.fromNotes : span.toNotes;
    const ending =
      span.tieType === 'laissez-vibrer' || (span.tieType === 'normal' && side === 'start');

    return local.find(
      (n) =>
        n.noteId !== undefined &&
        ids.includes(n.noteId) &&
        !(ending ? n.continues : n.continuation),
    );
  };
  const marks = noteSpanMarks(
    events.filter((e) => e.kind === 'tieGraphic'),
    { notes: notes, boundaries: boundaries, voices: voices },
    {
      family: 'ties',
      onMissingEndpoints: () =>
        warn(
          'tie-endpoints',
          'A tie graphic has missing compiler bounds; native curves are not guessed. Event-based tie links remain subject to endpoint ownership.',
        ),
      onMissingAnchor: () =>
        warn(
          'tie-anchor',
          'A resolved tie endpoint is outside its MusicXML part or has no matching written note; native curve pairing requires further endpoint support.',
        ),
      inspect: (span) => {
        const fromNoteId = span.fromNotes.length === 1 ? (span.fromNotes[0] ?? -1) : -1;
        const toNoteId = span.toNotes.length === 1 ? (span.toNotes[0] ?? -1) : -1;
        const sourceGeometry = span.resolvedGeometry as ResolvedTieGeometry | undefined;
        const from = anchor(span, 'start', notes),
          to = anchor(span, 'stop', notes);
        const eligible =
          span.tieType === 'normal' &&
          !span.custom &&
          Number.isSafeInteger(fromNoteId) &&
          Number.isSafeInteger(toNoteId) &&
          from?.noteId === fromNoteId &&
          to?.noteId === toNoteId &&
          from?.staff === sourceGeometry?.fromStaffContext &&
          to?.staff === sourceGeometry?.toStaffContext;
        const expected = {
          tieId: span.id,
          fromNoteId,
          toNoteId,
          fromStaffContext: from?.staff ?? -1,
          toStaffContext: to?.staff ?? -1,
          fromStaffSymbolContext: from?.staff ?? -1,
          toStaffSymbolContext: to?.staff ?? -1,
        };
        const start = eligible
          ? resolvedTieBezierAttributes(sourceGeometry, expected, 'start', globalStaffSpaceMm)
          : null;
        const stop = eligible
          ? resolvedTieBezierAttributes(sourceGeometry, expected, 'stop', globalStaffSpaceMm)
          : null;
        const resolved = start && stop ? { start, stop } : null;

        geometries.set(span, resolved);

        if (sourceGeometry && !resolved) {
          warn(
            'tie-layout',
            'Resolved source tie geometry has invalid endpoint ownership, coordinate units or scale. It remains in metadata without guessed native control points.',
          );
        }

        if (span.direction === 0 && !span.hidden) {
          warn(
            'tie-direction',
            'Actual printed tie pieces have no uniquely known final direction. Native endpoints remain without a guessed curve orientation.',
          );
        }

        if (span.custom) {
          warn(
            'tie-stencil',
            'A custom tie drawing has no mapped native MusicXML equivalent; its available native curve, endpoints and placement are retained.',
          );
        }

        if (
          !resolved &&
          (span.customControls ||
            span.controlPoints ||
            span.customDetails ||
            span.thickness !== 1.2 ||
            span.lineThickness !== 0.8)
        ) {
          warn(
            'tie-layout',
            'Custom tie control points, positioning details or thickness have no verified native Bezier mapping; available endpoints and placement are retained.',
          );
        } else if (
          resolved &&
          (span.customDetails || span.thickness !== 1.2 || span.lineThickness !== 0.8)
        ) {
          warn(
            'tie-layout',
            'The measured tie centerline is retained. MusicXML has no native control for the source ribbon width, thickness, or custom tie details.',
          );
        }

        if (
          span.dash.length > 1 ||
          (span.dash[0] && (span.dash[0][0] !== 0 || span.dash[0][1] !== 1))
        ) {
          warn(
            'tie-dash-pattern',
            'A tie changes dash patterns along its curve; native endpoints and the initial line style are retained without the exact partial-curve pattern.',
          );
        }
      },
      anchorNote: anchor,
      allocationGroup: (span) => pitchKey(anchor(span, 'start', notes)),
    },
  ) as Map<string, TieMark[]>;

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

export function tieSoundKey(
  note: NoteLike,
  marks: ReadonlyMap<string, readonly TieMark[]>,
  type: 'start' | 'stop',
) {
  const mark = marks
    .get(noteKey(note))
    ?.find((m) => m.span.tieType === 'normal' && m.type === type);

  return mark ? sourceKey(mark.span) : undefined;
}

export function writeTies(
  notation: Notation,
  note: NoteLike,
  marks: ReadonlyMap<string, readonly TieMark[]>,
  add: Add,
  visible: boolean,
) {
  if (note.continuation) {
    add(notation(!visible), 'tied', undefined, {
      type: 'stop',
      ...(!visible ? { color: '#00000000' } : {}),
    });
  }

  if (note.continues) {
    add(notation(!visible), 'tied', undefined, {
      type: 'start',
      ...(!visible ? { color: '#00000000' } : {}),
    });
  }

  for (const mark of marks.get(noteKey(note)) ?? []) {
    if (mark.span.tieType === 'laissez-vibrer' && mark.type === 'stop') {
      continue;
    }

    const type = mark.span.tieType === 'laissez-vibrer' ? 'let-ring' : mark.type;

    add(notation(mark.span.hidden || !visible), 'tied', undefined, {
      ...curveAttributes(
        {
          ...mark,
          type,
          span: { ...mark.span, hidden: mark.span.hidden || !visible },
        },
        !mark.bezierAttrs,
      ),
      ...(mark.bezierAttrs ?? {}),
    });
  }
}

export function tieWaits(events: readonly Event[], voice: number, from: number, to: number) {
  const states = events
    .filter((e) => e.kind === 'tieState' && e.voice === voice)
    .map((e) => ({
      at: eventTime(e),
      wait: e.waitForNote,
    }));

  return (
    states.filter((e) => e.at <= from).at(-1)?.wait === true &&
    !states.some((e) => e.at > from && e.at < to && !e.wait)
  );
}
