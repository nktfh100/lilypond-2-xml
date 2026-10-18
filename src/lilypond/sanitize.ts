import type { Diagnostic } from '../model/diagnostics.js';

interface TextRule {
  readonly code: 'unsupported-glyph-substituted' | 'unsupported-text-stripped';
  readonly message: string;
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * Sorted, inclusive [lo, hi] ranges of codepoints that have a real glyph (not `.notdef`) in
 * at least one font bundled into the wasm build's `runtime.data.bin`: the text fonts (C059,
 * Nimbus Mono PS, Nimbus Sans, TeX Gyre Cursor/Heros/Schola) and the Emmentaler music fonts.
 * Fontconfig falls back across all of them, so the union predicts whether a rendered character
 * can be shaped without aborting. ASCII whitespace is kept so sanitizing does not corrupt the
 * source layout. Regenerate from the bundled fonts if they change.
 */
const coveredGlyphs: readonly (readonly [number, number])[] = [
  [0x9, 0xa],
  [0xd, 0xd],
  [0x20, 0x7e],
  [0xa0, 0x17f],
  [0x18e, 0x18e],
  [0x192, 0x192],
  [0x1a0, 0x1a1],
  [0x1af, 0x1b0],
  [0x1cd, 0x1d4],
  [0x1d7, 0x1dd],
  [0x1e6, 0x1e7],
  [0x1ea, 0x1eb],
  [0x1f0, 0x1f0],
  [0x1f4, 0x1f5],
  [0x1fa, 0x201],
  [0x204, 0x205],
  [0x208, 0x209],
  [0x20c, 0x20d],
  [0x210, 0x211],
  [0x214, 0x215],
  [0x218, 0x21b],
  [0x237, 0x237],
  [0x258, 0x259],
  [0x2be, 0x2bf],
  [0x2c6, 0x2c7],
  [0x2c9, 0x2c9],
  [0x2d8, 0x2dd],
  [0x300, 0x304],
  [0x306, 0x30c],
  [0x30f, 0x30f],
  [0x311, 0x311],
  [0x323, 0x323],
  [0x326, 0x326],
  [0x32e, 0x332],
  [0x384, 0x38a],
  [0x38c, 0x38c],
  [0x38e, 0x3a1],
  [0x3a3, 0x3ce],
  [0x3d1, 0x3d1],
  [0x3d5, 0x3d6],
  [0x3f1, 0x3f1],
  [0x3f5, 0x3f5],
  [0x400, 0x45f],
  [0x462, 0x463],
  [0x472, 0x475],
  [0x490, 0x493],
  [0x496, 0x49d],
  [0x4a0, 0x4a3],
  [0x4aa, 0x4ab],
  [0x4ae, 0x4b3],
  [0x4b6, 0x4bb],
  [0x4c0, 0x4c0],
  [0x4cb, 0x4cc],
  [0x4cf, 0x4cf],
  [0x4d8, 0x4d9],
  [0x4e2, 0x4e3],
  [0x4e8, 0x4e9],
  [0x4ee, 0x4ef],
  [0xe3f, 0xe3f],
  [0x1e0c, 0x1e0f],
  [0x1e24, 0x1e27],
  [0x1e2a, 0x1e2b],
  [0x1e2e, 0x1e2f],
  [0x1e36, 0x1e39],
  [0x1e42, 0x1e47],
  [0x1e58, 0x1e5d],
  [0x1e62, 0x1e63],
  [0x1e6c, 0x1e6f],
  [0x1e80, 0x1e85],
  [0x1e92, 0x1e93],
  [0x1e97, 0x1e97],
  [0x1ea0, 0x1ef9],
  [0x2002, 0x2002],
  [0x2007, 0x2007],
  [0x2009, 0x200a],
  [0x2010, 0x201e],
  [0x2020, 0x2022],
  [0x2026, 0x2026],
  [0x2030, 0x2033],
  [0x2039, 0x2040],
  [0x2044, 0x2046],
  [0x2052, 0x2052],
  [0x2054, 0x2054],
  [0x2070, 0x2070],
  [0x2074, 0x2079],
  [0x207f, 0x207f],
  [0x20a1, 0x20a1],
  [0x20a3, 0x20a4],
  [0x20a6, 0x20a7],
  [0x20a9, 0x20a9],
  [0x20ab, 0x20ac],
  [0x20af, 0x20af],
  [0x20b1, 0x20b1],
  [0x20dd, 0x20dd],
  [0x2103, 0x2103],
  [0x2105, 0x2105],
  [0x210f, 0x210f],
  [0x2111, 0x2113],
  [0x2116, 0x2118],
  [0x211c, 0x211c],
  [0x211e, 0x211e],
  [0x2120, 0x2120],
  [0x2122, 0x2122],
  [0x2126, 0x2128],
  [0x212d, 0x212f],
  [0x2135, 0x2137],
  [0x215b, 0x215e],
  [0x2190, 0x2199],
  [0x21a8, 0x21a8],
  [0x21b5, 0x21b5],
  [0x21c4, 0x21c4],
  [0x21c6, 0x21c6],
  [0x21d0, 0x21d5],
  [0x2200, 0x2200],
  [0x2202, 0x2203],
  [0x2205, 0x2209],
  [0x220b, 0x220b],
  [0x220d, 0x220d],
  [0x220f, 0x220f],
  [0x2211, 0x2213],
  [0x2215, 0x2215],
  [0x2217, 0x2217],
  [0x2219, 0x221a],
  [0x221d, 0x2220],
  [0x2222, 0x2223],
  [0x2225, 0x2225],
  [0x2227, 0x222b],
  [0x222e, 0x222e],
  [0x2234, 0x2235],
  [0x2237, 0x2237],
  [0x2245, 0x2245],
  [0x2248, 0x2248],
  [0x2260, 0x2262],
  [0x2264, 0x2265],
  [0x226a, 0x226b],
  [0x2282, 0x2287],
  [0x2295, 0x2299],
  [0x22a2, 0x22a5],
  [0x22bb, 0x22bb],
  [0x22c6, 0x22c6],
  [0x2300, 0x2300],
  [0x2302, 0x2302],
  [0x2310, 0x2310],
  [0x2320, 0x2321],
  [0x2329, 0x232a],
  [0x2422, 0x2423],
  [0x2500, 0x2500],
  [0x2502, 0x2502],
  [0x250c, 0x250c],
  [0x2510, 0x2510],
  [0x2514, 0x2514],
  [0x2518, 0x2518],
  [0x251c, 0x251c],
  [0x2524, 0x2524],
  [0x252c, 0x252c],
  [0x2534, 0x2534],
  [0x253c, 0x253c],
  [0x2550, 0x2570],
  [0x2580, 0x2580],
  [0x2584, 0x2584],
  [0x2588, 0x2588],
  [0x258c, 0x258c],
  [0x2590, 0x2593],
  [0x25a0, 0x25a1],
  [0x25aa, 0x25ac],
  [0x25b2, 0x25b2],
  [0x25b5, 0x25b5],
  [0x25b9, 0x25ba],
  [0x25bc, 0x25bc],
  [0x25bf, 0x25bf],
  [0x25c3, 0x25c4],
  [0x25c6, 0x25c7],
  [0x25ca, 0x25cb],
  [0x25cf, 0x25cf],
  [0x25d8, 0x25d9],
  [0x25e6, 0x25e6],
  [0x263a, 0x263c],
  [0x2640, 0x2640],
  [0x2642, 0x2642],
  [0x2660, 0x2660],
  [0x2663, 0x2663],
  [0x2665, 0x2666],
  [0x266a, 0x266b],
  [0x266d, 0x266f],
  [0x26ad, 0x26ae],
  [0x27e6, 0x27e7],
  [0x2a7d, 0x2a7e],
  [0x301a, 0x301b],
  [0xe000, 0xe272],
  [0xe803, 0xe803],
  [0xea00, 0xea11],
  [0xea14, 0xea1f],
  [0xea21, 0xea46],
  [0xeb02, 0xeb05],
  [0xeb08, 0xeb0a],
  [0xeb0d, 0xeb0d],
  [0xeb0f, 0xeb12],
  [0xeb15, 0xeb17],
  [0xeb19, 0xeb19],
  [0xeb1e, 0xeb1f],
  [0xeb28, 0xeb2b],
  [0xeb2e, 0xeb32],
  [0xeb35, 0xeb36],
  [0xeb3a, 0xeb3b],
  [0xeb40, 0xeb40],
  [0xeb43, 0xeb43],
  [0xeb48, 0xeb49],
  [0xeb4c, 0xeb4d],
  [0xeb52, 0xeb52],
  [0xeb56, 0xeb57],
  [0xeb5a, 0xeb5a],
  [0xeb61, 0xeb61],
  [0xeb63, 0xeb67],
  [0xeb6b, 0xeb6b],
  [0xeb6e, 0xeb6f],
  [0xeb7e, 0xeb7e],
  [0xec00, 0xec00],
  [0xec06, 0xec0e],
  [0xec10, 0xec12],
  [0xefbf, 0xefec],
  [0xeffa, 0xefff],
  [0xf638, 0xf641],
  [0xf643, 0xf64c],
  [0xf66d, 0xf675],
  [0xf677, 0xf69b],
  [0xf69d, 0xf6ad],
  [0xf6be, 0xf6be],
  [0xf6dc, 0xf6dc],
  [0xf6de, 0xf6de],
  [0xf724, 0xf724],
  [0xf730, 0xf739],
  [0xf761, 0xf77a],
  [0xf7a2, 0xf7a2],
  [0xf7e0, 0xf7f6],
  [0xf7f8, 0xf7ff],
  [0xfb00, 0xfb04],
  [0x1d12a, 0x1d12b],
];

