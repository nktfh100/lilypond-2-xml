import { musicXMLColor } from '../colors.js';
import type { Add, Notation } from '../../types.js';
import type { Event, NoteLike } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { momentKey } from '../../../model/time.js';
import type { ArpeggioEvent } from '../../../model/document.js';

type Note = Extract<Event, { kind: 'note' }>;
export interface Mark {
  graphic: ArpeggioEvent;
  number: number;
  unbroken: boolean;
  endpoint?: 'top' | 'bottom';
  rangeEnd?: 'top' | 'bottom';
}
const noteKey = (note: NoteLike | Note): string =>
  note.noteId === undefined
    ? `${note.voice}:${momentKey(note.moment)}:${note.pitch?.octave}:${note.pitch?.step}:${note.pitch?.alteration.numerator}/${note.pitch?.alteration.denominator}`
    : `note:${note.noteId}`;

export function arpeggioMarks(
  events: Event[],
  staves: number[],
  captured: boolean | undefined,
  warn: Warn,
): Map<string, Mark[]> {
  const notes = events.filter((event) => event.kind === 'note');
  const byId = new Map(notes.map((note) => [note.noteId, note]));
  const graphics = new Map<string, ArpeggioEvent>();

  for (const graphic of events.filter((event) => event.kind === 'arpeggio')) {
    const key = `${graphic.id}:${momentKey(graphic.moment)}`;
    const previous = graphics.get(key);

    graphics.set(
      key,
      previous
        ? {
            ...graphic,
            noteIds: [...new Set([...previous.noteIds, ...graphic.noteIds])],
            ...(previous.headPositions || graphic.headPositions
              ? {
                  headPositions: [
                    ...new Map([
                      ...(previous.headPositions ?? []),
                      ...(graphic.headPositions ?? []),
                    ]).entries(),
                  ],
                }
              : {}),
            ...(previous.rangeReference || graphic.rangeReference
              ? {
                  rangeReference: [
                    ...new Set([
                      ...(previous.rangeReference ?? []),
                      ...(graphic.rangeReference ?? []),
                    ]),
                  ],
                }
              : {}),
          }
        : graphic,
    );
  }

  const groups = [...graphics.values()].map((graphic) => ({
    graphic,
    members: graphic.noteIds.flatMap((id) => {
      const note = byId.get(id);

      return note ? [note] : [];
    }),
  }));
  const requests = events.flatMap((event) => [
    ...(event.kind === 'voice' && event.class === 'arpeggio-event'
      ? [{ event, attachment: event }]
      : []),
    ...(event.kind === 'note'
      ? event.attachments
          .filter((attachment) => attachment.class === 'arpeggio-event')
          .map((attachment) => ({ event, attachment }))
      : []),
  ]);
  const seen = new Set<string>();

  for (const { event, attachment } of requests) {
    const key = `${event.voice}:${momentKey(event.moment)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const members = notes.filter(
      (note) => note.voice === event.voice && momentKey(note.moment) === momentKey(event.moment),
    );

    if (groups.some((group) => group.members.some((note) => members.includes(note)))) {
      continue;
    }

    groups.push({
      graphic: {
        kind: 'arpeggio',
        id: 0,
        context: event.voice,
        moment: event.moment,
        noteIds: members.flatMap((note) => (note.noteId === undefined ? [] : [note.noteId])),
        style: attachment.arpeggioStyle || 'normal',
        direction: attachment.arpeggioDirection || 0,
        hidden: !!captured,
        custom: false,
        side: -1,
        fontSize: 0,
        positions: null,
        dashed: false,
      },
      members,
    });

    if (!captured) {
      warn(
        'arpeggio-history',
        'Resolved arpeggio graphics are unavailable; native groups are inferred from each voice. Their visibility, drawing overrides, and connections between voices or staves cannot be verified.',
      );
    }
  }

  const marks = new Map<string, Mark[]>();
  const phaseNumbers = new Map<string, Set<number>>();
  const onsetNumbers = new Map<number, Set<number>>();
  const availableNumbers = Array.from({ length: 16 }, (_, index) => index + 1);

  for (const { graphic, members } of groups) {
    const positions = new Map(graphic.headPositions ?? []);
    const height = (n: Note) =>
      positions.get(n.noteId ?? NaN) ?? (n.pitch ? n.pitch.octave * 7 + n.pitch.step : 0);
    const local = members
      .filter((note) => staves.includes(note.staff))
      .sort((a, b) => staves.indexOf(a.staff) - staves.indexOf(b.staff) || height(b) - height(a));

    if (!local.length) {
      if (!members.length && !graphic.hidden) {
        warn(
          'arpeggio-notes',
          'An arpeggio has no captured notehead members; its graphic data remains in metadata without guessed note ownership.',
        );
      }

      continue;
    }

    if (
      graphic.id !== 0 &&
      (!graphic.headPositions || graphic.color === undefined || !graphic.offset)
    ) {
      warn(
        'arpeggio-appearance-history',
        'This arpeggio lacks captured color, offsets or physical notehead positions; available native membership is retained without verified appearance or non-pitched endpoint order.',
      );
    }

    const phase = momentKey(graphic.moment);
    const onset = graphic.moment.main.numerator / graphic.moment.main.denominator;
    const usedInPhase = phaseNumbers.get(phase) || new Set<number>();
    const usedAtOnset = onsetNumbers.get(onset) || new Set<number>();
    const preferred = availableNumbers.find((number) => !usedAtOnset.has(number));
    const number = preferred ?? availableNumbers.find((number) => !usedInPhase.has(number));

    if (number === undefined) {
      throw new Error(
        'More than 16 simultaneous arpeggio groups cannot be represented by MusicXML',
      );
    }

    usedInPhase.add(number);
    usedAtOnset.add(number);
    phaseNumbers.set(phase, usedInPhase);
    onsetNumbers.set(onset, usedAtOnset);
    const unbroken = new Set(local.map((note) => note.staff)).size > 1;

    if (local.length !== members.length && !graphic.hidden) {
      warn(
        'arpeggio-parts',
        'A connected arpeggio spans separate MusicXML parts. Its native markings are retained in each part, but MusicXML cannot connect an arpeggio across parts.',
      );
    }

    if (!graphic.hidden) {
      if (graphic.style === 'parenthesis') {
        warn(
          'arpeggio-parenthesis',
          'A vertical chord slur uses the available native non-arpeggiate bracket. Its curved or dashed LilyPond shape has no mapped native MusicXML representation.',
        );
      }

      if (graphic.custom) {
        warn(
          'arpeggio-stencil',
          'A custom arpeggio drawing has no mapped native MusicXML equivalent; its available native chord marking and resolved data are retained.',
        );
      }

      if (graphic.side > 0) {
        warn(
          'arpeggio-side',
          'A chord marking to the right of the notes retains its native shape; its right-side placement has not been mapped.',
        );
      }

      if (
        graphic.fontSize ||
        graphic.positions ||
        graphic.customGeometry ||
        graphic.customPositions
      ) {
        warn(
          'arpeggio-layout',
          'Native arpeggio membership and available nominal range/offset data are retained; custom glyph sizes, fitted waves, hook widths, thickness, padding or coordinate overrides are not mapped exactly.',
        );
      }
    }

    if (
      graphic.positions &&
      (graphic.rangeBase == null ||
        graphic.rangeStaffTop == null ||
        local.some((n) => !graphic.rangeReference?.includes(n.noteId ?? NaN)))
    ) {
      warn(
        'arpeggio-range-reference',
        'A custom arpeggio range spans different or unresolved staff coordinate references; native membership and translation offsets remain, without guessed cross-staff range coordinates.',
      );
    }

    const append = (note: Note, endpoint?: 'top' | 'bottom', rangeEnd = endpoint): void => {
      const key = noteKey(note);

      marks.set(key, [
        ...(marks.get(key) || []),
        {
          graphic,
          number,
          unbroken,
          ...(endpoint ? { endpoint } : {}),
          ...(rangeEnd ? { rangeEnd } : {}),
        },
      ]);
    };

    if (graphic.style === 'normal') {
      local.forEach((note, i) =>
        append(note, undefined, i === 0 ? 'top' : i === local.length - 1 ? 'bottom' : undefined),
      );

      if (local.length === 1 && graphic.positions) {
        append(local[0]!, undefined, 'bottom');
      }
    } else {
      append(local[0]!, 'top');
      append(local.at(-1)!, 'bottom');
    }
  }

  return marks;
}

export function writeArpeggios(
  notation: Notation,
  note: NoteLike,
  marks: ReadonlyMap<string, readonly Mark[]>,
  add: Add,
): void {
  if (note.kind !== 'note' || note.continuation) {
    return;
  }

  for (const { graphic, number, unbroken, endpoint, rangeEnd } of marks.get(noteKey(note)) || []) {
    const rangeY =
      rangeEnd &&
      graphic.positions &&
      graphic.rangeBase != null &&
      graphic.rangeStaffTop != null &&
      graphic.rangeReference?.includes(note.noteId ?? NaN)
        ? (graphic.positions[rangeEnd === 'top' ? 1 : 0] +
            graphic.rangeBase -
            graphic.rangeStaffTop) *
          10
        : undefined;
    const x = graphic.offset?.[0] ?? 0,
      y = graphic.offset?.[1] ?? 0;

    add(notation(graphic.hidden), endpoint ? 'non-arpeggiate' : 'arpeggiate', undefined, {
      number,
      color: graphic.hidden ? '#00000000' : musicXMLColor(graphic.color ?? null),
      ...(graphic.defaultX != null ? { 'default-x': graphic.defaultX * 10 } : {}),
      ...(x ? { 'relative-x': x * 10 } : {}),
      ...(y ? { 'relative-y': y * 10 } : {}),
      ...(rangeY !== undefined ? { 'default-y': rangeY } : {}),
      ...(endpoint
        ? { type: endpoint }
        : {
            ...(graphic.direction ? { direction: graphic.direction > 0 ? 'up' : 'down' } : {}),
            ...(unbroken ? { unbroken: 'yes' } : {}),
          }),
    });
  }
}
