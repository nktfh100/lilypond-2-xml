import { musicXMLColor } from '../colors.js';
import type { Attributes } from '../../types.js';
import type { Script } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';

export function scriptFont(graphic: Script | undefined, warn: Warn): Attributes {
  if (!graphic || graphic.glyphMissing) {
    return {};
  }

  const points = graphic.fontPoints;

  if (points == null) {
    warn(
      'script-size-history',
      'This script lacks a resolved physical font size. Its native symbol remains without a guessed point size from a LilyPond font step.',
    );

    return {};
  }

  if (!Number.isFinite(points) || points <= 0) {
    warn(
      'script-size-data',
      'An invalid cached script font size is omitted. Its native symbol remains.',
    );

    return {};
  }

  return { 'font-size': points };
}

export function scriptAppearance(
  graphic: Script | undefined,
  hidden: boolean | undefined,
  warn: Warn,
): Attributes {
  const color = musicXMLColor(graphic?.color ?? null);

  if (graphic && (graphic.color === undefined || graphic.offset === undefined)) {
    warn(
      'script-appearance-history',
      'This script lacks captured color or translation offsets. Its native symbol remains without verified appearance overrides.',
    );
  }

  return {
    ...scriptFont(graphic, warn),
    ...(hidden ? { color: '#00000000' } : color ? { color } : {}),
    ...(graphic?.offset?.[0] ? { 'relative-x': graphic.offset[0] * 10 } : {}),
    ...(graphic?.offset?.[1] ? { 'relative-y': graphic.offset[1] * 10 } : {}),
  };
}
