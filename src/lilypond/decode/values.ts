import { isRational } from '../../model/time.js';
import type { Moment, Rational } from '@sightread/lilypond-eventdocument';
import { texToPostScriptPoints } from '../../model/units.js';
import type { FormattedEvent, ScoreDocument, TextFontContext } from '../../model/document.js';
import type { WireEvent } from '../wire.js';

export type DecodedExtension = Exclude<ScoreDocument['events'][number], FormattedEvent>;

export function rational(value: string | number, field?: string): Rational {
  const parts = String(value).split('/');
  const numerator = Number(parts[0]),
    denominator = parts.length === 1 ? 1 : Number(parts[1]);

  if (parts.length > 2 || !parts[0]?.trim() || !isRational({ numerator, denominator })) {
    throw new TypeError(
      `Invalid extracted rational${field ? ` field ${field}` : ''}: ${String(value)}`,
    );
  }

  return { numerator, denominator };
}

export function numeric(value: number | string, field?: string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Invalid extracted numeric${field ? ` field ${field}` : ''}: ${value}`);
    }

    return value;
  }

  const fraction = rational(value, field);

  return fraction.numerator / fraction.denominator;
}

export function nullableMoment(
  main: string | number | null | undefined,
  grace: string | number | null | undefined,
  mainField?: string,
  graceField?: string,
): Moment | null {
  return main == null || grace == null
    ? null
    : { main: rational(main, mainField), grace: rational(grace, graceField) };
}

export const nullableNumber = (value: number | string | null, field?: string) =>
  value === null ? null : numeric(value, field);

export function fontContext(context: TextFontContext): TextFontContext {
  return {
    ...context,
    reference: texToPostScriptPoints(context.reference),
    attrs: Object.fromEntries(
      Object.entries(context.attrs).map(([key, value]) => [
        key,
        key === 'font-size' && typeof value === 'number' ? texToPostScriptPoints(value) : value,
      ]),
    ),
  };
}

export function musicFonts(
  fonts: Exclude<Extract<WireEvent, { k: 'namepiece' }>['music-fonts'], undefined>,
) {
  return fonts === null
    ? null
    : fonts.map((font, index) => ({
        textPoints: texToPostScriptPoints(
          numeric(font['text-size'], `music-fonts[${index}].text-size`),
        ),
        musicPoints: numeric(font['music-size'], `music-fonts[${index}].music-size`),
      }));
}

export const pitch = (value: readonly [number, number, string] | false) =>
  Array.isArray(value) && value.length === 3
    ? { octave: value[0], step: value[1], alteration: rational(value[2]) }
    : null;
