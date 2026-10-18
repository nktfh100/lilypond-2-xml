import { musicXMLColor } from '../colors.js';
import type { Attributes } from '../../types.js';
import type { FigureGroup } from '../../planning/events.js';
import type { Warn } from '../../../model/diagnostics.js';
import { textRuns, visibleText, type TextRun } from '../../text/runs.js';

/** Formatted labels replace semantic modifiers; explicit event text retains them. */
export type FigureDisplay =
  | { mode: 'semantic-number'; base: Attributes; invisible: boolean }
  | {
      mode: 'formatted-text' | 'semantic-text';
      base: Attributes;
      runs: TextRun[];
      textAttrs: Attributes;
      invisible: boolean;
    };

type DisplayContent = {
  mode: FigureDisplay['mode'];
  runs: TextRun[];
};

const figureTextAttributes = new Set([
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'default-x',
  'default-y',
  'relative-x',
  'relative-y',
]);

function figureMarkupUses(
  value: import('../../../model/document.js').TextMarkup,
  commands: readonly string[],
): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => figureMarkupUses(child, commands));
  }

  return !!(
    value &&
    typeof value === 'object' &&
    'command' in value &&
    (commands.includes(value.command) ||
      value.args.some((child) => figureMarkupUses(child, commands)))
  );
}

function numberFontSteps(
  value: import('../../../model/document.js').TextMarkup | undefined,
  step = 0,
): {
  steps: number[];
  markup: import('../../../model/document.js').TextMarkup | null;
} | null {
  if (!value || typeof value !== 'object' || !('command' in value)) {
    return null;
  }

  const { command, args } = value;

  if (command === 'number-markup') {
    return typeof args[0] === 'string' || typeof args[0] === 'number'
      ? { steps: [step], markup: String(args[0]) }
      : null;
  }

  if (
    ['slashed-digit-markup', 'backslashed-digit-markup'].includes(command) &&
    typeof args[0] === 'number' &&
    Number.isSafeInteger(args[0])
  ) {
    return { steps: [step], markup: null };
  }

  if (command === 'fontsize-markup' && typeof args[0] === 'number' && Number.isFinite(args[0])) {
    const child = numberFontSteps(args[1], step + args[0]);

    return (
      child && {
        ...child,
        markup: child.markup === null ? null : { ...value, args: [args[0], child.markup] },
      }
    );
  }

  if (['with-color-markup', 'transparent-markup'].includes(command)) {
    const index = command === 'with-color-markup' ? 1 : 0;
    const child = numberFontSteps(args[index], step);

    return (
      child && {
        ...child,
        markup:
          child.markup === null
            ? null
            : {
                ...value,
                args: index ? [args[0]!, child.markup] : [child.markup],
              },
      }
    );
  }

  if (command === 'concat-markup' && Array.isArray(args[0])) {
    const children = args[0].map((child) => numberFontSteps(child, step));

    if (children.some((child) => !child)) {
      return null;
    }

    return {
      steps: children.flatMap((child) => child!.steps),
      markup: children.some((child) => child!.markup === null)
        ? null
        : { ...value, args: [children.map((child) => child!.markup!)] },
    };
  }

  if (['align-on-other-markup', 'pad-x-markup', 'bracket-markup'].includes(command)) {
    const child = numberFontSteps(
      args[command === 'align-on-other-markup' ? 4 : command === 'pad-x-markup' ? 1 : 0],
      step,
    );

    return child && { ...child, markup: null };
  }

  if (command === 'put-adjacent-markup') {
    const left = numberFontSteps(args[2], step),
      right = numberFontSteps(args[3], step);

    return left && right ? { steps: [...left.steps, ...right.steps], markup: null } : null;
  }

  return null;
}

