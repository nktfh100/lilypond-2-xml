import { musicXMLColor } from '../colors.js';
import type { Add, Attributes, Notation } from '../../types.js';
import type { BendHoldPoint, Event, NoteLike } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { compareMoments as compare } from '../../../model/time.js';
import type {
  BendGraphicEvent,
  BendHeadState as SourceHeadState,
} from '../../../model/document.js';

export type BendHeadState = SourceHeadState;
export interface BendNative {
  amount: number;
  preBend: boolean;
  release: boolean;
  attrs: Attributes;
  source: BendGraphicEvent;
}
export interface BendPlans {
  byNote: Map<number, BendNative[]>;
  heads: Map<number, BendHeadState>;
}
const validId = (id: number | null): id is number =>
  id !== null && Number.isSafeInteger(id) && id > 0;
const headKeys = [
  'noteId',
  'kind',
  'eligible',
  'hidden',
  'parenthesized',
  'stemHidden',
  'flagHidden',
  'dotsHidden',
  'beamHidden',
] as const satisfies readonly (keyof BendHeadState)[];
const sameHead = (a: BendHeadState, b: BendHeadState) => headKeys.every((key) => a[key] === b[key]);
const fontAttrs = (source: BendGraphicEvent): Attributes =>
  Object.fromEntries(
    Object.entries(source.fontContext?.attrs ?? {}).filter(([key]) =>
      ['font-size', 'font-family', 'font-style', 'font-weight'].includes(key),
    ),
  );
const pitch = (note: Extract<Event, { kind: 'note' }>) =>
  note.pitch
    ? note.pitch.octave * 12 +
      [0, 2, 4, 5, 7, 9, 11][note.pitch.step]! +
      (note.pitch.alteration.numerator / note.pitch.alteration.denominator) * 2
    : null;

