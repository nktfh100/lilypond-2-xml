import type { Moment } from '@sightread/lilypond-eventdocument';
import type { Attributes } from '../types.js';
import type { NoteLike } from '../planning/events.js';
import type { Warn } from '../../model/diagnostics.js';
import { compareMoments as compare, isMoment as validMoment } from '../../model/time.js';
import { uncertainStaffTop } from './staff-reference.js';
import type { ScoreDocument } from '../../model/document.js';

const ratio = (r: Moment['main']) => r.numerator / r.denominator;
const group = <T, K>(items: readonly T[], key: (item: T) => K) => {
  const result = new Map<K, T[]>();

  for (const item of items) {
    const k = key(item),
      existing = result.get(k);

    if (existing) {
      existing.push(item);
    } else {
      result.set(k, [item]);
    }
  }

  return result;
};

export interface NotePositionPlan {
  readonly attributes: (note: NoteLike, start: Moment | number) => Attributes;
}

/** Map actual final source heads, never a nearby note or a generated fragment. */
export function notePositionPlan(document: ScoreDocument, warn: Warn): NotePositionPlan {
  const rows = document.events.filter((e) => e.kind === 'notePosition');
  const notes = document.events.filter((e) => e.kind === 'note');
  const none: NotePositionPlan = { attributes: () => ({}) };

  if (!document.notePositionsCaptured) {
    if (notes.length || rows.length) {
      warn(
        'note-position-history',
        'This document lacks actual final NoteHead positions. Native note placement remains automatic; no source coordinate is inferred from pitch or nominal columns.',
      );
    }

    return none;
  }

  if (document.events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'note-position-capture',
      'Final source layout failed; actual NoteHead positions may be unavailable. No source note placement is invented.',
    );

    return none;
  }

  const positionsById = group(rows, (row) => row.noteId);
  const notesById = group(notes, (note) => note.noteId);
  const headsById = group(
    document.events.filter((e) => e.kind === 'notehead'),
    (head) => head.noteId,
  );
  const grids = group(
    document.events.filter((e) => e.kind === 'staffLines'),
    (e) => e.staff,
  );
  const clefs = group(
    document.events.filter((e) => e.kind === 'clef'),
    (e) => e.staff,
  );

  for (const states of grids.values()) {
    states.sort((a, b) => compare(a.moment, b.moment));
  }

  for (const states of clefs.values()) {
    states.sort((a, b) => compare(a.moment, b.moment));
  }

  return {
    attributes(note, start) {
      if (note.kind !== 'note' || note.percentCopy || note.figureAnchor) {
        return {};
      }

      const matches = (note.noteId == null ? [] : (positionsById.get(note.noteId) ?? [])).filter(
        (row) => validMoment(row.moment) && compare(row.moment, note.moment) === 0,
      );

      if (matches.length !== 1) {
        if (note.continuation) {
          warn(
            'note-position-split',
            "A generated native note fragment has no unique actual source head at its full Moment. An earlier measure's head coordinates are not copied onto it.",
          );
        } else {
          warn(
            'note-position-owner',
            'A native note has no unique actual final head for its source identity and full Moment. No coordinate is selected by pitch, chord index or note order.',
          );
        }

        return {};
      }

      const row = matches[0]!;
      const source = (notesById.get(note.noteId) ?? []).filter((n) => n.voice === note.voice);

      if (
        row.noteId == null ||
        source.length !== 1 ||
        row.voice == null ||
        row.voice !== note.voice ||
        row.staff == null ||
        row.staff !== note.staff ||
        !validMoment(row.columnMoment) ||
        compare(row.columnMoment, row.moment) !== 0
      ) {
        warn(
          'note-position-owner',
          'A final head has missing, duplicate, cross-staff or contradictory source-note/column ownership. Its available geometry remains metadata without a guessed native transform.',
        );

        return {};
      }

      if (row.hidden) {
        warn(
          'note-position-hidden',
          'A source head is hidden, omitted or absent after final layout. Its coordinates are not applied to the whole native note and its independently visible stems or attachments.',
        );

        return {};
      }

      const styles = note.noteId == null ? [] : (headsById.get(note.noteId) ?? []);

      if (styles.length > 1) {
        warn(
          'note-position-owner',
          'Duplicate source head-style owners prevent selecting a unique ordinary glyph reference. No cached style row is selected by order.',
        );

        return {};
      }

      const head = styles[0];

      if (
        row.custom ||
        row.grobName !== 'NoteHead' ||
        (head?.kind === 'notehead' && !['default', 'altdefault'].includes(head.style))
      ) {
        warn(
          'note-position-stencil',
          'A nonordinary/custom head, tablature number or late callback lacks a verified glyph-reference mapping to native note coordinates. Actual geometry remains metadata.',
        );

        return {};
      }

      if (row.headOnlyOffset) {
        warn(
          'note-position-head-offset',
          'A source head has an independent X/Y or rendering offset. Native note position also moves descendant origins, so head-only displacement is not applied to stems, dots, accidentals or notation by guess.',
        );

        return {};
      }

      if (
        !validMoment(row.xReference) ||
        row.xTenths == null ||
        row.yTenths == null ||
        !Number.isFinite(row.xTenths) ||
        !Number.isFinite(row.yTenths) ||
        row.originXTenths == null ||
        row.glyphLeftXTenths == null ||
        !Number.isFinite(row.originXTenths) ||
        !Number.isFinite(row.glyphLeftXTenths) ||
        Math.abs(row.originXTenths - row.glyphLeftXTenths) > 1e-8
      ) {
        warn(
          'note-position-reference',
          'A final head lacks a verified ordinary glyph origin, staff top or actual source measure reference. No missing coordinate or glyph bearing is guessed.',
        );

        return {};
      }

      const referenceMatches =
        typeof start === 'number'
          ? row.xReference.grace.numerator === 0 &&
            Math.abs(ratio(row.xReference.main) - start) < 1e-10
          : validMoment(start) && compare(row.xReference, start) === 0;

      if (!referenceMatches) {
        warn(
          'note-position-reference',
          "A source head's actual measure reference differs from this native measure start. Its X/Y metadata is retained without applying another measure's coordinates.",
        );

        return {};
      }

      const grid = grids.get(row.staff)?.findLast((e) => compare(e.moment, row.moment) <= 0);
      const clef = clefs.get(row.staff)?.findLast((e) => compare(e.moment, row.moment) <= 0);
      const uncertainTop = uncertainStaffTop(grid, clef);

      warn(
        'note-position-layout',
        'Available actual head positions are retained; source measure widths, system/page spacing, detailed stem/dot/accidental fitting and arbitrary head-only drawings remain partial.',
      );

      if (uncertainTop) {
        warn(
          'note-position-reference',
          "A source head's visible staff-top reference differs from an unverified native staff-grid origin. Its X position is retained while Y remains metadata.",
        );
      }

      return {
        'default-x': row.xTenths,
        ...(!uncertainTop ? { 'default-y': row.yTenths } : {}),
      };
    },
  };
}