export function resolveFigureDisplay(
  figure: FigureGroup['figures'][number],
  customFormatter: boolean,
  warn: Warn,
): FigureDisplay {
  if (figure.graphic === false || figure.column === null || figure.columnUsed === false) {
    return figure.text !== null
      ? {
          mode: 'semantic-text',
          base: {},
          runs: [{ text: figure.text, attrs: {} }],
          textAttrs: {},
          invisible: true,
        }
      : { mode: 'semantic-number', base: {}, invisible: true };
  }

  if (figure.graphic === undefined) {
    warn(
      'figured-bass-graphics-history',
      'Graphics-presence provenance is unavailable for this figure. Available native figures are retained without verified source object presence or suppression.',
    );
  }

  if (
    figure.graphic === true &&
    (figure.column === undefined || (figure.column && figure.columnUsed === undefined))
  ) {
    warn(
      'figured-bass-column-history',
      'This BassFigure lacks resolved final paper-column attachment or usage provenance. Available native figures remain without verified source participation or column timing.',
    );
  }

  if (figure.graphic === true && figure.row === null) {
    warn(
      'figured-bass-row',
      'This BassFigure has no resolved row ownership. Native text and event order are retained without verified vertical row geometry.',
    );
  }

  const context = figure.fontContext;
  const color = musicXMLColor(figure.color ?? null);
  let base: Attributes = { ...context?.attrs, ...(color ? { color } : {}) };
  const numericDisplay = numberFontSteps(figure.display);
  const customNumeric =
    customFormatter && numericDisplay?.markup !== null && numericDisplay?.markup !== undefined;
  const useFormattedDisplay =
    figure.display !== undefined &&
    figure.display !== null &&
    !(customNumeric || (!customFormatter && numericDisplay)) &&
    (customFormatter ||
      !figureMarkupUses(figure.display, [
        'number-markup',
        'musicglyph-markup',
        'dynamic-markup',
        'score-markup',
      ]));
  let display: DisplayContent = { mode: 'semantic-number', runs: [] };

  if (useFormattedDisplay) {
    let unsupported = false;
    const runs = textRuns(
      figure.display,
      base,
      (code, message) => {
        if (code === 'markup-command') {
          unsupported = true;
        }

        warn(code, message);
      },
      context?.reference,
    );

    display = { mode: 'formatted-text', runs };
    const emptyFrame =
      !runs.some((run) => run.text.trim()) &&
      figureMarkupUses(figure.display!, ['box-markup', 'circle-markup', 'oval-markup']);

    if (unsupported || emptyFrame) {
      warn(
        'figured-bass-format',
        'The resolved figure display includes unsupported graphical or music-font markup; available text or original native figure semantics are retained.',
      );

      if (
        !runs.some((run) => run.text.trim()) ||
        figureMarkupUses(figure.display!, [
          'number-markup',
          'musicglyph-markup',
          'dynamic-markup',
          'score-markup',
        ])
      ) {
        display = { mode: 'semantic-number', runs };
      }
    }
  } else if (customFormatter && !customNumeric) {
    warn(
      'figured-bass-format-history',
      'This figure lacks the resolved custom formatter display. Available figure semantics and explicit event text are retained without verified printed labels.',
    );
  }

  if (display.mode !== 'formatted-text') {
    display =
      figure.text !== null
        ? {
            mode: 'semantic-text',
            runs: textRuns(figure.markup ?? figure.text, base, warn, context?.reference),
          }
        : { mode: 'semantic-number', runs: [] };
  }

  if (
    !customFormatter &&
    figure.number === null &&
    figure.text === null &&
    !display.runs.some((run) => run.text.trim())
  ) {
    display = { mode: 'semantic-number', runs: display.runs };
  }

  if (display.mode === 'semantic-number' || customNumeric) {
    const numeric = figure.numberFontContext;

    if (!numeric) {
      warn(
        'figured-bass-number-font-history',
        'This numeric figure lacks an encoding-specific font reference. Available native figures and inherited text styles remain without verified numeric point sizes.',
      );

      if (customNumeric) {
        base = color ? { color } : {};
      }
    } else {
      const steps = numericDisplay?.steps;
      const size = numeric.attrs['font-size'];
      const resolvedSize =
        typeof size === 'number' && steps?.length ? size * 2 ** (steps[0]! / 6) : NaN;

      if (
        steps?.length &&
        steps.every((step) => step === steps[0]) &&
        typeof size === 'number' &&
        Number.isFinite(size) &&
        size > 0 &&
        Number.isFinite(resolvedSize) &&
        resolvedSize > 0
      ) {
        base = {
          ...numeric.attrs,
          'font-size': resolvedSize,
          ...(color ? { color } : {}),
        };
      } else {
        base = color ? { color } : {};
        warn(
          'figured-bass-number-font',
          'The resolved numeric display has opaque music glyphs, mixed sizes or unsupported font-changing markup. Native figures retain their semantics and colors without a guessed font size.',
        );
      }

      if (numeric.encoding === 'fetaText') {
        warn(
          'figured-bass-number-glyph',
          'Native figure point sizes and nominal font families are retained where resolved; LilyPond music-font optical designs and OpenType digit variants have no mapped native representation.',
        );
      }

      if (numeric.unsupported.length) {
        warn(
          'figured-bass-font-style',
          `Unsupported inherited numeric font settings: ${numeric.unsupported.join(', ')}. Available native sizes and font descriptions are retained.`,
        );
      }
    }

    if (customNumeric) {
      const numericBase: Attributes = {
        ...numeric?.attrs,
        ...(color ? { color } : {}),
      };

      if (!base['font-size']) {
        delete numericBase['font-size'];
      }

      let runs = textRuns(numericDisplay!.markup!, numericBase, warn, numeric?.reference);

      if (!base['font-size']) {
        runs = runs.map((run) => ({
          text: run.text,
          attrs: Object.fromEntries(
            Object.entries(run.attrs).filter(([key]) => key !== 'font-size'),
          ),
        }));
      }

      display = { mode: 'formatted-text', runs };
    }
  }

  if (
    !context &&
    ((display.mode !== 'semantic-number' && !customNumeric) || !figure.numberFontContext)
  ) {
    warn(
      'figured-bass-style-history',
      'This figure lacks captured grob font and color context. Explicit styles remain native without verified inherited weights, families, colors or point sizes.',
    );
  }

  const { runs } = display;
  const keys = new Set(runs.flatMap((run) => Object.keys(run.attrs)));
  const textAttrs: Attributes = Object.fromEntries(
    [...keys]
      .filter(
        (key) =>
          figureTextAttributes.has(key) &&
          runs.every((run) => run.attrs[key] === runs[0]!.attrs[key]),
      )
      .map((key) => [key, runs[0]!.attrs[key]]),
  );

  if (
    runs.some((run) =>
      Object.keys(run.attrs).some(
        (key) => !figureTextAttributes.has(key) || run.attrs[key] !== textAttrs[key],
      ),
    ) ||
    runs.some((run) => run.text.includes('\n'))
  ) {
    warn(
      'figured-bass-markup',
      'Native figure-number supports one text style. Mixed styles, decoration and composite layout remain in metadata while text and common supported attributes are retained.',
    );
  }

  if (figure.custom) {
    warn(
      'figured-bass-stencil',
      'A custom figured-bass drawing has no mapped native equivalent; available figure semantics, text and supported styles are retained.',
    );
  }

  if (context?.unsupported.length) {
    warn(
      'figured-bass-font-style',
      `Unsupported inherited figured-bass font settings: ${context.unsupported.join(', ')}. Available native text styles are retained.`,
    );
  }

  const invisible =
    figure.hidden ||
    !visibleText(display.mode !== 'semantic-number' ? runs : [{ text: 'figure', attrs: base }]);

  return display.mode === 'semantic-number'
    ? { mode: display.mode, base, invisible }
    : { ...display, base, textAttrs, invisible };
}
