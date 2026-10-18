import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add, Attributes } from '../types.js';
import type { Event, NoteLike } from '../planning/events.js';
import type { Warn } from '../../model/diagnostics.js';
import { textRuns, type TextRun } from './runs.js';
import type { FootnoteEvent, TextMarkup } from '../../model/document.js';

export type FootnotePlans = Map<number, FootnoteEvent[]>;
const validId = (id: number | null): id is number =>
  id !== null && Number.isSafeInteger(id) && id > 0;

function sameMarkup(a: TextMarkup | undefined, b: TextMarkup | undefined): boolean {
  if (a === b) {
    return true;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameMarkup(v, b[i]))
    );
  }

  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    !('command' in a) ||
    !('command' in b)
  ) {
    return false;
  }

  return a.command === b.command && a.plain === b.plain && sameMarkup(a.args, b.args);
}

/** Editorial body ownership comes only from the actual sticky NoteHead host. */
export function footnotePlans(events: Event[], warn: Warn, captured = true): FootnotePlans {
  const plans: FootnotePlans = new Map(),
    seen = new Map<string, FootnoteEvent>(),
    conflicts = new Set<string>();
  const notes = new Set(
    events
      .filter((e) => e.kind === 'note')
      .flatMap((e) => (e.noteId === undefined ? [] : [e.noteId])),
  );
  const annotations = events.filter((e) => e.kind === 'footnote');

  if (!captured && annotations.length) {
    warn(
      'footnote-history',
      'Footnote input lacks confirmed actual sticky-host capture. Only retained explicit ownership is considered; event position is never used to select a note.',
    );
  }

  if (events.some((e) => e.kind === 'finalLayout' && e.status === 'failed') && annotations.length) {
    warn(
      'footnote-capture',
      'Final compiler layout failed. Retained annotation text does not establish a surviving source marker or page footer.',
    );
  }

  for (const footnote of annotations) {
    if (
      !validId(footnote.noteId) ||
      !notes.has(footnote.noteId) ||
      !['NoteHead', 'TabNoteHead'].includes(footnote.hostKind ?? '')
    ) {
      warn(
        'footnote-owner',
        'An actual Footnote has no verified direct NoteHead host in the native score. Its text remains in metadata; no next note, chord member or direction is guessed.',
      );
      continue;
    }

    if (footnote.body === null) {
      warn(
        'footnote-body',
        'An actual Footnote lacks observed textual body markup. A marker or arbitrary drawing is not substituted for its page-footer text.',
      );
      continue;
    }

    const key = `${footnote.context}:${footnote.id}:${footnote.noteId}`;

    if (conflicts.has(key)) {
      continue;
    }

    const prior = seen.get(key);

    if (prior) {
      if (prior.body !== footnote.body || !sameMarkup(prior.markup, footnote.markup)) {
        const remaining = (plans.get(footnote.noteId) ?? []).filter((item) => item !== prior);

        if (remaining.length) {
          plans.set(footnote.noteId, remaining);
        } else {
          plans.delete(footnote.noteId);
        }

        conflicts.add(key);
        warn(
          'footnote-history',
          'Pieces of one source footnote disagree on their body. That annotation is omitted instead of choosing an arbitrary body or inventing independent editorial notes.',
        );
      }

      continue;
    }

    seen.set(key, footnote);
    plans.set(footnote.noteId, [...(plans.get(footnote.noteId) ?? []), footnote]);

    if (!footnote.present) {
      warn(
        'footnote-presence',
        'A retained Footnote has no confirmed live final System marker membership. Its known body remains native because missing marker ink does not establish an absent page footer.',
      );
    }

    if (footnote.custom) {
      warn(
        'footnote-stencil',
        'A Footnote has custom drawing or callback provenance. Available body text remains native; the custom marker, connector or page-footer drawing is not reconstructed.',
      );
    }

    if (footnote.automaticallyNumbered) {
      warn(
        'footnote-number',
        'Automatic footnote numbering depends on source page layout. The original body and numbering provenance remain without inventing a page-dependent marker or prefixing a guessed number.',
      );
    } else if (footnote.marker && !footnote.markerHidden) {
      warn(
        'footnote-marker',
        'The literal source footnote marker and connector have no separate native editorial-footnote field. Its body remains exact; the marker is retained in metadata without being prepended to the footer text.',
      );
    }

    warn(
      'footnote-layout',
      'Native editorial footnote retains the actual host and body. Source footer position, separator, marker geometry and page allocation are not reproduced.',
    );
    warn(
      'footnote-font',
      'Source footer text uses page-layout font context, independently of its host marker. Available inline styles remain native without guessing inherited footer font size from the marker font.',
    );
  }

  return plans;
}

function uniform(runs: TextRun[], warn: Warn): TextRun {
  const common: Attributes = { ...(runs[0]?.attrs ?? {}) };

  for (const key of Object.keys(common)) {
    if (runs.some((run) => run.attrs[key] !== common[key])) {
      delete common[key];
    }
  }

  if (runs.some((run) => Object.keys(run.attrs).some((key) => run.attrs[key] !== common[key]))) {
    warn(
      'footnote-format',
      'MusicXML editorial footnote supports one formatted text style. Body text and common inline attributes remain; independently styled runs stay in metadata.',
    );
  }

  return { text: runs.map((run) => run.text).join(''), attrs: common };
}

export function writeFootnotes(
  node: XMLBuilder,
  note: NoteLike,
  plans: ReadonlyMap<number, readonly FootnoteEvent[]>,
  add: Add,
  warn: Warn,
): void {
  if (note.kind !== 'note' || note.continuation || note.noteId === undefined) {
    return;
  }

  const footnotes = plans.get(note.noteId) ?? [];

  if (!footnotes.length) {
    return;
  }

  const runs = footnotes.flatMap((footnote, index) => [
    ...(index ? [{ text: '\n', attrs: {} }] : []),
    ...textRuns(footnote.markup ?? footnote.body ?? '', {}, warn),
  ]);
  const body = uniform(runs, warn);

  if (body.text) {
    add(node, 'footnote', body.text, body.attrs);
  }

  if (footnotes.length > 1) {
    warn(
      'footnote-multiple',
      'Several actual annotations share one native note. MusicXML permits one editorial footnote there, so their exact bodies are joined by newlines while separate marker identities remain in metadata.',
    );
  }
}
