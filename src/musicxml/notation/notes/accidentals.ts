import { musicXMLColor } from '../colors.js';
import type { Attributes } from '../../types.js';
import type { Event } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { sameMoments as sameMoment } from '../../../model/time.js';
import type { AccidentalGraphicEvent, ScoreDocument } from '../../../model/document.js';

export interface AccidentalPlan {
  attrs: Attributes;
  value?: string;
}
const positive = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

/** Accidental ink follows actual final grobs; sounding pitch stays on the note. */
export function accidentalPlans(
  document: ScoreDocument,
  events: Event[],
  warn: Warn,
): Map<number, AccidentalPlan> {
  const plans = new Map<number, AccidentalPlan>(),
    rows = events.filter(
      (e): e is Event & AccidentalGraphicEvent => e.kind === 'accidentalGraphic',
    );

  if (document.accidentalsCaptured !== true) {
    if (events.some((e) => e.kind === 'accidental')) {
      warn(
        'accidental-history',
        'Actual final accidental graphics are unavailable. Legacy accidental semantics remain without verified visibility, color, physical size or glyph provenance.',
      );
    }

    return plans;
  }

  const stages = events.filter((e) => e.kind === 'finalLayout'),
    complete =
      stages.length === 1 &&
      stages[0]!.status === 'complete' &&
      stages[0]!.stage === 'book' &&
      stages[0]!.attempted === true;
  const notes = new Map(
    events.filter((e) => e.kind === 'note' && positive(e.noteId)).map((e) => [e.noteId!, e]),
  );
  const noteCounts = new Map<number, number>();

  for (const note of events.filter((e) => e.kind === 'note' && positive(e.noteId))) {
    noteCounts.set(note.noteId!, (noteCounts.get(note.noteId!) ?? 0) + 1);
  }

  const identity = (row: Event & AccidentalGraphicEvent) => `${row.percentCopy ?? 0}:${row.id}`;
  const counts = new Map<string, number>();

  for (const row of rows) {
    counts.set(identity(row), (counts.get(identity(row)) ?? 0) + 1);
  }

  const owners = new Map<number, (Event & AccidentalGraphicEvent)[]>(),
    quarantined = new Set<number>();

  for (const row of rows) {
    const note = row.noteId === null ? undefined : notes.get(row.noteId);

    if (
      !positive(row.id) ||
      counts.get(identity(row)) !== 1 ||
      !positive(row.noteId) ||
      !note ||
      noteCounts.get(row.noteId) !== 1 ||
      row.staff !== note.staff ||
      !sameMoment(row.moment, note.moment)
    ) {
      warn(
        'accidental-owner',
        'An actual accidental lacks unique original identity and exact note/staff/full-Moment ownership. Its graphic is not assigned by pitch, chord order or a neighboring note.',
      );

      if (positive(row.noteId) && note) {
        quarantined.add(row.noteId);
        plans.set(row.noteId, { attrs: { color: '#00000000' } });
      }

      continue;
    }

    owners.set(row.noteId, [...(owners.get(row.noteId) ?? []), row]);
  }

  for (const [noteId, owned] of owners) {
    const row = owned[0]!;

    if (quarantined.has(noteId) || !complete || owned.length !== 1 || !Array.isArray(row.pieces)) {
      if (!complete) {
        warn(
          'accidental-capture',
          'Final compiler layout is incomplete. Unverified accidental ink is suppressed while written sounding pitch remains.',
        );
      } else {
        warn(
          'accidental-ownership',
          'Multiple or malformed actual accidental originals conflict on one source note. No arbitrary graphic is selected.',
        );
      }

      plans.set(noteId, { attrs: { color: '#00000000' } });
      continue;
    }

    if (row.pieces.length === 0) {
      plans.set(noteId, { attrs: { color: '#00000000' } });
      continue;
    }

    const pieces = row.pieces,
      seen = new Set<string>();
    const valid = pieces.every((p) => {
      if (
        !p ||
        !positive(p.system) ||
        !positive(p.piece) ||
        typeof p.hidden !== 'boolean' ||
        typeof p.custom !== 'boolean' ||
        typeof p.parenthesized !== 'boolean' ||
        typeof p.restoreFirst !== 'boolean' ||
        !(p.glyph === null || typeof p.glyph === 'string') ||
        !(p.fontPoints === null || (Number.isFinite(p.fontPoints) && p.fontPoints > 0)) ||
        !(
          p.color === null ||
          (Array.isArray(p.color) &&
            [3, 4].includes(p.color.length) &&
            p.color.every((c: number) => Number.isFinite(c) && c >= 0 && c <= 1))
        )
      ) {
        return false;
      }

      const key = String(p.piece);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    });
    const first = pieces[0]!;
    const agrees =
      valid &&
      pieces.every(
        (p) =>
          p.hidden === first.hidden &&
          p.custom === first.custom &&
          p.glyph === first.glyph &&
          p.parenthesized === first.parenthesized &&
          p.restoreFirst === first.restoreFirst &&
          p.fontPoints === first.fontPoints &&
          JSON.stringify(p.color) === JSON.stringify(first.color),
      );

    if (!agrees) {
      warn(
        'accidental-appearance',
        'Final accidental pieces have invalid or contradictory appearance. Unverified ink is suppressed without changing pitch.',
      );
      plans.set(noteId, { attrs: { color: '#00000000' } });
      continue;
    }

    const attrs: Attributes = {};

    if (first.parenthesized) {
      attrs.parentheses = 'yes';
    }

    if (row.grobName === 'AccidentalCautionary') {
      attrs.cautionary = 'yes';
    }

    const color = musicXMLColor(first.color);

    // MusicXML specifies ARGB for eight-digit color values.
    if (first.hidden || row.percentCopy) {
      attrs.color = '#00000000';
    } else if (color) {
      attrs.color = color;
    }

    if (first.fontPoints !== null) {
      attrs['font-size'] = first.fontPoints;
    } else {
      warn(
        'accidental-size-history',
        'The actual accidental lacks a resolved physical font size; no point size is guessed from a font step.',
      );
    }

    if (first.custom) {
      warn(
        'accidental-stencil',
        'An accidental has custom stencil or after-line callback provenance. Available standard pitch symbol, color, size and visibility remain; arbitrary drawing changes are not reconstructed.',
      );
    }

    // Pinned output-lib.scm standard-alteration-glyph-name-alist; ink is independent of pitch.
    const glyphs: Record<string, readonly [string, string?]> = {
      'accidentals.flatflat': ['flat-flat'],
      'accidentals.flat': ['flat'],
      'accidentals.natural': ['natural'],
      'accidentals.sharp': ['sharp'],
      'accidentals.doublesharp': ['double-sharp'],
      'accidentals.mirroredflat': ['quarter-flat', 'accidentalQuarterToneFlatStein'],
      'accidentals.mirroredflat.flat': [
        'three-quarters-flat',
        'accidentalThreeQuarterTonesFlatZimmermann',
      ],
      'accidentals.sharp.slashslash.stem': ['quarter-sharp', 'accidentalQuarterToneSharpStein'],
      'accidentals.sharp.slashslash.stemstemstem': [
        'three-quarters-sharp',
        'accidentalThreeQuarterTonesSharpStein',
      ],
    };
    let value = first.glyph ? glyphs[first.glyph]?.[0] : undefined;

    if (first.glyph && glyphs[first.glyph]?.[1]) {
      attrs.smufl = glyphs[first.glyph]![1];
    }

    if (first.restoreFirst) {
      if (value === 'sharp' || value === 'flat') {
        value = 'natural-' + value;
        delete attrs.smufl;
      } else {
        warn(
          'accidental-composite',
          'An actual accidental prepends a natural to a symbol without a verified native composite value. The available main symbol and sounding pitch remain; composite fitting is not guessed.',
        );
      }
    }

    if (!first.hidden && !value) {
      warn(
        'accidental-glyph',
        'The actual accidental glyph is outside the verified standard source glyph table. Native pitch semantics remain; alternate/historical glyph appearance is not guessed.',
      );
    }

    plans.set(noteId, { attrs, ...(value ? { value } : {}) });
  }

  for (const event of events) {
    if (event.kind === 'accidental' && positive(event.noteId) && !plans.has(event.noteId)) {
      warn(
        'accidental-capture',
        'A captured accidental semantic event has no uniquely retained final graphic row. Unverified ink is suppressed while written sounding pitch remains.',
      );
      plans.set(event.noteId, { attrs: { color: '#00000000' } });
    }
  }

  return plans;
}
