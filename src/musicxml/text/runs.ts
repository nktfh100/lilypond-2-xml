import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import { isTransparentColor, markupColor, markupNumber } from '../notation/colors.js';
import type { Attributes } from '../types.js';
import type { Warn } from '../../model/diagnostics.js';
import { required } from '../planning/events.js';
import { sameAttributes, xmlNumber } from '../primitives.js';
import { texToPostScriptPoints } from '../../model/units.js';
import type { TextMarkup } from '../../model/document.js';

export interface TextRun {
  text: string;
  attrs: Attributes;
}
const styles: Record<string, Attributes> = {
  'bold-markup': { 'font-weight': 'bold' },
  'normal-weight-markup': { 'font-weight': 'normal' },
  'italic-markup': { 'font-style': 'italic' },
  'upright-markup': { 'font-style': 'normal' },
  'normal-text-markup': {
    'font-weight': 'normal',
    'font-style': 'normal',
    'font-family': 'serif',
  },
  'sans-markup': { 'font-family': 'sans-serif' },
  'roman-markup': { 'font-family': 'serif' },
  'typewriter-markup': { 'font-family': 'monospace' },
  'box-markup': { enclosure: 'rectangle' },
  'circle-markup': { enclosure: 'circle' },
  'oval-markup': { enclosure: 'oval' },
};

