import type { Add, Notation } from '../../types.js';
import type { Attachment, Script } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { textRuns } from '../../text/runs.js';

const pluckStyles = new Set(['font-style', 'font-weight', 'font-family', 'font-size', 'color']);
const digitNames = ['p', 'i', 'm', 'a', 'x'];

export function writeTechnique(
  notation: Notation,
  attachment: Attachment,
  graphic: Script | undefined,
  captured: boolean | undefined,
  add: Add,
  warn: Warn,
) {
  if (captured && !graphic) {
    return;
  }

  if (graphic?.custom) {
    warn(
      'technique-stencil',
      'A custom plucking or fall/doit drawing has no mapped native MusicXML equivalent; its available standard notation is retained.',
    );
  }

  if (!graphic) {
    warn(
      'technique-history',
      'Resolved plucking or fall/doit graphics are unavailable; native notation is inferred from events without verified visibility, placement, or drawing overrides.',
    );
  }

  if (graphic && graphic.noteId === undefined) {
    warn(
      'technique-anchor',
      'A plucking or fall/doit graphic has no resolved notehead owner; the native indication is placed once at its voice onset without verified chord-note ownership.',
    );
  }

  if (attachment.class === 'stroke-finger-event') {
    const digit = Math.max(0, Math.min(4, (attachment.strokeFingerDigit ?? 1) - 1));
    const runs = textRuns(
      graphic?.techniqueMarkup ?? attachment.strokeFingerText ?? digitNames[digit],
      {},
      warn,
    );
    const text = runs.map((r) => r.text).join('');
    const direction = graphic?.axis === 0 ? 0 : graphic?.direction || attachment.direction;
    const style = Object.entries(runs[0]?.attrs ?? {});

    add(add(notation(graphic?.hidden), 'technical'), 'pluck', text, {
      'font-style': graphic?.techniqueFontStyle ?? 'italic',
      ...Object.fromEntries(style.filter(([key]) => pluckStyles.has(key))),
      ...(direction ? { placement: direction === 1 ? 'above' : 'below' } : {}),
    });

    if (graphic?.axis === 0) {
      warn(
        'pluck-placement',
        'A plucking indication beside a note retains its native text; exact horizontal fingering placement is not mapped.',
      );
    }

    if (
      runs.length > 1 ||
      style.some(([key]) => !pluckStyles.has(key)) ||
      (graphic && graphic.fontSize !== -4)
    ) {
      warn(
        'pluck-format',
        'Plucking text is retained with its first text style; mixed styles, enclosures, and custom LilyPond font scaling require further mapping.',
      );
    }
  } else if (attachment.class === 'bend-after-event') {
    const delta = graphic?.deltaPosition ?? attachment.deltaStep;

    if (!delta) {
      warn(
        'bend-after-zero',
        'A zero-height bend-after line has no fall or doit direction; its resolved data remains in metadata without a guessed native symbol.',
      );

      return;
    }

    add(
      add(notation(graphic?.hidden), 'articulations'),
      delta < 0 ? 'falloff' : 'doit',
      undefined,
      { 'line-shape': 'curved', 'line-type': 'solid' },
    );
    warn(
      'bend-after-layout',
      'Native fall/doit direction and curved shape are retained; exact LilyPond height, length, thickness, and control points are not mapped. deltaStep is graphical, not a semitone bend amount.',
    );
  }
}
