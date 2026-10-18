import { type NoteLike, required } from './events.js';
import type { DiscoveredParts } from './parts.js';

export interface HarmonyNotes {
  harmonyStaff: Map<number, number>;
  notes: NoteLike[];
}

export function createHarmonyNotes({
  harmonies,
  context,
  parts,
  ancestors,
  staffIds,
}: Pick<
  DiscoveredParts,
  'harmonies' | 'context' | 'parts' | 'ancestors' | 'staffIds'
>): HarmonyNotes {
  const harmonyStaff = new Map(
    harmonies.map((e) => {
      const parent = context.get(e.context)?.parent;
      const part = required(
        parts.find((p) =>
          p.staves.some((staff) => ancestors(staff).some((a) => a.id === parent)),
        ) || parts[0],
        `part for harmony voice ${e.context}`,
      );

      return [
        e.context,
        staffIds.includes(e.context)
          ? e.context
          : required(part.staves[0], `staff for harmony voice ${e.context} in part ${part.id}`),
      ];
    }),
  );
  const chordNotes: NoteLike[] = harmonies.flatMap((e) =>
    (e.playedPitches || []).map((pitch) => ({
      kind: 'note',
      pitch,
      voice: e.context,
      staff: required(harmonyStaff.get(e.context), `staff for harmony voice ${e.context}`),
      duration: e.duration,
      moment: e.moment,
      hidden: true,
      stemHidden: true,
      attachments: [],
    })),
  );

  return { harmonyStaff, notes: chordNotes };
}
