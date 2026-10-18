import type { Moment } from '@sightread/lilypond-eventdocument';
import type { NoteLike } from '../../planning/events.js';
import { compareMoments, momentKey, rationalValue, sameMoments } from '../../../model/time.js';

interface NoteSpan {
  id: number;
  voice: number;
  moment: Moment;
  endMoment: Moment | null;
  fromNotes: readonly number[];
  toNotes: readonly number[];
  resolvedStart: boolean;
}
export const noteKey = (note: NoteLike) => `${note.noteId}:${note.voice}:${momentKey(note.moment)}`;
export interface SpanMark<S> {
  span: S;
  type: 'start' | 'stop';
  number: number;
}

export interface NoteSpanScore {
  notes: NoteLike[];
  boundaries: number[];
  voices: number[];
}
export interface NoteSpanPolicy<S> {
  family: string;
  onMissingEndpoints: () => void;
  onMissingAnchor: () => void;
  inspect: (span: S) => void;
  anchorNote?: (span: S, side: 'start' | 'stop', notes: NoteLike[]) => NoteLike | undefined;
  allocationGroup?: (span: S) => string;
}

export function noteSpanMarks<S extends NoteSpan>(
  spans: S[],
  score: NoteSpanScore,
  policy: NoteSpanPolicy<S>,
) {
  const { notes, boundaries, voices } = score;
  const {
    family,
    onMissingEndpoints: endpoints,
    onMissingAnchor: anchorWarning,
    inspect,
    anchorNote,
    allocationGroup = () => 'all',
  } = policy;
  const local = anchorNote ? notes : notes.filter((n) => !n.continuation);
  const measure = (n: NoteLike) =>
    boundaries.filter((b) => b <= rationalValue(n.moment.main)).length;
  const ordered = [...local].sort(
    (a, b) =>
      measure(a) - measure(b) ||
      voices.indexOf(a.voice) - voices.indexOf(b.voice) ||
      compareMoments(a.moment, b.moment),
  );
  const rank = new Map(ordered.map((n, i) => [n, i]));
  const points: {
    span: S;
    note: NoteLike;
    type: 'start' | 'stop';
    key: string;
    low: number;
    high: number;
  }[] = [];

  for (const span of spans) {
    if (!span.resolvedStart || !span.endMoment) {
      endpoints();
      continue;
    }

    const anchor = (ids: readonly number[], moment: Moment) =>
      ids.length
        ? local.find((n) => n.noteId !== undefined && ids.includes(n.noteId))
        : local.find((n) => n.voice === span.voice && sameMoments(n.moment, moment));
    const from = anchorNote
      ? anchorNote(span, 'start', local)
      : anchor(span.fromNotes, span.moment);
    const to = anchorNote ? anchorNote(span, 'stop', local) : anchor(span.toNotes, span.endMoment);

    if (!from || !to) {
      if (from || to) {
        anchorWarning();
      }

      continue;
    }

    const low = Math.min(rank.get(from)!, rank.get(to)!),
      high = Math.max(rank.get(from)!, rank.get(to)!);
    const key = `${span.voice}:${span.id}:${momentKey(span.moment)}`;

    points.push(
      { span, note: from, type: 'start', key, low, high },
      { span, note: to, type: 'stop', key, low, high },
    );
    inspect(span);
  }

  const phase = (p: (typeof points)[number]) => {
    const r = rank.get(p.note)!;

    if (p.low === p.high) {
      return p.type === 'start' ? 1 : 2;
    }

    return r === p.high ? 0 : 3;
  };

  points.sort((a, b) => rank.get(a.note)! - rank.get(b.note)! || phase(a) - phase(b));
  const active = new Map<string, { number: number; group: string }>(),
    seen = new Set<string>();
  const marks = new Map<string, SpanMark<S>[]>();

  for (const point of points) {
    let number = active.get(point.key)?.number;

    if (number === undefined) {
      const group = allocationGroup(point.span);
      const used = [...active.values()]
        .filter((entry) => entry.group === group)
        .map((entry) => entry.number);

      number = Array.from({ length: 16 }, (_, i) => i + 1).find((n) => !used.includes(n));

      if (number === undefined) {
        throw new Error(
          `More than 16 overlapping ${family} in MusicXML document order cannot be represented in one part`,
        );
      }

      active.set(point.key, { number, group: allocationGroup(point.span) });
    }

    const key = noteKey(point.note),
      entries = marks.get(key) ?? [];

    entries.push({ span: point.span, type: point.type, number });
    marks.set(key, entries);

    if (seen.has(point.key)) {
      active.delete(point.key);
    } else {
      seen.add(point.key);
    }
  }

  return marks;
}
