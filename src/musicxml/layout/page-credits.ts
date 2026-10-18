import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import type { Node } from '@oozcitak/dom/lib/dom/interfaces.js';
import { isXmlElement } from '../primitives.js';
import { musicXMLColor } from '../notation/colors.js';
import type { Add } from '../types.js';
import type { Warn } from '../../model/diagnostics.js';
import type { PageCreditRegion, PageSystemLayout, ScoreDocument } from '../../model/document.js';

type SourcePage = Pick<
  PageSystemLayout,
  'book' | 'bookpart' | 'scope' | 'page' | 'displayedPage' | 'outputScale' | 'width' | 'height'
>;
export interface NativeCreditPage {
  readonly source: SourcePage;
  /** Standalone MusicXML page ordinal, independent of LilyPond's displayed label. */
  readonly nativePage: number;
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;
const integer = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
const owner = (row: { book: number; bookpart: number; scope: number; page: number }) =>
  `${row.book}:${row.bookpart}:${row.scope}:${row.page}`;
const validText = (s: unknown): s is string =>
  typeof s === 'string' &&
  !/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(s);
const elementChildren = (node: Node) => Array.from(node.childNodes).filter(isXmlElement);
const tag = (node: Node) => (isXmlElement(node) ? node.localName : '');

function fontAttributes(
  description: string | null,
  leafScale: number | null,
  warn: Warn,
): Record<string, string | number> {
  if (typeof description !== 'string' || (leafScale !== null && !positive(leafScale))) {
    warn(
      'page-credit-font',
      'A resolved page text leaf lacks a supported actual font description. Its text is retained without guessed font attributes.',
    );

    return {};
  }

  const size = description.match(/\s+([0-9]+(?:\.[0-9]+)?)$/);

  if (!size) {
    warn(
      'page-credit-font',
      'A resolved page text leaf has an unsupported Pango font description. Its text is retained without guessed font attributes.',
    );

    return {};
  }

  let family = description.slice(0, size.index).trim();
  const styles = new Set<string>();
  let unsupportedVariant = false;
  const known = new Set([
    'Bold',
    'Italic',
    'Small-Caps',
    'Oblique',
    'Light',
    'Heavy',
    'Medium',
    'Condensed',
    'Book',
    'Roman',
    'Normal',
  ]);

  while (true) {
    const suffix = family.match(/(?:,\s*|\s+)([A-Za-z][A-Za-z-]*)$/);
    const variant = suffix?.[1];

    if (!suffix || !variant || !known.has(variant)) {
      break;
    }

    const supported = ['Bold', 'Italic', 'Small-Caps', 'Normal'].includes(variant);

    if (!supported && !suffix[0]!.startsWith(',')) {
      break;
    }

    family = family.slice(0, suffix.index).replace(/,$/, '').trim();

    if (['Bold', 'Italic', 'Small-Caps'].includes(variant)) {
      styles.add(variant);
    } else if (variant !== 'Normal') {
      unsupportedVariant = true;
    }
  }

  if (!family) {
    warn(
      'page-credit-font',
      'A resolved page text leaf has an unsupported Pango family description. Its text is retained without guessed font attributes.',
    );

    return {};
  }

  if (unsupportedVariant) {
    warn(
      'page-credit-font',
      'A resolved page text leaf uses an unsupported Pango font variant. Its text is retained without guessed font styling.',
    );

    return {};
  }

  const points = ((Number(size[1]) * 72) / 25.4) * (leafScale ?? 1);

  if (!positive(points)) {
    warn(
      'page-credit-font',
      'A resolved page text leaf has a nonfinite physical font size. Its text is retained without guessed font attributes.',
    );

    return {};
  }

  if (styles.has('Small-Caps')) {
    warn(
      'page-credit-font',
      'Small-cap shaping remains source metadata; native page text retains its available family, size, weight and style.',
    );
  }

  return {
    'font-family': family,
    'font-size': points,
    'font-weight': styles.has('Bold') ? 'bold' : 'normal',
    'font-style': styles.has('Italic') ? 'italic' : 'normal',
  };
}

/** Project resolved source text only to actual source pages emitted in the native document. */
export function writeResolvedPageCredits(
  root: XMLBuilder,
  partList: XMLBuilder,
  document: ScoreDocument,
  pages: readonly NativeCreditPage[],
  add: Add,
  warn: Warn,
): void {
  const priorCredits = elementChildren(root.node)
    .filter((node) => tag(node) === 'credit')
    .map((creditNode) => {
      const children = elementChildren(creditNode),
        type = children.find((child) => tag(child) === 'credit-type')?.textContent?.trim() ?? '';
      const words = children
        .filter((child) => tag(child) === 'credit-words')
        .map((child) => child.textContent ?? '');

      return { node: creditNode, type, words };
    });
  const legacyRightsWords = new Set(
    priorCredits.filter((credit) => credit.type === 'rights').flatMap((credit) => credit.words),
  );
  const replaceableFirstPageRegions = new Set<'header' | 'footer'>();
  const rows = document.pageCredits;
  const captured = document.pageCreditsCaptured;

  if (captured !== true) {
    if (rows?.length) {
      warn(
        'page-credit-history',
        'Resolved running text lacks confirmed source page capture. Cached page text is not assigned to guessed pages.',
      );
    }

    return;
  }

  const stages = document.events.filter((e) => e.kind === 'finalLayout');

  if (
    stages.length !== 1 ||
    stages[0]!.status !== 'complete' ||
    stages[0]!.stage !== 'book' ||
    stages[0]!.attempted !== true
  ) {
    warn(
      'page-credit-capture',
      'Completed actual page capture is unavailable; running header/footer text remains metadata without guessed page ownership.',
    );

    return;
  }

  if (!Array.isArray(rows)) {
    warn(
      'page-credit-history',
      'The page-credit capture marker has no resolved region table. Running credits are not reconstructed from templates.',
    );

    return;
  }

  const active = new Map<string, NativeCreditPage>();
  const ambiguousPages = new Set<string>();

  for (const page of pages) {
    const source = page?.source;

    if (
      !source ||
      ![source.book, source.scope, source.page].every(integer) ||
      !Number.isSafeInteger(source.bookpart) ||
      source.bookpart < 0 ||
      !integer(page.nativePage)
    ) {
      warn(
        'page-credit-ownership',
        'An emitted native page has invalid source ownership; its resolved running text is omitted.',
      );
      continue;
    }

    const key = owner(source);

    if (ambiguousPages.has(key)) {
      continue;
    }

    const previous = active.get(key);

    if (previous && previous.nativePage !== page.nativePage) {
      warn(
        'page-credit-ownership',
        'Actual Systems on one source page disagree about their standalone page ordinal. Its running credits are omitted.',
      );
      active.delete(key);
      ambiguousPages.add(key);
      continue;
    }

    active.set(key, page);
  }

  const grouped = new Map<string, PageCreditRegion[]>();

  for (const row of rows) {
    if (
      !row ||
      typeof row !== 'object' ||
      ![row.book, row.scope, row.page].every(integer) ||
      !Number.isSafeInteger(row.bookpart) ||
      row.bookpart < 0 ||
      !(row.displayedPage === null || Number.isSafeInteger(row.displayedPage)) ||
      !(row.region === 'header' || row.region === 'footer') ||
      typeof row.resolved !== 'boolean' ||
      !Array.isArray(row.items) ||
      !Array.isArray(row.primitives)
    ) {
      warn(
        'page-credit-data',
        'A resolved page-credit region has invalid ownership or shape. It is omitted without moving text to another page.',
      );
      continue;
    }

    const key = owner(row),
      group = grouped.get(key) ?? [];

    group.push(row);
    grouped.set(key, group);
  }

  let emitted = false;

  for (const [key, page] of active) {
    const regions = grouped.get(key) ?? [];

    if (regions.length !== 2 || new Set(regions.map((region) => region.region)).size !== 2) {
      warn(
        'page-credit-ownership',
        'An emitted source page lacks a unique resolved header and footer region pair. No template or nearby page is used as a substitute.',
      );
      continue;
    }

    const source = page.source;

    if (
      regions.some(
        (region) =>
          region.displayedPage !== source.displayedPage ||
          !positive(region.outputScale) ||
          !positive(region.width) ||
          !positive(region.height) ||
          !positive(source.outputScale) ||
          !positive(source.width) ||
          !positive(source.height) ||
          !close(region.outputScale, source.outputScale) ||
          !close(region.width, source.width) ||
          !close(region.height, source.height),
      )
    ) {
      warn(
        'page-credit-ownership',
        'Resolved running text and the actual source page disagree about their physical frame or displayed label. No page is selected arbitrarily.',
      );
      continue;
    }

    for (const region of regions) {
      if (!region.resolved) {
        warn(
          'page-credit-capture',
          'An actual page or header/footer stencil was unresolved. Its formatter is not rerun to invent text.',
        );
        continue;
      }

      if (region.primitives.length) {
        warn(
          'page-credit-drawing',
          'A resolved header/footer contains unsupported drawing. Independently captured text is retained; other primitives remain structured metadata.',
        );
      }

      const pieces = new Map<number, number>();

      for (const item of region.items) {
        if (item && typeof item === 'object') {
          pieces.set(item.piece, (pieces.get(item.piece) ?? 0) + 1);
        }
      }

      let regionDataValid = true;

      for (const item of region.items) {
        if (
          !item ||
          typeof item !== 'object' ||
          !integer(item.piece) ||
          pieces.get(item.piece) !== 1 ||
          !validText(item.text) ||
          !(item.fontDescription === null || typeof item.fontDescription === 'string') ||
          !(item.x === null || finite(item.x)) ||
          !(item.y === null || finite(item.y)) ||
          !(item.fontScale === null || positive(item.fontScale)) ||
          !(
            item.color === null ||
            (Array.isArray(item.color) &&
              [3, 4].includes(item.color.length) &&
              item.color.every((c) => finite(c) && c >= 0 && c <= 1))
          ) ||
          !Array.isArray(item.unsupported) ||
          item.unsupported.some((reason) => typeof reason !== 'string')
        ) {
          regionDataValid = false;
          warn(
            'page-credit-data',
            'A captured page text leaf has invalid or duplicated identity, text, color or provenance. It is omitted without guessing another leaf.',
          );
          continue;
        }

        if (!item.text) {
          continue;
        }

        // The old header writer can preserve resolved first-page templates and
        // rights as ordinary credits. Keep those credits when capture is absent,
        // but let a complete actual page stencil replace inferred running text.
        if (
          page.nativePage === 1 &&
          region.region === 'footer' &&
          legacyRightsWords.has(item.text)
        ) {
          continue;
        }

        if (item.unsupported.length) {
          warn(
            'page-credit-transform',
            'A resolved page text leaf has unsupported source transforms. Its text and independently known styling remain without guessed geometry.',
          );
        }

        const factor =
          positive(region.outputScale) && positive(document.paper?.['staff-space'])
            ? (region.outputScale * 10) / document.paper['staff-space']
            : null;
        const x = item.unsupported.length
          ? null
          : positive(factor) && finite(item.x)
            ? item.x * factor
            : null;
        const y = item.unsupported.length
          ? null
          : positive(factor) && finite(item.y) && positive(region.height)
            ? (region.height - item.y) * factor
            : null;
        const positioned = finite(x) && finite(y) && Number.isFinite(x) && Number.isFinite(y);

        if (!positioned) {
          warn(
            'page-credit-position',
            'A resolved page text leaf lacks a proven physical page baseline. Its text remains without guessed credit coordinates.',
          );
        }

        const credit = add(root, 'credit', undefined, {
          page: page.nativePage,
        });

        add(credit, 'credit-type', region.region === 'header' ? 'page header' : 'page footer');
        const color = item.color ? musicXMLColor(item.color) : undefined;

        add(credit, 'credit-words', item.text, {
          ...fontAttributes(item.fontDescription, item.fontScale, warn),
          ...(positioned ? { 'default-x': x!, 'default-y': y! } : {}),
          ...(color ? { color } : {}),
          justify: 'left',
          halign: 'left',
          valign: 'baseline',
          'xml:space': 'preserve',
        });
        // Credit belongs before part-list in score-partwise even though source page
        // ownership is resolved only after the converter has mapped all Systems.
        root.node.insertBefore(credit.node, partList.node);
        emitted = true;
      }

      if (page.nativePage === 1 && regionDataValid) {
        replaceableFirstPageRegions.add(region.region);
      }
    }
  }

  for (const credit of priorCredits) {
    const region =
      credit.type === 'page header' ? 'header' : credit.type === 'page footer' ? 'footer' : null;

    if (region && replaceableFirstPageRegions.has(region) && credit.node) {
      credit.node.parentNode?.removeChild(credit.node);
    }
  }

  if (active.size) {
    for (const key of active.keys()) {
      if (!grouped.has(key)) {
        warn(
          'page-credit-history',
          'An emitted actual source page lacks resolved header/footer history. Its running credits are not inferred from templates or page parity.',
        );
      }
    }
  }

  if (emitted) {
    warn(
      'page-credit-layout',
      'Native page credits retain actual cached source text and supported typography; mixed shaping and unsupported drawings remain partial.',
    );
  }
}
