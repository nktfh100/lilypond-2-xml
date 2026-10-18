import type { Moment } from '@sightread/lilypond-eventdocument';
import type { Warn } from '../../model/diagnostics.js';
import { momentKey as fullKey, rationalKey, isMoment as validMoment } from '../../model/time.js';
import type { BarlineEvent, BarlineLayoutEvent, ScoreDocument } from '../../model/document.js';

export interface PlannedBarline {
  readonly glyph: string;
  readonly hidden: boolean;
  readonly custom?: boolean;
}
export interface BarlineLayoutSelection {
  readonly status: 'resolved' | 'unresolved' | 'legacy';
  readonly bars: readonly PlannedBarline[];
}
export interface BarlineLayoutPlan {
  readonly at: (
    moment: Moment,
    staves: readonly number[],
    side: 'left' | 'right' | 'middle',
  ) => BarlineLayoutSelection;
}
const integer = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const unresolved: BarlineLayoutSelection = { status: 'unresolved', bars: [] };
const absent: BarlineLayoutSelection = { status: 'resolved', bars: [] };

/** Final bar pieces own ink; semantic bar requests never certify source visibility. */
export function barlineLayoutPlan(document: ScoreDocument, warn: Warn): BarlineLayoutPlan {
  if (!document.barlineLayoutsCaptured) {
    warn(
      'barline-layout-history',
      'Final source barline pieces are unavailable in this document. Legacy barline requests do not establish actual printed visibility.',
    );

    return { at: () => ({ status: 'legacy', bars: [] }) };
  }

  const stages = document.events.filter((e) => e.kind === 'finalLayout');

  if (stages.length !== 1 || stages[0]!.status !== 'complete') {
    warn(
      'barline-layout-capture',
      'Final source barline capture has no unique completed layout stage. Native barline ink is not inferred from semantic bar requests.',
    );

    return { at: () => unresolved };
  }

  type Bucket = {
    originals: Map<number, BarlineEvent[]>;
    rows: Map<number, BarlineLayoutEvent[]>;
    invalid: boolean;
  };
  const buckets = new Map<string, Bucket>();
  const originalIds = new Map<number, BarlineEvent[]>(),
    rowIds = new Map<number, BarlineLayoutEvent[]>();
  let unlocated = false;
  const bucket = (moment: Moment): Bucket => {
    const key = rationalKey(moment.main),
      old = buckets.get(key);

    if (old) {
      return old;
    }

    const value: Bucket = {
      originals: new Map(),
      rows: new Map(),
      invalid: false,
    };

    buckets.set(key, value);

    return value;
  };
  const data = () =>
    warn(
      'barline-layout-data',
      'Cached source barline pieces have invalid, duplicate or contradictory identities, full Moments or system references. No source staff or piece is selected arbitrarily.',
    );

  for (const event of document.events) {
    if (event.kind !== 'barline' && event.kind !== 'barlineLayout') {
      continue;
    }

    if (!validMoment(event.moment)) {
      unlocated = true;
      data();
      continue;
    }

    const group = bucket(event.moment);

    if (!integer(event.staff) || event.moment.grace.numerator > 0) {
      group.invalid = true;

      if (event.moment.grace.numerator > 0) {
        warn(
          'barline-layout-grace',
          'A source barline has a positive grace Moment. It cannot be assigned to a canonical native measure boundary by main time alone.',
        );
      } else {
        data();
      }

      continue;
    }

    if (event.kind === 'barline') {
      const entries = group.originals.get(event.staff) ?? [];

      entries.push(event);
      group.originals.set(event.staff, entries);
    } else {
      const entries = group.rows.get(event.staff) ?? [];

      entries.push(event);
      group.rows.set(event.staff, entries);
    }

    const id = event.kind === 'barline' ? event.id : event.barlineId;

    if (!integer(id)) {
      group.invalid = true;
      data();
      continue;
    }

    if (event.kind === 'barline') {
      const entries = originalIds.get(id) ?? [];

      entries.push(event);
      originalIds.set(id, entries);
    } else {
      const entries = rowIds.get(id) ?? [];

      entries.push(event);
      rowIds.set(id, entries);
    }
  }

  const selected = new Map<
    string,
    Map<number, Record<'left' | 'right' | 'middle', BarlineLayoutSelection>>
  >();
  const anchors = new Map<string, Map<number, string>>();

  for (const [main, group] of buckets) {
    const byStaff = new Map<number, Record<'left' | 'right' | 'middle', BarlineLayoutSelection>>();

    selected.set(main, byStaff);
    const staffAnchors = new Map<number, string>();

    anchors.set(main, staffAnchors);

    for (const staff of new Set([...group.originals.keys(), ...group.rows.keys()])) {
      const values = {
        left: unresolved,
        right: unresolved,
        middle: unresolved,
      };

      byStaff.set(staff, values);
      const originals = group.originals.get(staff) ?? [],
        rows = group.rows.get(staff) ?? [];

      if (group.invalid || originals.length !== 1 || rows.length !== 1) {
        data();
        continue;
      }

      const original = originals[0]!,
        row = rows[0]!;

      if (
        !integer(original.id) ||
        originalIds.get(original.id)?.length !== 1 ||
        rowIds.get(original.id)?.length !== 1 ||
        row.barlineId !== original.id ||
        row.staff !== original.staff ||
        fullKey(row.moment) !== fullKey(original.moment) ||
        !Array.isArray(row.pieces)
      ) {
        data();
        continue;
      }

      const identities = new Set<string>();
      const valid = Array.from(row.pieces).every((piece) => {
        if (
          !piece ||
          typeof piece !== 'object' ||
          !integer(piece.system) ||
          ![-1, 0, 1].includes(piece.breakDirection) ||
          !(piece.glyph === null || typeof piece.glyph === 'string') ||
          !(piece.hidden === null || typeof piece.hidden === 'boolean') ||
          typeof piece.custom !== 'boolean'
        ) {
          return false;
        }

        const identity = `${piece.system}:${piece.breakDirection}`;

        if (identities.has(identity)) {
          return false;
        }

        identities.add(identity);

        return true;
      });

      if (!valid) {
        data();
        continue;
      }

      staffAnchors.set(staff, fullKey(original.moment));

      for (const side of ['left', 'right', 'middle'] as const) {
        const pieces = row.pieces.filter((piece) =>
          side === 'left'
            ? piece.breakDirection === 1
            : side === 'right'
              ? piece.breakDirection !== 1
              : piece.breakDirection === 0,
        );

        if (!pieces.length) {
          values[side] = absent;
          continue;
        }

        if (pieces.length !== 1 || pieces[0]!.glyph === null || pieces[0]!.hidden === null) {
          warn(
            'barline-layout-piece',
            'The selected native barline side has multiple source pieces or unresolved final glyph/visibility. Its ink remains unspecified instead of using another broken piece.',
          );
          continue;
        }

        const piece = pieces[0]!;

        if (piece.custom) {
          warn(
            'barline-layout-stencil',
            'A source barline uses a custom stencil or final callback. Available final glyph and visibility are retained; its arbitrary drawing is not reconstructed.',
          );
        }

        values[side] = {
          status: 'resolved',
          bars: [
            {
              glyph: piece.glyph!,
              hidden: piece.hidden!,
              custom: piece.custom,
            },
          ],
        };
      }
    }
  }

  return {
    at(moment, staves, side) {
      if (
        unlocated ||
        !validMoment(moment) ||
        moment.grace.numerator !== 0 ||
        !staves.length ||
        !staves.every(integer) ||
        new Set(staves).size !== staves.length
      ) {
        data();

        return unresolved;
      }

      const main = rationalKey(moment.main),
        group = buckets.get(main);

      if (!group) {
        return absent;
      }

      if (group.invalid) {
        return unresolved;
      }

      const states = staves.map((staff) => selected.get(main)?.get(staff)?.[side] ?? absent);

      if (states.some((state) => state.status !== 'resolved')) {
        return unresolved;
      }

      const first = states[0]!;

      if (
        !states.every(
          (state, index) =>
            state.bars.length === first.bars.length &&
            state.bars.every(
              (bar, i) =>
                bar.glyph === first.bars[i]!.glyph && bar.hidden === first.bars[i]!.hidden,
            ) &&
            (!state.bars.length ||
              anchors.get(main)?.get(staves[index]!) === anchors.get(main)?.get(staves[0]!)),
        )
      ) {
        warn(
          'barline-layout-ownership',
          "Staves in one native part disagree about actual barline full Moments, glyphs, visibility or presence on this side. No staff's barline ink is selected arbitrarily.",
        );

        return unresolved;
      }

      if (!first.bars.length) {
        return absent;
      }

      return {
        status: 'resolved',
        bars: first.bars.map((bar, i) => ({
          ...bar,
          custom: states.some((state) => state.bars[i]?.custom),
        })),
      };
    },
  };
}
