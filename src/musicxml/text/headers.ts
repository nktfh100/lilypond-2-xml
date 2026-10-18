import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Add, Attributes } from '../types.js';
import type { Warn } from '../../model/diagnostics.js';
import type { writePaper } from '../layout/paper.js';
import { textRuns } from './runs.js';
import type { ScoreDocument, TextMarkup } from '../../model/document.js';

const fields = [
  ['dedication', 'dedication', 'center'],
  ['title', 'title', 'center'],
  ['subtitle', 'subtitle', 'center'],
  ['subsubtitle', 'subtitle', 'center'],
  ['instrument', 'part name', 'center'],
  ['poet', 'lyricist', 'left'],
  ['composer', 'composer', 'right'],
  ['arranger', 'arranger', 'right'],
  ['meter', 'meter', 'left'],
  ['piece', 'movement title', 'left'],
  ['opus', 'opus', 'right'],
  ['copyright', 'rights', 'center'],
] as const;
const reset: Attributes = {
  'font-weight': 'normal',
  'font-style': 'normal',
  'font-family': 'serif',
  'font-size': 'medium',
  color: '#000000',
  enclosure: 'none',
  underline: 0,
  overline: 0,
  'line-through': 0,
  rotation: 0,
};

export function writeHeaderCredits(
  root: XMLBuilder,
  document: ScoreDocument,
  paper: ReturnType<typeof writePaper>,
  add: Add,
  warn: Warn,
  runningCaptured = false,
) {
  const templates = document.pageHeaderMarkup ?? {};
  const items: {
    type: string;
    align: string;
    value: TextMarkup;
    footer: boolean;
    blank?: boolean;
    context?: import('../../model/document.js').HeaderFontContext;
  }[] = [];
  const custom = (name: string) => Object.hasOwn(templates, name);
  const firstFooter =
    Number(document.paper?.['first-page-number'] ?? 1) % 2 ? 'oddFooterMarkup' : 'evenFooterMarkup';
  const scoreValues: Record<string, TextMarkup> = Object.assign(
    Object.create(null),
    document.header,
  );

  for (const [key, value] of Object.entries(document.headerMarkup ?? {})) {
    if (value !== null) {
      scoreValues[key] = value;
    }
  }

  const bookValues = document.headerScopes?.book ?? scoreValues;
  const bookStart = document.headerScopes?.bookStart ?? true;
  const resolve = (value: TextMarkup, values: Readonly<Record<string, TextMarkup>>) => {
    let resolved = true;
    const visit = (node: TextMarkup, path: ReadonlySet<string>): TextMarkup => {
      if (Array.isArray(node)) {
        return node.map((child) => visit(child, path));
      }

      if (node && typeof node === 'object' && 'command' in node) {
        if (node.command === 'fromproperty-markup') {
          const key = String(node.args[0]);

          if (!key.startsWith('header:') || path.has(key)) {
            resolved = false;

            return node;
          }

          const field = key.slice(7),
            child = Object.hasOwn(values, field) ? values[field] : undefined;

          return child === undefined ? '' : visit(child, new Set([...path, key]));
        }

        return { ...node, args: node.args.map((child) => visit(child, path)) };
      }

      return node;
    };

    return { value: visit(value, new Set()), resolved };
  };
  const defaults = (
    values: Readonly<Record<string, TextMarkup>>,
    section: 'book' | 'score' | 'rights',
  ) => {
    for (const [field, type, align] of fields) {
      const group = ['piece', 'opus'].includes(field)
        ? 'score'
        : field === 'copyright'
          ? 'rights'
          : 'book';

      if (group !== section) {
        continue;
      }

      const rawValue = values[field];
      const value = rawValue === undefined ? undefined : resolve(rawValue, values).value;

      if (value !== undefined && value !== false && value !== null) {
        items.push({
          type,
          align,
          value,
          footer: field === 'copyright',
          ...(document.headerStyles?.[field] ? { context: document.headerStyles[field] } : {}),
        });
      }
    }
  };
  const template = (
    name: string,
    type: string,
    align: string,
    footer: boolean,
    values: Readonly<Record<string, TextMarkup>>,
  ) => {
    if (templates[name] === false || templates[name] === null) {
      return;
    }

    const resolution = resolve(templates[name] ?? null, values),
      value = resolution.value;
    let resolved = resolution.resolved;

    textRuns(
      value,
      { ...document.headerStyleBase?.attrs },
      (code) => {
        if (code === 'markup-command') {
          resolved = false;
        }
      },
      document.headerStyleBase?.reference,
    );

    if (resolved) {
      items.push({
        type,
        align,
        value,
        footer,
        ...(document.headerStyleBase ? { context: document.headerStyleBase } : {}),
      });
    }
  };

  if (bookStart) {
    if (custom('bookTitleMarkup')) {
      template('bookTitleMarkup', 'title', 'center', false, bookValues);
    } else {
      defaults(bookValues, 'book');
    }
  }

  if (custom('scoreTitleMarkup')) {
    template('scoreTitleMarkup', 'movement title', 'left', false, scoreValues);
  } else {
    if (document.headerScopes?.printAllHeaders) {
      defaults(scoreValues, 'book');
    }

    defaults(scoreValues, 'score');
  }

  if (bookStart && !runningCaptured) {
    const firstHeader =
      Number(document.paper?.['first-page-number'] ?? 1) % 2
        ? 'oddHeaderMarkup'
        : 'evenHeaderMarkup';

    if (custom(firstHeader)) {
      template(firstHeader, 'page header', 'center', false, bookValues);
    }

    if (custom(firstFooter)) {
      template(firstFooter, 'page footer', 'center', true, bookValues);
    } else {
      defaults(bookValues, 'rights');
    }
  }

  if (
    !document.headerScopes &&
    items.some((item) => textRuns(item.value, {}, () => {}).some((r) => r.text.trim()))
  ) {
    warn(
      'header-scope-history',
      'This cached document lacks book/score header scopes and print-all-headers policy. Credits use merged header values without verified title ownership or repetition.',
    );
  }

  const metadataHeading = !!(
    document.header.title ||
    document.header.composer ||
    document.header.arranger ||
    document.header.poet
  );

  if (
    (custom('bookTitleMarkup') || (document.headerScopes && metadataHeading)) &&
    !items.some(
      (item) => !item.footer && textRuns(item.value, {}, () => {}).some((r) => r.text.trim()),
    )
  ) {
    items.push({
      type: 'title',
      align: 'center',
      value: ' ',
      footer: false,
      blank: true,
    });
  }

  if (
    !runningCaptured &&
    Object.entries(templates).some(
      ([name, value]) =>
        value !== false &&
        value !== null &&
        !(name === 'bookTitleMarkup' || name === 'scoreTitleMarkup'),
    )
  ) {
    warn(
      'page-header-template',
      'Custom running-header and footer templates remain in structured metadata. Static first-page text is retained when resolvable; page conditions, dynamic references and repetition require resolved pagination.',
    );
  }

  if (
    ['bookTitleMarkup', 'scoreTitleMarkup'].some(
      (name) => custom(name) && templates[name] !== false && templates[name] !== null,
    )
  ) {
    warn(
      'header-title-template',
      'Custom title templates retain resolvable text and styles as native first-page credits. Unsupported graphical commands, conditional procedures and exact composite layout remain in structured metadata.',
    );
  }

  if (bookValues.tagline && !runningCaptured) {
    warn(
      'header-tagline',
      'The tagline remains in structured metadata; its last-page position requires resolved pagination and is not assigned to a guessed page.',
    );
  }

  if (!paper && items.length) {
    warn(
      'header-page',
      'Native credit text and styles have no captured physical page geometry; absolute header/footer coordinates are omitted.',
    );
  }

  let y = paper ? paper.page.height - paper.page.top : undefined;

  for (const { type, align, value, footer, blank, context } of items) {
    const runs = textRuns(value, { ...context?.attrs }, warn, context?.reference);

    if (!blank && !context) {
      warn(
        'header-font-context',
        'This header lacks captured template font context; explicit styles remain native without verified inherited weights, families or point sizes.',
      );
    }

    if (context?.unsupported.length) {
      warn(
        'header-font-style',
        `Unsupported inherited header font settings: ${context.unsupported.join(', ')}. Available native text styles are retained.`,
      );
    }

    if (!blank && !runs.some((r) => r.text.trim())) {
      continue;
    }

    const credit = add(root, 'credit', undefined, { page: 1 });

    add(credit, 'credit-type', type);
    const x = paper
      ? align === 'left'
        ? paper.page.left
        : align === 'right'
          ? paper.page.width - paper.page.right
          : (paper.page.left + paper.page.width - paper.page.right) / 2
      : undefined;

    for (const [i, run] of runs.entries()) {
      add(credit, 'credit-words', run.text, {
        ...reset,
        justify: align,
        halign: align,
        valign: footer ? 'bottom' : 'top',
        ...run.attrs,
        ...(blank ? { color: '#00000000' } : {}),
        ...(i === 0 && x !== undefined ? { 'default-x': x } : {}),
        ...(y !== undefined ? { 'default-y': footer ? paper!.page.bottom : y } : {}),
        'xml:space': 'preserve',
      });
    }

    if (!footer && y !== undefined) {
      const size = Math.max(
        12,
        ...runs.map((r) => (typeof r.attrs['font-size'] === 'number' ? r.attrs['font-size'] : 12)),
      );

      y -= size * 1.5 * paper!.point;
    }

    warn(
      'header-layout',
      'Header text and supported styles use native first-page credits in a nominal page-margin arrangement. Exact baselines, book/score title placement and pagination are not captured.',
    );
  }
}