const uncoveredGlyph = new RegExp(
  `[^${coveredGlyphs
    .map(([lo, hi]) => `\\u{${lo.toString(16)}}-\\u{${hi.toString(16)}}`)
    .join('')}]`,
  'gu',
);

const rules: readonly TextRule[] = [
  {
    code: 'unsupported-glyph-substituted',
    message:
      'Broken-bar glyphs have no glyph in the embedded LilyPond fonts and abort formatting; the vertical bar substitutes them.',
    pattern: /\\char\s*##x01C0/g,
    replacement: '"|"',
  },
  {
    code: 'unsupported-glyph-substituted',
    message:
      'Broken-bar glyphs have no glyph in the embedded LilyPond fonts and abort formatting; the vertical bar substitutes them.',
    pattern: /ǀ/g,
    replacement: '|',
  },
  {
    code: 'unsupported-text-stripped',
    message:
      'Characters with no glyph coverage in the embedded LilyPond fonts abort formatting; they are removed from marked-up text.',
    pattern: uncoveredGlyph,
    replacement: '',
  },
];

export interface SanitizedText {
  readonly text: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** Returns the end of a quoted string, preserving an unfinished string verbatim. */
const stringEnd = (text: string, start: number): number | undefined => {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') {
      index++;
    } else if (text[index] === '"') {
      return index + 1;
    }
  }

  return undefined;
};

