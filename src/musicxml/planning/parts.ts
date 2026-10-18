import type { Context } from '@sightread/lilypond-eventdocument';
import { type Event, isKind, percussionKey } from './events.js';
import type { ScoreDocument, PercussionEvent } from '../../model/document.js';

export interface Part {
  id: string;
  contextId: number;
  staves: number[];
  percussion: (PercussionEvent & { instrumentId: string })[];
}

export interface DiscoveredParts {
  events: Event[];
  context: Map<number, Context>;
  ancestors: (id: number) => Context[];
  staffIds: number[];
  semanticFigures: (Extract<Event, { kind: 'figuredBass' }> & {
    staff: number;
  })[];
  harmonies: Extract<Event, { kind: 'harmony' }>[];
  parts: Part[];
}

export function discoverParts(document: ScoreDocument, sourceEvents: Event[]): DiscoveredParts {
  let events = sourceEvents;
  const context = new Map(document.contexts.map((c) => [c.id, c]));
  const ancestors = (id: number) => {
    const chain: Context[] = [];
    let current = context.get(id);

    while (current && !chain.some((c) => c.id === current?.id)) {
      chain.push(current);
      current = current.parent === null ? undefined : context.get(current.parent);
    }

    return chain;
  };
  const ancestor = (id: number) =>
    ancestors(id).find((c) => ['PianoStaff', 'GrandStaff'].includes(c.type))?.id ?? id;
  const staffGroupTypes = new Set([
    'Score',
    'StaffGroup',
    'ChoirStaff',
    'PianoStaff',
    'GrandStaff',
  ]);
  const isStaffGroup = (id: number | null | undefined) => {
    const c = id === undefined || id === null ? undefined : context.get(id);

    return c !== undefined && staffGroupTypes.has(c.type);
  };
  const carrierStaffIds = [
    ...new Set(
      events
        .filter((e) => isKind(e, 'note', 'rest', 'mmrest', 'skip', 'staffMeta', 'clef'))
        .map((e) => e.staff),
    ),
  ];
  const staffGroupAnchor = new Map<number, number | undefined>(
    carrierStaffIds
      .filter((id) => isStaffGroup(id))
      .map((id) => [
        id as number,
        carrierStaffIds.find(
          (staff) =>
            staff !== id &&
            !isStaffGroup(staff) &&
            ancestors(staff as number).some((a) => a.id === id),
        ),
      ]),
  );

  if (staffGroupAnchor.size) {
    events = events.map((e) => {
      const anchor = typeof e.staff === 'number' ? staffGroupAnchor.get(e.staff) : undefined;

      return anchor === undefined ? e : ({ ...e, staff: anchor } as typeof e);
    });
  }

  const staffIds = [
    ...new Set(
      events
        .filter((e) => isKind(e, 'note', 'rest', 'mmrest', 'skip', 'staffMeta', 'clef'))
        .map((e) => e.staff),
    ),
  ];
  const semanticFigures = events
    .filter((e) => e.kind === 'figuredBass')
    .map((e) => ({ ...e, staff: e.staff ?? e.context }));
  const harmonies = events.filter((e) => e.kind === 'harmony');

  if (!staffIds.length) {
    staffIds.push(...new Set(harmonies.map((e) => e.context)));
  }

  for (const e of semanticFigures) {
    if (!staffIds.includes(e.staff)) {
      staffIds.push(e.staff);
    }
  }

  if (!staffIds.length) {
    throw new Error('Score contains no supported staves');
  }

  const parts: Part[] = [...new Set(staffIds.map(ancestor))].map((id, index) => {
    const partId = `P${index + 1}`;
    const staves = staffIds.filter((s) => ancestor(s) === id);
    const drums = [
      ...new Map(
        events
          .filter(
            (e): e is typeof e & { kind: 'percussion' } =>
              e.kind === 'percussion' && staves.includes(e.staff),
          )
          .map((e) => [percussionKey(e), e]),
      ).values(),
    ];

    return {
      id: partId,
      contextId: id,
      staves,
      percussion: drums.map((drum, i) => ({
        ...drum,
        instrumentId: `${partId}-I${i + 1}`,
      })),
    };
  });

  return {
    events,
    context,
    ancestors,
    staffIds,
    semanticFigures,
    harmonies,
    parts,
  };
}
