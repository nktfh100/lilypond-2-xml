import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { musicXMLColor } from '../colors.js';
import type { Add, Attributes } from '../../types.js';
import type { NoteLike } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import type {
  ClusterGraphicEvent,
  NoteheadEvent,
  PercussionEvent,
} from '../../../model/document.js';

const native: Record<string, string> = {
  default: 'normal',
  altdefault: 'normal',
  cross: 'x',
  xcircle: 'circle-x',
  diamond: 'diamond',
  triangle: 'triangle',
  slash: 'slash',
  do: 'do',
  re: 're',
  mi: 'mi',
  sol: 'so',
  la: 'la',
  ti: 'ti',
};
const shapes: Record<string, string> = {
  do: 'noteShapeTriangleUp',
  re: 'noteShapeMoon',
  mi: 'noteShapeDiamond',
  sol: 'noteShapeRound',
  la: 'noteShapeSquare',
  ti: 'noteShapeTriangleRound',
  doFunk: 'noteShapeMoonLeft',
  reFunk: 'noteShapeArrowheadLeft',
  miFunk: 'noteShapeDiamond',
  solFunk: 'noteShapeRound',
  laFunk: 'noteShapeSquare',
  tiFunk: 'noteShapeTriangleRoundLeft',
  doWalker: 'noteShapeKeystone',
  reWalker: 'noteShapeQuarterMoon',
  miWalker: 'noteShapeDiamond',
  laWalker: 'noteShapeSquare',
  tiWalker: 'noteShapeIsoscelesTriangle',
};

export function writeNotehead(
  parent: XMLBuilder,
  note: NoteLike,
  graphic: NoteheadEvent | undefined,
  percussion: PercussionEvent | undefined,
  add: Add,
  warn: Warn,
  cluster?: ClusterGraphicEvent,
): void {
  if (note.cluster) {
    add(parent, 'notehead', cluster?.present && !cluster.hidden ? 'cluster' : 'none', {
      filled: 'yes',
      color: cluster?.hidden ? '#00000000' : musicXMLColor(cluster?.color ?? null),
    });

    return;
  }

  const original = graphic?.style || percussion?.noteheadStyle || note.noteheadStyle || 'default';
  const match = graphic?.glyph.match(/^(-?\d+)(.*)$/);
  const style = original !== 'default' && match?.[2] ? match[2] : original;
  const log = match && original !== 'default' ? Number(match[1]) : note.duration.log;
  const direction = graphic?.direction || (note.stem === 'down' ? -1 : 1);
  const variant = style.replace(/Thin$|Mirror$/, '');
  const attrs: Attributes = note.parenthesized ? { parentheses: 'yes' } : {};
  let head = Object.hasOwn(native, variant) ? native[variant] : undefined;

  if (['diamond', 'triangle', 'do', 're', 'mi', 'so', 'la', 'ti'].includes(head || '')) {
    attrs.filled = log >= 2 ? 'yes' : 'no';
  }

  if (graphic?.custom) {
    warn(
      'notehead-stencil',
      'A custom notehead drawing is not mapped to native MusicXML; its available notehead style is retained.',
    );
  }

  if (variant !== style) {
    warn(
      'notehead-variant',
      `The ${style} notehead retains its native shape; the LilyPond stroke or mirrored design requires further glyph mapping.`,
    );
  }

  if (['harmonic', 'harmonic-black', 'harmonic-mixed'].includes(style)) {
    head = 'diamond';
    attrs.filled =
      style === 'harmonic-black' || (style === 'harmonic-mixed' ? log >= 2 : log === 2)
        ? 'yes'
        : 'no';
  }

  if (variant === 'fa' || style === 'faFunk' || style === 'faWalker') {
    head = direction > 0 ? 'fa up' : 'fa';
    attrs.smufl = `noteShapeTriangle${direction > 0 ? 'Left' : 'Right'}${log >= 2 ? 'Black' : 'White'}`;
  }

  if (style === 'xcircle') {
    attrs.smufl = 'noteheadCircleX';
  }

  if (style === 'triangle') {
    attrs.smufl = `noteheadTriangleUp${log >= 2 ? 'Black' : log === 1 ? 'Half' : 'Whole'}`;
  }

  if (style === 'arrow') {
    head = direction > 0 ? 'arrow down' : 'arrow up';
    attrs.filled = log >= 2 ? 'yes' : 'no';
    attrs.smufl = `noteheadLargeArrow${direction > 0 ? 'Down' : 'Up'}${log >= 2 ? 'Black' : 'Whole'}`;
  }

  const shape = Object.hasOwn(shapes, style)
    ? shapes[style]
    : Object.hasOwn(shapes, variant)
      ? shapes[variant]
      : undefined;

  if (shape) {
    head ??= 'other';
    attrs.smufl = `${shape}${log >= 2 ? 'Black' : 'White'}`;

    if (['doFunk', 'reFunk', 'tiFunk', 'doWalker', 'reWalker', 'tiWalker'].includes(style)) {
      warn(
        'notehead-orientation',
        `The ${style} notehead uses its native SMuFL shape; direction-dependent rotations require further glyph mapping.`,
      );
    }
  }

  if (!head) {
    head = 'normal';
    warn(
      'notehead-style',
      `Unmapped notehead style: ${style}. Pitches and durations are retained with a normal native notehead.`,
    );
  }

  if (graphic?.hidden && !note.percentCopy) {
    head = 'none';
    delete attrs.smufl;
    delete attrs.filled;
  }

  if (
    percussion ||
    head !== 'normal' ||
    original !== 'default' ||
    note.parenthesized ||
    graphic?.custom
  ) {
    add(parent, 'notehead', head, attrs);
  }
}
