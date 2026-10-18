import type { Moment } from '@sightread/lilypond-eventdocument';
import { sameAttributes } from '../primitives.js';
import { musicXMLColor } from '../notation/colors.js';
import type { Attributes } from '../types.js';
import type { Event } from '../planning/events.js';
import type { Warn } from '../../model/diagnostics.js';
import { lyricHasText } from './lyrics.js';
import {
  compareMoments as compare,
  momentKey as key,
  isMoment as validMoment,
} from '../../model/time.js';

type Syllable = Extract<Event, { kind: 'lyric' }>;
export interface LyricExtenderPlan {
  readonly moments: readonly Moment[];
  /** Attributes for the extend element only; caller supplies its endpoint type. */
  readonly attrs: Attributes;
  readonly attrsAt?: (moment: Moment) => Attributes;
}
const empty = (): LyricExtenderPlan => ({ moments: [], attrs: {} });

/** Actual NoteHead supports determine ownership; score finish is not an endpoint. */
export function lyricExtenderPlan(
  syllable: Syllable,
  events: readonly Event[],
  notes: readonly Event[],
  warn: Warn,
  captured: boolean,
): LyricExtenderPlan | undefined {
  if (!captured) {
    if (
      events.some(
        (e) =>
          (e.kind === 'lyric' &&
            e.class === 'extender-event' &&
            e.verse === syllable.verse &&
            compare(e.moment, syllable.moment) === 0) ||
          (e.kind === 'lyricExtender' &&
            e.verse === syllable.verse &&
            e.lyricMoment !== null &&
            compare(e.lyricMoment, syllable.moment) === 0),
      )
    ) {
      warn(
        'lyric-extender-history',
        'This document lacks actual LyricExtender bounds and NoteHead supports. Legacy lyric-extension timing remains a diagnosed fallback, not verified source completion.',
      );
    }

    return undefined;
  }

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed')) {
    warn(
      'lyric-extender-capture',
      'Final compiler layout failed; actual lyric extenders may be unavailable. No score-end extension is invented.',
    );

    return empty();
  }

  if (syllable.voice === null) {
    if (events.some((e) => e.kind === 'lyricExtender' && e.verse === syllable.verse && !e.hidden)) {
      warn(
        'lyric-extender-owner',
        'A lyric syllable lacks its actual associated Voice. Its extender is not assigned to an arbitrary available voice.',
      );
    }

    return empty();
  }

  // The writer visits every verse for each part. Other parts are not owners.
  if (!notes.some((e) => e.kind === 'note' && e.voice === syllable.voice)) {
    return empty();
  }

  const all = events
    .filter((e) => e.kind === 'lyricExtender')
    .filter((e) => e.verse === syllable.verse);

  if (all.some((e) => !e.hidden && e.lyricMoment === null)) {
    warn(
      'lyric-extender-owner',
      'A visible lyric extender lacks an exact original LyricText association. Its owner is not guessed from nearby syllables.',
    );
  }

  const rows = all.filter(
    (e) => e.lyricMoment && compare(e.lyricMoment, syllable.moment) === 0 && !e.hidden,
  );

  if (!rows.length) {
    return empty();
  }

  const semantic = events.filter(
    (e) =>
      e.kind === 'lyric' &&
      e.class === 'lyric-event' &&
      e.verse === syllable.verse &&
      compare(e.moment, syllable.moment) === 0 &&
      lyricHasText(e.text, e.markup),
  );

  if (
    semantic.length !== 1 ||
    new Set(rows.map((e) => e.id)).size !== 1 ||
    rows.some((e) => e.voice === null || e.voice !== syllable.voice || e.staff === null)
  ) {
    warn(
      'lyric-extender-owner',
      'A lyric extender has ambiguous syllable, voice, staff or original-spanner ownership. No native melisma is assigned by note order.',
    );

    return empty();
  }

  if (rows.some((e) => e.custom)) {
    warn(
      'lyric-extender-stencil',
      'A custom lyric-extender stencil or late callback retains its source metadata without a guessed standard underline.',
    );

    return empty();
  }

  if (
    rows.some(
      (e) =>
        !validMoment(e.moment) ||
        !validMoment(e.endMoment) ||
        e.leftKind == null ||
        e.rightKind == null ||
        !Array.isArray(e.headNotes) ||
        !Array.isArray(e.toNotes) ||
        compare(e.moment, e.endMoment) > 0,
    )
  ) {
    warn(
      'lyric-extender-endpoints',
      'A lyric extender has missing or reversed actual bounds. No native endpoint is inferred from note durations.',
    );

    return empty();
  }

  const ids = [...new Set(rows.flatMap((e) => [...e.headNotes]))];
  const sourceNotes = events.filter((e) => e.kind === 'note');
  const owned = ids.map((id) => (id === null ? [] : sourceNotes.filter((n) => n.noteId === id)));

  if (
    !ids.length ||
    owned.some((group) => group.length !== 1) ||
    owned.some((group) => {
      const note = group[0]!;

      return note.voice !== syllable.voice || rows.some((row) => row.staff !== note.staff);
    })
  ) {
    warn(
      'lyric-extender-owner',
      'A lyric extender has unknown, filtered, duplicate or cross-voice NoteHead supports. Available notes do not establish unique ownership of the complete source line.',
    );

    return empty();
  }

  const heads = owned.map((group) => group[0]!);
  const moments = [...new Map(heads.map((n) => [key(n.moment), n.moment])).values()].sort(compare);

  if (
    syllable.moment.grace.numerator ||
    moments.some((m) => m.grace.numerator) ||
    rows.some((row) => row.moment.grace.numerator || row.endMoment!.grace.numerator)
  ) {
    warn(
      'lyric-extender-grace',
      'A lyric extender has actual grace-column ownership that the ordinary-note lyric writer cannot retain. No equal-main-time attachment is guessed.',
    );

    return empty();
  }

  const noteById = new Map(heads.map((n) => [n.noteId, n]));
  const incompatiblePiece = rows.some((row) => {
    const end = row.endMoment!;

    if (
      row.headNotes.some((id) => {
        const note = id === null ? undefined : noteById.get(id);

        return (
          !note ||
          !validMoment(note.moment) ||
          compare(note.moment, row.moment) < 0 ||
          compare(note.moment, end) > 0
        );
      })
    ) {
      return true;
    }

    if (!['NoteHead', 'TabNoteHead'].includes(row.rightKind!)) {
      return row.toNotes.length !== 0;
    }

    if (row.toNotes.length !== 1) {
      return true;
    }

    const terminalId = row.toNotes[0],
      terminal = terminalId == null ? undefined : noteById.get(terminalId);

    return !terminal || !row.headNotes.includes(terminalId!) || compare(terminal.moment, end) !== 0;
  });

  if (compare(moments[0]!, syllable.moment) !== 0 || incompatiblePiece) {
    warn(
      'lyric-extender-endpoints',
      "A lyric extender's actual syllable/start or terminal NoteHead conflicts with its retained supports. No label or endpoint is moved to a nearby note.",
    );

    return empty();
  }

  const appearance = (row: (typeof rows)[number]): Attributes => {
    const color = musicXMLColor(row.color);

    return color ? { color } : {};
  };
  const attrsAt = (moment: Moment): Attributes => {
    const headIds = new Set(
      heads.filter((n) => compare(n.moment, moment) === 0).map((n) => n.noteId),
    );
    const owners = rows.filter((row) => row.headNotes.some((id) => id !== null && headIds.has(id)));
    const attrs = owners.map(appearance);

    if (!attrs.length || attrs.some((a) => !sameAttributes(a, attrs[0]!))) {
      warn(
        'lyric-extender-appearance',
        "Coincident lyric-extender pieces disagree about an owned NoteHead's appearance. Source metadata remains without choosing an arbitrary color.",
      );

      return {};
    }

    return attrs[0]!;
  };

  warn(
    'lyric-extender-layout',
    'Actual source lyric-extender rectangles remain in metadata. Minimum-length fitting, per-piece geometry, thickness and native extend coordinate semantics are not reconstructed from note duration.',
  );

  return { moments, attrs: attrsAt(moments[0]!), attrsAt };
}
