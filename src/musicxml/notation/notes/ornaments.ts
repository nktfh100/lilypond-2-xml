import type { Moment, Rational } from '@sightread/lilypond-eventdocument';
import type { Add, Attributes, Notation } from '../../types.js';
import { type Attachment, type Script, required } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { scriptAppearance } from './script-appearance.js';

const shapes: Record<string, readonly [string, Attributes?]> = {
  trill: ['trill-mark'],
  turn: ['turn'],
  reverseturn: ['inverted-turn'],
  slashturn: ['turn', { slash: 'yes' }],
  haydnturn: ['haydn'],
  bachschleifer: ['schleifer'],
  prall: ['inverted-mordent'],
  mordent: ['mordent'],
  prallprall: ['inverted-mordent', { long: 'yes' }],
  prallmordent: ['mordent', { long: 'yes' }],
  upprall: ['inverted-mordent', { long: 'yes', approach: 'below' }],
  downprall: ['inverted-mordent', { long: 'yes', approach: 'above' }],
  upmordent: ['mordent', { long: 'yes', approach: 'below' }],
  downmordent: ['mordent', { long: 'yes', approach: 'above' }],
  prallup: ['inverted-mordent', { long: 'yes', departure: 'above' }],
  pralldown: ['inverted-mordent', { long: 'yes', departure: 'below' }],
  lineprall: ['inverted-mordent', { long: 'yes', approach: 'above' }],
};
const value = (r: Rational) => r.numerator / r.denominator;

export const scriptKey = (id: number | undefined, voice: number, moment: Moment) =>
  `${id}:${voice}:${value(moment.main)}:${value(moment.grace)}`;

export function writeOrnament(
  notation: Notation,
  attachment: Attachment,
  graphic: Script | undefined,
  captured: boolean | undefined,
  add: Add,
  warn: Warn,
) {
  const requested = attachment.articulationType || '';
  const name = graphic && shapes[graphic.glyph] ? graphic.glyph : requested;

  if (!shapes[name]) {
    return false;
  }

  if (captured && !graphic) {
    return true;
  }

  if (graphic?.hidden) {
    return true;
  }

  if (graphic?.custom) {
    warn(
      'ornament-stencil',
      'A custom ornament drawing cannot be reproduced natively; its available standard ornament is retained.',
    );
  }

  if (graphic && graphic.glyph !== requested) {
    warn(
      'ornament-glyph',
      `The ${requested} ornament resolves to ${graphic.glyph || 'a custom glyph'}; its available native shape is retained while the original event remains in metadata.`,
    );
  }

  if (name === 'lineprall') {
    warn(
      'ornament-variant',
      'The lineprall ornament retains a native long upper mordent with an approach from above; its straight prefix differs from the curved standard form.',
    );
  }

  const [element, attributes = {}] = required(shapes[name], 'ornaments.ts: shapes[name]');
  const horizontal = graphic?.axis === 0;

  if (horizontal) {
    warn(
      'ornament-placement',
      'A horizontal ornament retains its native symbol and available staff position, but placement to the left of the note is not mapped.',
    );
  }

  const direction = horizontal ? 0 : graphic?.direction || attachment.direction;
  const parent = notation();

  add(add(parent, 'ornaments'), element, undefined, {
    ...scriptAppearance(graphic, false, warn),
    ...attributes,
    ...(horizontal && graphic.staffPosition !== null
      ? { 'default-y': (graphic.staffPosition - 4) * 5 }
      : {}),
    ...(direction ? { placement: direction < 0 ? 'below' : 'above' } : {}),
  });

  return true;
}