const blockCommentEnd = (text: string, start: number, open: string, close: string): number => {
  let depth = 1;

  for (let index = start + open.length; index < text.length; index++) {
    if (text.startsWith(open, index)) {
      depth++;
      index += open.length - 1;
    } else if (text.startsWith(close, index)) {
      if (--depth === 0) {
        return index + close.length;
      }

      index += close.length - 1;
    }
  }

  return text.length;
};

const lineCommentEnd = (text: string, start: number): number => {
  const length = text.slice(start).search(/[\r\n]/);

  return length < 0 ? text.length : start + length;
};

/** Skip one Scheme datum, including reader prefixes and comments within lists. */
const schemeDatumEnd = (text: string, start: number): number => {
  let index = start;

  while (index < text.length) {
    if (/\s/.test(text[index]!)) {
      index++;
    } else if (text[index] === ';') {
      index = lineCommentEnd(text, index);
    } else if (text.startsWith('#|', index)) {
      index = blockCommentEnd(text, index, '#|', '|#');
    } else if (text.startsWith('#;', index)) {
      index = schemeDatumEnd(text, index + 2);
    } else {
      break;
    }
  }

  const char = text[index];

  if (char === '"') {
    return stringEnd(text, index) ?? text.length;
  }

  if (char === "'" || char === '`') {
    return schemeDatumEnd(text, index + 1);
  }

  if (char === ',') {
    return schemeDatumEnd(text, index + (text[index + 1] === '@' ? 2 : 1));
  }

  if (text.startsWith('#\\', index)) {
    // A character literal may itself be a delimiter, e.g. #\) or #\".
    index += 3;

    while (index < text.length && !/[\s()[\]";]/.test(text[index]!)) {
      index++;
    }

    return index;
  }

  const vectorPrefix = /^#(?:[a-z\d]+)?(?=\()/i.exec(text.slice(index));

  if (vectorPrefix) {
    index += vectorPrefix[0].length;
  }

  if (text[index] === '(' || text[index] === '[') {
    const close = text[index] === '(' ? ')' : ']';

    index++;

    while (index < text.length) {
      if (text[index] === close) {
        return index + 1;
      }

      const end = schemeDatumEnd(text, index);

      // An unmatched closing delimiter is ambiguous: preserve the rest of the source.
      if (end <= index) {
        return text.length;
      }

      index = end;
    }

    return text.length;
  }

  if (text.startsWith('#{', index)) {
    // Delimiters in embedded LilyPond strings/comments do not end the datum.
    index += 2;

    while (index < text.length) {
      if (text.startsWith('#}', index)) {
        return index + 2;
      }

      if (text.startsWith('%{', index)) {
        index = blockCommentEnd(text, index, '%{', '%}');
      } else if (text[index] === '%') {
        index = lineCommentEnd(text, index);
      } else if (text[index] === '"') {
        index = stringEnd(text, index) ?? text.length;
      } else if (text.startsWith('#{', index)) {
        index = schemeDatumEnd(text, index);
      } else if (text[index] === '#' || text[index] === '$') {
        const end = schemeDatumEnd(text, index + 1);

        if (end <= index + 1) {
          return text.length;
        }

        index = end;
      } else {
        index++;
      }
    }

    return text.length;
  }

  while (index < text.length && !/[\s()[\]";]/.test(text[index]!)) {
    index++;
  }

  return index;
};

const textCommands = new Set(['markup', 'markuplist', 'lyricmode', 'lyrics', 'addlyrics']);
// Unknown command arguments remain executable data. Only commands whose string
// arguments are displayed opt in, so user-defined functions are conservative too.
const renderedCommands = new Set([
  'mark',
  'textMark',
  'textEndMark',
  'tempo',
  'sectionLabel',
  'rehearsalMark',
]);
const markupTextCommands = new Set([
  'bold',
  'normal-weight',
  'italic',
  'upright',
  'normal-text',
  'sans',
  'roman',
  'typewriter',
  'box',
  'circle',
  'oval',
  'underline',
  'overline',
  'strike',
  'smaller',
  'larger',
  'tiny',
  'small',
  'normalsize',
  'large',
  'huge',
  'fontsize',
  'magnify',
  'concat',
  'line',
  'column',
  'center-column',
  'left-column',
  'right-column',
  'center-align',
  'left-align',
  'right-align',
  'justify',
  'wordwrap',
  'fill-line',
  'fill-with-pattern',
  'pad-around',
  'pad-markup',
  'pad-to-box',
  'raise',
  'lower',
  'translate',
  'rotate',
  'with-color',
  'with-url',
  'transparent',
  'override',
  'abs-fontsize',
  'whiteout',
]);
const renderedProperties = new Set([
  'instrumentName',
  'shortInstrumentName',
  'vocalName',
  'shortVocalName',
  'text',
  'cueInstrument',
]);

type TextBlock = 'source' | 'text' | 'header';
const identifierChar = /[\p{L}\p{M}\p{N}_-]/u;

/**
 * Only strings and bare words in explicit text blocks are rendered text. All other
 * tokens are source identifiers or executable data and must survive unchanged.
 */
const replaceInRenderedText = (
  text: string,
  pattern: RegExp,
  replacement: string,
): { text: string; count: number } => {
  let result = '';
  let count = 0;
  let pendingText = false;
  let pendingUrl = false;
  let commandText: boolean | undefined;
  let pendingBlock: TextBlock | undefined;
  let lastToken = '';
  const blocks: TextBlock[] = [];
  const replace = (value: string) => {
    count += (value.match(pattern) ?? []).length;

    return value.replace(pattern, replacement);
  };

  for (let index = 0; index < text.length; ) {
    const start = index;
    const char = text[index]!;
    const inText: boolean =
      !pendingUrl && (commandText ?? (pendingText || blocks.at(-1) === 'text'));

    if (text.startsWith('%{', index)) {
      index = blockCommentEnd(text, index, '%{', '%}');
    } else if (char === '%') {
      index = lineCommentEnd(text, index);
    } else if (char === '#' || char === '$') {
      const end = schemeDatumEnd(text, index + 1);

      index = end > index + 1 ? end : text.length;
      pendingUrl = false;
    } else if (char === '"') {
      const end = stringEnd(text, index);

      index = end ?? text.length;
      const attachedText = /[-^_]\s*$/.test(text.slice(0, start));

      if (pendingUrl) {
        pendingUrl = false;
      } else if ((inText || attachedText) && end !== undefined) {
        result += '"' + replace(text.slice(start + 1, index - 1)) + '"';
        pendingText = false;
        pendingBlock = undefined;
        commandText = undefined;
        continue;
      }
    } else if (char === '\\') {
      index++;

      while (index < text.length && identifierChar.test(text[index]!)) {
        index++;
      }

      if (index === start + 1 && index < text.length) {
        index++;
      }

      const command = text.slice(start + 1, index);

      if (pendingUrl) {
        pendingUrl = false;
        result += text.slice(start, index);
        continue;
      }

      const rendersText: boolean =
        textCommands.has(command) ||
        renderedCommands.has(command) ||
        (inText && markupTextCommands.has(command));

      commandText = rendersText;
      pendingUrl = inText && command === 'with-url';
      pendingText = rendersText || command === 'lyricsto';
      pendingBlock =
        command === 'header' ? 'header' : rendersText || command === 'lyricsto' ? 'text' : 'source';
      lastToken = '';

      if (inText && command === 'char') {
        const argument = /^\s+##x[\da-f]+/i.exec(text.slice(index));

        if (argument) {
          index += argument[0].length;
          result += replace(text.slice(start, index));
          // The complete command argument was consumed; following text belongs
          // to the enclosing markup again, including on later rule passes.
          commandText = undefined;
          pendingBlock = undefined;
          pendingText = false;
          continue;
        }
      }
    } else if (char === '{') {
      pendingUrl = false;
      blocks.push(pendingBlock ?? (inText ? 'text' : 'source'));
      pendingBlock = undefined;
      commandText = undefined;
      pendingText = false;
      index++;
    } else if (char === '}') {
      pendingUrl = false;
      blocks.pop();
      pendingBlock = undefined;
      commandText = undefined;
      pendingText = false;
      index++;
    } else if (char === '=') {
      pendingUrl = false;
      const property = lastToken.split('.').at(-1) ?? '';

      pendingText = blocks.at(-1) === 'header' || renderedProperties.has(property);
      commandText = undefined;
      pendingBlock = undefined;
      index++;
    } else if (/\s/.test(char)) {
      index++;
    } else {
      // Read a complete bare token, so Unicode identifiers are never split up.
      while (index < text.length && !/[\s{}"\\%#$=]/.test(text[index]!)) {
        index++;
      }

      lastToken = text.slice(start, index);
      pendingUrl = false;

      if (inText && !/^\s*=/.test(text.slice(index))) {
        result += replace(text.slice(start, index));
        pendingText = false;
        continue;
      }
    }

    result += text.slice(start, index);
  }

  return { text: result, count };
};

export function sanitizeUnsupportedText(text: string): SanitizedText {
  let sanitized = text;
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    const outcome = replaceInRenderedText(sanitized, rule.pattern, rule.replacement);

    if (!outcome.count) {
      continue;
    }

    sanitized = outcome.text;
    diagnostics.push({
      code: rule.code,
      message: `${rule.message} ${outcome.count} occurrence(s) in the source text.`,
    });
  }

  return { text: sanitized, diagnostics };
}

export interface SanitizedInput {
  readonly source: string;
  readonly files: Readonly<Record<string, string | Uint8Array>>;
  readonly diagnostics: readonly Diagnostic[];
}

export function sanitizeInput(
  source: string,
  files: Readonly<Record<string, string | Uint8Array>> | undefined,
): SanitizedInput {
  const sourceText = sanitizeUnsupportedText(source);
  const diagnostics: Diagnostic[] = [...sourceText.diagnostics];
  const fileTexts: Record<string, string | Uint8Array> = {};

  for (const [name, content] of Object.entries(files ?? {})) {
    if (typeof content === 'string') {
      const sanitizedText = sanitizeUnsupportedText(content);

      diagnostics.push(...sanitizedText.diagnostics);
      fileTexts[name] = sanitizedText.text;
    } else {
      fileTexts[name] = content;
    }
  }

  return { source: sourceText.text, files: fileTexts, diagnostics };
}
