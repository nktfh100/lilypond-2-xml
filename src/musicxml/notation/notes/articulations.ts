import type { Add, Notation } from '../../types.js';
import { type Attachment, type Script, required } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { scriptAppearance } from './script-appearance.js';
import type { TextMarkup } from '../../../model/document.js';

const marks: Record<string, string> = {
  staccato: 'staccato',
  accent: 'accent',
  tenuto: 'tenuto',
  staccatissimo: 'staccatissimo',
  marcato: 'strong-accent',
  portato: 'detached-legato',
  espressivo: 'soft-accent',
};
const technical: Record<string, string> = {
  upbow: 'up-bow',
  downbow: 'down-bow',
  flageolet: 'harmonic',
  open: 'open-string',
  stopped: 'stopped',
  thumb: 'thumb-position',
  snappizzicato: 'snap-pizzicato',
  heel: 'heel',
  varheel: 'heel',
  heelcircle: 'heel',
  toe: 'toe',
  vartoe: 'toe',
  halfopen: 'half-muted',
  halfopenvertical: 'half-muted',
};
const fermatas: Record<string, string> = {
  fermata: '',
  shortfermata: 'angled',
  longfermata: 'square',
  veryshortfermata: 'double-angled',
  verylongfermata: 'double-square',
  henzeshortfermata: 'half-curve',
  henzelongfermata: 'double-dot',
};
const glyphs: Record<string, string> = {
  sforzato: 'accent',
  espr: 'espressivo',
  umarcato: 'marcato',
  dmarcato: 'marcato',
  ustaccatissimo: 'staccatissimo',
  dstaccatissimo: 'staccatissimo',
  uportato: 'portato',
  dportato: 'portato',
  uupbow: 'upbow',
  dupbow: 'upbow',
  udownbow: 'downbow',
  ddownbow: 'downbow',
  upedalheel: 'heel',
  dpedalheel: 'varheel',
  pedalheelcircle: 'heelcircle',
  upedaltoe: 'vartoe',
  dpedaltoe: 'toe',
};
const known = (name: string | undefined) =>
  name !== undefined && [marks, technical, fermatas].some((table) => Object.hasOwn(table, name));
const glyphName = (glyph: string | undefined) =>
  glyph ? glyphs[glyph] || glyph?.match(/^[ud](.*fermata)$/)?.[1] || glyph : '';

export function isThumbFingering(markup: TextMarkup | undefined): boolean {
  if (!markup || typeof markup !== 'object' || !('command' in markup)) {
    return false;
  }

  if (markup.command === 'musicglyph-markup') {
    return markup.args[0] === 'scripts.thumb';
  }

  return markup?.command === 'scale-markup' && isThumbFingering(markup.args[1]);
}

export function writeArticulation(
  notation: Notation,
  attachment: Attachment,
  graphic: Script | undefined,
  captured: boolean | undefined,
  add: Add,
  warn: Warn,
): boolean {
  const requested = attachment.articulationType || '';

  if (requested === 'staccato') {
    warn(
      'articulation-playback',
      'Native staccato notation is retained; source MIDI note lengths are not captured.',
    );
  }

  const resolved = glyphName(graphic?.glyph);
  const name = known(resolved) ? resolved : requested;

  if (!known(name)) {
    return false;
  }

  const hidden = graphic?.hidden || (captured && !graphic);
  const parent = notation(hidden);
  const direction = graphic?.direction || attachment.direction;
  const appearance = scriptAppearance(graphic, hidden, warn);
  const attrs = {
    ...appearance,
    ...(direction ? { placement: direction < 0 ? 'below' : 'above' } : {}),
  };

  if (!hidden) {
    if (graphic?.custom) {
      warn(
        'script-stencil',
        'A custom articulation drawing cannot be reproduced natively; its available standard mark is retained.',
      );
    }

    if (
      graphic &&
      resolved !== requested &&
      !(technical[name] && technical[name] === technical[requested])
    ) {
      warn(
        'script-glyph',
        `The ${requested} mark resolves to ${graphic.glyph || 'a custom glyph'}; its available native shape is retained and the original event remains in metadata.`,
      );
    }
  }

  if (Object.hasOwn(fermatas, name)) {
    const inverted = /^[ud].*fermata$/.test(graphic?.glyph || '')
      ? graphic?.glyph.startsWith('d')
      : direction === -1;

    add(parent, 'fermata', fermatas[name] || undefined, {
      ...appearance,
      type: inverted ? 'inverted' : 'upright',
    });

    return true;
  }

  if (Object.hasOwn(marks, name)) {
    add(
      add(parent, 'articulations'),
      required(marks[name], 'articulations.ts: marks[name]'),
      undefined,
      {
        ...attrs,
        ...(name === 'marcato'
          ? {
              type: graphic?.glyph === 'dmarcato' || (!graphic && direction === -1) ? 'down' : 'up',
            }
          : {}),
      },
    );

    return true;
  }

  const element = required(technical[name], 'articulations.ts: technical[name]');

  add(add(parent, 'technical'), element, undefined, attrs);

  if (!hidden && ['heel', 'toe', 'half-muted'].includes(element)) {
    warn(
      'technical-variant',
      `The ${name} technique and placement use native ${element}; its specific LilyPond glyph orientation or circle/slash variant requires further native glyph mapping.`,
    );
  }

  return true;
}
