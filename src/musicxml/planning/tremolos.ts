import { type Event, type NoteLike, required } from './events.js';
import type { Warn } from '../../model/diagnostics.js';
import { eventTime } from '../../model/time.js';

export interface TremoloMark {
  type: 'start' | 'stop';
  marks: number;
}

export interface TremoloPlan {
  tremolosByNote: Map<number | undefined, TremoloMark>;
}

export function planTremolos(
  events: readonly Event[],
  notes: readonly NoteLike[],
  warn: Warn,
): TremoloPlan {
  const tremolosByNote = new Map<number | undefined, TremoloMark>();
  const tremoloStarts = new Map<number | null | undefined, Event>();

  for (const e of events.filter((e) => e.class === 'tremolo-span-event')) {
    if (e.spanDirection === -1) {
      tremoloStarts.set(e.voice, e);
    } else {
      const start = tremoloStarts.get(e.voice);

      if (!start) {
        continue;
      }

      const members = notes.filter(
        (n): n is NoteLike & { kind: 'note' } =>
          n.kind === 'note' &&
          n.voice === e.voice &&
          eventTime(n) >= eventTime(start) &&
          eventTime(n) < eventTime(e),
      );
      const moments = [...new Set(members.map(eventTime))];

      if (moments.length === 2) {
        tremolosByNote.set(
          required(
            members.find((n) => eventTime(n) === moments[0]),
            'score-plan.ts: members.find((n) => time(n) === moments[0])',
          ).noteId,
          {
            type: 'start',
            marks: Math.log2(start.tremoloType || 0) - 2,
          },
        );
        tremolosByNote.set(
          required(
            members.find((n) => eventTime(n) === moments[1]),
            'score-plan.ts: members.find((n) => time(n) === moments[1])',
          ).noteId,
          {
            type: 'stop',
            marks: Math.log2(start.tremoloType || 0) - 2,
          },
        );
      } else {
        warn(
          'tremolo-span',
          'Alternating tremolos with other than two note groups require further mapping.',
        );
      }

      tremoloStarts.delete(e.voice);
    }
  }

  return { tremolosByNote };
}