/** Original actual bound heads own the native gesture; piece timing is not note order. */
export function bendPlans(events: Event[], warn: Warn, captured = true): BendPlans {
  const byNote = new Map<number, BendNative[]>(),
    heads = new Map<number, BendHeadState>(),
    conflicts = new Set<number>();
  const spans = events.filter((e) => e.kind === 'bendGraphic');

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'bend-capture',
      'Final compiler layout failed; actual BendSpanner pieces and post-print target states may be unavailable. No bend amount or hidden target is inferred from adjacent notes.',
    );
  }

  if (
    !captured &&
    events.some((e) =>
      e.attachments?.some((a) => a.class === 'ignored' && a.name === 'bend-span-event'),
    )
  ) {
    warn(
      'bend-history',
      'Bend input lacks actual final BendSpanner ownership and component states. No native amount, endpoint or hidden fret is guessed from a bend event alone.',
    );
  }

  for (const span of spans) {
    for (const head of [...span.fromHeads, ...span.toHeads]) {
      if (!validId(head.noteId)) {
        continue;
      }

      if (conflicts.has(head.noteId)) {
        continue;
      }

      const old = heads.get(head.noteId);

      if (old && !sameHead(old, head)) {
        heads.delete(head.noteId);
        conflicts.add(head.noteId);
        warn(
          'bend-history',
          'Conflicting cached final component states for one bend-bound note are omitted instead of choosing a visibility history.',
        );
      } else {
        heads.set(head.noteId, head);
      }
    }
  }

  for (const head of heads.values()) {
    if (head.flagHidden === true && head.stemHidden !== true) {
      warn(
        'bend-flag',
        'A bend-bound note has a hidden flag and visible stem. MusicXML cannot independently hide that flag without changing its stem or written duration; the available stem remains.',
      );
    }

    if (head.kind === 'TabNoteHead' && head.parenthesized && !head.hidden) {
      warn(
        'bend-target-parentheses',
        'A final visible bend target has parenthesized tablature fret ink. MusicXML fret requires a nonnegative integer and has no parentheses attribute; the actual fret remains without invented fret text.',
      );
    }
  }

  const notes = new Map(
    events
      .filter(
        (e): e is Extract<Event, { kind: 'note' }> =>
          e.kind === 'note' && validId(e.noteId ?? null),
      )
      .map((e) => [e.noteId!, e]),
  );
  const groups = new Map<string, BendGraphicEvent[]>();

  for (const span of spans) {
    const key = `${span.voice}:${span.id}:${span.percentCopy ?? 'source'}`;

    groups.set(key, [...(groups.get(key) ?? []), span]);
  }

  for (const pieces of groups.values()) {
    const source = pieces.find((p) => !p.hidden) ?? pieces[0]!;

    if (pieces.some((p) => p.custom)) {
      warn(
        'bend-stencil',
        'A custom BendSpanner drawing or line-breaking callback has no verified native bend shape. Actual final target component states remain available without inventing a standard curve.',
      );
      continue;
    }

    if (
      !source.resolvedStart ||
      !source.endMoment ||
      compare(source.moment, source.endMoment) > 0
    ) {
      if (!source.hidden) {
        warn(
          'bend-endpoints',
          'A BendSpanner lacks valid actual graphical bounds. No source note or target is inferred from the next event.',
        );
      }

      continue;
    }

    if (source.style === 'hold') {
      continue;
    }

    const amount = source.quarterDifference === null ? null : source.quarterDifference / 2;
    const eligibleFrom = source.fromHeads.filter((h) => h.eligible),
      eligibleTo = source.toHeads.filter((h) => h.eligible);
    const from = source.fromNotes.flatMap((id) => (notes.has(id) ? [notes.get(id)!] : []));
    const to = source.toNotes.flatMap((id) => (notes.has(id) ? [notes.get(id)!] : []));

    if (
      amount === null ||
      !Number.isFinite(amount) ||
      from.length !== 1 ||
      to.length !== 1 ||
      source.fromNotes.length !== 1 ||
      source.toNotes.length !== 1 ||
      !eligibleFrom.some((h) => h.noteId === from[0]!.noteId) ||
      !eligibleTo.some((h) => h.noteId === to[0]!.noteId) ||
      from.some((n) => pitch(n) === null || conflicts.has(n.noteId!)) ||
      to.some((n) => pitch(n) === null)
    ) {
      warn(
        'bend-ownership',
        'A BendSpanner lacks unique actual highest eligible bound-head owners or a verified numeric amount. Tied highest unisons and missing source IDs are not resolved by chord order or pitch proximity.',
      );
      continue;
    }

    const actual = pitch(to[0]!)! - pitch(from[0]!)!;

    if (Math.abs(actual - amount) > 1e-10) {
      warn(
        'bend-data',
        'Cached bend amount conflicts with its actual highest selected bound pitches; the native pitch change is omitted.',
      );
      continue;
    }

    const preBend = source.style === 'pre-bend' || source.style === 'pre-bend-hold';
    const release = amount < 0 && !preBend;
    const color = musicXMLColor(source.color);
    const attrs: Attributes = {
      shape: 'curved',
      ...fontAttrs(source),
      color: source.hidden ? '#00000000' : color,
    };

    for (const note of from) {
      byNote.set(note.noteId!, [
        ...(byNote.get(note.noteId!) ?? []),
        { amount, preBend, release, attrs, source },
      ]);
    }

    if (!source.hidden) {
      warn(
        'bend-layout',
        'Native technical bends retain actual selected-note ownership, pitch amount and available pre-bend/release kind. They do not reconstruct the source inter-column curve, target position, successive levels, arrow shape or broken-piece fitting.',
      );
      warn(
        'bend-playback',
        'Native bend notation retains the source bend amount. Custom MIDI pitch-wheel and controller gestures are not inferred from the printed curve.',
      );

      if (eligibleFrom.length > 1 || eligibleTo.length > 1) {
        warn(
          'bend-chord-layout',
          'A source chord bend has curves from multiple eligible heads and one shared arrow. The native bend retains its unique highest-pitch amount owner without reconstructing lower-head curves or that shared envelope.',
        );
      }

      if (release) {
        warn(
          'bend-release',
          'A downward source BendSpanner uses a negative native bend-alter and release. The source arrow direction is retained without inferring a prior performed pitch-wheel state or compressing the separate target note.',
        );
      }

      if (source.textCustom || amount === 0) {
        warn(
          'bend-label',
          'Native bend-alter retains the verified semitone amount, but MusicXML bend has no independent arbitrary amount-label override. Actual source text remains in metadata; reader labels can differ.',
        );
      }

      if (pieces.length > 1) {
        warn(
          'bend-broken',
          'One native bend is attached to the original source-owned note. Actual broken source pieces remain in metadata; their repeated amount text and per-system curve fitting are not reconstructed.',
        );
      }

      if (source.fontContext?.unsupported.length) {
        warn(
          'bend-font',
          'Some source bend-label font properties lack a native MusicXML font mapping and remain in metadata.',
        );
      }
    }
  }

  return { byNote, heads };
}