export function textRuns(
  markup: TextMarkup | undefined,
  attrs: Attributes,
  warn: Warn,
  fontReference?: number,
  musicFont?: ((textPoints: number) => number | undefined) | null,
): TextRun[] {
  const walk = (node: TextMarkup | undefined, style = attrs): TextRun[] => {
    if (typeof node === 'string') {
      return [{ text: node, attrs: style }];
    }

    if (Array.isArray(node)) {
      return join(node, ' ', style);
    }

    if (!node || typeof node !== 'object' || !('command' in node)) {
      return [];
    }

    const { command, args = [], plain = '' } = node;

    if (command === 'null-markup') {
      return [];
    }

    const accidentals: Record<string, string> = {
      'flat-markup': '♭',
      'sharp-markup': '♯',
      'natural-markup': '♮',
      'doubleflat-markup': '𝄫',
      'doublesharp-markup': '𝄪',
    };

    if (Object.hasOwn(accidentals, command)) {
      if (musicFont === undefined) {
        return [{ text: accidentals[command] || '', attrs: style }];
      }

      const {
        'font-size': size,
        'font-family': family,
        'font-weight': weight,
        'font-style': shape,
        ...rest
      } = style;
      const points = typeof size === 'number' ? musicFont?.(size) : undefined;

      if (typeof points === 'number' && Number.isFinite(points) && points > 0) {
        return [
          {
            text: accidentals[command] || '',
            attrs: { ...rest, 'font-size': points },
          },
        ];
      }

      warn(
        'markup-music-font',
        'An accidental markup glyph lacks a resolved music-font size for its text context. Native accidental semantics and other styles remain without applying a text-font point size to a music glyph.',
      );

      return [{ text: accidentals[command] || '', attrs: rest }];
    }

    if (command === 'with-color-markup') {
      const color = markupColor(args[0]);

      if (!color) {
        warn(
          'markup-color',
          'An unresolved markup color has no native color mapping; the nested text and available styles are retained.',
        );
      }

      return walk(args[1], color ? { ...style, color } : style);
    }

    if (command === 'transparent-markup') {
      return transparentText(walk(args[0], style));
    }

    if (command === 'rotate-markup') {
      const angle = markupNumber(args[0]);

      if (!Number.isFinite(angle)) {
        warn(
          'markup-rotation',
          'An unresolved markup rotation has no native angle; nested text and available styles are retained.',
        );

        return walk(args[1], style);
      }

      const rotation = (Number(style.rotation ?? 0) - (angle % 360)) % 360;

      const runs = walk(args[1], {
        ...style,
        rotation:
          (rotation > 180 ? rotation - 360 : rotation < -180 ? rotation + 360 : rotation) + 0,
      });

      if (angle % 360 !== 0 && runs.some((run) => !sameAttributes(run.attrs, runs[0]!.attrs))) {
        warn(
          'markup-rotation-layout',
          'Rotation angles and text styles remain native, but independently rotated text runs do not retain the exact geometry of a LilyPond composite rotated around one center.',
        );
      }

      return runs;
    }

    if (command === 'underline-markup') {
      const count = Number(style.underline ?? 0) + 1;

      if (count > 3) {
        warn(
          'markup-underlines',
          'MusicXML supports up to three underline strokes. Additional LilyPond strokes are retained in markup metadata; native text uses three lines.',
        );
      }

      return walk(args[0], { ...style, underline: Math.min(count, 3) });
    }

    if (['smaller-markup', 'larger-markup', 'fontsize-markup'].includes(command)) {
      const pointSize = style['font-size'],
        increment =
          command === 'fontsize-markup'
            ? markupNumber(args[0])
            : command === 'smaller-markup'
              ? -1
              : 1;
      const child = args[command === 'fontsize-markup' ? 1 : 0];
      const size =
        typeof pointSize === 'number' && typeof increment === 'number'
          ? pointSize * Math.pow(2, increment / 6)
          : NaN;

      if (Number.isFinite(size) && size > 0) {
        return walk(child, { ...style, 'font-size': size });
      }

      warn(
        'markup-font-base',
        'Relative markup font sizing has no captured absolute point-size base; nested text and other native styles are retained without a guessed font size.',
      );

      return walk(child, style);
    }

    if (
      [
        'tiny-markup',
        'teeny-markup',
        'small-markup',
        'large-markup',
        'huge-markup',
        'normalsize-markup',
      ].includes(command)
    ) {
      const step: Record<string, number> = {
        'tiny-markup': -2,
        'teeny-markup': -3,
        'small-markup': -1,
        'large-markup': 1,
        'huge-markup': 2,
        'normalsize-markup': 0,
      };

      return resetSize(args[0], style, Math.pow(2, step[command]! / 6));
    }

    if (command === 'magnify-markup') {
      return resetSize(args[1], style, markupNumber(args[0]));
    }

    if (styles[command]) {
      const runs = walk(args[0], { ...style, ...styles[command] });

      if (styles[command]?.enclosure && runs.length > 1) {
        const first = required(runs[0], 'text.ts: runs[0]');
        const uniform = runs.every((run) => sameAttributes(run.attrs, first.attrs));

        if (!uniform) {
          warn(
            'markup-enclosure',
            'A frame around mixed text styles is retained as one native enclosure with uniform text formatting.',
          );
        }

        return [
          {
            text: runs.map((r) => r.text).join(''),
            attrs: uniform ? first.attrs : { ...style, ...styles[command] },
          },
        ];
      }

      return runs;
    }

    if (['line-markup', 'concat-markup'].includes(command)) {
      return join(args[0], command === 'concat-markup' ? '' : ' ', style);
    }

    if (
      [
        'column-markup',
        'left-column-markup',
        'center-column-markup',
        'right-column-markup',
      ].includes(command)
    ) {
      const align =
        command === 'center-column-markup'
          ? 'center'
          : command === 'right-column-markup'
            ? 'right'
            : 'left';

      warn(
        'markup-layout',
        'Text lines and alignment are retained, but exact column baseline spacing has not been extracted.',
      );

      return join(args[0], '\n', { ...style, justify: align, halign: align });
    }

    if (['center-align-markup', 'left-align-markup', 'right-align-markup'].includes(command)) {
      return walk(args[0], { ...style, halign: command.split('-')[0] });
    }

    if (
      command === 'abs-fontsize-markup' &&
      Number.isFinite(markupNumber(args[0])) &&
      markupNumber(args[0]) > 0
    ) {
      return walk(args[1], {
        ...style,
        'font-size': texToPostScriptPoints(markupNumber(args[0])),
      });
    }

    if (command === 'override-markup') {
      const pair = args[0];
      const [property, value] = Array.isArray(pair) ? pair : [];

      if (property === 'font-size') {
        return resetSize(args[1], style, Math.pow(2, markupNumber(value) / 6));
      }

      const native = new Map<string, string>(
        Object.entries({
          'font-name': 'font-family',
          'font-series': 'font-weight',
          'font-shape': 'font-style',
        }),
      ).get(String(property));

      if (
        native &&
        typeof value === 'string' &&
        (native === 'font-family' ||
          (native === 'font-weight'
            ? ['bold', 'normal'].includes(value)
            : ['italic', 'upright', 'normal'].includes(value)))
      ) {
        return walk(args[1], {
          ...style,
          [native]: value === 'upright' ? 'normal' : value,
        });
      }
    }

    warn(
      'markup-command',
      `Text is retained, but markup formatting requires further mapping: ${command}`,
    );

    return [{ text: plain, attrs: style }];
  };
  const resetSize = (
    child: TextMarkup | undefined,
    style: Attributes,
    factor: number,
  ): TextRun[] => {
    if (
      fontReference !== undefined &&
      Number.isFinite(fontReference) &&
      fontReference > 0 &&
      Number.isFinite(factor) &&
      factor > 0
    ) {
      return walk(child, { ...style, 'font-size': fontReference * factor });
    }

    warn(
      'markup-font-reset',
      'A LilyPond font-size reset uses its layout font reference; that reference or size is unavailable for this text, so nested styles are retained without a guessed point size.',
    );
    const { 'font-size': _pointSize, ...remaining } = style;

    return walk(child, remaining);
  };
  const join = (nodes: TextMarkup | undefined, separator: string, style: Attributes): TextRun[] =>
    (Array.isArray(nodes) ? nodes : [nodes]).reduce((runs, node, i) => {
      const next = walk(node, style);
      const previous = runs.at(-1);
      const enclosed = (run: TextRun | undefined) =>
        run?.attrs.enclosure && run.attrs.enclosure !== 'none';

      if (i && separator) {
        if (previous && !enclosed(previous)) {
          previous.text += separator;
        } else if (next[0] && !enclosed(next[0])) {
          next[0].text = separator + next[0].text;
        } else {
          runs.push({ text: separator, attrs: style });
        }
      }

      runs.push(...next);

      return runs;
    }, []);

  return walk(markup).reduce<TextRun[]>((runs, run) => {
    const previous = runs.at(-1);

    if (previous && sameAttributes(previous.attrs, run.attrs)) {
      previous.text += run.text;
    } else {
      runs.push({ ...run });
    }

    return runs;
  }, []);
}

export function transparentText(runs: TextRun[]) {
  return runs.map((run) => ({
    ...run,
    attrs: { ...run.attrs, color: '#00000000' },
  }));
}

export function visibleText(runs: TextRun[]) {
  return runs.some((run) => run.text.trim() && !isTransparentColor(run.attrs.color));
}

export function writeText(
  parent: XMLBuilder,
  kind: string,
  text: string | undefined,
  markup: TextMarkup | undefined,
  attrs: Attributes,
  warn: Warn,
  hidden = false,
): XMLBuilder {
  const rawRuns =
    markup === undefined ? [{ text: text ?? '', attrs }] : textRuns(markup, attrs, warn);
  const runs = hidden ? transparentText(rawRuns) : rawRuns;

  let first;

  for (const run of runs.length ? runs : [{ text: '', attrs }]) {
    const node = parent
      .ele(kind, {
        ...Object.fromEntries(
          Object.entries(run.attrs).map(([key, value]) => [
            key,
            typeof value === 'number' ? xmlNumber(value) : value,
          ]),
        ),
        'xml:space': 'preserve',
      })
      .txt(run.text);

    first ||= node;
  }

  return required(first, 'text.ts: first');
}