export function writeBends(notation: Notation, note: NoteLike, plans: BendPlans, add: Add): void {
  if (note.kind !== 'note' || note.continuation || note.noteId === undefined) {
    return;
  }

  for (const bend of plans.byNote.get(note.noteId) ?? []) {
    const node = add(add(notation(), 'technical'), 'bend', undefined, bend.attrs);

    add(node, 'bend-alter', bend.amount);

    if (bend.preBend) {
      add(node, 'pre-bend');
    } else if (bend.release) {
      add(node, 'release');
    }
  }
}

export function bendHoldPoints(events: Event[], warn: Warn, captured = true): Event[] {
  const points: BendHoldPoint[] = [];

  for (const source of events.filter((e) => e.kind === 'bendGraphic')) {
    if (!['hold', 'pre-bend-hold'].includes(source.style ?? '')) {
      continue;
    }

    if (
      source.custom ||
      !source.resolvedStart ||
      !source.endMoment ||
      compare(source.moment, source.endMoment) > 0
    ) {
      continue;
    }

    const base = {
      ...source,
      kind: 'bendHoldPoint' as const,
      spanKey: `bend-hold:${source.voice}:${source.id}:${source.piece}:${source.percentCopy ?? 'source'}`,
    };

    points.push({ ...base, point: 'start' }, { ...base, point: 'stop', moment: source.endMoment });

    if (!source.hidden) {
      warn(
        'bend-hold-layout',
        'A native dashed bracket retains the actual hold-piece temporal bounds and staff. Source vertical placement, dash phase, joining to the pre-bend arrow and exact fitted geometry are not represented.',
      );

      if (source.text) {
        warn(
          'bend-hold-label',
          'The actual source hold amount label remains in metadata; a native hold bracket has no built-in bend amount label.',
        );
      }

      if (source.moment.grace.numerator || source.endMoment.grace.numerator) {
        warn(
          'bend-grace',
          'Native hold offsets retain main-note timing without reconstructing individual grace-column attachment.',
        );
      }
    }
  }

  void captured;

  return [...events, ...points].sort((a, b) => compare(a.moment, b.moment));
}

export function bendHoldAttributes(point: BendHoldPoint, number: number): Attributes {
  const dash = point.dashSettings,
    scale =
      point.layoutStaffSpace !== null && point.layoutStaffSpace > 0
        ? 10 / point.layoutStaffSpace
        : null;
  const physical = scale !== null && point.staffSpace !== null ? scale * point.staffSpace : null;
  const color = musicXMLColor(point.color);

  return {
    type: point.point,
    number,
    'line-end': 'none',
    'line-type': dash && dash[1] === 0 ? 'solid' : 'dashed',
    ...(dash && physical !== null && dash[0] > 0 && dash[1] > 0
      ? {
          'dash-length': dash[0] * physical,
          'space-length': dash[1] * physical,
        }
      : {}),
    color: point.hidden ? '#00000000' : color,
  };
}
